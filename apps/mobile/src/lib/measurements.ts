import type { SessionResult } from '@edgevitals/measurement';

/** Map an on-device SessionResult to the API measurement submission. */
export function toSubmission(result: SessionResult, measuredAt: Date = new Date()) {
  return {
    outcome: result.outcome,
    measurements: result.metrics.map((m) => ({
      metric: m.metric,
      status: m.status,
      value: m.status === 'valid' ? m.value : null,
      value_secondary: m.status === 'valid' ? m.valueSecondary : null,
      unit: m.unit,
      quality_score: m.status === 'valid' ? m.qualityScore : null,
      quality_flags: m.qualityFlags,
      reason: m.reason,
      method: m.provenance.method,
      algorithm_name: m.provenance.algorithm,
      algorithm_version: m.provenance.version,
      config_version: result.configVersion,
      validation: m.provenance.validation,
      measured_at: measuredAt.toISOString(),
    })),
    diagnostics: {
      usable_duration_sec: Math.round(result.diagnostics.usableDurationSec * 10) / 10,
      usable_frame_fraction: Math.round(result.diagnostics.usableFrameFraction * 1000) / 1000,
      hr_snr_db: result.diagnostics.hrSnrDb,
    },
  };
}
