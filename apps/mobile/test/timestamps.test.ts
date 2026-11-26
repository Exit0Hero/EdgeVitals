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
});
