import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../src/pipeline';
import { estimateRespiration } from '../src/respiration';
import { labelFrames, syntheticFaceSession } from '../validation/synthetic';

// SYNTHETIC recordings. Breathing modulation here is idealised; these tests
// check the fusion rule (two clear signals must agree), not accuracy.

const br = (o: Parameters<typeof syntheticFaceSession>[0]) => {
  const res = analyzeSession(labelFrames(syntheticFaceSession(o).inputs));
  return { res, m: res.metrics.find((x) => x.metric === 'breathing_rate')! };
};

describe('face-scan breathing (synthetic)', () => {
  it('reads breathing from agreeing modulations and names them', () => {
    const { res, m } = br({
      seed: 71,
      durationSec: 60,
      breathingPerMin: 14,
      rsaSec: 0.08,
      respAmplitude: 0.003,
      pulseAmplitude: 0.008,
      regionNoise: 0.2,
    });
    expect(m.status).toBe('valid');
    expect(Math.abs(m.value! - 14)).toBeLessThanOrEqual(2);
    expect(res.diagnostics.respiration?.agreeing.length).toBeGreaterThanOrEqual(2);
  });

  it.each([81, 82, 83])('reports no breathing rate when nothing breathes (seed %i)', (seed) => {
    const { m } = br({
      seed,
      durationSec: 60,
      rsaSec: 0,
      respAmplitude: 0,
      respMotionPx: 0,
      pulseAmplitude: 0.008,
      regionNoise: 0.2,
    });
    expect(m.value).toBeNull();
  });

  it('needs enough duration and beats', () => {
    expect(estimateRespiration(null, new Array(20 * 30).fill(0), 30).failure).toBe('too_short');
    expect(estimateRespiration(null, new Array(40 * 30).fill(0), 30).failure).toBe('too_few_beats');
  });

  it('is computed separately from heart rate: HR can pass while breathing abstains', () => {
    const { res, m } = br({
      seed: 84,
      durationSec: 60,
      rsaSec: 0,
      respAmplitude: 0,
      respMotionPx: 0,
      pulseAmplitude: 0.008,
      regionNoise: 0.2,
    });
    expect(res.metrics.find((x) => x.metric === 'heart_rate')!.status).toBe('valid');
    expect(m.status).not.toBe('valid');
  });
});
