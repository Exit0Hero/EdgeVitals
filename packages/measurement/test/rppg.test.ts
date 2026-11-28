import { describe, expect, it } from 'vitest';
import { chrom } from '../src/chrom';
import {
  autocorrelationRate,
  bandpassOrder,
  detrendSmoothnessPriors,
  peakFrequency,
  welch,
} from '../src/dsp';
import { pos, posV2, type ProjectionStats } from '../src/pos';
import { RPPG_CONFIG, extractPulse, type RppgMethod } from '../src/rppg';
import { gauss, mulberry32 } from '../validation/synthetic';

// SYNTHETIC RGB traces: a sinusoidal pulse with a fixed colour signature, slow
// drift and sensor noise. They test the code, not accuracy on people.

const FS = 30;
function rgb(hz: number, sec = 30, seed = 1, amp = 0.01, noise = 0.2) {
  const rng = mulberry32(seed);
  const n = sec * FS;
  const base = [170, 125, 100];
  const sig = [0.33, 0.77, 0.53];
  const ch = base.map((c, k) =>
    Array.from({ length: n }, (_, i) => {
      const t = i / FS;
      return (
        c *
          (1 +
            amp * sig[k]! * Math.sin(2 * Math.PI * hz * t) +
            0.02 * Math.sin((2 * Math.PI * t) / 20)) +
        noise * gauss(rng)
      );
    }),
  );
  return { r: ch[0]!, g: ch[1]!, b: ch[2]! };
}
const peakBpm = (x: number[]) => peakFrequency(welch(x, FS, 10, 2048), 0.7, 3)!.freq * 60;

describe('rPPG extractors (synthetic)', () => {
  it.each<RppgMethod>(['pos', 'pos_v2', 'chrom', 'pbv'])(
    '%s recovers a known pulse frequency',
    (m) => {
      for (const bpm of [48, 72, 150]) {
        const { pulse } = extractPulse(m, rgb(bpm / 60, 30, bpm), FS);
        expect(Math.abs(peakBpm(pulse) - bpm)).toBeLessThan(1.5);
      }
    },
  );

  it('POS v2 and CHROM survive constant (zero-variance) input without NaN', () => {
    const flat = Array.from({ length: 600 }, () => 100);
    const stats: ProjectionStats = { windows: 0, skipped: 0 };
    const h = posV2(flat, flat, flat, 48, stats);
    expect(h.every(Number.isFinite)).toBe(true);
    expect(stats.skipped).toBe(stats.windows);
    const c = chrom(flat, flat, flat, 48, FS, RPPG_CONFIG.filterBandHz, stats);
    expect(c.every(Number.isFinite)).toBe(true);
    const zero = Array.from({ length: 600 }, () => 0);
    expect(posV2(zero, zero, zero, 48).every(Number.isFinite)).toBe(true);
  });

  it('legacy POS is unchanged by the revision (kept for comparison)', () => {
    const { r, g, b } = rgb(1.2, 10, 9);
    const a = pos(r, g, b, 48);
    expect(a).toHaveLength(r.length);
    expect(a.every(Number.isFinite)).toBe(true);
  });
});

describe('signal conditioning', () => {
  it('smoothness-priors detrending removes slow drift and keeps the pulse', () => {
    const n = 900;
    const x = Array.from(
      { length: n },
      (_, i) => 5 * (i / n) + Math.sin(2 * Math.PI * 1.2 * (i / FS)),
    );
    const d = detrendSmoothnessPriors(x, FS, 0.3);
    const head = d.slice(0, 300).reduce((a, b) => a + b, 0) / 300;
    const tail = d.slice(-300).reduce((a, b) => a + b, 0) / 300;
    expect(Math.abs(tail - head)).toBeLessThan(0.3);
    expect(Math.abs(peakBpm(d) - 72)).toBeLessThan(1);
  });

  it('higher-order band-pass attenuates out-of-band power more', () => {
    const x = Array.from({ length: 900 }, (_, i) => Math.sin(2 * Math.PI * 6 * (i / FS)));
    const rms = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
    const o2 = rms(bandpassOrder(x, 0.55, 3.5, FS, 2));
    const o6 = rms(bandpassOrder(x, 0.55, 3.5, FS, 6));
    expect(o6).toBeLessThan(o2);
  });

  it('autocorrelation finds the beat period', () => {
    const x = Array.from({ length: 600 }, (_, i) => Math.sin(2 * Math.PI * 1.25 * (i / FS)));
    const r = autocorrelationRate(x, FS, [0.7, 3])!;
    expect(Math.abs(r.bpm - 75)).toBeLessThan(2);
    expect(r.strength).toBeGreaterThan(0.8);
  });
});
