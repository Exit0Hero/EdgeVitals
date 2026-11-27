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
  /**
   * camera_rppg: EdgeVitals' own pipeline. licensed_sdk: a licensed
   * third-party SDK (ADR 0007); only ever used for SpO2 and blood pressure.
   * camera_experimental: an opt-in, unvalidated research estimator from a
   * published method (ADR 0008); currently SpO2 only.
   */
  method: 'camera_rppg' | 'licensed_sdk' | 'camera_experimental';
  algorithm: string;
  version: string;
  source: 'measured' | 'simulated';
  /**
   * No camera metric has passed an EdgeVitals validation study. Vendor
   * accuracy claims do not change this: we have not verified them.
   */
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
  /** Capture statistics for troubleshooting a failed scan (aggregates only, no pixels). */
  capture?: CaptureDiagnostics;
  /** Heart-rate gate inputs, present when a spectral peak was found. */
  hrGate?: HrGateDiagnostics;
  /** Present only when experimental SpO2 was requested (ADR 0008). */
  experimentalSpo2?: {
    ratio: number | null;
    acceptedFraction: number;
    iqr: number | null;
    failure: string | null;
  };
}

export interface CaptureDiagnostics {
  frameCount: number;
  /** Median interval between frames, ms (≈ 1000 / frame rate). */
  medianFrameIntervalMs: number;
  /** Frames carrying each quality flag. */
  flagCounts: Partial<Record<FrameQualityFlag, number>>;
  /** Frames that had ROI colour statistics. */
  roiFrames: number;
  meanLuma: number | null;
  meanSkinPixels: number | null;
}

export interface HrGateDiagnostics {
  bpm: number;
  snrDb: number;
  halvesDiffBpm: number;
  beatAcceptedFraction: number | null;
  beatMeanHrBpm: number | null;
}

export type SessionOutcome = 'completed' | 'partial' | 'failed' | 'cancelled';

export interface SessionResult {
  outcome: SessionOutcome;
  metrics: MetricResult[];
  diagnostics: SignalDiagnostics;
  pipelineVersion: string;
  configVersion: string;
}
