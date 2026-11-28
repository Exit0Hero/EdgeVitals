import type { HrFusionResult } from './hrFusion';
import type { MetricQuality } from './quality';
import type { RespirationEstimate } from './respiration';

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
  /**
   * Per-region means in ROI_REGION_IDS order (forehead, left cheek, right
   * cheek). Each region is analysed as its own signal so its quality can be
   * judged independently. n = skin pixels in that region; r/g/b are 0 when n
   * is 0.
   */
  regions?: RoiRegionSample[];
}

/** Aggregate statistics of one skin region in one frame. */
export interface RoiRegionSample {
  r: number;
  g: number;
  b: number;
  n: number;
  /** Mean luma (0-255) of all sampled pixels in the region, skin or not. */
  luma?: number;
  /** Fraction of sampled pixels in the region with a saturated channel. */
  clipped?: number;
}

/** Region order of RoiSample.regions. */
export const ROI_REGION_IDS = ['forehead', 'left_cheek', 'right_cheek'] as const;
export type RoiRegionId = (typeof ROI_REGION_IDS)[number];

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
   * finger_ppg: fingertip over the back camera with the torch on (ADR 0010);
   * heart rate, HRV and breathing only.
   */
  method: 'camera_rppg' | 'licensed_sdk' | 'camera_experimental' | 'finger_ppg';
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
  /**
   * Structured quality report (quality.ts): gates, grade and abstention
   * detail. Optional so stored and SDK results without it stay valid.
   */
  quality?: MetricQuality;
  status: MetricStatus;
  value: number | null;
  valueSecondary: number | null;
  unit: string;
  /**
   * 0-1 heuristic quality score; null when not computed. NOT a calibrated
   * confidence and never shown as one; see `quality` for the gate details.
   */
  qualityScore: number | null;
  qualityFlags: string[];
  reason: UnavailableReason | null;
  provenance: MetricProvenance;
}

export interface SignalDiagnostics {
  durationSec: number;
  usableDurationSec: number;
  /**
   * Processing (resampling) rate of the analysis, Hz. NOT the camera frame
   * rate: that is `acquisition.measuredFps` / `acquisition.medianFps`.
   */
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
  /** Raw-signal statistics of the analysed segment, for troubleshooting. */
  signal?: SignalStatsDiagnostics;
  /** Present only for a finger scan (ADR 0010). */
  finger?: FingerDiagnostics;
  /** Face scan: breathing from head movement (present once the scan is long enough). */
  motionBreathing?: MotionBreathingDiagnostics;
  /** Face scan: frame timing, missing data, lighting and ROI tracking (acquisition.ts). */
  acquisition?: AcquisitionDiagnostics;
  /** Face scan: multi-method, multi-region heart-rate fusion (hrFusion.ts). */
  hrFusion?: Omit<HrFusionResult, 'beats'>;
  /** Face scan: beat detection and pulse-rate variability (prv.ts). */
  prv?: PrvDiagnostics;
  /** Face scan: respiratory signals and their fusion (respiration.ts). */
  respiration?: RespirationEstimate;
  /** Face scan: what the v0.3 estimators (kept for comparison) would have reported. */
  legacy?: LegacyDiagnostics;
  /** Present only when experimental SpO2 was requested (ADR 0008). */
  experimentalSpo2?: {
    ratio: number | null;
    acceptedFraction: number;
    iqr: number | null;
    failure: string | null;
  };
}

export interface AcquisitionDiagnostics {
  /** Frames delivered per second over the whole capture. */
  measuredFps: number;
  /** 1000 / median frame interval over the analysed segment (whole capture if none). */
  medianFps: number;
  /** Frame rate the app asked the camera for, and the one the camera reported selecting, when known. */
  requestedFps?: number | null;
  selectedFps?: number | null;
  intervalCv: number;
  droppedFramePct: number;
  longestGapMs: number;
  nonMonotonicTimestamps: number;
  /** Share of the analysed signal that was interpolated across frame gaps, %. */
  interpolatedPct: number;
  maxIntensityStepPct: number;
  faceJitterPct: number | null;
  /** Share of frames in which forehead, left cheek and right cheek passed exposure and pixel checks. */
  regionUsableFraction: number[] | null;
  /** Problem of each region that failed, or null. */
  regionProblem: (string | null)[] | null;
  /** Share of 10 s heart-rate windows rejected for each artefact. */
  windowArtefacts: Record<string, number>;
  flags: string[];
}

