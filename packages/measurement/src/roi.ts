import type { FaceBox, RoiRegionSample, RoiSample } from './types';

/**
 * Pixel buffer view, compatible with browser ImageData and with RGB(A)
 * frames exported by native camera frame processors.
 */
export interface PixelFrame {
  width: number;
  height: number;
  /** Interleaved 8-bit channels, R first. */
  data: ArrayLike<number>;
  /** Bytes per pixel: 4 for RGBA/RGBX, 3 for RGB. */
  channels: 3 | 4;
  /** Bytes per row; defaults to width * channels. */
  stride?: number;
}

/** Skin regions as fractions of the face box: forehead and both cheeks. */
export const ROI_REGIONS: ReadonlyArray<{ x0: number; x1: number; y0: number; y1: number }> = [
  { x0: 0.3, x1: 0.7, y0: 0.08, y1: 0.24 }, // forehead
  { x0: 0.14, x1: 0.38, y0: 0.52, y1: 0.74 }, // left cheek
  { x0: 0.62, x1: 0.86, y0: 0.52, y1: 0.74 }, // right cheek
];

/**
 * Skin classification in YCbCr space (Chai & Ngan, 1999 bounds). Used to
 * exclude hair, eyebrows, glasses frames and background from the ROI.
 */
export function isSkin(r: number, g: number, b: number): boolean {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127;
}

/** A region as fractions of the face box: [x0, x1, y0, y1]. */
export type RegionFractions = [number, number, number, number];

/** Default regions (ROI_REGIONS) in RegionFractions form. */
export const BOX_REGION_FRACTIONS: RegionFractions[] = ROI_REGIONS.map((r) => [
  r.x0,
  r.x1,
  r.y0,
  r.y1,
]);

export interface Point2 {
  x: number;
  y: number;
}

/** Face landmarks in the same (upright image) coordinates as the face box. */
export interface FaceLandmarks {
  leftEye?: Point2;
  rightEye?: Point2;
  noseBase?: Point2;
  mouthLeft?: Point2;
  mouthRight?: Point2;
  mouthBottom?: Point2;
}

/** Largest head roll (degrees) for which axis-aligned landmark regions stay off the features. */
export const MAX_LANDMARK_ROLL_DEG = 15;

/**
 * Forehead and cheek rectangles placed from face landmarks, as fractions of
 * the face box (so the held-box skin mask stays aligned frame to frame).
 *
 * Geometry is in units of the inter-eye distance d (eye centres), using
 * typical adult proportions: eyebrows sit about 0.3-0.5 d above the eye
 * centres, the nose is about 0.55 d wide, and the mouth corners are about
 * 1 d below the eyes. Forehead: 0.6-1.05 d above the eyes, 0.9 d wide.
 * Cheeks: 0.35-0.85 d below the eyes (and at least 0.15 d above the mouth),
 * from 0.35 d beside the nose midline outwards to 0.85 d. Eyes, eyebrows,
 * nose and lips fall outside these rectangles; hair and background inside
 * them are removed by the skin mask. Returns null (use BOX_REGION_FRACTIONS)
 * when the eyes are missing, implausibly spaced, or the head is rolled more
 * than MAX_LANDMARK_ROLL_DEG.
 *
 * Region order matches ROI_REGIONS: forehead, image-left cheek, image-right cheek.
 */
