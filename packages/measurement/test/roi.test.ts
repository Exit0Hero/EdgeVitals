import { describe, expect, it } from 'vitest';
import { extractRoi, isSkin } from '../src/roi';

function image(w: number, h: number, fill: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  return { width: w, height: h, data, channels: 4 as const };
}

describe('roi extraction', () => {
  it('classifies typical skin tones as skin and blue background as not', () => {
    expect(isSkin(200, 150, 130)).toBe(true);
    expect(isSkin(120, 80, 60)).toBe(true);
    expect(isSkin(30, 60, 200)).toBe(false);
  });

  it('averages only skin pixels inside the face regions', () => {
    const face = { x: 40, y: 40, width: 100, height: 120 };
    const img = image(200, 200, (x, y) =>
      x >= 40 && x < 140 && y >= 40 && y < 160 ? [190, 140, 120] : [20, 60, 200],
    );
    const s = extractRoi(img, face);
    expect(s.skinPixels).toBeGreaterThan(500);
    expect(s.r).toBeCloseTo(190, 5);
    expect(s.g).toBeCloseTo(140, 5);
    expect(s.clippedFraction).toBe(0);
  });

  it('reports clipped pixels and excludes them from the mean', () => {
    const face = { x: 0, y: 0, width: 100, height: 100 };
    const img = image(100, 100, () => [255, 255, 255]);
    const s = extractRoi(img, face);
    expect(s.skinPixels).toBe(0);
    expect(s.clippedFraction).toBe(1);
  });
});
