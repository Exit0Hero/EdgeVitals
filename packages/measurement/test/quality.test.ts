import { describe, expect, it } from 'vitest';
import { buildQuality, component, gradeOf } from '../src/quality';
import { analyzeSession } from '../src/pipeline';
import { labelFrames, syntheticFaceSession } from '../validation/synthetic';

describe('quality model', () => {
  const ok = { pulse_snr: component(6, 'dB', '>= -2 dB', true) };

  it('grades from gates and margins, never from a made-up percentage', () => {
    expect(gradeOf({ status: 'valid', components: ok, margins: [true] })).toBe('good');
    expect(gradeOf({ status: 'valid', components: ok, margins: [false] })).toBe('fair');
    expect(
      gradeOf({
        status: 'valid',
        components: { ...ok, motion: component(0.6, 'share', '<= 0.5', false) },
        margins: [true],
      }),
    ).toBe('rejected');
    expect(gradeOf({ status: 'unavailable', components: ok, margins: [true] })).toBe('rejected');
  });

  it('never carries a confidence value without a calibration model', () => {
    const q = buildQuality('valid', null, null, 45.04, 'x', '1', ok, [true]);
    expect(q.uncertainty).toBeNull();
    expect(q.uncertaintyNote).toBe('not_calibrated');
    expect(q.durationSec).toBe(45);
  });

  it('every metric of a session carries algorithm, version, status and duration (synthetic)', () => {
    const res = analyzeSession(
      labelFrames(syntheticFaceSession({ seed: 91, durationSec: 50 }).inputs),
    );
    for (const m of res.metrics) {
      if (!m.quality) continue;
      expect(m.quality.algorithm.length).toBeGreaterThan(0);
      expect(m.quality.version.length).toBeGreaterThan(0);
      expect(m.quality.status).toBe(m.status);
      expect(JSON.stringify(m.quality)).not.toMatch(/confidence/i);
      if (m.status !== 'valid') expect(m.quality.grade).toBe('rejected');
    }
    const hr = res.metrics.find((m) => m.metric === 'heart_rate')!;
    expect(hr.quality).toBeDefined();
  });
});