export interface PrvDiagnostics {
  /** Always 'pulse_rate_variability': camera intervals are pulse intervals, not ECG RR intervals. */
  kind: 'pulse_rate_variability';
  beats: number;
  acceptedIntervals: number;
  rejectedIntervals: number;
  rejectedByReason: Record<string, number>;
  falsePeaksRemoved: number;
  successivePairs: number;
  rmssdMs: number | null;
  sdnnMs: number | null;
  meanRateBpm: number | null;
  polarity: 1 | -1;
  source: { method: string; region: string } | null;
  /** Only with AnalyzeOptions.keepBeats (offline validation). Seconds on the capture clock. */
  beatTimesSec?: number[];
  intervals?: { t: number; ibi: number; status: string }[];
}

export interface LegacyDiagnostics {
  /** v0.3 heart rate (POS spectral OR PBV consensus), bpm, or null if it would have abstained. */
  hrBpm: number | null;
  acceptedBy: 'spectral' | 'consensus' | null;
  /** v0.3 RMSSD, ms, if its gates would have passed. */
  rmssdMs: number | null;
  /** v0.3 breathing (RIFV + green RIIV agreement), /min. */
  breathingPerMin: number | null;
}

export interface SignalStatsDiagnostics {
  /** Spectral peak of the green channel alone (no POS), bpm. */
  greenPeakBpm: number | null;
  /** SNR of that green-only peak, dB (same definition as hrSnrDb). */
  greenSnrDb: number | null;
  /** Std of the band-passed (0.7-3 Hz) green trace as % of its mean. A real pulse is ~0.1-0.5%. */
  bandAmplitudePct: number;
  /** Largest frame-to-frame change of mean green, % (auto-exposure steps show up here). */
  maxStepPct: number;
  /** POS pulse SNR (dB) of each region alone: forehead, left cheek, right cheek. */
  regionSnrDb?: (number | null)[];
  /** 10th and 90th percentile of the interval between analysed frames, ms. */
  intervalP10Ms: number;
  intervalP90Ms: number;
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
  /**
   * Window-consensus path (PBV pulse), present when the capture is long
   * enough for it. Heart rate passes when either path passes.
   */
  consensus?: HrConsensusDiagnostics;
  /** Which path accepted the heart rate, or null when neither did. */
  acceptedBy?: 'spectral' | 'consensus' | null;
}

export interface HrConsensusDiagnostics {
  bpm: number;
  /** Share of windows voting for `bpm` (0-1). */
  agreement: number;
  /** Share needed for this capture length (0-1). */
  required: number;
  windows: number;
  snrDb: number;
}

export interface BreathingModulation {
  name: 'riiv' | 'riav' | 'rifv' | 'head_motion';
  perMin: number | null;
  /** Share of 0.05-0.7 Hz power near the peak (0-1). */
  concentration: number;
}

export interface FingerDiagnostics {
  /** Channel used for the pulse. */
  channel: 'r' | 'g' | 'b' | null;
  /** SNR of each channel's pulse, dB (null when the channel was unusable). */
  channelSnrDb: { r: number | null; g: number | null; b: number | null };
  /** Median beat amplitude as % of the channel mean (a camera "perfusion index"). */
  pulseStrengthPct: number | null;
  /** Share of frames with the red channel mostly clipped at 255. */
  redClippedFraction: number;
  meanCoverage: number | null;
  halvesDiffBpm: number | null;
  beatMeanHrBpm: number | null;
  sdnnMs: number | null;
  /** Estimated beat-timing error, ms (bootstrap, scaled by timingErrorScale). */
  timingNoiseMs: number | null;
  /** Largest timing error this recording's beat variation tolerates for HRV, ms. */
  timingLimitMs: number | null;
  breathing: BreathingModulation[];
  /** (AC/DC red) / (AC/DC blue). Recorded only; no SpO2 is derived from it. */
  ratioOfRatiosRedBlue: number | null;
}

export interface MotionBreathingDiagnostics {
  perMin: number | null;
  /** Share of 0.05-0.7 Hz power of the head-movement trace near its peak. */
  concentration: number;
  /** Share of 20 s windows that agree with the whole-scan rate. */
  agreement: number;
  windows: number;
  /** Std of the band-passed vertical face position, % of face height. */
  amplitudePct: number;
  passed: boolean;
}

/** A short stretch of the pulse for display (kept on the device, never uploaded). */
export interface PulseWaveform {
  /** Samples per second. */
  fs: number;
  /** Scaled to ±1. */
  samples: number[];
  /** Detected beat times, seconds from the first sample. */
  beats: number[];
}

export type SessionOutcome = 'completed' | 'partial' | 'failed' | 'cancelled';

export interface SessionResult {
  outcome: SessionOutcome;
  metrics: MetricResult[];
  diagnostics: SignalDiagnostics;
  pipelineVersion: string;
  configVersion: string;
  /** Which scan produced this result. Absent means the face scan. */
  scanType?: 'face' | 'finger';
  /** Finger scans: the last seconds of the pulse with detected beats, for display. */
  waveform?: PulseWaveform;
}
