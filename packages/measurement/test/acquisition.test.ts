import { describe, expect, it } from 'vitest';
import {
  analyzeFrameTiming,
  detectWindowArtefacts,
  monotonicFrames,
  resampleWithMask,
} from '../src/acquisition';
import { longInterpolatedRuns } from '../src/pipeline';
import { labelFrames, syntheticFaceSession } from '../validation/synthetic';

// All signals here are SYNTHETIC (validation/synthetic.ts).

const ticks = (n: number, dtMs: number) => Array.from({ length: n }, (_, i) => i * dtMs);

describe('frame timing', () => {
  it('measures the real frame rate from timestamps', () => {
    const r = analyzeFrameTiming(ticks(600, 50));
    expect(r.medianFps).toBeCloseTo(20, 5);
    expect(r.measuredFps).toBeCloseTo(20, 5);
    expect(r.missingFrames).toBe(0);
    expect(r.flags).toEqual([]);
  });

  it('counts missing frames from long intervals and flags heavy loss', () => {
    const t = ticks(300, 33.3).filter((_, i) => i % 5 !== 0); // every 5th frame lost
    const r = analyzeFrameTiming(t);
    expect(r.missingFrames).toBeGreaterThan(50);
    expect(r.droppedFrameFraction).toBeGreaterThan(0.15);
    expect(r.flags).toContain('frames_dropped');
  });

  it('flags low and unstable frame rates', () => {
    expect(analyzeFrameTiming(ticks(100, 100)).flags).toContain('low_frame_rate');
    const jitter = ticks(300, 33).map((t, i) => t + (i % 2 ? 12 : -12));
    expect(analyzeFrameTiming(jitter).flags).toContain('unstable_frame_rate');
  });

  it('flags and removes duplicate or backwards timestamps', () => {
    const t = [0, 33, 33, 66, 50, 100];
    expect(analyzeFrameTiming(t).nonMonotonic).toBe(2);
    expect(analyzeFrameTiming(t).flags).toContain('timestamp_irregular');
    expect(monotonicFrames(t.map((x) => ({ t: x }))).map((f) => f.t)).toEqual([0, 33, 66, 100]);
  });
});

describe('resampling with an interpolation mask', () => {
  it('marks no samples when frames are regular, even below the grid rate', () => {
    const t = ticks(400, 50).map((x) => x / 1000);
    const s = resampleWithMask(t, [t.map(Math.sin)], 30);
    expect(s.interpolatedFraction).toBe(0);
  });

  it('marks the samples where frames were missing, and only those', () => {
    const t = ticks(300, 1000 / 30)
      .filter((_, i) => i < 100 || i >= 115) // 0.5 s gap
      .map((x) => x / 1000);
    const s = resampleWithMask(t, [t.map(() => 1)], 30);
    const marked = s.interpolated.filter(Boolean).length;
    expect(marked).toBeGreaterThanOrEqual(13);
    expect(marked).toBeLessThanOrEqual(16);
  });

  it('bridges a single missing frame for beat detection but masks longer gaps', () => {
    const m = [false, true, false, true, true, true, true, true, false];
    expect(longInterpolatedRuns(m, 3)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('window artefacts (synthetic)', () => {
  const run = (o: Parameters<typeof syntheticFaceSession>[0]) => {
    const { inputs } = syntheticFaceSession({ durationSec: 40, ...o });
    const seg = labelFrames(inputs).filter((f) => f.usable && f.roi);
    const t = seg.map((f) => f.t / 1000);
    const series = resampleWithMask(t, [seg.map((f) => f.roi!.g)], 30);
    return detectWindowArtefacts(seg, series, 10, 2);
  };

  it('finds no artefact in a still recording', () => {
    expect(run({ seed: 2 }).artefact.every((a) => a === null)).toBe(true);
  });

  it('rejects the windows that contain a head movement', () => {
    const w = run({ seed: 3, motionBursts: [{ t0: 20, t1: 21, px: 40 }] });
    const hit = w.starts.filter((_, i) => w.artefact[i] === 'face_motion');
    expect(hit.length).toBeGreaterThan(0);
    for (const s of hit) expect(s + 10 > 20 && s < 21).toBe(true);
    expect(w.artefact[0]).toBeNull();
  });

  it('rejects the windows that contain a lighting step', () => {
    const w = run({ seed: 4, lightingSteps: [{ t: 20, factor: 1.02 }] });
    expect(
      w.artefact.some((a) => a === 'sudden_lighting_change' || a === 'lighting_unstable'),
    ).toBe(true);
    expect(w.artefact[0]).toBeNull();
  });
});
