import { describe, expect, it } from 'vitest';
import {
  collect,
  formatSynced,
  fromHealthConnectBloodPressure,
  fromHealthConnectSpo2,
  fromHealthKitBloodPressure,
  fromHealthKitSpo2,
  sourceLabel,
} from '../src/lib/healthSync/mapping';

const at = '2026-11-27T08:00:00.000Z';

describe('Health Connect records', () => {
  it('copies SpO2 with its app and device', () => {
    expect(
      fromHealthConnectSpo2({
        time: at,
        percentage: 97,
        metadata: {
          id: 'hc-1',
          dataOrigin: 'com.sec.android.app.shealth',
          device: { manufacturer: 'Samsung', model: 'Galaxy Watch6', type: 1 },
        },
      }),
    ).toEqual({
      metric: 'spo2',
      value: 97,
      value_secondary: null,
      measured_at: at,
      external_id: 'hc-1',
      source_app: 'com.sec.android.app.shealth',
      source_name: 'Samsung Health',
      device_manufacturer: 'Samsung',
      device_model: 'Galaxy Watch6',
    });
  });

  it('copies blood pressure in whole mmHg', () => {
    const r = fromHealthConnectBloodPressure({
      time: at,
      systolic: { inMillimetersOfMercury: 123.6 },
      diastolic: { inMillimetersOfMercury: 79.2 },
      metadata: { id: 'hc-2', dataOrigin: 'jp.co.omron.healthcare.omron_connect' },
    });
    expect(r).toMatchObject({ value: 124, value_secondary: 79, source_name: 'OMRON connect' });
  });

  it('skips records it cannot trust instead of changing them', () => {
    const { readings, skipped } = collect(
      [
        { time: at, percentage: 98, metadata: { id: 'ok' } },
        { time: at, percentage: 30, metadata: { id: 'low' } },
        { time: at, percentage: 101, metadata: { id: 'high' } },
        { time: at, percentage: 97 }, // no id: cannot be de-duplicated
        { time: '2999-01-01T00:00:00Z', percentage: 97, metadata: { id: 'future' } },
      ],
      fromHealthConnectSpo2,
    );
    expect(readings.map((r) => r.external_id)).toEqual(['ok']);
    expect(skipped).toBe(4);
    expect(
      fromHealthConnectBloodPressure({
        time: at,
        systolic: { inMillimetersOfMercury: 80 },
        diastolic: { inMillimetersOfMercury: 90 },
        metadata: { id: 'swap' },
      }),
    ).toBeNull();
  });
});

describe('Apple Health samples', () => {
  const source = {
    sourceRevision: { source: { name: 'Withings', bundleIdentifier: 'com.withings.wiScaleNG' } },
    device: { name: 'BPM Connect', manufacturer: 'Withings', model: 'BPM Connect' },
  };

  it('converts the HealthKit percent fraction to percent', () => {
    expect(
      fromHealthKitSpo2({
        uuid: 'u1',
        startDate: new Date(at),
        quantity: 0.96,
        unit: '%',
        ...source,
      }),
    ).toMatchObject({ value: 96, measured_at: at, source_name: 'Withings' });
    expect(
      fromHealthKitSpo2({ uuid: 'u1', startDate: at, quantity: 96, unit: 'count', ...source }),
    ).toBeNull();
  });

  it('reads systolic and diastolic from the correlation', () => {
    expect(
      fromHealthKitBloodPressure({
        uuid: 'u2',
        startDate: at,
        objects: [
          {
            quantityType: 'HKQuantityTypeIdentifierBloodPressureDiastolic',
            quantity: 82,
            unit: 'mmHg',
          },
          {
            quantityType: 'HKQuantityTypeIdentifierBloodPressureSystolic',
            quantity: 131,
            unit: 'mmHg',
          },
        ],
        ...source,
      }),
    ).toMatchObject({ value: 131, value_secondary: 82, device_model: 'BPM Connect' });
    expect(
      fromHealthKitBloodPressure({
        uuid: 'u3',
        startDate: at,
        objects: [{ quantityType: 'HKQuantityTypeIdentifierBloodPressureSystolic', quantity: 131 }],
      }),
    ).toBeNull();
  });
});

describe('labels', () => {
  it('names the device, the app and the health store', () => {
    expect(
      sourceLabel({
        platform: 'health_connect',
        source_app: 'com.sec.android.app.shealth',
        source_name: null,
        device_manufacturer: 'Samsung',
        device_model: 'Galaxy Watch6',
      }),
    ).toBe('Samsung Galaxy Watch6 · Samsung Health via Health Connect');
    expect(
      sourceLabel({
        platform: 'apple_health',
        source_app: 'com.withings.wiScaleNG',
        source_name: 'Withings',
        device_manufacturer: 'Withings',
        device_model: 'Withings BPM Connect',
      }),
    ).toBe('Withings BPM Connect · Withings via Apple Health');
    expect(
      sourceLabel({
        platform: 'health_connect',
        source_app: 'com.example.unknown',
        source_name: null,
        device_manufacturer: null,
        device_model: null,
      }),
    ).toBe('com.example.unknown via Health Connect');
    expect(formatSynced({ metric: 'spo2', value: 97.5, value_secondary: null })).toBe('97.5%');
    expect(formatSynced({ metric: 'blood_pressure', value: 120, value_secondary: 80 })).toBe(
      '120/80 mmHg',
    );
  });
});
