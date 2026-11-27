/**
 * Apple Health (iOS), read only (ADR 0009). Code-complete but untested on a
 * device: building it needs an Apple Developer account for the HealthKit
 * entitlement.
 */
import {
  isHealthDataAvailableAsync,
  queryCorrelationSamples,
  queryQuantitySamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';
import {
  collect,
  fromHealthKitBloodPressure,
  fromHealthKitSpo2,
  type HkCorrelationSample,
  type HkQuantitySample,
} from './mapping';
import type { HealthStore } from './types';

const MAX_RECORDS = 2000;
const READ = [
  'HKQuantityTypeIdentifierOxygenSaturation',
  'HKQuantityTypeIdentifierBloodPressureSystolic',
  'HKQuantityTypeIdentifierBloodPressureDiastolic',
] as const;

// HealthKit never tells an app whether read access was granted (privacy by
// design), so access is reported as unknown and an empty read is normal.
const UNKNOWN = { spo2: null, blood_pressure: null };

export const healthStore: HealthStore | null = {
  platform: 'apple_health',
  name: 'Apple Health',
  async availability() {
    return (await isHealthDataAvailableAsync().catch(() => false)) ? 'available' : 'unavailable';
  },
  async requestAccess() {
    await requestAuthorization({ toRead: READ });
    return UNKNOWN;
  },
  async grantedAccess() {
    return UNKNOWN;
  },
  async read(since) {
    const filter = { date: { startDate: since } };
    const [ox, bp] = await Promise.all([
      queryQuantitySamples('HKQuantityTypeIdentifierOxygenSaturation', {
        limit: MAX_RECORDS,
        unit: '%',
        ascending: false,
        filter,
      }),
      queryCorrelationSamples('HKCorrelationTypeIdentifierBloodPressure', {
        limit: MAX_RECORDS,
        ascending: false,
        filter,
      }),
    ]);
    const a = collect(ox as unknown as HkQuantitySample[], fromHealthKitSpo2);
    const b = collect(bp as unknown as HkCorrelationSample[], fromHealthKitBloodPressure);
    return { readings: [...a.readings, ...b.readings], skipped: a.skipped + b.skipped };
  },
  async revoke() {
    // iOS has no API to give up HealthKit access; the person turns it off in
    // Settings → Health → Data Access & Devices → EdgeVitals.
    return false;
  },
  async openSettings() {
    await Linking.openSettings();
  },
};