export function landmarkRegionFractions(
  face: FaceBox,
  lm: FaceLandmarks,
): RegionFractions[] | null {
  'worklet';
  if (!lm.leftEye || !lm.rightEye || !(face.width > 0) || !(face.height > 0)) return null;
  const a = lm.leftEye.x <= lm.rightEye.x ? lm.leftEye : lm.rightEye;
  const b = a === lm.leftEye ? lm.rightEye : lm.leftEye;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 0.2 * face.width || d > 0.7 * face.width) return null;
  const roll = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (Math.abs(roll) > MAX_LANDMARK_ROLL_DEG) return null;
  const mx = (a.x + b.x) / 2;
  const ey = (a.y + b.y) / 2;
  let cheekBottom = ey + 0.85 * d;
  const mouthY = Math.min(lm.mouthLeft?.y ?? Infinity, lm.mouthRight?.y ?? Infinity);
  if (Number.isFinite(mouthY)) cheekBottom = Math.min(cheekBottom, mouthY - 0.15 * d);
  const cheekTop = ey + 0.35 * d;
  if (cheekBottom - cheekTop < 0.2 * d) return null;
  const fx = (x: number) => Math.min(1, Math.max(0, (x - face.x) / face.width));
  const fy = (y: number) => Math.min(1, Math.max(0, (y - face.y) / face.height));
  const rect = (x0: number, x1: number, y0: number, y1: number): RegionFractions => [
    fx(x0),
    fx(x1),
    fy(y0),
    fy(y1),
  ];
  const out = [
    rect(mx - 0.45 * d, mx + 0.45 * d, ey - 1.05 * d, ey - 0.6 * d),
    rect(mx - 0.85 * d, mx - 0.35 * d, cheekTop, cheekBottom),
    rect(mx + 0.35 * d, mx + 0.85 * d, cheekTop, cheekBottom),
  ];
  // A region squeezed to nothing by the face-box edge is useless.
  for (const r of out) if (r[1] - r[0] < 0.05 || r[3] - r[2] < 0.03) return null;
  return out;
}

/**
 * Average the skin pixels of the forehead and cheek regions of `face`.
 * Only aggregate statistics leave this function; no pixels are copied.
 * Returns combined means plus per-region means, luma and clipping.
 *
 * @param step sampling stride in pixels (2 = every other pixel/row).
 * @param fractions region rectangles as fractions of the face box (default ROI_REGIONS).
 */
export function extractRoi(
  frame: PixelFrame,
  face: FaceBox,
  step = 2,
  fractions: RegionFractions[] = BOX_REGION_FRACTIONS,
): RoiSample {
  const { width, height, data, channels } = frame;
  const stride = frame.stride ?? width * channels;
  let sr = 0,
    sg = 0,
    sb = 0,
    skin = 0,
    sampled = 0,
    lumaSum = 0,
    clipped = 0;
  const regions: RoiRegionSample[] = [];
  for (const reg of fractions) {
    let rr = 0,
      rg = 0,
      rb = 0,
      rn = 0,
      rs = 0,
      rl = 0,
      rc = 0;
    const x0 = Math.max(0, Math.floor(face.x + reg[0] * face.width));
    const x1 = Math.min(width, Math.ceil(face.x + reg[1] * face.width));
    const y0 = Math.max(0, Math.floor(face.y + reg[2] * face.height));
    const y1 = Math.min(height, Math.ceil(face.y + reg[3] * face.height));
    for (let y = y0; y < y1; y += step) {
      const row = y * stride;
      for (let x = x0; x < x1; x += step) {
        const o = row + x * channels;
        const r = data[o]!,
          g = data[o + 1]!,
          b = data[o + 2]!;
        rs++;
        rl += 0.299 * r + 0.587 * g + 0.114 * b;
        const clip = r >= 250 || g >= 250 || b >= 250;
        if (clip) rc++;
        if (isSkin(r, g, b) && !clip) {
          rr += r;
          rg += g;
          rb += b;
          rn++;
        }
      }
    }
    sr += rr;
    sg += rg;
    sb += rb;
    skin += rn;
    sampled += rs;
    lumaSum += rl;
    clipped += rc;
    regions.push({
      r: rn ? rr / rn : 0,
      g: rn ? rg / rn : 0,
      b: rn ? rb / rn : 0,
      n: rn,
      luma: rs ? rl / rs : 0,
      clipped: rs ? rc / rs : 0,
    });
  }
  return {
    r: skin ? sr / skin : 0,
    g: skin ? sg / skin : 0,
    b: skin ? sb / skin : 0,
    skinPixels: skin,
    luma: sampled ? lumaSum / sampled : 0,
    clippedFraction: sampled ? clipped / sampled : 0,
    regions,
  };
}
