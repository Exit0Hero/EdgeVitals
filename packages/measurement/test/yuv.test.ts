import { describe, expect, it } from 'vitest';
import { extractRoi, ROI_REGIONS } from '../src/roi';
import {
  extractRoiYuv,
  inferPixelStride,
  orientationToRotation,
  uprightToBuffer,
  type Rotation,
  type YuvFrame,
} from '../src/yuv';

const W = 160; // upright width
const H = 120; // upright height
const face = { x: 12, y: 6, width: 70, height: 84 }; // off-centre, so a wrong mapping misses it
const SKIN: [number, number, number] = [200, 140, 110];
const BG: [number, number, number] = [30, 90, 200];

/** Upright RGBA test image: a skin-coloured face box on a blue background. */
function uprightRgb() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let v = 0; v < H; v++)
    for (let u = 0; u < W; u++) {
      const inFace =
        u >= face.x && u < face.x + face.width && v >= face.y && v < face.y + face.height;
      const c = inFace ? SKIN : BG;
      data.set([c[0], c[1], c[2], 255], (v * W + u) * 4);
    }
  return data;
}

const toYcc = (r: number, g: number, b: number, full: boolean) => {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return full
    ? [y, cb, cr]
    : [16 + (y * 219) / 255, 128 + ((cb - 128) * 224) / 255, 128 + ((cr - 128) * 224) / 255];
};

/** Encode the upright image into a rotated/mirrored YUV 4:2:0 buffer. */
function toBuffer(
  rgb: Uint8ClampedArray,
  rotation: Rotation,
  mirrored: boolean,
  full: boolean,
  interleaved: boolean,
): YuvFrame {
  const bw = rotation === 90 || rotation === 270 ? H : W;
  const bh = rotation === 90 || rotation === 270 ? W : H;
  const Y = new Uint8Array(bw * bh);
  const cw = bw / 2;
  const ch = bh / 2;
  const U = new Uint8Array(cw * ch * (interleaved ? 2 : 1));
  const V = interleaved ? U : new Uint8Array(cw * ch);
  for (let v = 0; v < H; v++)
    for (let u = 0; u < W; u++) {
      const o = (v * W + u) * 4;
      const [yy, cb, cr] = toYcc(rgb[o]!, rgb[o + 1]!, rgb[o + 2]!, full);
      const [x, y] = uprightToBuffer(u, v, bw, bh, rotation, mirrored);
      Y[y * bw + x] = Math.round(yy!);
      if (x % 2 === 0 && y % 2 === 0) {
        const ci = (y / 2) * cw + x / 2;
        if (interleaved) {
          U[ci * 2] = Math.round(cb!);
          U[ci * 2 + 1] = Math.round(cr!);
        } else {
          U[ci] = Math.round(cb!);
          V[ci] = Math.round(cr!);
        }
      }
    }
  return {
    width: bw,
    height: bh,
    y: { data: Y, rowStride: bw, pixelStride: 1 },
    u: { data: U, rowStride: interleaved ? bw : cw, pixelStride: interleaved ? 2 : 1 },
    v: {
      data: V,
      rowStride: interleaved ? bw : cw,
      pixelStride: interleaved ? 2 : 1,
      offset: interleaved ? 1 : 0,
    },
    fullRange: full,
  };
}

describe('YUV ROI extraction', () => {
  const rgb = uprightRgb();
  const reference = extractRoi({ width: W, height: H, data: rgb, channels: 4 }, face);

  it('uses the same regions as the RGB extractor', () => {
    expect(ROI_REGIONS.map((r) => [r.x0, r.x1, r.y0, r.y1])).toEqual([
      [0.3, 0.7, 0.08, 0.24],
      [0.14, 0.38, 0.52, 0.74],
      [0.62, 0.86, 0.52, 0.74],
    ]);
  });

  for (const rotation of [0, 90, 180, 270] as const)
    for (const mirrored of [false, true])
      for (const full of [true, false])
        for (const interleaved of [false, true])
          it(`matches the RGB result (rotation ${rotation}, mirrored ${mirrored}, ${full ? 'full' : 'video'} range, ${interleaved ? 'interleaved' : 'planar'} chroma)`, () => {
            // The detector's box is in upright (possibly mirrored) image coordinates,
            // the same space the test image was drawn in.
            const f = face;
            const frame = toBuffer(rgb, rotation, mirrored, full, interleaved);
            const res = extractRoiYuv(frame, f, rotation, mirrored);
            expect(res.skinPixels).toBe(reference.skinPixels);
            expect(Math.abs(res.r - reference.r)).toBeLessThan(2.5);
            expect(Math.abs(res.g - reference.g)).toBeLessThan(2.5);
            expect(Math.abs(res.b - reference.b)).toBeLessThan(2.5);
            expect(Math.abs(res.luma - reference.luma)).toBeLessThan(2.5);
          });

  it('reads the wrong pixels if the rotation is wrong (the mapping matters)', () => {
    const frame = toBuffer(rgb, 90, false, true, false);
    const wrong = extractRoiYuv(frame, face, 270, false);
    expect(wrong.skinPixels).toBeLessThan(reference.skinPixels);
  });

  it('ignores the background when the face box is wrong', () => {
    const frame = toBuffer(rgb, 90, false, true, false);
    const res = extractRoiYuv(frame, { x: 120, y: 80, width: 30, height: 30 }, 90, false);
    expect(res.skinPixels).toBe(0);
  });

  it('maps orientations and infers chroma pixel strides', () => {
    expect(['up', 'right', 'down', 'left'].map((o) => orientationToRotation(o as 'up'))).toEqual([
      0, 270, 180, 90,
    ]);
    // Android U plane of an interleaved VU buffer: 320 px row, 160 samples spaced 2 bytes, last row short by one byte.
    expect(inferPixelStride(320 * 119 + 319, 320, 120, 160)).toBe(2);
    expect(inferPixelStride(160 * 120, 160, 120, 160)).toBe(1);
  });
});
