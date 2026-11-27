/**
 * Licensed vitals SDK registry (ADR 0007).
 *
 * SpO2 and blood pressure come only from a licensed third-party SDK. No SDK
 * is bundled yet, so the default provider reports "not installed" and both
 * metrics stay "Not available". To add a vendor: implement
 * `VitalsSdkProvider` in `src/vitals-sdk/<vendor>.ts`, register it in
 * ADAPTERS, and set `EXPO_PUBLIC_VITALS_SDK=<vendor id>` for the build.
 * The adapter reads its licence key from the build environment and must
 * report `unlicensed` (never invent readings) when the key is missing.
 */
import {
  NO_SDK_PROVIDER,
  applySdkOutcome,
  runSdkProvider,
  type SessionResult,
  type VitalsSdkProvider,
} from '@edgevitals/measurement';

const ADAPTERS: Record<string, () => VitalsSdkProvider> = {};

/** Longest time a vendor measurement may take before it counts as an error. */
export const SDK_TIMEOUT_MS = 120_000;

export function getVitalsSdkProvider(
  id: string | undefined = process.env.EXPO_PUBLIC_VITALS_SDK,
): VitalsSdkProvider {
  const make = id ? ADAPTERS[id] : undefined;
  if (!make) return NO_SDK_PROVIDER;
  try {
    return make();
  } catch {
    return NO_SDK_PROVIDER;
  }
}

/** Add the SDK's SpO2 and blood pressure to an on-device result, or leave them unavailable. */
export async function withSdkVitals(
  result: SessionResult,
  provider: VitalsSdkProvider = getVitalsSdkProvider(),
): Promise<SessionResult> {
  if (result.outcome === 'cancelled') return result;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SDK_TIMEOUT_MS);
  try {
    const outcome = await Promise.race([
      runSdkProvider(provider, abort.signal),
      new Promise<never>((_, reject) =>
        abort.signal.addEventListener('abort', () => reject(new Error('timeout'))),
      ),
    ]).catch((e: unknown) => ({
      kind: 'error' as const,
      message: e instanceof Error ? e.message : String(e),
    }));
    return applySdkOutcome(result, provider, outcome);
  } finally {
    clearTimeout(timer);
  }
}
