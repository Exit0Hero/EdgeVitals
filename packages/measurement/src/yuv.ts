import type { FaceBox, RoiSample } from './types';

/**
 * ROI extraction straight from native camera YUV buffers.
 *
 * Native camera frames arrive as YUV 4:2:0 in the sensor's orientation; face
 * detectors (ML Kit) report boxes in the upright image. These helpers map the
 * upright forehead/cheek regions back into the buffer and average skin pixels,
 * so the result matches `extractRoi` on an upright RGB image.
 *
 * The functions carry a 'worklet' directive so they can run on a VisionCamera
 * frame-processor thread; in Node and on the web the directive is a no-op.
 */

export interface YuvPlane {
  data: ArrayLike<number>;
  /** Bytes per row. */
  rowStride: number;
  /** Bytes between horizontally adjacent samples (1 planar, 2 interleaved). */
  pixelStride: number;
  /** Byte offset of the first sample (1 for Cr in an interleaved CbCr plane). */
  offset?: number;
}

export interface YuvFrame {
  /** Buffer dimensions, before rotation. */
  width: number;
  height: number;
  y: YuvPlane;
  /** Cb (U) samples, at half resolution in both directions (4:2:0). */
  u: YuvPlane;
  /** Cr (V) samples. */
  v: YuvPlane;
  /** true for full range (0-255), false for video range (Y 16-235, C 16-240). */
  fullRange: boolean;
}

/** Clockwise rotation that turns the buffer upright (VisionCamera `Frame.orientation`). */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * VisionCamera's `orientation` says how the pixel data is rotated: `'left'`
 * means rotated 90° counter-clockwise, so it needs 90° clockwise to be upright
 * (Android maps CameraX `rotationDegrees` 90 to `'left'`; iOS uses the same
 * convention as `UIImage.Orientation.left`).
 */
export function orientationToRotation(o: 'up' | 'right' | 'down' | 'left'): Rotation {
  'worklet';
  return o === 'left' ? 90 : o === 'down' ? 180 : o === 'right' ? 270 : 0;
}

