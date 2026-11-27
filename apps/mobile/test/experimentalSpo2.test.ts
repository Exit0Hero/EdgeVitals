import { measurementSchema } from '@edgevitals/domain';
import { analyzeSession, ScanSession } from '@edgevitals/measurement';
import { describe, expect, it } from 'vitest';
import { toSubmission } from '../src/lib/measurements';
import { withSdkVitals } from '../src/vitals-sdk';

describe('experimental SpO2 submission', () => {
  it('every experimental result the pipeline can emit is accepted by the API schema', async () => {
    for (const result of [
      analyzeSession([], { experimentalSpo2: true }),
      new ScanSession(undefined, undefined, { spo2: true }).finish(),
    ]) {
      const sub = toSubmission(await withSdkVitals(result));
      for (const m of sub.measurements) expect(measurementSchema.safeParse(m).success).toBe(true);
      expect(sub.measurements.find((m) => m.metric === 'spo2')!.method).toBe('camera_experimental');
    }
  });

  it('a valid experimental value passes the API schema with its method recorded', () => {
    const base = analyzeSession([], { experimentalSpo2: true });
    const spo2 = base.metrics.find((m) => m.metric === 'spo2')!;
    const result = {
      ...base,
      metrics: base.metrics.map((m) =>
        m.metric === 'spo2'
          ? { ...spo2, status: 'valid' as const, value: 97, qualityScore: 0.7, reason: null }
          : m,
      ),
    };
    const m = toSubmission(result).measurements.find((x) => x.metric === 'spo2')!;
    expect(measurementSchema.safeParse(m).success).toBe(true);
    expect(m).toMatchObject({ method: 'camera_experimental', validation: 'unvalidated' });
  });
});
