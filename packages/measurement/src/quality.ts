/**
 * Shared measurement-quality model.
 *
 * Every metric result carries a structured quality report. It lists the
 * inputs that decided the outcome, each compared with its gate, plus a
 * coarse grade:
 *  - `rejected`: the metric abstained or was invalid; there is no value.
 *  - `fair`: every gate passed.
 *  - `low`: the strict gates abstained, but a documented lower-confidence
 *    rule (calibrated on simulated pulseless captures) passed. The value is
 *    shown with a "Low confidence" label, never feeds the baseline, and is
 *    not used for scores.
 *  - `good`: every gate passed with margin. That means pulse SNR at least
 *    6 dB above the gate, no artefact windows, at most 2% dropped frames and
 *    2% interpolation, at least 25 fps, and, where regions were analysed, two
 *    or more regions agreeing.
 *
 * The grade is a documented rule over measured inputs. It is NOT a
 * probability or a confidence. No calibration against reference data exists,
 * so `uncertainty` is always null with the note 'not_calibrated', and
 * nothing here may be shown as a percentage confidence. (The legacy
 * `qualityScore` field is a heuristic 0-1 number kept for API compatibility;
 * it is not shown to users.)
 */
import type { MetricStatus, UnavailableReason } from './types';

export type QualityGrade = 'good' | 'fair' | 'low' | 'rejected';

export type QualityComponentId =
  | 'lighting'
  | 'motion'
  | 'face_tracking'
  | 'roi_stability'
  | 'effective_sample_rate'
  | 'dropped_frames'
  | 'interpolated_signal'
  | 'pulse_snr'
  | 'spectral_peak'
  | 'region_agreement'
  | 'algorithm_agreement'
  | 'recording_duration'
  | 'beat_intervals'
  | 'respiratory_agreement';

export interface QualityComponent {
  value: number | null;
  unit: string;
  /** The gate it is compared with, as text (e.g. ">= 13 dB"). */
  gate: string;
  /** null when the component does not apply to this metric or was not measured. */
  pass: boolean | null;
}

export interface MetricQuality {
  grade: QualityGrade;
  status: MetricStatus;
  durationSec: number;
  algorithm: string;
  version: string;
  components: Partial<Record<QualityComponentId, QualityComponent>>;
  /** Always null: no calibrated uncertainty model exists. */
  uncertainty: null;
  uncertaintyNote: 'not_calibrated';
  /** Detailed failure code (e.g. 'methods_disagree') when the metric abstained. */
  abstention: string | null;
  reason: UnavailableReason | null;
}

export function component(
  value: number | null,
  unit: string,
  gate: string,
  pass: boolean | null,
): QualityComponent {
  return {
    value: value === null || !Number.isFinite(value) ? null : Math.round(value * 1000) / 1000,
    unit,
    gate,
    pass,
  };
}

export interface GradeInputs {
  status: MetricStatus;
  components: Partial<Record<QualityComponentId, QualityComponent>>;
  /** Margin conditions for 'good' (all must be true). */
  margins: boolean[];
}

/** Apply the grade rule above. A failed component always means 'rejected' for a valid metric too. */
export function gradeOf(g: GradeInputs): QualityGrade {
  if (g.status !== 'valid') return 'rejected';
  if (Object.values(g.components).some((c) => c?.pass === false)) return 'rejected';
  return g.margins.every(Boolean) ? 'good' : 'fair';
}

export function buildQuality(
  status: MetricStatus,
  reason: UnavailableReason | null,
  abstention: string | null,
  durationSec: number,
  algorithm: string,
  version: string,
  components: Partial<Record<QualityComponentId, QualityComponent>>,
  margins: boolean[],
): MetricQuality {
  return {
    grade: gradeOf({ status, components, margins }),
    status,
    durationSec: Math.round(durationSec * 10) / 10,
    algorithm,
    version,
    components,
    uncertainty: null,
    uncertaintyNote: 'not_calibrated',
    abstention,
    reason,
  };
}
