import { describe, expect, it } from 'vitest';
import {
  NO_SDK_PROVIDER,
  analyzeSession,
  applySdkOutcome,
  runSdkProvider,
  type SdkReading,
  type VitalsSdkProvider,
} from '../src';

const base = analyzeSession([]);
const provider = { id: 'test', sdkVersion: '2.1.0', metrics: ['spo2', 'blood_pressure'] as const };
const get = (r: ReturnType<typeof applySdkOutcome>, m: string) =>
  r.metrics.find((x) => x.metric === m)!;

const fake = (over: Partial<VitalsSdkProvider> = {}): VitalsSdkProvider => ({
  ...provider,
  displayName: 'Test SDK',
  status: async () => ({ state: 'ready' }),
  measure: async () => [],
  ...over,
});

describe('licensed SDK boundary', () => {
  it('leaves SpO2 and BP "Not available" when no SDK is installed', async () => {
    const outcome = await runSdkProvider(NO_SDK_PROVIDER);
    expect(outcome).toEqual({ kind: 'unavailable', state: 'not_installed' });
    const r = applySdkOutcome(base, NO_SDK_PROVIDER, outcome);
    for (const m of ['spo2', 'blood_pressure']) {
      expect(get(r, m).status).toBe('unavailable');
      expect(get(r, m).reason).toBe('unsupported_method');
      expect(get(r, m).value).toBeNull();
    }
  });

  it('treats an unlicensed SDK as not available and never calls measure', async () => {
    let called = false;
    const p = fake({
      status: async () => ({ state: 'unlicensed' }),
      measure: async () => {
        called = true;
        return [];
      },
    });
    const outcome = await runSdkProvider(p);
    expect(outcome).toEqual({ kind: 'unavailable', state: 'unlicensed' });
    expect(called).toBe(false);
    expect(get(applySdkOutcome(base, p, outcome), 'spo2').reason).toBe('unsupported_method');
  });

  it('stores plausible vendor readings as unvalidated wellness estimates', async () => {
    const readings: SdkReading[] = [
      { metric: 'spo2', value: 97.4, confidence: 0.9 },
      { metric: 'blood_pressure', value: 118.2, valueSecondary: 76.6 },
    ];
    const outcome = await runSdkProvider(fake({ measure: async () => readings }));
    const r = applySdkOutcome(base, provider, outcome);
    expect(get(r, 'spo2')).toMatchObject({ status: 'valid', value: 97, qualityScore: 0.9 });
    expect(get(r, 'blood_pressure')).toMatchObject({
      status: 'valid',
      value: 118,
      valueSecondary: 77,
      qualityFlags: ['vendor_wellness_estimate'],
    });
    expect(get(r, 'spo2').provenance).toEqual({
      method: 'licensed_sdk',
      algorithm: 'sdk-test',
      version: '2.1.0',
      source: 'measured',
      validation: 'unvalidated',
    });
    // Pipeline metrics are untouched.
    expect(get(r, 'heart_rate')).toEqual(get(base, 'heart_rate'));
  });

  it('rejects implausible vendor values instead of showing them', () => {
    const bad = (readings: SdkReading[]) =>
      applySdkOutcome(base, provider, { kind: 'readings', readings });
    expect(get(bad([{ metric: 'spo2', value: 104 }]), 'spo2').status).toBe('invalid');
    expect(get(bad([{ metric: 'spo2', value: Number.NaN }]), 'spo2').value).toBeNull();
    expect(get(bad([{ metric: 'blood_pressure', value: 120 }]), 'blood_pressure').status).toBe(
      'invalid',
    );
    expect(
      get(bad([{ metric: 'blood_pressure', value: 85, valueSecondary: 80 }]), 'blood_pressure')
        .reason,
    ).toBe('out_of_operating_range');
  });

  it('reports SDK errors and missing readings as no reliable reading', async () => {
    const outcome = await runSdkProvider(
      fake({
        measure: async () => {
          throw new Error('face lost');
        },
      }),
    );
    expect(outcome.kind).toBe('error');
    const r = applySdkOutcome(base, provider, outcome);
    expect(get(r, 'spo2')).toMatchObject({ status: 'unavailable', qualityFlags: ['sdk_error'] });
    const none = applySdkOutcome(base, provider, { kind: 'readings', readings: [] });
    expect(get(none, 'blood_pressure').qualityFlags).toEqual(['sdk_no_reading']);
  });

  it('ignores metrics the provider does not claim and cancelled scans', () => {
    const spo2Only = { ...provider, metrics: ['spo2'] as const };
    const readings: SdkReading[] = [{ metric: 'blood_pressure', value: 120, valueSecondary: 80 }];
    const r = applySdkOutcome(base, spo2Only, { kind: 'readings', readings });
    expect(get(r, 'blood_pressure').reason).toBe('unsupported_method');
    const cancelled = analyzeSession([], { cancelled: true });
    const c = applySdkOutcome(cancelled, provider, {
      kind: 'readings',
      readings: [{ metric: 'spo2', value: 97 }],
    });
    expect(get(c, 'spo2').value).toBeNull();
  });
});
