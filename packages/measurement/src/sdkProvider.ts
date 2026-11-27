/**
 * Licensed vitals SDK boundary (ADR 0007).
 *
 * EdgeVitals' own pipeline cannot estimate SpO2 or blood pressure from RGB
 * video. These two metrics can only come from a licensed third-party SDK,
 * integrated behind this interface. This module never produces a value by
 * itself: with no SDK, an unlicensed SDK, an SDK error or a reading outside
 * the plausible range, the metric stays "unavailable".
 */
import type { MetricId, MetricProvenance, MetricResult, SessionResult } from './types';
import { METRIC_UNITS } from './types';

export type SdkMetricId = Extract<MetricId, 'spo2' | 'blood_pressure'>;
export const SDK_METRICS: readonly SdkMetricId[] = ['spo2', 'blood_pressure'] as const;

/** Why a provider cannot run. */
export type SdkUnavailableState =
  'not_installed' | 'unlicensed' | 'unsupported_device' | 'permission_denied';

export type SdkProviderStatus =
  { state: 'ready' } | { state: SdkUnavailableState; detail?: string };

/** One reading exactly as the vendor SDK reported it. */
export interface SdkReading {
  metric: SdkMetricId;
  /** SpO2 in %, or systolic BP in mmHg. */
  value: number;
  /** Diastolic BP in mmHg; required for blood pressure, absent for SpO2. */
  valueSecondary?: number;
  /** Vendor confidence mapped to 0-1, when the SDK reports one. */
  confidence?: number;
}

export interface VitalsSdkProvider {
  /** Stable machine id stored with each reading, e.g. "binah". */
  readonly id: string;
  /** Vendor name shown next to the value, e.g. "Binah.ai". */
  readonly displayName: string;
  /** Semver of the vendor SDK, stored as algorithm_version. */
  readonly sdkVersion: string;
  readonly metrics: readonly SdkMetricId[];
  status(): Promise<SdkProviderStatus>;
  /** Run the vendor measurement. Rejects on any SDK error or cancellation. */
  measure(signal?: AbortSignal): Promise<SdkReading[]>;
}

/** Default provider: no SDK is bundled, so SpO2 and BP stay "Not available". */
export const NO_SDK_PROVIDER: VitalsSdkProvider = {
  id: 'none',
  displayName: 'None',
  sdkVersion: '0.0.0',
  metrics: [],
  status: async () => ({ state: 'not_installed' }),
  measure: async () => [],
};

/**
 * Plausibility limits for vendor values. These reject implausible SDK output;
 * they say nothing about accuracy. Narrower than the API's storage bounds.
 */
export const SDK_PLAUSIBLE = {
  spo2: { min: 70, max: 100 },
  systolic: { min: 70, max: 220 },
  diastolic: { min: 40, max: 140 },
  /** Minimum systolic-minus-diastolic (pulse pressure) in mmHg. */
  minPulsePressure: 10,
} as const;

export type SdkOutcome =
  | { kind: 'readings'; readings: SdkReading[] }
  | { kind: 'unavailable'; state: SdkUnavailableState }
  | { kind: 'error'; message: string };

function provenanceFor(p: Pick<VitalsSdkProvider, 'id' | 'sdkVersion'>): MetricProvenance {
  return {
    method: 'licensed_sdk',
    algorithm: `sdk-${p.id}`,
    version: /^\d+\.\d+\.\d+$/.test(p.sdkVersion) ? p.sdkVersion : '0.0.0',
    source: 'measured',
    validation: 'unvalidated',
  };
}

function isPlausible(r: SdkReading): boolean {
  if (!Number.isFinite(r.value)) return false;
  if (r.metric === 'spo2')
    return (
      r.valueSecondary === undefined &&
      r.value >= SDK_PLAUSIBLE.spo2.min &&
      r.value <= SDK_PLAUSIBLE.spo2.max
    );
  const dia = r.valueSecondary;
  return (
    dia !== undefined &&
    Number.isFinite(dia) &&
    r.value >= SDK_PLAUSIBLE.systolic.min &&
    r.value <= SDK_PLAUSIBLE.systolic.max &&
    dia >= SDK_PLAUSIBLE.diastolic.min &&
    dia <= SDK_PLAUSIBLE.diastolic.max &&
    r.value - dia >= SDK_PLAUSIBLE.minPulsePressure
  );
}

/**
 * Replace the SpO2 and blood-pressure entries of an on-device session result
 * with the vendor outcome. Heart rate, HRV and breathing are never touched.
 */
export function applySdkOutcome(
  result: SessionResult,
  provider: Pick<VitalsSdkProvider, 'id' | 'sdkVersion' | 'metrics'>,
  outcome: SdkOutcome,
): SessionResult {
  const provenance = provenanceFor(provider);
  const replace = (metric: SdkMetricId): MetricResult | null => {
    const base = {
      metric,
      value: null,
      valueSecondary: null,
      unit: METRIC_UNITS[metric],
      qualityScore: null,
    };
    if (result.outcome === 'cancelled') return null;
    if (outcome.kind === 'unavailable') return null; // keep the pipeline's own "unsupported_method" entry
    if (!provider.metrics.includes(metric)) return null;
    if (outcome.kind === 'error')
      return {
        ...base,
        status: 'unavailable',
        qualityFlags: ['sdk_error'],
        reason: 'low_signal_quality',
        provenance,
      };
    const reading = outcome.readings.find((r) => r.metric === metric);
    if (!reading)
      return {
        ...base,
        status: 'unavailable',
        qualityFlags: ['sdk_no_reading'],
        reason: 'low_signal_quality',
        provenance,
      };
    if (!isPlausible(reading))
      return {
        ...base,
        status: 'invalid',
        qualityFlags: ['sdk_out_of_range'],
        reason: 'out_of_operating_range',
        provenance,
      };
    return {
      ...base,
      status: 'valid',
      value: Math.round(reading.value),
      valueSecondary:
        reading.valueSecondary === undefined ? null : Math.round(reading.valueSecondary),
      qualityScore:
        reading.confidence === undefined || !Number.isFinite(reading.confidence)
          ? null
          : Math.max(0, Math.min(1, reading.confidence)),
      qualityFlags: ['vendor_wellness_estimate'],
      reason: null,
      provenance,
    };
  };

  return {
    ...result,
    metrics: result.metrics.map((m) =>
      m.metric === 'spo2' || m.metric === 'blood_pressure' ? (replace(m.metric) ?? m) : m,
    ),
  };
}

/** Ask the provider for readings, turning every failure into an outcome. */
export async function runSdkProvider(
  provider: VitalsSdkProvider,
  signal?: AbortSignal,
): Promise<SdkOutcome> {
  let status: SdkProviderStatus;
  try {
    status = await provider.status();
  } catch {
    return { kind: 'unavailable', state: 'not_installed' };
  }
  if (status.state !== 'ready') return { kind: 'unavailable', state: status.state };
  try {
    return { kind: 'readings', readings: await provider.measure(signal) };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
