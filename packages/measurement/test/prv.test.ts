import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../src/pipeline';
import { bandpassOrder } from '../src/dsp';
import { detectPulseBeats } from '../src/prv';
import { gauss, labelFrames, mulberry32, syntheticFaceSession } from '../validation/synthetic';

// SYNTHETIC pulse waveforms with known beat times. Pulse-rate variability
// (PRV) from the camera is not ECG heart-rate variability; these tests check
// the beat pipeline's rules only.

const FS = 30;
function waveform(beats: number[], sec: number, seed = 1, noise = 0.02) {
  const rng = mulberry32(seed);
  // Band-passed as in rppg.ts, since the detector always receives a filtered pulse.
  const raw = Array.from({ length: sec * FS }, (_, i) => {
    const t = i / FS;
    let v = 0;
    for (const b of beats) {
      const d = t - b;
      if (d > -0.5 && d < 1)
        v +=
          Math.exp(-((d - 0.08) ** 2) / (2 * 0.1 ** 2)) + 0.3 * Math.exp(-((d - 0.4) ** 2) / 0.03);
    }
    return v - 0.5 + noise * gauss(rng);
  });
  return bandpassOrder(raw, 0.55, 3.5, FS, 2);
}
const regularBeats = (sec: number, ibi = 0.85) =>
  Array.from({ length: Math.floor(sec / ibi) }, (_, i) => 0.3 + i * ibi);

describe('PRV beat pipeline (synthetic)', () => {
  it('accepts regular beats and reports counts and RMSSD near zero', () => {
    const a = detectPulseBeats(waveform(regularBeats(40), 40), FS, 60 / 0.85)!;
    expect(a.acceptedCount).toBeGreaterThan(40);
    expect(a.rejectedCount).toBe(0);
    expect(a.rmssdMs!).toBeLessThan(20);
    expect(a.successivePairs).toBeGreaterThan(30);
  });

  it('classifies a missed beat instead of accepting a long interval', () => {
    // 0.7 s beats: the gap left by the missing beat (1.4 s) is still in range.
    const beats = regularBeats(40, 0.7).filter((_, i) => i !== 20);
    const w = waveform(beats, 40);
    const a = detectPulseBeats(w, FS, 60 / 0.7)!;
    expect(a.rejectedByReason.missed_beat ?? 0).toBeGreaterThanOrEqual(1);
    expect(a.intervals.filter((iv) => iv.status === 'accepted').every((iv) => iv.ibi < 1.2)).toBe(
      true,
    );
  });

  it('rejects an extra (false) peak', () => {
    const beats = regularBeats(40);
    const w = waveform(beats, 40);
    // A sharp spurious bump between two beats, as large as a beat.
    const k = Math.round((beats[15]! + 0.45) * FS);
    w[k] = (w[k] ?? 0) + 1.2;
    const a = detectPulseBeats(w, FS, 60 / 0.85)!;
    const extra =
      (a.rejectedByReason.extra_beat ?? 0) +
      a.falsePeaksRemoved +
      (a.rejectedByReason.irregular ?? 0);
    expect(extra).toBeGreaterThanOrEqual(1);
    expect(a.intervals.filter((iv) => iv.status === 'accepted').every((iv) => iv.ibi > 0.6)).toBe(
      true,
    );
  });

  it('marks intervals inside an artefact as rejected', () => {
    const w = waveform(regularBeats(40), 40);
    const mask = w.map((_, i) => i / FS > 10 && i / FS < 15);
    const a = detectPulseBeats(w, FS, 60 / 0.85, mask)!;
    expect(a.rejectedByReason.artefact ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('uses only adjacent accepted pairs for RMSSD', () => {
    const a = detectPulseBeats(
      waveform(
        regularBeats(40).filter((_, i) => i !== 20),
        40,
      ),
      FS,
      60 / 0.85,
    )!;
    expect(a.successivePairs).toBeLessThan(a.acceptedCount);
  });
});

describe('PRV metric in the pipeline (synthetic)', () => {
  const run = (o: Parameters<typeof syntheticFaceSession>[0]) => {
    const truth = syntheticFaceSession(o);
    const res = analyzeSession(labelFrames(truth.inputs));
    return { truth, res, prv: res.metrics.find((m) => m.metric === 'hrv')! };
  };

  it('labels the interval metric as pulse-rate variability with counts', () => {
    const { truth, res, prv } = run({
      seed: 61,
      durationSec: 75,
      pulseAmplitude: 0.012,
      regionNoise: 0.15,
      fps: 30,
    });
    expect(prv.status).toBe('valid');
    expect(prv.qualityFlags).toContain('pulse_rate_variability');
    expect(Math.abs(prv.value! - truth.rmssdMs)).toBeLessThan(10);
    const d = res.diagnostics.prv!;
    expect(d.kind).toBe('pulse_rate_variability');
    expect(d.acceptedIntervals).toBeGreaterThan(40);
    expect(d.acceptedIntervals + d.rejectedIntervals).toBeGreaterThan(0);
  });

  it('withholds PRV when frames are too slow for beat timing', () => {
    const { prv } = run({
      seed: 62,
      durationSec: 75,
      pulseAmplitude: 0.012,
      regionNoise: 0.15,
      fps: 12,
    });
    expect(prv.value).toBeNull();
  });

  it('withholds PRV from distorted, weak peaks rather than reporting noise', () => {
    const { prv } = run({
      seed: 63,
      durationSec: 60,
      pulseAmplitude: 0.002,
      regionNoise: 0.5,
      shapeDistortion: 0.8,
    });
    expect(prv.value).toBeNull();
  });
});
