import { describe, expect, it } from 'vitest';
import { createTimestampNormalizer } from '../src/camera/timestamps';

describe('camera timestamp units', () => {
  const cases: Array<[string, number]> = [
    ['nanoseconds', 1e6],
    ['microseconds', 1e3],
    ['milliseconds', 1],
    ['seconds', 1e-3],
  ];
  for (const [unit, perMs] of cases)
    it(`converts ${unit} to milliseconds from the first frame`, () => {
      const norm = createTimestampNormalizer();
      const base = 123456 * perMs * 1000;
      expect(norm(base)).toBeNull();
      expect(norm(base + 33.3 * perMs)).toBeCloseTo(33.3, 1);
      expect(norm(base + 1000 * perMs)).toBeCloseTo(1000, 1);
    });

  it('uses a known unit even when the first two frames arrive back to back', () => {
    const norm = createTimestampNormalizer(1e-6);
    expect(norm(5e12)).toBeNull();
    expect(norm(5e12 + 1e6)).toBeCloseTo(1, 3);
    expect(norm(5e12 + 34e6)).toBeCloseTo(34, 3);
  });
});
