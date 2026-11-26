import { describe, expect, it } from 'vitest';
import { assessFrame } from '../src/frameQuality';

const roi = { r: 170, g: 120, b: 100, skinPixels: 1500, luma: 130, clippedFraction: 0 };
const face = { x: 200, y: 140, width: 240, height: 300 };
const base = { t: 1000, faces: [face], roi, frameWidth: 640, frameHeight: 640 };

describe('frame quality gates', () => {
  it('passes a centred, well-lit, still face', () => {
    expect(assessFrame(base)).toEqual([]);
  });
  it('flags a missing face', () => {
    expect(assessFrame({ ...base, faces: [] })).toEqual(['face_not_found']);
  });
  it('flags multiple faces', () => {
    expect(assessFrame({ ...base, faces: [face, face] })).toContain('multiple_faces');
  });
  it('flags a face outside the guide', () => {
    expect(assessFrame({ ...base, faces: [{ ...face, x: 0, y: 0 }] })).toContain(
      'face_out_of_region',
    );
  });
  it('flags low and high light', () => {
    expect(assessFrame({ ...base, roi: { ...roi, luma: 20 } })).toContain('lighting_too_low');
    expect(assessFrame({ ...base, roi: { ...roi, clippedFraction: 0.3 } })).toContain(
      'lighting_too_high',
    );
  });
  it('flags motion between frames', () => {
    const flags = assessFrame({ ...base, previous: { t: 967, face: { ...face, x: 170 } } });
    expect(flags).toContain('motion_too_high');
  });
  it('does not flag small natural movement', () => {
    expect(assessFrame({ ...base, previous: { t: 967, face: { ...face, x: 201 } } })).toEqual([]);
  });
});
