import { describe, expect, it } from 'vitest';
import { EXPERIMENTAL_SPO2, analyzeSession } from '../src';
import { syntheticSession } from './fixtures/synthetic';

const spo2Of = (r: ReturnType<typeof analyzeSession>) =>
  r.metrics.find((m) => m.metric === 'spo2')!;
// Synthetic traces where red/blue pulse strength ratio R is known: SpO2 = 101.6 - 5.834 R.
const withRatio = (ratio: number, extra = {}) =>
  syntheticSession({ pulseAmplitude: 0.012, pulseVec: [0.5 * ratio, 0.77, 0.5], ...extra }).frames;

describe('experimental SpO2 (ADR 0008)', () => {
  it('is off unless explicitly requested', () => {
    const s = spo2Of(analyzeSession(withRatio(0.8)));
    expect(s).toMatchObject({ status: 'unavailable', reason: 'unsupported_method', value: null });
    expect(s.provenance.method).toBe('camera_rppg');
  });

  it('recovers the published calibration on a clean synthetic signal', () => {
    for (const ratio of [0.4, 0.8, 1.2]) {
      const res = analyzeSession(withRatio(ratio), { experimentalSpo2: true });
      const s = spo2Of(res);
      const expected = EXPERIMENTAL_SPO2.a - EXPERIMENTAL_SPO2.b * ratio;
      expect(s.status).toBe('valid');
      expect(Math.abs(s.value! - expected)).toBeLessThanOrEqual(1);
      expect(s.qualityFlags).toContain('experimental');
      expect(s.provenance).toMatchObject({
        method: 'camera_experimental',
        algorithm: 'bal2015-ror-red-blue',
        validation: 'unvalidated',
      });
    }
  });

  it('never reports a value from a camera with no pulse', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const frames = syntheticSession({ noPulse: true, seed }).frames;
      const s = spo2Of(analyzeSession(frames, { experimentalSpo2: true }));
      expect(s.value).toBeNull();
      expect(s.status).not.toBe('valid');
    }
  });

  it('reports values outside 90-100 % as no reliable reading', () => {
    // R = 2.5 -> 87 %, below the range of the published fit.
    const s = spo2Of(analyzeSession(withRatio(2.5), { experimentalSpo2: true }));
    expect(s).toMatchObject({ status: 'invalid', reason: 'out_of_operating_range', value: null });
  });

  it('does not change the scan outcome', () => {
    const frames = withRatio(0.8, { durationSec: 20 });
    const off = analyzeSession(frames);
    const on = analyzeSession(frames, { experimentalSpo2: true });
    expect(on.outcome).toBe(off.outcome);
  });
});
