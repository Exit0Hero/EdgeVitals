import { describe, expect, it } from 'vitest';
import { PIPELINE_CONFIG } from '../src/config';
import { consensusHeartRate, minConsensusAgreement } from '../src/estimators';
import { pbv } from '../src/pbv';
import { analyzeSession } from '../src/pipeline';
import { ScanSession } from '../src/session';
import { phoneNoiseSession } from './fixtures/phoneNoise';
import { syntheticSession } from './fixtures/synthetic';

const hrOf = (r: ReturnType<typeof analyzeSession>) =>
  r.metrics.find((m) => m.metric === 'heart_rate')!;

describe('window-consensus heart rate', () => {
  it('needs fewer agreeing windows the more windows there are', () => {
    expect(minConsensusAgreement(18)).toBeGreaterThan(minConsensusAgreement(26));
    expect(minConsensusAgreement(26)).toBeGreaterThan(minConsensusAgreement(41));
    expect(minConsensusAgreement(41)).toBeGreaterThan(0.6);
  });

  it('needs about 40 s of signal', () => {
    const fs = PIPELINE_CONFIG.sampleRateHz;
    expect(consensusHeartRate(new Array(39 * fs).fill(0).map(Math.random), fs)).toBeNull();
    expect(consensusHeartRate(new Array(41 * fs).fill(0).map(Math.random), fs)).not.toBeNull();
  });

  it('finds a clean pulse with PBV and every window agreeing', () => {
    const fs = 30;
    const n = 45 * fs;
    const p = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 72 * i) / 60 / fs));
    const r = p.map((v) => 170 * (1 + 0.003 * 0.33 * v));
    const g = p.map((v) => 140 * (1 + 0.003 * 0.77 * v));
    const b = p.map((v) => 115 * (1 + 0.003 * 0.53 * v));
    const c = consensusHeartRate(pbv(r, g, b, 288, fs, PIPELINE_CONFIG.hrBandHz), fs)!;
    expect(c.agreement).toBe(1);
    expect(Math.abs(c.bpm - 72)).toBeLessThan(1);
  });

  // Weak pulses in phone-like noise (whole-scan SNR around 0 dB, like the
  // locked-exposure iQOO trace) used to fail the halves and beat checks.
  // v0.4.1 raised the window bar (hrFusion.ts consensusPerWindow 6.5, after
  // ~0.7% false readings on per-region noise), so fewer read at 45 s; the
  // scan extends to 75 s when heart rate has not passed, and most read there.
  it.each([
    [45, 15],
    [75, 18],
  ])('reads weak pulses in phone-like noise within 2 bpm at %i s', (durationSec, minRead) => {
    let accepted = 0;
    for (let s = 0; s < 20; s++) {
      const bpm = 48 + ((s * 37) % 100);
      const res = analyzeSession(
        phoneNoiseSession({ seed: 7000 + s, durationSec, pulse: { bpm, amplitude: 0.0008 } }),
      );
      const hr = hrOf(res);
      if (hr.status !== 'valid') continue;
      accepted++;
      expect(Math.abs(hr.value! - bpm)).toBeLessThanOrEqual(2);
    }
    expect(accepted).toBeGreaterThanOrEqual(minRead);
  });

  it('accepts no heart rate from phone-like noise, at any scan length up to 90 s', () => {
    let accepted = 0;
    for (let s = 0; s < 120; s++) {
      const res = analyzeSession(
        phoneNoiseSession({
          seed: 40000 + s,
          durationSec: [20, 30, 45, 60, 75, 90][s % 6],
          scale: [0.5, 1, 2][s % 3],
          ar: s % 2 ? 0.95 : 0.8,
        }),
      );
      if (res.metrics.some((m) => m.status === 'valid')) accepted++;
    }
    expect(accepted).toBe(0);
  });
});

describe('scan length', () => {
  const run = (frames: ReturnType<typeof phoneNoiseSession>) => {
    const s = new ScanSession();
    for (const f of frames) {
      s.pushFrame({ t: f.t, faces: [f.face!], roi: f.roi, frameWidth: 480, frameHeight: 640 });
      s.liveState();
      if (s.shouldFinish()) return { sec: f.t / 1000, s };
    }
    return { sec: Infinity, s };
  };

  it('stops at 45 s once the heart rate has passed', () => {
    const { sec } = run(syntheticSession({ durationSec: 80, noise: 0.03, seed: 4 }).frames);
    expect(sec).toBeGreaterThanOrEqual(45);
    expect(sec).toBeLessThan(46);
  });

  it('keeps scanning up to 75 s while no heart rate has passed', () => {
    const { sec, s } = run(phoneNoiseSession({ seed: 77, durationSec: 80 }));
    expect(sec).toBeGreaterThanOrEqual(75);
    expect(sec).toBeLessThan(76);
    expect(s.liveState().extended).toBe(true);
  });
});
