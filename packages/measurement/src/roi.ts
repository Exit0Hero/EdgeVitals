import type { FaceBox, RoiSample } from './types';

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

/**
 * Average the skin pixels of the forehead and cheek regions of `face`.
 * Only aggregate statistics leave this function; no pixels are copied.
 *
 * @param step sampling stride in pixels (2 = every other pixel/row).
 */
export function extractRoi(frame: PixelFrame, face: FaceBox, step = 2): RoiSample {
  const { width, height, data, channels } = frame;
  const stride = frame.stride ?? width * channels;
  let sr = 0,
    sg = 0,
    sb = 0,
    skin = 0,
    sampled = 0,
    lumaSum = 0,
    clipped = 0;
  for (const reg of ROI_REGIONS) {
    const x0 = Math.max(0, Math.floor(face.x + reg.x0 * face.width));
    const x1 = Math.min(width, Math.ceil(face.x + reg.x1 * face.width));
    const y0 = Math.max(0, Math.floor(face.y + reg.y0 * face.height));
    const y1 = Math.min(height, Math.ceil(face.y + reg.y1 * face.height));
    for (let y = y0; y < y1; y += step) {
      const row = y * stride;
      for (let x = x0; x < x1; x += step) {
        const o = row + x * channels;
        const r = data[o]!,
          g = data[o + 1]!,
          b = data[o + 2]!;
        sampled++;
        lumaSum += 0.299 * r + 0.587 * g + 0.114 * b;
        if (r >= 250 || g >= 250 || b >= 250) clipped++;
        if (isSkin(r, g, b) && r < 250 && g < 250 && b < 250) {
          sr += r;
          sg += g;
          sb += b;
          skin++;
        }
      }
    }
  }
  return {
    r: skin ? sr / skin : 0,
    g: skin ? sg / skin : 0,
    b: skin ? sb / skin : 0,
    skinPixels: skin,
    luma: sampled ? lumaSum / sampled : 0,
    clippedFraction: sampled ? clipped / sampled : 0,
  };
}
