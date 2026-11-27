/**
 * Pure conversion from Health Connect / HealthKit records to EdgeVitals
 * health-sync readings (ADR 0009). No native imports, so it is unit-tested.
 *
 * Values are copied as recorded. A record is skipped, never "fixed", when it
 * is outside the range a person can have or misses a part we need.
 */
import { healthSyncReadingSchema, type HealthSyncReadingInput } from '@edgevitals/domain';

const text = (s: unknown, max: number): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

function accept(r: HealthSyncReadingInput): HealthSyncReadingInput | null {
  return healthSyncReadingSchema.safeParse(r).success ? r : null;
}

/** Blood pressure is shown in whole mmHg; devices record whole numbers. */
const mmHg = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
/** SpO2 to one decimal place, as the database stores it. */
const pct1 = (v: number) => Math.round(v * 10) / 10;

// ── Health Connect ──
/** The subset of react-native-health-connect record results we read. */
export interface HcMetadata {
  id?: string;
  dataOrigin?: string;
  device?: { manufacturer?: string; model?: string; type?: number };
}
export interface HcOxygenSaturation {
  time: string;
  percentage: number;
  metadata?: HcMetadata;
}
export interface HcBloodPressure {
  time: string;
  systolic: { inMillimetersOfMercury: number };
  diastolic: { inMillimetersOfMercury: number };
  metadata?: HcMetadata;
}

function hcSource(m: HcMetadata | undefined) {
  const app = text(m?.dataOrigin, 200) ?? 'unknown';
  return {
    source_app: app,
    source_name: knownAppName(app),
    device_manufacturer: text(m?.device?.manufacturer, 120),
    device_model: text(m?.device?.model, 120),
  };
}

export function fromHealthConnectSpo2(r: HcOxygenSaturation): HealthSyncReadingInput | null {
  const id = text(r.metadata?.id, 200);
  if (!id || typeof r.percentage !== 'number' || !Number.isFinite(r.percentage)) return null;
  return accept({
    metric: 'spo2',
    value: pct1(r.percentage),
    value_secondary: null,
    measured_at: r.time,
    external_id: id,
    ...hcSource(r.metadata),
  });
}

export function fromHealthConnectBloodPressure(r: HcBloodPressure): HealthSyncReadingInput | null {
  const id = text(r.metadata?.id, 200);
  if (!id) return null;
  return accept({
    metric: 'blood_pressure',
    value: mmHg(r.systolic?.inMillimetersOfMercury),
    value_secondary: mmHg(r.diastolic?.inMillimetersOfMercury),
    measured_at: r.time,
    external_id: id,
    ...hcSource(r.metadata),
  });
}

// ── Apple HealthKit ──
/** The subset of @kingstinct/react-native-healthkit samples we read. */
export interface HkSampleBase {
  uuid: string;
  startDate: Date | string;
  sourceRevision?: { source?: { name?: string; bundleIdentifier?: string } };
  device?: { name?: string; manufacturer?: string; model?: string };
}
export interface HkQuantitySample extends HkSampleBase {
  quantity: number;
  unit: string;
  quantityType?: string;
}
export interface HkCorrelationSample extends HkSampleBase {
  objects: readonly { quantityType?: string; quantity?: number; unit?: string }[];
}

function hkSource(s: HkSampleBase) {
  return {
    source_app: text(s.sourceRevision?.source?.bundleIdentifier, 200) ?? 'unknown',
    source_name: text(s.sourceRevision?.source?.name, 120),
    device_manufacturer: text(s.device?.manufacturer, 120),
    device_model: text(s.device?.model, 120) ?? text(s.device?.name, 120),
  };
}
const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();

export function fromHealthKitSpo2(s: HkQuantitySample): HealthSyncReadingInput | null {
  if (!s.uuid || typeof s.quantity !== 'number' || !Number.isFinite(s.quantity)) return null;
  // HealthKit's '%' unit is a fraction (0.97 = 97%).
  if (s.unit !== '%') return null;
  const value = s.quantity <= 1 ? s.quantity * 100 : s.quantity;
  return accept({
    metric: 'spo2',
    value: pct1(value),
    value_secondary: null,
    measured_at: iso(s.startDate),
    external_id: s.uuid,
    ...hkSource(s),
  });
}

export function fromHealthKitBloodPressure(s: HkCorrelationSample): HealthSyncReadingInput | null {
  if (!s.uuid) return null;
  const part = (type: string) => {
    const o = s.objects?.find((x) => x.quantityType === type);
    return o && (o.unit === undefined || o.unit === 'mmHg') ? mmHg(o.quantity) : NaN;
  };
  return accept({
    metric: 'blood_pressure',
    value: part('HKQuantityTypeIdentifierBloodPressureSystolic'),
    value_secondary: part('HKQuantityTypeIdentifierBloodPressureDiastolic'),
    measured_at: iso(s.startDate),
    external_id: s.uuid,
    ...hkSource(s),
  });
}

/** Keep the valid ones and count the rest. */
export function collect<T>(
  records: readonly T[],
  map: (r: T) => HealthSyncReadingInput | null,
): { readings: HealthSyncReadingInput[]; skipped: number } {
  const readings: HealthSyncReadingInput[] = [];
  let skipped = 0;
  for (const r of records) {
    const m = map(r);
    if (m) readings.push(m);
    else skipped++;
  }
  return { readings, skipped };
}

// ── Labels ──
/** Names for common Android apps that write SpO2 or blood pressure to Health Connect. */
const KNOWN_ANDROID_APPS: Record<string, string> = {
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.google.android.apps.fitness': 'Google Fit',
  'com.google.android.apps.healthdata': 'Health Connect',
  'com.fitbit.FitbitMobile': 'Fitbit',
  'jp.co.omron.healthcare.omron_connect': 'OMRON connect',
  'com.xiaomi.wearable': 'Mi Fitness',
  'com.mi.health': 'Mi Fitness',
  'com.huami.watch.hmwatchmanager': 'Zepp',
  'com.huawei.health': 'Huawei Health',
  'com.withings.wiscale2': 'Withings',
  'com.ouraring.oura': 'Oura',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
  'com.vivo.health': 'vivo Health',
};

export function knownAppName(packageName: string): string | null {
  return KNOWN_ANDROID_APPS[packageName] ?? null;
}

export interface SourceLike {
  platform: 'health_connect' | 'apple_health';
  source_app: string;
  source_name: string | null;
  device_manufacturer: string | null;
  device_model: string | null;
}

/** "Galaxy Watch6 · Samsung Health via Health Connect". */
export function sourceLabel(s: SourceLike): string {
  const store = s.platform === 'health_connect' ? 'Health Connect' : 'Apple Health';
  const app = s.source_name ?? knownAppName(s.source_app) ?? s.source_app;
  const make = s.device_manufacturer;
  const model = s.device_model;
  const device = model
    ? make && !model.toLowerCase().startsWith(make.toLowerCase())
      ? `${make} ${model}`
      : model
    : null;
  const via = app === store || app === 'unknown' ? store : `${app} via ${store}`;
  return device ? `${device} · ${via}` : via;
}

/** "97%" or "124/81 mmHg". */
export function formatSynced(r: {
  metric: 'spo2' | 'blood_pressure';
  value: number;
  value_secondary: number | null;
}): string {
  return r.metric === 'spo2' ? `${r.value}%` : `${r.value}/${r.value_secondary} mmHg`;
}
