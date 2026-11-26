/**
 * Core types for the EdgeVitals on-device measurement pipeline.
 *
 * Nothing in this package fabricates values: every metric either carries a
 * value that passed its quality gates, or an explicit unavailable/invalid
 * status with a reason.
 */

export type MetricId = 'heart_rate' | 'hrv' | 'breathing_rate' | 'spo2' | 'blood_pressure';

export const ALL_METRICS: readonly MetricId[] = [
  'heart_rate',
  'hrv',
  'breathing_rate',
  'spo2',
  'blood_pressure',
] as const;

export const METRIC_UNITS: Record<MetricId, string> = {
  heart_rate: 'bpm',
  hrv: 'ms',
  breathing_rate: '/min',
  spo2: '%',
  blood_pressure: 'mmHg',
};

/** Axis-aligned face bounding box in frame pixel coordinates. */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Output of the face detector for one frame (detector-agnostic). */
export interface FaceDetection {
  faces: FaceBox[];
}

/** Statistics extracted from the skin regions of one frame. Raw pixels are never retained. */
export interface RoiSample {
  r: number;
  g: number;
  b: number;
  /** Number of pixels classified as skin and averaged. */
  skinPixels: number;
  /** Mean luma (0-255, BT.601) over the sampled ROI pixels. */
  luma: number;
  /** Fraction (0-1) of sampled ROI pixels with any channel saturated. */
  clippedFraction: number;
}

export type FrameQualityFlag =
  | 'face_not_found'
  | 'multiple_faces'
  | 'face_out_of_region'
  | 'lighting_too_low'
  | 'lighting_too_high'
  | 'motion_too_high'
  | 'signal_insufficient';

/** One processed frame: timestamp, ROI colour means and quality evaluation. */
export interface FrameSample {
  /** Monotonic timestamp in milliseconds. */
  t: number;
  roi: RoiSample | null;
  face: FaceBox | null;
  faceCount: number;
  frameWidth: number;
  frameHeight: number;
  flags: FrameQualityFlag[];
  usable: boolean;
}

export type MetricStatus = 'valid' | 'unavailable' | 'invalid';

export type UnavailableReason =
  | 'unsupported_method'
  | 'insufficient_duration'
  | 'low_signal_quality'
  | 'inconsistent_estimates'
  | 'out_of_operating_range'
  | 'cancelled';

export interface MetricProvenance {
  method: 'camera_rppg';
  algorithm: string;
  version: string;
  source: 'measured' | 'simulated';
  /** No camera metric has passed a validation study yet. */
  validation: 'unvalidated';
}

export interface MetricResult {
  metric: MetricId;
  status: MetricStatus;
  value: number | null;
  valueSecondary: number | null;
  unit: string;
  /** 0-1 heuristic quality score; null when not computed. */
  qualityScore: number | null;
  qualityFlags: string[];
  reason: UnavailableReason | null;
  provenance: MetricProvenance;
}

export interface SignalDiagnostics {
  durationSec: number;
  usableDurationSec: number;
  sampleRateHz: number;
  droppedFrameFraction: number;
  usableFrameFraction: number;
  hrSnrDb: number | null;
  ibiCount: number;
  ibiAcceptedFraction: number | null;
}

export type SessionOutcome = 'completed' | 'partial' | 'failed' | 'cancelled';

export interface SessionResult {
  outcome: SessionOutcome;
  metrics: MetricResult[];
  diagnostics: SignalDiagnostics;
  pipelineVersion: string;
  configVersion: string;
}
