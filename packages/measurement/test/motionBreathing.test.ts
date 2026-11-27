import { describe, expect, it } from 'vitest';
import { estimateMotionBreathing } from '../src/motionBreathing';
import { analyzeSession } from '../src/pipeline';
import { withHeadMotion } from './fixtures/headMotion';
import { syntheticSession } from './fixtures/synthetic';

/** Synthetic checks of breathing from head movement (face scan). Not validation. */
describe('breathing from head movement', () => {
  const faint = syntheticSession({ durationSec: 60, noPulse: true, noise: 0.3, seed: 1 }).frames;
  const faint20 = syntheticSession({
    durationSec: 60,
    fps: 20,
    noPulse: true,
    noise: 0.3,
    seed: 2,
  }).frames;

  it('finds the breathing rate even when there is no colour pulse', () => {
    // Slow breathing needs a larger movement: the analysis uses velocity,
    // which weights slow rhythms down (see motionBreathing.ts).
    for (const [br, px] of [
      [8, 3],
      [12, 2],
      [15, 2],
      [20, 2],
      [24, 2],
    ] as const) {
      const frames = withHeadMotion(faint20, { breathingPerMin: br, breathingPx: px, seed: br });
      const m = estimateMotionBreathing(frames)!;
      expect(m.passed).toBe(true);
      expect(Math.abs(m.perMin! - br)).toBeLessThanOrEqual(1);
      const r = analyzeSession(frames);
      const b = r.metrics.find((x) => x.metric === 'breathing_rate')!;
      expect(b.status).toBe('valid');
      expect(b.qualityFlags).toContain('head_motion');
      // The faint colour signal still yields no heart rate.
      expect(r.metrics.find((x) => x.metric === 'heart_rate')!.status).toBe('unavailable');
      expect(r.outcome).toBe('partial');
    }
  });

  it('accepts no breathing rate from jitter and posture drift alone', () => {
    let accepted = 0;
    const settings = [
      { jitterPx: 1, driftPxPerSec: 0.2 },
      { jitterPx: 2, driftPxPerSec: 1 },
      { jitterPx: 4, driftPxPerSec: 2 },
    ];
    for (let s = 0; s < 300; s++) {
      const m = estimateMotionBreathing(
        withHeadMotion(s % 2 ? faint : faint20, {
          breathingPerMin: null,
          ...settings[s % 3],
          seed: 1000 + s,
        }),
      );
      if (m?.passed) accepted++;
    }
    expect(accepted).toBe(0);
  }, 60_000);

  it('abstains on a still box and on short scans', () => {
    expect(estimateMotionBreathing(faint)!.passed).toBe(false);
    const short = syntheticSession({ durationSec: 25, seed: 3 }).frames;
    expect(estimateMotionBreathing(withHeadMotion(short, { breathingPx: 3 }))).toBeNull();
  });
});
