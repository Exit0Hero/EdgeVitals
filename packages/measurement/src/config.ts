/**
 * Versioned pipeline configuration.
 *
 * IMPORTANT: these thresholds are v0 ENGINEERING DEFAULTS chosen from the
 * rPPG literature and synthetic-signal testing. They have NOT been
 * established empirically on a reference dataset. docs/adr/0004 tracks the
 * validation work required before any accuracy claim. Bump CONFIG_VERSION
 * whenever a value changes so every stored measurement is traceable.
 */
export const PIPELINE_VERSION = '0.2.1';
export const CONFIG_VERSION = 'v0.4.1-fusion-prv';
export const ALGORITHM_NAME = 'pos-welch';

export const PIPELINE_CONFIG = {
  /** Uniform resampling rate for signal processing. */
  sampleRateHz: 30,
  /** Target capture length of usable signal. */
  targetUsableSec: 45,
  /** If heart rate has not passed by targetUsableSec, keep scanning up to this. */
  extendedUsableSec: 75,
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
   * Window-consensus heart rate (consensusHeartRate), the path for weak
   * but real pulses: PBV pulse (de Haan & van Leest 2014, window
   * hrPbvWindowSec); 10 s windows every 2 s each vote with their strongest
   * peak; the capture passes when the share of votes within ±6 bpm of the
   * consensus reaches hrConsensusBase + hrConsensusPerWindow / windows
   * (0.83 at 45 s, 0.74 at 60 s, 0.70 at 75 s), with at least
   * hrConsensusMinWindows windows (about 40 s) and SNR at the consensus
   * rate >= minHrSnrDb. Simulated pulseless captures (white and phone-like
   * coloured noise, 500 per length) reached at most 0.67 at 45 s and 0.72
   * at 60 s; trace 3 from the iQOO Neo 9 (locked exposure) reaches 0.89.
   */
  hrPbvWindowSec: 9.6,
  hrConsensusWindowSec: 10,
  hrConsensusHopSec: 2,
  hrConsensusToleranceBpm: 6,
  hrConsensusMinWindows: 16,
  hrConsensusBase: 0.55,
  hrConsensusPerWindow: 5,
  /**
   * Heart rate passes by EITHER the window consensus above OR the
   * whole-scan spectral path: POS spectral SNR >= minSpectralHrSnrDb, both
   * halves' peaks within hrHalvesAgreementBpm, >= minHrBeatAcceptedFraction
   * plausible beat intervals and beat HR within hrvHrAgreementBpm. See
   * test/gates.test.ts and test/consensus.test.ts for the noise-only
   * regression checks. Real-world false acceptance is NOT yet measured.
   */
  minHrSnrDb: -2,
  /**
   * SNR floor of the whole-recording (spectral) path. At -2 dB that path
   * accepted about 0.4% of simulated phone-like noise captures; at 3 dB
   * it accepted 0 of 4,500 (20-39 s) and 0 of 2,000 (40-90 s).
   */
  minSpectralHrSnrDb: 3,
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