/** Size of the upright image for a buffer of `width` x `height`. */
export function uprightSize(width: number, height: number, rotation: Rotation) {
  'worklet';
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/**
 * Map a pixel (u, v) of the upright image to buffer coordinates.
 * `mirrored`: the upright image is horizontally flipped relative to the buffer
 * (front camera previews).
 */
export function uprightToBuffer(
  u: number,
  v: number,
  width: number,
  height: number,
  rotation: Rotation,
  mirrored: boolean,
): [number, number] {
  'worklet';
  const up = uprightSize(width, height, rotation);
  const uu = mirrored ? up.width - 1 - u : u;
  switch (rotation) {
    case 90:
      return [v, height - 1 - uu];
    case 180:
      return [width - 1 - uu, height - 1 - v];
    case 270:
      return [width - 1 - v, uu];
    default:
      return [uu, v];
  }
}

/**
 * Pixel stride of a chroma plane whose stride is not reported directly:
 * inferred from the plane's byte length, row stride and sample count per row.
 */
export function inferPixelStride(
  byteLength: number,
  rowStride: number,
  rows: number,
  samplesPerRow: number,
): number {
  'worklet';
  if (rows < 1 || samplesPerRow < 2) return 1;
  const lastRow = byteLength - rowStride * (rows - 1);
  return Math.max(1, Math.min(4, Math.round((lastRow - 1) / (samplesPerRow - 1))));
}

/**
 * Which sampled pixels count as skin, decided once and then reused. With a
 * per-frame skin test, pixels near the colour threshold drop in and out of
 * the average as sensor noise and the pulse itself nudge them, which adds
 * noise to the very signal being measured. Fill it on the first frame of a
 * held face box (`ready: false`), then pass the same object every frame.
 */
export interface SkinMask {
  bits: Uint8Array;
  ready: boolean;
}

/** An empty mask large enough for `face` sampled every `step` pixels. */
export function createSkinMask(face: FaceBox, step = 2): SkinMask {
  'worklet';
  const n = Math.ceil((face.width + 2) / step) * Math.ceil((face.height + 2) / step);
  return { bits: new Uint8Array(n), ready: false };
}

/**
 * Average the skin pixels of the forehead and cheeks of `face` (upright
 * coordinates) in a YUV frame. Same regions, skin test and clipping rules as
 * `extractRoi`; only aggregate statistics are returned. With `mask`, skin
 * membership is decided on the frame that fills it and then kept fixed.
 */
export function extractRoiYuv(
  frame: YuvFrame,
  face: FaceBox,
  rotation: Rotation,
  mirrored: boolean,
  step = 2,
  mask: SkinMask | null = null,
): RoiSample {
  'worklet';
  // Keep in sync with ROI_REGIONS in roi.ts (checked by tests).
  const regions = [
    [0.3, 0.7, 0.08, 0.24],
    [0.14, 0.38, 0.52, 0.74],
    [0.62, 0.86, 0.52, 0.74],
  ];
  const { width, height, y: yp, u: up, v: vp, fullRange } = frame;
  const upright = uprightSize(width, height, rotation);
  const uOff = up.offset ?? 0;
  const vOff = vp.offset ?? 0;
  let sr = 0,
    sg = 0,
    sb = 0,
    skin = 0,
    sampled = 0,
    lumaSum = 0,
    clipped = 0,
    k = 0;
  const useMask = mask !== null && mask.ready;
  const fillMask = mask !== null && !mask.ready;
  for (const reg of regions) {
    const u0 = Math.max(0, Math.floor(face.x + reg[0]! * face.width));
    const u1 = Math.min(upright.width, Math.ceil(face.x + reg[1]! * face.width));
    const v0 = Math.max(0, Math.floor(face.y + reg[2]! * face.height));
    const v1 = Math.min(upright.height, Math.ceil(face.y + reg[3]! * face.height));
    for (let vv = v0; vv < v1; vv += step) {
      for (let uu = u0; uu < u1; uu += step) {
        const p = uprightToBuffer(uu, vv, width, height, rotation, mirrored);
        const bx = p[0];
        const by = p[1];
        let Y = yp.data[by * yp.rowStride + bx * yp.pixelStride]!;
        const cx = bx >> 1;
        const cy = by >> 1;
        let Cb = up.data[uOff + cy * up.rowStride + cx * up.pixelStride]! - 128;
        let Cr = vp.data[vOff + cy * vp.rowStride + cx * vp.pixelStride]! - 128;
        if (!fullRange) {
          Y = ((Y - 16) * 255) / 219;
          Cb = (Cb * 255) / 224;
          Cr = (Cr * 255) / 224;
        }
        const r = Math.min(255, Math.max(0, Y + 1.402 * Cr));
        const g = Math.min(255, Math.max(0, Y - 0.344136 * Cb - 0.714136 * Cr));
        const b = Math.min(255, Math.max(0, Y + 1.772 * Cb));
        sampled++;
        lumaSum += 0.299 * r + 0.587 * g + 0.114 * b;
        const clip = r >= 250 || g >= 250 || b >= 250;
        if (clip) clipped++;
        let isSkin: boolean;
        if (useMask) {
          isSkin = k < mask.bits.length && mask.bits[k] === 1;
        } else {
          // Skin test in YCbCr (Chai & Ngan), identical to isSkin() in roi.ts.
          const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
          isSkin = cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127;
          if (fillMask && k < mask.bits.length) mask.bits[k] = isSkin && !clip ? 1 : 0;
        }
        k++;
        if (!clip && isSkin) {
          sr += r;
          sg += g;
          sb += b;
          skin++;
        }
      }
    }
  }
  if (fillMask) mask.ready = true;
  return {
    r: skin ? sr / skin : 0,
    g: skin ? sg / skin : 0,
    b: skin ? sb / skin : 0,
    skinPixels: skin,
    luma: sampled ? lumaSum / sampled : 0,
    clippedFraction: sampled ? clipped / sampled : 0,
  };
}

/**
 * Exponentially smooth a face box between frames. Face detectors move their
 * box by a few pixels every frame even when the head is still; because the
 * ROI follows the box, that jitter slides skin/hair/eyebrow edges in and out
 * of the sampled regions and adds colour noise far larger than the <1% pulse
 * signal. A real move (centre shift above `resetFraction` of the face width)
 * snaps to the new box instead of lagging behind it.
 */
export function smoothFaceBox(
  prev: FaceBox | null,
  next: FaceBox,
  alpha = 0.25,
  resetFraction = 0.25,
): FaceBox {
  'worklet';
  if (!prev) return next;
  const dx = next.x + next.width / 2 - (prev.x + prev.width / 2);
  const dy = next.y + next.height / 2 - (prev.y + prev.height / 2);
  if (Math.hypot(dx, dy) > resetFraction * prev.width) return next;
  return {
    x: prev.x + alpha * (next.x - prev.x),
    y: prev.y + alpha * (next.y - prev.y),
    width: prev.width + alpha * (next.width - prev.width),
    height: prev.height + alpha * (next.height - prev.height),
  };
}

/**
 * Keep the skin-sampling box fixed while the face stays put. Even a smoothed
 * box drifts by fractions of a pixel, which moves the region edges and the
 * sampling grid onto different pixels. Holding the box (whole pixels) means
 * the same skin pixels are averaged frame after frame; it is replaced only
 * when the face centre moves or the size changes by more than `tolerance` of
 * the face width.
 */
export function holdRoiBox(held: FaceBox | null, box: FaceBox, tolerance = 0.08): FaceBox {
  'worklet';
  if (held) {
    const dx = box.x + box.width / 2 - (held.x + held.width / 2);
    const dy = box.y + box.height / 2 - (held.y + held.height / 2);
    const moved = Math.hypot(dx, dy) > tolerance * held.width;
    const resized = Math.abs(box.width / held.width - 1) > tolerance;
    if (!moved && !resized) return held;
  }
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}
