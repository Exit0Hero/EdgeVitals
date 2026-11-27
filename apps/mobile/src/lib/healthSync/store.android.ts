/** Health Connect (Android), read only (ADR 0009). */
import { Linking } from 'react-native';
import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  revokeAllPermissions,
  SdkAvailabilityStatus,
  type Permission,
} from 'react-native-health-connect';
import {
  collect,
  fromHealthConnectBloodPressure,
  fromHealthConnectSpo2,
  type HcBloodPressure,
  type HcOxygenSaturation,
} from './mapping';
import type { Access, HealthStore } from './types';

const PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'OxygenSaturation' },
  { accessType: 'read', recordType: 'BloodPressure' },
];
/** Upper bound per type and sync, so a years-long history cannot stall the app. */
const MAX_RECORDS = 2000;

let ready: Promise<boolean> | null = null;
const init = () => (ready ??= initialize().catch(() => ((ready = null), false)));

const toAccess = (granted: { accessType: string; recordType: string }[]): Access => ({
  spo2: granted.some((p) => p.accessType === 'read' && p.recordType === 'OxygenSaturation'),
  blood_pressure: granted.some((p) => p.accessType === 'read' && p.recordType === 'BloodPressure'),
});

async function readAll<T>(type: 'OxygenSaturation' | 'BloodPressure', since: Date): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords(type, {
      timeRangeFilter: { operator: 'after', startTime: since.toISOString() },
      pageSize: 500,
      ...(pageToken ? { pageToken } : {}),
    });
    out.push(...(page.records as unknown as T[]));
    pageToken = page.pageToken || undefined;
  } while (pageToken && out.length < MAX_RECORDS);
  return out;
}

export const healthStore: HealthStore | null = {
  platform: 'health_connect',
  name: 'Health Connect',
  async availability() {
    const status = await getSdkStatus().catch(() => SdkAvailabilityStatus.SDK_UNAVAILABLE);
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED)
      return 'needs_update';
    return 'unavailable';
  },
  async requestAccess() {
    if (!(await init())) return { spo2: false, blood_pressure: false };
    return toAccess(await requestPermission(PERMISSIONS));
  },
  async grantedAccess() {
    if (!(await init())) return { spo2: false, blood_pressure: false };
    return toAccess(await getGrantedPermissions());
  },
  async read(since) {
    if (!(await init())) throw new Error('Health Connect is not available');
    const access = toAccess(await getGrantedPermissions());
    const [ox, bp] = await Promise.all([
      access.spo2 ? readAll<HcOxygenSaturation>('OxygenSaturation', since) : [],
      access.blood_pressure ? readAll<HcBloodPressure>('BloodPressure', since) : [],
    ]);
    const a = collect(ox, fromHealthConnectSpo2);
    const b = collect(bp, fromHealthConnectBloodPressure);
    return { readings: [...a.readings, ...b.readings], skipped: a.skipped + b.skipped };
  },
  async revoke() {
    if (!(await init())) return false;
    await revokeAllPermissions();
    return true;
  },
  async openSettings() {
    if ((await this.availability()) === 'needs_update') {
      await Linking.openURL(
        'market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding',
      ).catch(() => undefined);
      return;
    }
    openHealthConnectSettings();
  },
};
