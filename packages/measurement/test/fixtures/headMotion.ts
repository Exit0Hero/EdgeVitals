/**
 * TEST FIXTURE ONLY. Adds face-box movement to synthetic face frames:
 * breathing (vertical head movement), detector jitter, posture drift, then
 * the same box smoothing the app applies (smoothFaceBox).
 */
import type { FrameSample } from '../../src/types';
import { smoothFaceBox } from '../../src/yuv';
import { gauss, mulberry32 } from './synthetic';

export interface HeadMotionOptions {
  /** Breaths per minute; null for no breathing movement. */
  breathingPerMin?: number | null;
  /** Peak vertical movement from breathing, px (face height 300 px). */
  breathingPx?: number;
  /** Detector jitter SD per frame, px. */
  jitterPx?: number;
  /** Random-walk posture drift per second, px. */
  driftPxPerSec?: number;
  seed?: number;
}

export function withHeadMotion(frames: FrameSample[], o: HeadMotionOptions = {}): FrameSample[] {
  const rng = mulberry32(o.seed ?? 11);
  const br = o.breathingPerMin === undefined ? 15 : o.breathingPerMin;
  const amp = o.breathingPx ?? 1.5;
  const jit = o.jitterPx ?? 2;
  const drift = o.driftPxPerSec ?? 0.5;
  let walk = 0;
  let prevT = frames[0]?.t ?? 0;
  let box = null as FrameSample['face'];
  const phase = rng() * 2 * Math.PI;
  return frames.map((f) => {
    const t = f.t / 1000;
    const dt = Math.max(0, (f.t - prevT) / 1000);
    prevT = f.t;
    walk += drift * Math.sqrt(dt) * gauss(rng);
    const dy =
      (br ? amp * Math.sin(2 * Math.PI * (br / 60) * t + phase) : 0) + walk + jit * gauss(rng);
    const raw = {
      x: 200 + jit * gauss(rng),
      y: 150 + dy,
      width: 240 + jit * gauss(rng),
      height: 300 + jit * gauss(rng),
    };
    box = smoothFaceBox(box, raw);
    return { ...f, face: box };
  });
}
