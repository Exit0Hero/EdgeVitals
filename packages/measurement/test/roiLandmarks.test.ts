import { describe, expect, it } from 'vitest';
import { extractRoi, landmarkRegionFractions, type FaceLandmarks } from '../src/roi';
import type { FaceBox } from '../src/types';

// A schematic face: box 200 x 250 at (100, 100), eyes 80 px apart.
const face: FaceBox = { x: 100, y: 100, width: 200, height: 250 };
const lm: FaceLandmarks = {
  leftEye: { x: 160, y: 200 },
  rightEye: { x: 240, y: 200 },
  noseBase: { x: 200, y: 250 },
  mouthLeft: { x: 170, y: 285 },
  mouthRight: { x: 230, y: 285 },
};
const toPx = (f: number[]) => ({
  x0: face.x + f[0]! * face.width,
  x1: face.x + f[1]! * face.width,
  y0: face.y + f[2]! * face.height,
  y1: face.y + f[3]! * face.height,
});
const inside = (p: { x: number; y: number }, r: ReturnType<typeof toPx>) =>
  p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

describe('landmark-placed skin regions', () => {
  const rects = landmarkRegionFractions(face, lm)!.map(toPx);

  it('places the forehead above the brows and the cheeks between eyes and mouth', () => {
    const [fh, lc, rc] = rects as [
      ReturnType<typeof toPx>,
      ReturnType<typeof toPx>,
      ReturnType<typeof toPx>,
    ];
    const browY = 200 - 0.3 * 80; // brows sit at least 0.3 d above the eye centres
    expect(fh.y1).toBeLessThan(browY);
    for (const c of [lc, rc]) {
      expect(c.y0).toBeGreaterThan(200 + 0.25 * 80); // below the lower eyelid
      expect(c.y1).toBeLessThan(285); // above the lips
    }
    expect(lc.x1).toBeLessThan(200 - 0.25 * 80); // off the nose
    expect(rc.x0).toBeGreaterThan(200 + 0.25 * 80);
  });

  it('excludes the eyes, nose base and mouth from every region', () => {
    const features = [lm.leftEye!, lm.rightEye!, lm.noseBase!, lm.mouthLeft!, lm.mouthRight!];
    for (const r of rects) for (const p of features) expect(inside(p, r)).toBe(false);
  });

  it('falls back to the fixed box regions when the head is rolled or eyes are missing', () => {
    expect(landmarkRegionFractions(face, { ...lm, rightEye: { x: 240, y: 240 } })).toBeNull(); // ~27° roll
    expect(landmarkRegionFractions(face, { leftEye: lm.leftEye })).toBeNull();
    expect(landmarkRegionFractions(face, { ...lm, rightEye: { x: 170, y: 200 } })).toBeNull(); // eyes too close
  });

  it('keeps per-region statistics separate', () => {
    const W = 400;
    const H = 450;
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const left = x < 200;
        data[o] = left ? 190 : 170;
        data[o + 1] = left ? 140 : 120;
        data[o + 2] = left ? 120 : 100;
        data[o + 3] = 255;
      }
    const roi = extractRoi(
      { width: W, height: H, data, channels: 4 },
      face,
      2,
      landmarkRegionFractions(face, lm)!,
    );
    const [, l, r] = roi.regions!;
    expect(l!.n).toBeGreaterThan(0);
    expect(r!.n).toBeGreaterThan(0);
    expect(l!.r).toBeCloseTo(190, 0);
    expect(r!.r).toBeCloseTo(170, 0);
    expect(l!.luma).toBeGreaterThan(r!.luma!);
  });
});
