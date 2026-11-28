import { describe, expect, it } from 'vitest';
import { HR_FUSION, fuseHeartRate } from '../src/hrFusion';
import { analyzeSession } from '../src/pipeline';
import type { PulseCandidate, RppgMethod, SignalRegion } from '../src/rppg';
import { gauss, labelFrames, mulberry32, syntheticFaceSession } from '../validation/synthetic';
import { phoneNoiseRegionsSession } from './fixtures/phoneNoise';

// All recordings here are SYNTHETIC. They check the fusion rules (agree,
// abstain, never force a value), not accuracy on people.

const hrOf = (o: Parameters<typeof syntheticFaceSession>[0]) =>
  analyzeSession(labelFrames(syntheticFaceSession(o).inputs)).metrics.find(
    (m) => m.metric === 'heart_rate',
  )!;

const FS = 30;
function candidate(
  method: RppgMethod,
  region: SignalRegion,
  hz: number,
  seed: number,
  sec = 60,
): PulseCandidate {
  const rng = mulberry32(seed);
  const pulse = Array.from(
    { length: sec * FS },
    (_, i) => Math.sin(2 * Math.PI * hz * (i / FS)) + 0.3 * gauss(rng),
  );
  return { method, region, pulse, stats: { windows: 0, skipped: 0 } };
}
function cleanWindows(sec = 60) {
  const starts: number[] = [];
  for (let s = 0; s + HR_FUSION.windowSec <= sec; s += HR_FUSION.hopSec) starts.push(s);
  return { starts, artefact: starts.map(() => null) };
}

describe('heart-rate fusion (synthetic)', () => {
  it('reads a clear multi-region pulse and reports which path passed', () => {
    const hr = hrOf({ seed: 11, durationSec: 60, heartRateBpm: 72 });
    expect(hr.status).toBe('valid');
    expect(Math.abs(hr.value! - 72)).toBeLessThan(2);
    expect(hr.quality?.uncertainty).toBeNull();
    expect(hr.quality?.uncertaintyNote).toBe('not_calibrated');
    expect(['good', 'fair']).toContain(hr.quality?.grade);
  });

  it.each([21, 22, 23, 24, 25])(
    'reports no heart rate from pulseless recordings (seed %i)',
    (seed) => {
      const hr = hrOf({
        seed,
        durationSec: 60,
        noPulse: true,
        regionNoise: 0.6,
        commonNoise: 0.001,
      });
      expect(hr.value).toBeNull();
      expect(hr.status).not.toBe('valid');
    },
  );

  it('still reads the pulse when one region carries none', () => {
    const hr = hrOf({ seed: 31, durationSec: 60, heartRateBpm: 64, regionPulseGain: [1, 1, 0] });
    expect(hr.status).toBe('valid');
    expect(Math.abs(hr.value! - 64)).toBeLessThan(2);
  });

  it('abstains instead of picking one when methods agree on different rates', () => {
    const c = [
      candidate('pos_v2', 'combined', 1.0, 1),
      candidate('chrom', 'combined', 1.0, 2),
      candidate('pbv', 'combined', 1.6, 3),
      candidate('pbv', 'forehead', 1.6, 4),
    ];
    const r = fuseHeartRate(c, FS, cleanWindows());
    expect(r.status).not.toBe('valid');
    expect(r.bpm).toBeNull();
    expect([
      'methods_disagree',
      'regions_disagree',
      'windows_disagree',
      'paths_disagree',
      'autocorrelation_disagrees',
    ]).toContain(r.failure);
  });

  it('abstains when regions disagree', () => {
    const c: PulseCandidate[] = [];
    let s = 10;
    for (const m of HR_FUSION.methods) {
      c.push(candidate(m, 'forehead', 1.1, s++));
      c.push(candidate(m, 'left_cheek', 1.1, s++));
      c.push(candidate(m, 'right_cheek', 1.75, s++));
      c.push(candidate(m, 'combined', 1.75, s++));
    }
    const r = fuseHeartRate(c, FS, cleanWindows());
    expect(r.bpm).toBeNull();
  });

  it('agrees when every candidate carries the same rate', () => {
    const c: PulseCandidate[] = [];
    let s = 50;
    for (const m of HR_FUSION.methods)
      for (const reg of ['combined', 'forehead', 'left_cheek'] as const)
        c.push(candidate(m, reg, 1.2, s++));
    const r = fuseHeartRate(c, FS, cleanWindows());
    expect(r.status).toBe('valid');
    expect(Math.abs(r.bpm! - 72)).toBeLessThan(1.5);
  });

  it('abstains when most windows are artefacts', () => {
    const c = HR_FUSION.methods.map((m, i) => candidate(m, 'combined', 1.2, 70 + i));
    const w = cleanWindows();
    const r = fuseHeartRate(c, FS, {
      starts: w.starts,
      artefact: w.starts.map((_, i) => (i % 4 ? 'face_motion' : null)),
    });
    expect(r.status).not.toBe('valid');
    expect(r.failure).toBe('artefacts');
  });

  it('abstains rather than reporting through repeated head movement', () => {
    const hr = hrOf({
      seed: 41,
      durationSec: 45,
      motionBursts: [5, 13, 21, 29, 37].map((t0) => ({ t0, t1: t0 + 1.5, px: 40, colourPct: 2 })),
    });
    expect(hr.value).toBeNull();
  });

  it('tolerates scattered single dropped frames', () => {
    const hr = hrOf({ seed: 51, durationSec: 60, heartRateBpm: 70, dropProbability: 0.05 });
    expect(hr.status).toBe('valid');
    expect(Math.abs(hr.value! - 70)).toBeLessThan(2);
  });

  // v0.4.0 read a heart rate from these two pulseless captures (independent
  // phone-like noise in each region): the stability-weighted fusion of 12
  // candidates produced a 16/18 and a 27/33 window consensus that no single
  // method carried. v0.4.1 requires a carrying method.
  it.each([
    [51007, 45.75],
    [51019, 75],
  ])('reports no heart rate from per-region noise (seed %i, %f s)', (seed, durationSec) => {
    const res = analyzeSession(phoneNoiseRegionsSession({ seed, durationSec }));
    const hr = res.metrics.find((m) => m.metric === 'heart_rate')!;
    expect(hr.value).toBeNull();
  });

  it('reports no heart rate from 40 per-region noise captures of 45-75 s', () => {
    let accepted = 0;
    for (let s = 0; s < 40; s++) {
      const res = analyzeSession(
        phoneNoiseRegionsSession({ seed: 700000 + s, durationSec: 45 + (s % 3) * 15 }),
      );
      if (res.metrics.find((m) => m.metric === 'heart_rate')!.status === 'valid') accepted++;
    }
    expect(accepted).toBe(0);
  }, 60_000);

  it('still reads weak in-phase pulses in per-region noise', () => {
    let read = 0;
    for (let s = 0; s < 10; s++) {
      const bpm = 55 + s * 8;
      const res = analyzeSession(
        phoneNoiseRegionsSession({
          seed: 710000 + s,
          durationSec: 60,
          pulse: { bpm, amplitude: 0.0008 },
        }),
      );
      const hr = res.metrics.find((m) => m.metric === 'heart_rate')!;
      if (hr.status !== 'valid') continue;
      read++;
      expect(Math.abs(hr.value! - bpm)).toBeLessThanOrEqual(3);
    }
    expect(read).toBeGreaterThanOrEqual(7);
  });
});
