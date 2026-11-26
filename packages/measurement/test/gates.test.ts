import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../src/pipeline';
import { syntheticSession } from './fixtures/synthetic';

/**
 * False-acceptance check of the heart-rate gates against pure noise. This
 * bounds how often the pipeline invents a pulse from a pulseless synthetic
 * signal. It is a software regression guard, not a validation result.
 */
describe('quality gates against noise-only captures', () => {
  it('accepts no heart rate from 150 pulseless captures', () => {
    let accepted = 0;
    for (let s = 0; s < 150; s++) {
      const res = analyzeSession(
        syntheticSession({
          noPulse: true,
          noise: [0.1, 0.3, 1][s % 3],
          durationSec: [15, 20, 45][s % 3],
          seed: 5000 + s,
        }).frames,
      );
      if (res.metrics.some((m) => m.status === 'valid')) accepted++;
    }
    expect(accepted).toBe(0);
  });
});
