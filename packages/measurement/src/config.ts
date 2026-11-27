/**
 * Versioned pipeline configuration.
 *
 * IMPORTANT: these thresholds are v0 ENGINEERING DEFAULTS chosen from the
 * rPPG literature and synthetic-signal testing. They have NOT been
 * established empirically on a reference dataset. docs/adr/0004 tracks the
 * validation work required before any accuracy claim. Bump CONFIG_VERSION
 * whenever a value changes so every stored measurement is traceable.
 */
export const PIPELINE_VERSION = '0.1.0';
export const CONFIG_VERSION = 'v0.2-engineering-defaults';
export const ALGORITHM_NAME = 'pos-welch';

export const PIPELINE_CONFIG = {
  /** Uniform resampling rate for signal processing. */
  sampleRateHz: 30,
  /** Target capture length of usable signal. */
  targetUsableSec: 45,
  /** Hard stop for a scan, usable or not. */
  maxScanSec: 90,
  /** A gap longer than this between usable frames breaks the signal segment. */
  maxGapSec: 0.35,
  /**
   * A frame-to-frame change of mean skin colour above this fraction (any
   * channel) splits the signal: it is an exposure/white-balance step, not a
   * pulse (pulse amplitude is well under 1%).
   */
  maxColourStep: 0.03,
  /** POS sliding window length (Wang et al. 2017 use 1.6 s). */
  posWindowSec: 1.6,
  /** Cardiac band, 42-180 bpm. */
  hrBandHz: [0.7, 3.0] as [number, number],
  minHrDurationSec: 15,
  /**
   * Heart-rate acceptance requires ALL of: SNR >= minHrSnrDb, first/second
   * half spectral HR within hrHalvesAgreementBpm, at least
   * minHrBeatAcceptedFraction of detected beat intervals plausible, and
   * beat-derived HR within hrvHrAgreementBpm of spectral HR. On 300
   * synthetic noise-only captures (15-45 s) this combination accepted 0;
   * see test/gates.test.ts. Real-world false-acceptance is NOT yet measured.
   */
  minHrSnrDb: -2,
  hrHalvesAgreementBpm: 6,
  minHrBeatAcceptedFraction: 0.7,
  minHrvDurationSec: 30,
  /**
   * Beat-timing noise inflates RMSSD strongly (a known rPPG limitation). On
   * synthetic signals with known RMSSD, error fell below ~10 ms only above
   * ~13 dB SNR, so HRV abstains below that. Provisional; needs ECG-referenced
   * validation.
   */
  minHrvSnrDb: 13,
  minIbiCount: 20,
  minIbiAcceptedFraction: 0.8,
  /** IBI rejected if it deviates from its local median by more than this fraction. */
  ibiTolerance: 0.25,
  /** Mean IBI-derived HR must agree with spectral HR within this many bpm. */
  hrvHrAgreementBpm: 5,
  hrvRangeMs: [5, 200] as [number, number],
  minBreathingDurationSec: 30,
  /** 6-30 breaths/min. */
  breathingBandHz: [0.1, 0.5] as [number, number],
  /** Two independent respiratory estimates must agree within this many breaths/min. */
  breathingAgreementPerMin: 3,
  frame: {
    minSkinPixels: 150,
    minLuma: 45,
    maxLuma: 225,
    maxClippedFraction: 0.1,
    /** Face centre must lie within this normalised ellipse (the on-screen guide). */
    guideCenter: [0.5, 0.45] as [number, number],
    guideRadii: [0.3, 0.38] as [number, number],
    minFaceWidthFraction: 0.18,
    maxFaceWidthFraction: 0.85,
    /** Face-centre speed, in face widths per second, above which motion is too high. */
    maxFaceSpeed: 0.35,
    /**
     * Speed is measured against the face position at least this long ago.
     * Frame-to-frame differences at 30 fps mostly measure face-detector box
     * jitter (a few pixels), not head movement.
     */
    motionBaselineSec: 0.3,
  },
} as const;

export type PipelineConfig = typeof PIPELINE_CONFIG;
