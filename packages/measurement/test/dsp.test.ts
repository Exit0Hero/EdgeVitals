import { describe, expect, it } from 'vitest';
import {
  bandpass,
  findPeaks,
  mad,
  median,
  peakFrequency,
  resampleUniform,
  std,
  welch,
} from '../src/dsp';

const sine = (f: number, fs: number, sec: number, a = 1) =>
  Array.from({ length: Math.round(fs * sec) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs));

describe('dsp', () => {
  it('computes robust statistics', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });

  it('finds the spectral peak of a sine with sub-bin precision', () => {
    const spec = welch(sine(1.23, 30, 40), 30, 20, 4096);
    const p = peakFrequency(spec, 0.7, 3)!;
    expect(p.freq).toBeCloseTo(1.23, 2);
  });

  it('band-pass keeps in-band and suppresses out-of-band components', () => {
    const fs = 30;
    const inBand = sine(1.2, fs, 30);
    const low = sine(0.05, fs, 30, 5);
    const high = sine(8, fs, 30, 2);
    const y = bandpass(
      inBand.map((v, i) => v + low[i]! + high[i]!),
      0.7,
      3,
      fs,
    );
    const mid = y.slice(150, -150);
    expect(std(mid)).toBeGreaterThan(0.6);
    expect(std(mid)).toBeLessThan(0.8);
  });

  it('resamples irregular timestamps linearly', () => {
    const out = resampleUniform([0, 0.5, 1.5], [0, 1, 3], 2);
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('detects peaks respecting minimum distance', () => {
    const x = sine(1, 30, 10);
    const peaks = findPeaks(x, 20);
    expect(peaks.length).toBe(10);
    expect(peaks[0]!).toBeCloseTo(7.5, 1);
  });
});
