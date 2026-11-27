import { analyzeSession, type VitalsSdkProvider } from '@edgevitals/measurement';
import { measurementSchema } from '@edgevitals/domain';
import { describe, expect, it } from 'vitest';
import { toSubmission } from '../src/lib/measurements';
import { getVitalsSdkProvider, withSdkVitals } from '../src/vitals-sdk';

const fake: VitalsSdkProvider = {
  id: 'fake',
  displayName: 'Fake',
  sdkVersion: '1.0.0',
  metrics: ['spo2', 'blood_pressure'],
  status: async () => ({ state: 'ready' }),
  measure: async () => [
    { metric: 'spo2', value: 97 },
    { metric: 'blood_pressure', value: 119, valueSecondary: 78 },
  ],
};

describe('vitals SDK registry', () => {
  it('falls back to no SDK for unknown or missing ids', () => {
    expect(getVitalsSdkProvider(undefined).id).toBe('none');
    expect(getVitalsSdkProvider('binah').id).toBe('none');
  });

  it('keeps SpO2 and BP Not available without an SDK, and the API accepts the submission', async () => {
    const result = await withSdkVitals(analyzeSession([]));
    const sub = toSubmission(result);
    for (const m of sub.measurements) expect(measurementSchema.safeParse(m).success).toBe(true);
    const bp = sub.measurements.find((m) => m.metric === 'blood_pressure')!;
    expect(bp).toMatchObject({ status: 'unavailable', value: null, reason: 'unsupported_method' });
  });

  it('submits licensed SDK readings that the API schema accepts', async () => {
    const sub = toSubmission(await withSdkVitals(analyzeSession([]), fake));
    const bp = sub.measurements.find((m) => m.metric === 'blood_pressure')!;
    expect(bp).toMatchObject({
      status: 'valid',
      value: 119,
      value_secondary: 78,
      method: 'licensed_sdk',
      algorithm_name: 'sdk-fake',
    });
    for (const m of sub.measurements) expect(measurementSchema.safeParse(m).success).toBe(true);
  });

  it('never runs the SDK for a cancelled scan', async () => {
    let ran = false;
    const r = await withSdkVitals(analyzeSession([], { cancelled: true }), {
      ...fake,
      measure: async () => {
        ran = true;
        return [];
      },
    });
    expect(ran).toBe(false);
    expect(r.outcome).toBe('cancelled');
  });
});
