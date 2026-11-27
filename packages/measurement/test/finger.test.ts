import { describe, expect, it } from 'vitest';
import {
  FINGER_CONFIG,
  FingerScanSession,
  analyzeFingerSession,
  assessFingerFrame,
  extractFingerYuv,
  fuseBreathing,
} from '../src/finger';
import { fingerSession } from './fixtures/fingerSynthetic';

const metric = (r: ReturnType<typeof analyzeFingerSession>, m: string) =>
  r.metrics.find((x) => x.metric === m)!;

/**
 * Synthetic-signal checks of the finger scan. They bound estimator error and
 * false acceptance on traces with known truth. They are software regression
 * guards, not validation on people.
 */
describe('finger scan: accuracy on synthetic traces', () => {
  it('recovers heart rate, HRV and breathing from a clean trace', () => {
    for (const seed of [1, 2, 3]) {
      const s = fingerSession({ seed });
      const r = analyzeFingerSession(s.frames);
      expect(r.scanType).toBe('finger');
      expect(r.outcome).toBe('completed');
      expect(Math.abs(metric(r, 'heart_rate').value! - s.meanHrBpm)).toBeLessThanOrEqual(1.5);
      const hrv = metric(r, 'hrv');
      expect(Math.abs(hrv.value! - s.rmssdMs)).toBeLessThanOrEqual(8);
      expect(Math.abs(hrv.valueSecondary! - s.sdnnMs)).toBeLessThanOrEqual(6);
      expect(metric(r, 'breathing_rate').value).toBe(s.breathingPerMin);
      for (const m of r.metrics) {
        expect(m.provenance.method).toBe('finger_ppg');
        expect(m.provenance.validation).toBe('unvalidated');
      }
    }
  });

  it('tracks different heart and breathing rates', () => {
    for (const [hr, br] of [
      [52, 8],
      [75, 12],
      [95, 18],
      [120, 22],
    ] as const) {
      const s = fingerSession({ heartRateBpm: hr, breathingPerMin: br, seed: hr });
      const r = analyzeFingerSession(s.frames);
      expect(Math.abs(metric(r, 'heart_rate').value! - s.meanHrBpm)).toBeLessThanOrEqual(1.5);
      const b = metric(r, 'breathing_rate');
      if (b.status === 'valid') expect(Math.abs(b.value! - br)).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to green when red is clipped by the torch', () => {
    const r = analyzeFingerSession(fingerSession({ redClipped: true, noise: 0.1, seed: 4 }).frames);
    expect(r.diagnostics.finger!.channel).toBe('g');
    expect(metric(r, 'heart_rate').status).toBe('valid');
  });

  it('withholds HRV when beat timing is too noisy', () => {
    // Green only (red clipped) with more sensor noise: heart rate is fine,
    // but beat timing error would inflate RMSSD by ~20 ms.
    const r = analyzeFingerSession(fingerSession({ redClipped: true, noise: 0.3, seed: 1 }).frames);
    expect(metric(r, 'heart_rate').status).toBe('valid');
    expect(metric(r, 'hrv').status).toBe('unavailable');
    expect(r.diagnostics.finger!.timingNoiseMs!).toBeGreaterThan(FINGER_CONFIG.maxTimingNoiseMs);
  });

  it('never reports SpO2 or blood pressure', () => {
    const r = analyzeFingerSession(fingerSession({ seed: 9 }).frames);
    expect(metric(r, 'spo2').status).toBe('unavailable');
    expect(metric(r, 'spo2').qualityFlags).toContain('needs_device_calibration');
    expect(metric(r, 'blood_pressure').status).toBe('unavailable');
  });

  it('needs 15 s for heart rate and 30 s for HRV and breathing', () => {
    const short = analyzeFingerSession(fingerSession({ durationSec: 12 }).frames);
    expect(short.metrics.every((m) => m.status !== 'valid')).toBe(true);
    const mid = analyzeFingerSession(fingerSession({ durationSec: 25, seed: 3 }).frames);
    expect(metric(mid, 'heart_rate').status).toBe('valid');
    expect(metric(mid, 'hrv').reason).toBe('insufficient_duration');
    expect(metric(mid, 'breathing_rate').reason).toBe('insufficient_duration');
  });

  it('keeps a display waveform with beat marks', () => {
    const r = analyzeFingerSession(fingerSession({ seed: 5 }).frames);
    expect(r.waveform!.samples.length).toBeGreaterThan(200);
    expect(r.waveform!.beats.length).toBeGreaterThan(8);
    expect(Math.max(...r.waveform!.samples.map(Math.abs))).toBeCloseTo(1, 5);
  });
});

describe('finger scan: false acceptance', () => {
  it('accepts nothing from 240 pulseless traces', () => {
    let accepted = 0;
    for (let s = 0; s < 240; s++) {
      const r = analyzeFingerSession(
        fingerSession({
          noPulse: true,
          noise: [0.1, 0.3, 1, 3][s % 4],
          durationSec: [20, 40, 62][s % 3],
          baseMod: [0, 0.004, 0.02][s % 3],
          seed: 900 + s,
        }).frames,
      );
      if (r.metrics.some((m) => m.status === 'valid')) accepted++;
    }
    expect(accepted).toBe(0);
  }, 60_000);

  it('reports no breathing rate when the pulse has no respiratory modulation', () => {
    let accepted = 0;
    for (let s = 0; s < 150; s++) {
      const r = analyzeFingerSession(
        fingerSession({
          rsaSec: 0,
          ampMod: 0,
          baseMod: 0,
          jitterSec: [0.01, 0.02, 0.05][s % 3],
          durationSec: [35, 62][s % 2],
          seed: 3000 + s,
        }).frames,
      );
      if (metric(r, 'breathing_rate').status === 'valid') accepted++;
    }
    expect(accepted).toBe(0);
  }, 60_000);

  it('fuses breathing only when two clear modulations agree', () => {
    const m = (perMin: number | null, concentration: number) => ({
      name: 'riiv' as const,
      perMin,
      concentration,
    });
    expect(fuseBreathing([m(14, 0.9), m(14.5, 0.7), m(22, 0.9)])).toBeCloseTo(14.25);
    expect(fuseBreathing([m(14, 0.9), m(14.5, 0.3), m(null, 0)])).toBeNull();
    expect(fuseBreathing([m(10, 0.9), m(16, 0.9), m(22, 0.9)])).toBeNull();
  });
});

describe('finger frame checks', () => {
  const lit = { r: 200, g: 60, b: 18, luma: 98, coverage: 0.97, redClipped: 0 };
  it('flags an uncovered lens, darkness, saturation and movement', () => {
    expect(assessFingerFrame(lit, null)).toEqual([]);
    expect(assessFingerFrame({ ...lit, coverage: 0.4 }, null)).toEqual(['finger_not_detected']);
    expect(assessFingerFrame({ ...lit, r: 20 }, null)).toEqual(['too_dark']);
    expect(assessFingerFrame({ ...lit, r: 255, g: 250 }, null)).toContain('too_bright');
    expect(assessFingerFrame({ ...lit, g: 75 }, lit)).toEqual(['finger_moving']);
    expect(assessFingerFrame(null, null)).toEqual(['finger_not_detected']);
  });

  it('averages the centre of a YUV frame', () => {
    const w = 64;
    const h = 48;
    // Uniform reddish frame: Y=100, Cb=110, Cr=190 (full range).
    const y = new Uint8Array(w * h).fill(100);
    const u = new Uint8Array((w / 2) * (h / 2)).fill(110);
    const v = new Uint8Array((w / 2) * (h / 2)).fill(190);
    const s = extractFingerYuv({
      width: w,
      height: h,
      y: { data: y, rowStride: w, pixelStride: 1 },
      u: { data: u, rowStride: w / 2, pixelStride: 1 },
      v: { data: v, rowStride: w / 2, pixelStride: 1 },
      fullRange: true,
    });
    expect(s.r).toBeCloseTo(100 + 1.402 * 62, 1);
    expect(s.g).toBeCloseTo(100 - 0.344136 * -18 - 0.714136 * 62, 1);
    expect(s.coverage).toBe(1);
  });
});

describe('FingerScanSession', () => {
  it('runs to the target, shows a live waveform and clears its buffer', () => {
    const s = fingerSession({ durationSec: 70, seed: 8 });
    const session = new FingerScanSession();
    let finished = false;
    let sawWave = false;
    let interimHr: number | null = null;
    for (const f of s.frames) {
      session.pushFrame({ t: f.t, sample: f.sample });
      const live = session.liveState();
      if (live.waveform.length > 50) sawWave = true;
      interimHr = live.interimHeartRate ?? interimHr;
      if (session.shouldFinish()) {
        finished = true;
        break;
      }
    }
    expect(finished).toBe(true);
    expect(sawWave).toBe(true);
    expect(interimHr).not.toBeNull();
    expect(session.exportTrace().split('\n')[0]).toMatch(/^edgevitals-finger-trace v1/);
    const r = session.finish();
    expect(r.outcome).toBe('completed');
    expect(session.frameCount).toBe(0);
    expect(() => session.pushFrame({ t: 0, sample: null })).toThrow();
  }, 30_000);

  it('stops at the torch-heat limit even without a clean signal', () => {
    const session = new FingerScanSession();
    let t = 0;
    while (!session.shouldFinish() && t < 200_000) {
      session.pushFrame({ t, sample: null });
      t += 33;
    }
    expect(t / 1000).toBeLessThanOrEqual(FINGER_CONFIG.maxScanSec + 0.1);
    expect(session.finish().outcome).toBe('failed');
  });
});
