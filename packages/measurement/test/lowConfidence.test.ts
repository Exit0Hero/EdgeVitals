import { describe, expect, it } from 'vitest';
import { lowConfidenceBreathing } from '../src/finger';
import { analyzeSession } from '../src/pipeline';
import { phoneNoiseRegionsSession, phoneNoiseSession } from './fixtures/phoneNoise';

// All recordings here are SYNTHETIC. They check the low-confidence rules
// (when a rough value may be shown, and that noise never produces one), not
// accuracy on people. The calibration runs behind the thresholds (8,000
// pulseless face captures, 1,500 no-breathing finger traces) are described
// in docs/adr/0012-low-confidence-estimates.md.

const hrOf = (frames: Parameters<typeof analyzeSession>[0]) =>
  analyzeSession(frames).metrics.find((m) => m.metric === 'heart_rate')!;

describe('low-confidence face heart rate', () => {
  it('gives a labelled rough heart rate when only the single-method rule passes', () => {
    const cases = [
      { seed: 310018, dur: 45, bpm: 56, regions: true },
      { seed: 300055, dur: 60, bpm: 75, regions: false },
    ];
    for (const c of cases) {
      const o = { seed: c.seed, durationSec: c.dur, pulse: { bpm: c.bpm, amplitude: 0.0006 } };
      const res = analyzeSession(c.regions ? phoneNoiseRegionsSession(o) : phoneNoiseSession(o));
      const hr = res.metrics.find((m) => m.metric === 'heart_rate')!;
      expect(hr.status).toBe('valid');
      expect(hr.qualityFlags).toContain('low_confidence');
      expect(hr.quality?.grade).toBe('low');
      expect(Math.abs(hr.value! - c.bpm)).toBeLessThanOrEqual(3);
      // PRV and colour breathing need a stronger pulse: withheld, with the reason.
      for (const m of ['hrv', 'breathing_rate'] as const) {
        const r = res.metrics.find((x) => x.metric === m)!;
        expect(r.status).toBe('unavailable');
        expect(r.qualityFlags).toContain('heart_rate_low_confidence');
      }
    }
  });

  it('reports nothing from 90 pulseless captures of 45-75 s', () => {
    for (let s = 0; s < 45; s++) {
      const durationSec = [45, 60, 75][s % 3]!;
      expect(
        hrOf(phoneNoiseSession({ seed: 820000 + s, durationSec, scale: 0.7 + 0.2 * (s % 4) }))
          .status,
      ).not.toBe('valid');
      expect(hrOf(phoneNoiseRegionsSession({ seed: 830000 + s, durationSec })).status).not.toBe(
        'valid',
      );
    }
  }, 60_000);

  it('keeps clear pulses on the strict path', () => {
    const hr = hrOf(
      phoneNoiseSession({ seed: 4, durationSec: 60, pulse: { bpm: 70, amplitude: 0.003 } }),
    );
    expect(hr.status).toBe('valid');
    expect(hr.qualityFlags).not.toContain('low_confidence');
  });
});

describe('low-confidence finger breathing', () => {
  const mod = (name: 'riiv' | 'riav' | 'rifv', perMin: number | null, concentration: number) => ({
    name,
    perMin,
    concentration,
  });
  it('needs two modulations within 1/min, both at least 0.45 clear', () => {
    expect(
      lowConfidenceBreathing([
        mod('riav', 12, 0.46),
        mod('rifv', 12.6, 0.47),
        mod('riiv', null, 0),
      ]),
    ).toBeCloseTo(12.3);
    expect(lowConfidenceBreathing([mod('riav', 12, 0.46), mod('rifv', 13.4, 0.47)])).toBeNull();
    expect(lowConfidenceBreathing([mod('riav', 7.3, 0.372), mod('rifv', 7.1, 0.367)])).toBeNull();
  });
});
