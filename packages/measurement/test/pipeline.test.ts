import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../src/pipeline';
import { syntheticSession } from './fixtures/synthetic';

const byMetric = (res: ReturnType<typeof analyzeSession>, m: string) =>
  res.metrics.find((x) => x.metric === m)!;

describe('rPPG pipeline on synthetic ground truth', () => {
  it.each([1, 2, 3, 4])(
    'recovers HR, HRV and breathing from a high-SNR 45 s signal (seed %i)',
    (seed) => {
      const truth = syntheticSession({ heartRateBpm: 66, breathingPerMin: 15, noise: 0.03, seed });
      const res = analyzeSession(truth.frames);
      expect(res.outcome).toBe('completed');
      expect(byMetric(res, 'heart_rate').value!).toBeGreaterThanOrEqual(truth.meanHrBpm - 2);
      expect(byMetric(res, 'heart_rate').value!).toBeLessThanOrEqual(truth.meanHrBpm + 2);
      expect(Math.abs(byMetric(res, 'hrv').value! - truth.rmssdMs)).toBeLessThan(10);
      expect(
        Math.abs(byMetric(res, 'breathing_rate').value! - truth.breathingPerMin),
      ).toBeLessThanOrEqual(2);
    },
  );

  it('abstains from HRV when SNR is too low for reliable beat timing', () => {
    const res = analyzeSession(syntheticSession({ noise: 0.15, seed: 1 }).frames);
    expect(byMetric(res, 'heart_rate').status).toBe('valid');
    expect(byMetric(res, 'hrv').status).toBe('unavailable');
    expect(byMetric(res, 'hrv').reason).toBe('low_signal_quality');
  });

  it.each([52, 78, 95])('tracks heart rate %i bpm', (bpm) => {
    const truth = syntheticSession({ heartRateBpm: bpm, seed: bpm });
    const hr = byMetric(analyzeSession(truth.frames), 'heart_rate');
    expect(hr.status).toBe('valid');
    expect(Math.abs(hr.value! - truth.meanHrBpm)).toBeLessThanOrEqual(2);
  });

  it('abstains on every metric when there is no pulse in the signal', () => {
    const res = analyzeSession(syntheticSession({ noPulse: true, noise: 0.6, seed: 7 }).frames);
    expect(res.outcome).toBe('failed');
    for (const m of res.metrics) {
      expect(m.status).not.toBe('valid');
      expect(m.value).toBeNull();
    }
  });

  it('reports insufficient duration for a 10 s capture', () => {
    const res = analyzeSession(syntheticSession({ durationSec: 10 }).frames);
    expect(byMetric(res, 'heart_rate').reason).toBe('insufficient_duration');
    expect(res.outcome).toBe('failed');
  });

  it('gives a partial result when only heart rate has enough duration', () => {
    const res = analyzeSession(syntheticSession({ durationSec: 20, seed: 3 }).frames);
    expect(byMetric(res, 'heart_rate').status).toBe('valid');
    expect(byMetric(res, 'hrv').reason).toBe('insufficient_duration');
    expect(res.outcome).toBe('partial');
  });

  it('never reports SpO2 or blood pressure', () => {
    const res = analyzeSession(syntheticSession({ seed: 5 }).frames);
    for (const m of ['spo2', 'blood_pressure']) {
      expect(byMetric(res, m).status).toBe('unavailable');
      expect(byMetric(res, m).reason).toBe('unsupported_method');
      expect(byMetric(res, m).value).toBeNull();
    }
  });

  it('returns no values for a cancelled scan', () => {
    const res = analyzeSession(syntheticSession({ seed: 9 }).frames, { cancelled: true });
    expect(res.outcome).toBe('cancelled');
    expect(res.metrics.every((m) => m.value === null)).toBe(true);
  });

  it('uses only the longest clean segment when motion interrupts capture', () => {
    const truth = syntheticSession({ durationSec: 60, seed: 11 });
    // Mark 20-22 s as unusable (simulated movement).
    for (const f of truth.frames) if (f.t > 20000 && f.t < 22000) f.usable = false;
    const res = analyzeSession(truth.frames);
    expect(res.diagnostics.usableDurationSec).toBeGreaterThan(37);
    expect(res.diagnostics.usableDurationSec).toBeLessThan(39);
    expect(byMetric(res, 'heart_rate').status).toBe('valid');
  });

  it('labels every metric as measured but unvalidated with algorithm version', () => {
    const res = analyzeSession(syntheticSession({ seed: 13 }).frames);
    for (const m of res.metrics) {
      expect(m.provenance.validation).toBe('unvalidated');
      expect(m.provenance.version).toMatch(/\d+\.\d+\.\d+/);
      if (m.status !== 'valid') expect(m.value).toBeNull();
    }
  });

  it('starts the signal after the exposure ramp seen on a real phone', () => {
    // First 14 frames of a real Android scan (mean skin colour x100): auto
    // exposure and white balance ramping by up to 17% per frame.
    const ramp = [
      [9637, 6568, 4976],
      [9646, 6559, 4965],
      [10826, 7582, 5872],
      [12347, 8870, 7011],
      [13016, 9514, 7593],
      [13720, 10161, 8206],
      [14101, 10551, 8687],
      [14789, 11293, 9443],
      [15719, 12567, 10358],
      [15895, 12787, 10617],
      [16267, 13227, 11109],
      [16300, 13340, 11262],
      [16282, 13335, 11243],
      [17279, 14009, 11766],
    ];
    const settled = [17450, 13950, 11570];
    const truth = syntheticSession({ fps: 20, heartRateBpm: 77, noise: 0.15, seed: 2 });
    const frames = truth.frames.map((f, i) => {
      const k = ramp[i]?.map((v, j) => v / settled[j]!);
      return k
        ? {
            ...f,
            roi: { ...f.roi!, r: f.roi!.r * k[0]!, g: f.roi!.g * k[1]!, b: f.roi!.b * k[2]! },
          }
        : f;
    });
    const res = analyzeSession(frames);
    // The analysed segment begins once the colour has settled.
    expect(res.diagnostics.usableDurationSec).toBeGreaterThan(43);
    expect(res.diagnostics.usableDurationSec).toBeLessThan(44.4);
    expect(res.diagnostics.signal!.maxStepPct).toBeLessThan(3);
    expect(Math.abs(byMetric(res, 'heart_rate').value! - truth.meanHrBpm)).toBeLessThanOrEqual(2);
  });

  it('splits the signal at a sudden lighting change', () => {
    const truth = syntheticSession({ seed: 9 });
    const frames = truth.frames.map((f) =>
      f.t > 20_000
        ? { ...f, roi: { ...f.roi!, r: f.roi!.r * 1.1, g: f.roi!.g * 1.1, b: f.roi!.b * 1.1 } }
        : f,
    );
    const res = analyzeSession(frames);
    expect(res.diagnostics.usableDurationSec).toBeLessThan(25.5);
  });

  it('reports pulse SNR for each face region when regions are present', () => {
    const truth = syntheticSession({ seed: 4, noise: 0.15 });
    const frames = truth.frames.map((f, i) => {
      const c = f.roi!;
      // Right cheek gets no pulse: only noise around a constant colour.
      const flat = {
        r: 175 + Math.sin(i * 7.1) * 0.3,
        g: 125 + Math.cos(i * 5.3) * 0.3,
        b: 105,
        n: 600,
      };
      return { ...f, roi: { ...c, regions: [{ ...c, n: 700 }, { ...c, n: 700 }, flat] } };
    });
    const snr = analyzeSession(frames).diagnostics.signal!.regionSnrDb!;
    expect(snr).toHaveLength(3);
    expect(snr[0]!).toBeGreaterThan(0);
    expect(snr[1]!).toBeGreaterThan(0);
    expect(snr[2] == null || snr[2] < snr[0]!).toBe(true);
  });
});
