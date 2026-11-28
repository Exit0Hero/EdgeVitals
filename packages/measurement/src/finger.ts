/**
 * Finger-on-camera pulse scan (contact PPG, ADR 0010).
 *
 * The user rests a fingertip over the BACK camera with the torch on. Light
 * passes through the finger, and each heartbeat changes how much of it the
 * blood absorbs, so the whole image pulses. This is transmissive
 * photoplethysmography, the principle of a clip-on finger oximeter, and the
 * pulse is typically one to two orders of magnitude stronger than the colour
 * change on a face. That is what makes beat-to-beat timing (HRV) and
 * respiratory modulation (breathing rate) measurable.
 *
 * Methods:
 * - Heart rate: Welch spectral peak of the band-passed channel with the best
 *   pulse SNR, cross-checked by the two halves and by beat timing.
 * - Beats: maximum upstroke slope of each pulse (the steepest rise), a
 *   fiducial that is less sensitive to waveform shape than the systolic peak,
 *   with parabolic sub-sample refinement. Intervals that deviate more than
 *   `ibiTolerance` from their local median are rejected (artefacts, ectopic
 *   beats).
 * - HRV: RMSSD (main value) and SDNN (secondary) over accepted intervals.
 * - Breathing: three respiratory modulations of the pulse (Karlen et al.,
 *   IEEE TBME 2013, "smart fusion"): baseline intensity (RIIV), beat
 *   amplitude (RIAV) and beat interval (RIFV). A rate is reported only when at
 *   least two clear modulations agree.
 * - SpO2: NOT reported. A ratio of ratios is recorded for diagnostics only;
 *   turning it into a percentage needs a calibration for this optical set-up
 *   (torch, lens, finger) that no published phone-agnostic formula provides.
 *
 * Every threshold is an engineering default tuned on SYNTHETIC signals with
 * known ground truth (test/finger.test.ts). None has been validated on people
 * against ECG or a reference oximeter. Results are wellness estimates.
 */
import { bandPower, bandpass, mean, median, resampleUniform, std, welch, findPeaks } from './dsp';
import { estimateHeartRate } from './estimators';
import type { YuvFrame } from './yuv';
import type {
  BreathingModulation,
  FingerDiagnostics,
  MetricId,
  MetricProvenance,
  MetricResult,
  PulseWaveform,
  SessionOutcome,
  SessionResult,
  UnavailableReason,
} from './types';
import { METRIC_UNITS } from './types';

export const FINGER_PIPELINE_VERSION = '0.2.0';
export const FINGER_CONFIG_VERSION = 'finger-v0.2-low-confidence-breathing';
export const FINGER_ALGORITHM = 'finger-ppg-slope';

export const FINGER_CONFIG = {
  /** Uniform resampling rate. Above the ~30 fps capture so beat timing keeps sub-frame detail. */
  sampleRateHz: 60,
  /** Target length of clean signal. */
  targetUsableSec: 60,
  /**
   * Hard stop. The torch heats the phone and the fingertip; a minute is the
   * usual limit for this kind of scan.
   */
  maxScanSec: 75,
  /** Frames this soon after a clean stretch starts are skipped (finger and exposure settling). */
  settleSec: 2,
  maxGapSec: 0.35,
  /**
   * Frame-to-frame change of the mean colour above this fraction splits the
   * signal (finger shifted or pressed). A finger pulse is about 0.5-5%.
   */
  maxStep: 0.1,
  minHrDurationSec: 15,
  minHrvDurationSec: 30,
  minBreathingDurationSec: 30,
  hrBandHz: [0.7, 3.0] as [number, number],
  /** Band for beat detection: wide enough to keep the upstroke sharp. */
  beatBandHz: [0.5, 6] as [number, number],
  minHrSnrDb: 6,
  hrHalvesAgreementBpm: 5,
  minBeatAcceptedFraction: 0.8,
  beatHrAgreementBpm: 4,
  ibiTolerance: 0.2,
  minHrvSnrDb: 8,
  minHrvIntervals: 30,
  minHrvAcceptedFraction: 0.85,
  hrvRangeMs: [5, 200] as [number, number],
  /**
   * Beat-timing error is measured per recording by a bootstrap (rebuild the
   * pulse from its own template and residuals, re-detect, compare). On
   * synthetic traces the bootstrap reads 1.3-2.4x low, so it is scaled by
   * this factor before use.
   */
  timingErrorScale: 2,
  /**
   * Timing error inflates RMSSD: observed^2 ~ true^2 + 6 sigma^2. HRV is
   * shown only when that inflation is at most this share of observed^2.
   */
  maxTimingShareOfRmssd: 0.25,
  /**
   * And never above this (after scaling): on noisy synthetic traces the
   * bootstrap under-reads most, and recordings at 9-11 ms came with +30% to
   * +400% RMSSD error; at 8 ms and below, within +17%.
   */
  maxTimingErrorMs: 8,
  breathingBandHz: [0.1, 0.5] as [number, number],
  /**
   * A respiratory modulation counts only if this share of its 0.05-0.7 Hz
   * power lies within ±breathingPeakHalfWidthHz of its peak.
   */
  minBreathingConcentration: 0.5,
  breathingPeakHalfWidthHz: 0.04,
  breathingAgreementPerMin: 2,
  /**
   * Low-confidence breathing (v0.2): two modulations within this many
   * breaths/min of each other, both at least lowConfidenceBreathingConcentration.
   * On 1,500 simulated no-breathing traces the best such pair reached 0.41
   * (tolerance 1/min); on 300 traces with breathing, pairs at >= 0.45 were
   * within 0.8/min of the truth. Shown labelled "Low confidence" and never
   * used for baselines.
   */
  lowConfidenceBreathingAgreementPerMin: 1,
  lowConfidenceBreathingConcentration: 0.45,
  frame: {
    /** Share of sampled pixels that must look like a lit fingertip (red-dominant). */
    minCoverage: 0.85,
    /** Below this mean red level the torch is off, blocked, or the finger is pressed white. */
    minRed: 35,
    /** Above this mean green level every channel is saturated and carries no pulse. */
    maxGreen: 240,
  },
} as const;

export type FingerFrameFlag = 'finger_not_detected' | 'too_dark' | 'too_bright' | 'finger_moving';

export const FINGER_GUIDANCE: Record<FingerFrameFlag | 'ready' | 'starting', string> = {
  starting: 'Starting camera and flash…',
  ready: 'Good. Keep your fingertip still and breathe normally.',
  finger_not_detected: 'Cover the back camera and flash completely with your fingertip.',
  too_dark: "It's too dark. Make sure the flash is on and not covered by a case.",
  too_bright: 'Too much light is getting in. Cover the lens fully with the pad of your finger.',
  finger_moving: 'Hold your finger still and rest your hand on something.',
};

/** Per-frame aggregate of the central image area. No pixels are kept. */
export interface FingerSample {
  r: number;
  g: number;
  b: number;
  luma: number;
  /** Share (0-1) of sampled pixels that look like a lit fingertip. */
  coverage: number;
  /** Share (0-1) of sampled pixels with the red channel at 250 or more. */
  redClipped: number;
}

export interface FingerFrameInput {
  /** Monotonic timestamp, ms. */
  t: number;
  sample: FingerSample | null;
}

export interface FingerFrameSample extends FingerFrameInput {
  flags: FingerFrameFlag[];
  usable: boolean;
}

/**
 * Average the central half of a YUV 4:2:0 frame (rotation does not matter:
 * the whole image is the fingertip). Runs on the frame-processor thread.
 */
export function extractFingerYuv(frame: YuvFrame, step = 4): FingerSample {
  'worklet';
  const { width, height, y: yp, u: up, v: vp, fullRange } = frame;
  const uOff = up.offset ?? 0;
  const vOff = vp.offset ?? 0;
  const x0 = Math.floor(width * 0.25);
  const x1 = Math.ceil(width * 0.75);
  const y0 = Math.floor(height * 0.25);
  const y1 = Math.ceil(height * 0.75);
  let sr = 0,
    sg = 0,
    sb = 0,
    sl = 0,
    n = 0,
    lit = 0,
    clip = 0;
  for (let by = y0; by < y1; by += step) {
    for (let bx = x0; bx < x1; bx += step) {
      let Y = yp.data[by * yp.rowStride + bx * yp.pixelStride]!;
      const cx = bx >> 1;
      const cy = by >> 1;
      let Cb = up.data[uOff + cy * up.rowStride + cx * up.pixelStride]! - 128;
      let Cr = vp.data[vOff + cy * vp.rowStride + cx * vp.pixelStride]! - 128;
      if (!fullRange) {
        Y = ((Y - 16) * 255) / 219;
        Cb = (Cb * 255) / 224;
        Cr = (Cr * 255) / 224;
      }
      const r = Math.min(255, Math.max(0, Y + 1.402 * Cr));
      const g = Math.min(255, Math.max(0, Y - 0.344136 * Cb - 0.714136 * Cr));
      const b = Math.min(255, Math.max(0, Y + 1.772 * Cb));
      sr += r;
      sg += g;
      sb += b;
      sl += 0.299 * r + 0.587 * g + 0.114 * b;
      n++;
      if (r >= 50 && r >= 1.5 * g && r >= 1.5 * b) lit++;
      if (r >= 250) clip++;
    }
  }
  return n
    ? {
        r: sr / n,
        g: sg / n,
        b: sb / n,
        luma: sl / n,
        coverage: lit / n,
        redClipped: clip / n,
      }
    : { r: 0, g: 0, b: 0, luma: 0, coverage: 0, redClipped: 0 };
}

const fc = FINGER_CONFIG;

function relStep(a: FingerSample, b: FingerSample): number {
  // A dark channel (a few counts) steps by 5-10% on quantisation alone.
  const rel = (p: number, q: number) => (p > 1 ? Math.abs(q - p) / p : 0);
  // Red is often clipped near 255 and carries no step information then.
  return Math.max(rel(a.g, b.g), a.r < 245 ? rel(a.r, b.r) : 0);
}

/** Per-frame checks. A frame is usable only with no flags. */
export function assessFingerFrame(
  s: FingerSample | null,
  prev: FingerSample | null,
): FingerFrameFlag[] {
  if (!s) return ['finger_not_detected'];
  const flags: FingerFrameFlag[] = [];
  if (s.r < fc.frame.minRed) flags.push('too_dark');
  else if (s.coverage < fc.frame.minCoverage) flags.push('finger_not_detected');
  if (s.g > fc.frame.maxGreen) flags.push('too_bright');
  if (prev && flags.length === 0 && relStep(prev, s) > fc.maxStep) flags.push('finger_moving');
  return flags;
}

/** Longest clean stretch (gaps ≤ maxGapSec, no colour step), minus its settling start. */
export function fingerSegment(frames: FingerFrameSample[]): FingerFrameSample[] {
  let best: FingerFrameSample[] = [];
  let cur: FingerFrameSample[] = [];
  const close = () => {
    const start = cur[0]?.t ?? 0;
    const trimmed = cur.filter((f) => f.t - start >= fc.settleSec * 1000);
    if (trimmed.length > best.length) best = trimmed;
    cur = [];
  };
  for (const f of frames) {
    if (!f.usable || !f.sample) {
      // Isolated bad frames are bridged as long as the gap stays short.
      continue;
    }
    const last = cur[cur.length - 1];
    if (
      last &&
      ((f.t - last.t) / 1000 > fc.maxGapSec || relStep(last.sample!, f.sample) > fc.maxStep)
    )
      close();
    cur.push(f);
  }
  close();
  return best;
}

function duration(seg: { t: number }[]): number {
  return seg.length > 1 ? (seg[seg.length - 1]!.t - seg[0]!.t) / 1000 : 0;
}

/**
 * Re-time each beat by aligning the whole pulse with the average beat
 * (cross-correlation with parabolic refinement). A single fiducial point is
 * moved by noise on one or two samples; the alignment uses the full upstroke
 * and peak, which cuts beat-timing noise and with it the RMSSD bias that
 * timing noise causes. Beats are aligned to the template, so a constant
 * offset does not matter: only intervals are used.
 */
function refineByTemplate(
  x: number[],
  coarse: number[],
  period: number,
  fs: number,
): { beats: number[]; timingNoiseMs: number | null } {
  const pre = Math.round(0.3 * period * fs);
  const post = Math.round(0.5 * period * fs);
  const len = pre + post + 1;
  const tpl = new Array<number>(len).fill(0);
  let used = 0;
  for (const p of coarse) {
    const c = Math.round(p);
    if (c - pre < 0 || c + post >= x.length) continue;
    for (let k = 0; k < len; k++) tpl[k] = tpl[k]! + x[c - pre + k]!;
    used++;
  }
  if (used < 3) return { beats: coarse, timingNoiseMs: null };
  const tm = mean(tpl);
  for (let k = 0; k < len; k++) tpl[k] = tpl[k]! / used - tm / used;
  const maxLag = Math.max(1, Math.round(0.15 * period * fs));
  const first = alignBeats(x, coarse, tpl, pre, maxLag);
  return {
    beats: first.beats,
    timingNoiseMs: bootstrapTimingNoise(x.length, coarse, first, tpl, pre, maxLag, fs),
  };
}

interface Alignment {
  beats: number[];
  /** Per beat: fitted template gain and residual (raw minus offset minus gain x template), or null at the edges. */
  fits: ({ gain: number; residual: number[] } | null)[];
}

/** Cross-correlate each beat with the template around its coarse position. */
function alignBeats(
  x: ArrayLike<number>,
  coarse: number[],
  tpl: number[],
  pre: number,
  maxLag: number,
): Alignment {
  const len = tpl.length;
  const fits: Alignment['fits'] = [];
  const beats = coarse.map((p) => {
    const c = Math.round(p);
    if (c - pre - maxLag - 1 < 0 || c - pre + len + maxLag + 1 >= x.length) {
      fits.push(null);
      return p;
    }
    const score = (lag: number) => {
      let s = 0;
      for (let k = 0; k < len; k++) s += tpl[k]! * x[c + lag - pre + k]!;
      return s;
    };
    let bestLag = 0;
    let best = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const s = score(lag);
      if (s > best) {
        best = s;
        bestLag = lag;
      }
    }
    const a = score(bestLag - 1);
    const d = score(bestLag + 1);
    const denom = a - 2 * best + d;
    const frac = denom < 0 ? (0.5 * (a - d)) / denom : 0;
    let xm = 0;
    for (let k = 0; k < len; k++) xm += x[c + bestLag - pre + k]!;
    xm /= len;
    let sxy = 0;
    let syy = 0;
    for (let k = 0; k < len; k++) {
      sxy += tpl[k]! * (x[c + bestLag - pre + k]! - xm);
      syy += tpl[k]! * tpl[k]!;
    }
    const gain = syy > 0 ? sxy / syy : 0;
    const residual = new Array<number>(len);
    for (let k = 0; k < len; k++) residual[k] = x[c + bestLag - pre + k]! - xm - gain * tpl[k]!;
    fits.push({ gain, residual });
    return c + bestLag + Math.max(-0.5, Math.min(0.5, frac));
  });
  return { beats, fits };
}

/**
 * Beat-timing error measured by simulation from this recording (a
 * parametric bootstrap). A pulse train is rebuilt from the recording's own
 * average beat, at its own beat times and sizes, plus the recording's own
 * per-beat residuals (noise and beat-to-beat shape changes) shuffled
 * between beats. The same alignment is run on it, and the spread of
 * (found - true) beat times is the timing error. A formula-based estimate
 * (Cramer-Rao) read 2-3x too low on synthetic tests because the residuals
 * are neither white nor independent of the beat shape.
 */
function bootstrapTimingNoise(
  n: number,
  coarse: number[],
  first: Alignment,
  tpl: number[],
  pre: number,
  maxLag: number,
  fs: number,
  reps = 4,
): number | null {
  const ok = first.fits.map((f, i) => (f && f.gain > 0 ? i : -1)).filter((i) => i >= 0);
  if (ok.length < 10) return null;
  const len = tpl.length;
  const tplAt = (u: number) => {
    if (u <= 0 || u >= len - 1) return 0;
    const i = Math.floor(u);
    return tpl[i]! + (u - i) * (tpl[i + 1]! - tpl[i]!);
  };
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  const errs: number[] = [];
  for (let r = 0; r < reps; r++) {
    const y = new Float64Array(n);
    const order = ok.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    ok.forEach((bi, k) => {
      const p = first.beats[bi]!;
      const g = first.fits[bi]!.gain;
      const noise = first.fits[order[k]!]!.residual;
      const c = Math.round(p);
      for (let m = 0; m < len; m++) {
        const j = c - pre + m;
        if (j < 0 || j >= n) continue;
        y[j] = y[j]! + g * tplAt(j - (p - pre)) + noise[m]!;
      }
    });
    const again = alignBeats(
      y,
      ok.map((bi) => coarse[bi]!),
      tpl,
      pre,
      maxLag,
    );
    const d = ok.map((bi, k) => again.beats[k]! - first.beats[bi]!);
    const md = median(d);
    for (const v of d) if (Math.abs(v - md) < 0.2 * fs) errs.push(v - md);
  }
  if (errs.length < 10) return null;
  return (1000 * std(errs)) / fs;
}

export interface FingerBeats {
  /** Beat (fiducial) times in seconds from the segment start. */
  times: number[];
  /** Peak-to-trough amplitude of each beat in the beat-band signal. */
  amplitudes: number[];
  /** Accepted intervals with the time of their closing beat. */
  ibis: { t: number; ibi: number }[];
  intervalCount: number;
  acceptedFraction: number;
  meanHrBpm: number;
  rmssdMs: number;
  sdnnMs: number;
  /** Estimated beat-timing error, ms (null when it could not be estimated). */
  timingNoiseMs: number | null;
}

/**
 * Beat detection on an inverted (blood = up) pulse signal sampled at `fs`.
 * Fiducial: maximum of the first derivative within each beat.
 */
export function detectFingerBeats(
  pulse: number[],
  fs: number,
  spectralHrBpm: number,
): FingerBeats | null {
  const x = bandpass(pulse, fc.beatBandHz[0], fc.beatBandHz[1], fs);
  const d = new Array<number>(x.length).fill(0);
  for (let i = 1; i < x.length - 1; i++) d[i] = (x[i + 1]! - x[i - 1]!) / 2;
  const period = 60 / spectralHrBpm;
  const peaks = findPeaks(d, Math.max(2, Math.floor(0.6 * period * fs)));
  // Drop tiny slope peaks (noise between beats, dicrotic notch remnants).
  const heights = peaks.map((p) => d[Math.round(p)]!);
  const hMed = median(heights);
  const coarse = peaks.filter((_, i) => heights[i]! > 0.35 * hMed);
  if (coarse.length < 3) return null;
  const refined = refineByTemplate(x, coarse, period, fs);
  const kept = refined.beats;
  const times = kept.map((p) => p / fs);
  const half = Math.round(0.45 * period * fs);
  const amplitudes = kept.map((p) => {
    const i = Math.round(p);
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = Math.max(0, i - half); k <= Math.min(x.length - 1, i + half); k++) {
      if (k >= i) hi = Math.max(hi, x[k]!);
      if (k <= i) lo = Math.min(lo, x[k]!);
    }
    return hi - lo;
  });
  const raw: { t: number; ibi: number }[] = [];
  for (let i = 1; i < times.length; i++) raw.push({ t: times[i]!, ibi: times[i]! - times[i - 1]! });
  const accepted = raw.map((r, i) => {
    const win = raw.slice(Math.max(0, i - 3), Math.min(raw.length, i + 4)).map((q) => q.ibi);
    const m = median(win);
    return r.ibi >= 60 / 200 && r.ibi <= 60 / 35 && Math.abs(r.ibi - m) <= fc.ibiTolerance * m;
  });
  const ibis = raw.filter((_, i) => accepted[i]);
  const diffs: number[] = [];
  for (let i = 1; i < raw.length; i++)
    if (accepted[i] && accepted[i - 1]) diffs.push(raw[i]!.ibi - raw[i - 1]!.ibi);
  if (ibis.length < 2 || diffs.length < 1) return null;
  const vals = ibis.map((q) => q.ibi);
  return {
    times,
    amplitudes,
    ibis,
    intervalCount: raw.length,
    acceptedFraction: ibis.length / raw.length,
    meanHrBpm: 60 / mean(vals),
    rmssdMs: Math.sqrt(mean(diffs.map((v) => v * v))) * 1000,
    sdnnMs: std(vals) * 1000,
    timingNoiseMs: refined.timingNoiseMs,
  };
}

/** Dominant respiratory rate of a uniformly sampled series, with how clear it is. */
export function respiratoryPeak(
  series: number[],
  fs: number,
): { perMin: number; concentration: number } | null {
  if (series.length < fs * 15) return null;
  const m = mean(series);
  const x = series.map((v) => v - m);
  if (!(std(x) > 0)) return null;
  const spec = welch(x, fs, Math.min(32, x.length / fs), 4096);
  const [lo, hi] = fc.breathingBandHz;
  let best = -1;
  for (let k = 0; k < spec.freqs.length; k++) {
    const f = spec.freqs[k]!;
    if (f < lo || f > hi) continue;
    if (best < 0 || spec.power[k]! > spec.power[best]!) best = k;
  }
  if (best < 0 || !(spec.power[best]! > 0)) return null;
  const f0 = spec.freqs[best]!;
  // A peak sitting on the band edge is drift or noise rolling off, not breathing.
  if (f0 <= lo + 0.01 || f0 >= hi - 0.01) return null;
  const w = fc.breathingPeakHalfWidthHz;
  const total = bandPower(spec, 0.05, 0.7);
  const concentration = total > 0 ? bandPower(spec, f0 - w, f0 + w) / total : 0;
  return { perMin: f0 * 60, concentration };
}

/**
 * Lower-confidence breathing: the clearest pair of modulations that agree
 * within lowConfidenceBreathingAgreementPerMin, both at least
 * lowConfidenceBreathingConcentration. Returns their mean, or null.
 */
export function lowConfidenceBreathing(mods: BreathingModulation[]): number | null {
  let best: { c: number; rate: number } | null = null;
  for (let i = 0; i < mods.length; i++)
    for (let j = i + 1; j < mods.length; j++) {
      const a = mods[i]!;
      const b = mods[j]!;
      if (a.perMin === null || b.perMin === null) continue;
      if (Math.abs(a.perMin - b.perMin) > fc.lowConfidenceBreathingAgreementPerMin) continue;
      const c = Math.min(a.concentration, b.concentration);
      if (c >= fc.lowConfidenceBreathingConcentration && (!best || c > best.c))
        best = { c, rate: (a.perMin + b.perMin) / 2 };
    }
  return best ? best.rate : null;
}

/**
 * Breathing from three respiratory modulations of a finger pulse. Returns
 * the mean of the largest group (≥ 2) of clear modulations that agree within
 * `breathingAgreementPerMin`, or null.
 */
export function fuseBreathing(mods: BreathingModulation[]): number | null {
  const clear = mods.filter(
    (m) => m.perMin !== null && m.concentration >= fc.minBreathingConcentration,
  );
  let bestGroup: BreathingModulation[] = [];
  for (const a of clear) {
    const group = clear.filter(
      (b) => Math.abs(b.perMin! - a.perMin!) <= fc.breathingAgreementPerMin,
    );
    if (group.length > bestGroup.length) bestGroup = group;
  }
  if (bestGroup.length < 2) return null;
  const vals = bestGroup.map((m) => m.perMin!);
  if (Math.max(...vals) - Math.min(...vals) > fc.breathingAgreementPerMin) return null;
  return mean(vals);
}

const PROVENANCE: MetricProvenance = {
  method: 'finger_ppg',
  algorithm: FINGER_ALGORITHM,
  version: FINGER_PIPELINE_VERSION,
  source: 'measured',
  validation: 'unvalidated',
};

export const FINGER_METRICS: readonly MetricId[] = ['heart_rate', 'hrv', 'breathing_rate'];

function unavailable(
  metric: MetricId,
  reason: UnavailableReason,
  flags: string[] = [],
): MetricResult {
  return {
    metric,
    status: 'unavailable',
    value: null,
    valueSecondary: null,
    unit: METRIC_UNITS[metric],
    qualityScore: null,
    qualityFlags: ['finger_scan', ...flags],
    reason,
    provenance: PROVENANCE,
  };
}

function valid(
  metric: MetricId,
  value: number,
  quality: number,
  secondary: number | null = null,
): MetricResult {
  return {
    metric,
    status: 'valid',
    value,
    valueSecondary: secondary,
    unit: METRIC_UNITS[metric],
    qualityScore: Math.max(0, Math.min(1, quality)),
    qualityFlags: ['finger_scan'],
    reason: null,
    provenance: PROVENANCE,
  };
}

function round(v: number, dp: number): number {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
}

/** Last `sec` seconds of the beat-band pulse, at 30 Hz, scaled to ±1, for display only. */
function waveformFor(pulse: number[], fs: number, beats: number[] | null, sec = 10): PulseWaveform {
  const x = bandpass(pulse, fc.beatBandHz[0], fc.beatBandHz[1], fs);
  const start = Math.max(0, x.length - Math.round(sec * fs));
  const stride = Math.max(1, Math.round(fs / 30));
  const out: number[] = [];
  for (let i = start; i < x.length; i += stride) out.push(x[i]!);
  const peak = Math.max(1e-9, ...out.map(Math.abs));
  const t0 = start / fs;
  return {
    fs: fs / stride,
    samples: out.map((v) => round(v / peak, 3)),
    beats: (beats ?? []).filter((t) => t >= t0).map((t) => round(t - t0, 3)),
  };
}

/** Analyse a finger scan. Each metric passes or abstains on its own gates. */
export function analyzeFingerSession(
  frames: FingerFrameSample[],
  opts: { cancelled?: boolean } = {},
): SessionResult {
  const seg = fingerSegment(frames);
  const dts: number[] = [];
  for (let i = 1; i < frames.length; i++) dts.push(frames[i]!.t - frames[i - 1]!.t);
  const mdt = dts.length ? median(dts) : 0;
  const withSample = frames.filter((f) => f.sample);
  const flagCounts: Partial<Record<string, number>> = {};
  for (const f of frames) for (const fl of f.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1;
  const finger: FingerDiagnostics = {
    channel: null,
    channelSnrDb: { r: null, g: null, b: null },
    pulseStrengthPct: null,
    redClippedFraction: withSample.length
      ? round(mean(withSample.map((f) => (f.sample!.redClipped > 0.5 ? 1 : 0))), 3)
      : 0,
    meanCoverage: withSample.length
      ? round(mean(withSample.map((f) => f.sample!.coverage)), 3)
      : null,
    halvesDiffBpm: null,
    beatMeanHrBpm: null,
    sdnnMs: null,
    timingNoiseMs: null,
    timingLimitMs: null,
    breathing: [],
    ratioOfRatiosRedBlue: null,
  };
  const usableDur = duration(seg);
  const diagnostics: SessionResult['diagnostics'] = {
    durationSec: duration(frames),
    usableDurationSec: usableDur,
    sampleRateHz: fc.sampleRateHz,
    droppedFrameFraction: mdt > 0 ? dts.filter((d) => d > 2.5 * mdt).length / dts.length : 0,
    usableFrameFraction: frames.length ? frames.filter((f) => f.usable).length / frames.length : 0,
    hrSnrDb: null,
    ibiCount: 0,
    ibiAcceptedFraction: null,
    capture: {
      frameCount: frames.length,
      medianFrameIntervalMs: round(mdt, 1),
      flagCounts: flagCounts as never,
      roiFrames: withSample.length,
      meanLuma: withSample.length ? round(mean(withSample.map((f) => f.sample!.luma)), 1) : null,
      meanSkinPixels: null,
    },
    finger,
  };
  const base = {
    pipelineVersion: FINGER_PIPELINE_VERSION,
    configVersion: FINGER_CONFIG_VERSION,
    diagnostics,
  };
  const spo2 = unavailable('spo2', 'unsupported_method', ['needs_device_calibration']);
  const bp = unavailable('blood_pressure', 'unsupported_method');
  const finish = (
    results: Map<MetricId, MetricResult>,
    waveform?: PulseWaveform,
  ): SessionResult => {
    const metrics = [...FINGER_METRICS.map((m) => results.get(m)!), spo2, bp];
    const n = FINGER_METRICS.filter((m) => results.get(m)!.status === 'valid').length;
    const outcome: SessionOutcome =
      n === FINGER_METRICS.length ? 'completed' : n > 0 ? 'partial' : 'failed';
    return { ...base, scanType: 'finger', outcome, metrics, ...(waveform ? { waveform } : {}) };
  };
  const results = new Map<MetricId, MetricResult>();
  const all = (reason: UnavailableReason, flags: string[] = []) => {
    for (const m of FINGER_METRICS) results.set(m, unavailable(m, reason, flags));
  };

  if (opts.cancelled) {
    all('cancelled');
    return { ...finish(results), outcome: 'cancelled' };
  }
  if (usableDur < fc.minHrDurationSec) {
    all('insufficient_duration');
    return finish(results);
  }

  const fs = fc.sampleRateHz;
  const t = seg.map((f) => f.t / 1000);
  const ch = (c: 'r' | 'g' | 'b') =>
    resampleUniform(
      t,
      seg.map((f) => f.sample![c]),
      fs,
    );
  const chans = { r: ch('r'), g: ch('g'), b: ch('b') };
  // Pick the channel with the clearest pulse. Blood absorbs light, so the
  // signal is inverted to make each beat point up.
  let best: {
    c: 'r' | 'g' | 'b';
    hr: NonNullable<ReturnType<typeof estimateHeartRate>>;
    inv: number[];
  } | null = null;
  for (const c of ['g', 'r', 'b'] as const) {
    const x = chans[c];
    const m = median(x);
    const clipped = c === 'r' && finger.redClippedFraction > 0.2;
    if (m < 8 || m > 245 || clipped) continue;
    const inv = x.map((v) => -v / m);
    const hr = estimateHeartRate(inv, fs);
    finger.channelSnrDb[c] = hr ? round(hr.snrDb, 2) : null;
    if (hr && (!best || hr.snrDb > best.hr.snrDb)) best = { c, hr, inv };
  }
  if (!best) {
    all('low_signal_quality', ['no_usable_channel']);
    return finish(results);
  }
  const { hr, inv } = best;
  finger.channel = best.c;
  diagnostics.hrSnrDb = round(hr.snrDb, 2);
  finger.halvesDiffBpm = Number.isFinite(hr.halvesDiffBpm) ? round(hr.halvesDiffBpm, 1) : null;
  const beats = detectFingerBeats(inv, fs, hr.bpm);
  finger.timingNoiseMs =
    beats?.timingNoiseMs != null ? round(fc.timingErrorScale * beats.timingNoiseMs, 1) : null;
  finger.timingLimitMs = beats
    ? round(
        Math.min(fc.maxTimingErrorMs, beats.rmssdMs * Math.sqrt(fc.maxTimingShareOfRmssd / 6)),
        1,
      )
    : null;
  diagnostics.ibiCount = beats?.intervalCount ?? 0;
  diagnostics.ibiAcceptedFraction = beats ? round(beats.acceptedFraction, 3) : null;
  finger.beatMeanHrBpm = beats ? round(beats.meanHrBpm, 1) : null;
  if (beats) finger.pulseStrengthPct = round(100 * median(beats.amplitudes), 3);
  if (chans.r.length && finger.redClippedFraction < 0.05) {
    const acR = std(bandpass(chans.r, 0.7, 3, fs)) / mean(chans.r);
    const acB = std(bandpass(chans.b, 0.7, 3, fs)) / mean(chans.b);
    if (acB > 0 && Number.isFinite(acR / acB)) finger.ratioOfRatiosRedBlue = round(acR / acB, 4);
  }
  const waveform = waveformFor(inv, fs, beats?.times ?? null);

  const hrOk =
    hr.snrDb >= fc.minHrSnrDb &&
    hr.halvesDiffBpm <= fc.hrHalvesAgreementBpm &&
    hr.bpm >= 40 &&
    hr.bpm <= 180 &&
    !!beats &&
    beats.acceptedFraction >= fc.minBeatAcceptedFraction &&
    Math.abs(beats.meanHrBpm - hr.bpm) <= fc.beatHrAgreementBpm;
  if (!hrOk || !beats) {
    all('low_signal_quality');
    return finish(results, waveform);
  }
  const quality = 0.5 + 0.5 * Math.min(1, Math.max(0, (hr.snrDb - fc.minHrSnrDb) / 10));
  results.set('heart_rate', valid('heart_rate', Math.round(hr.bpm), quality));

  // HRV
  const accepted = beats.ibis.length;
  if (usableDur < fc.minHrvDurationSec)
    results.set('hrv', unavailable('hrv', 'insufficient_duration'));
  else if (
    hr.snrDb < fc.minHrvSnrDb ||
    accepted < fc.minHrvIntervals ||
    beats.acceptedFraction < fc.minHrvAcceptedFraction ||
    beats.timingNoiseMs === null ||
    fc.timingErrorScale * beats.timingNoiseMs > fc.maxTimingErrorMs ||
    6 * (fc.timingErrorScale * beats.timingNoiseMs) ** 2 >
      fc.maxTimingShareOfRmssd * beats.rmssdMs ** 2
  )
    results.set('hrv', unavailable('hrv', 'low_signal_quality'));
  else if (beats.rmssdMs < fc.hrvRangeMs[0] || beats.rmssdMs > fc.hrvRangeMs[1])
    results.set('hrv', unavailable('hrv', 'out_of_operating_range'));
  else {
    finger.sdnnMs = round(beats.sdnnMs, 1);
    results.set(
      'hrv',
      valid(
        'hrv',
        Math.round(beats.rmssdMs),
        quality * beats.acceptedFraction,
        Math.round(beats.sdnnMs),
      ),
    );
  }

  // Breathing
  if (usableDur < fc.minBreathingDurationSec)
    results.set('breathing_rate', unavailable('breathing_rate', 'insufficient_duration'));
  else {
    const rfs = 4;
    const baseline = bandpass(inv, 0.05, 0.5, fs);
    const riivSeries: number[] = [];
    for (let i = 0; i < baseline.length; i += fs / rfs) riivSeries.push(baseline[Math.floor(i)]!);
    const beatT = beats.times;
    const riav = resampleUniform(beatT, beats.amplitudes, rfs);
    const rifv = resampleUniform(
      beats.ibis.map((q) => q.t),
      beats.ibis.map((q) => q.ibi),
      rfs,
    );
    const mod = (name: BreathingModulation['name'], s: number[]): BreathingModulation => {
      const p = respiratoryPeak(s, rfs);
      return {
        name,
        perMin: p ? round(p.perMin, 1) : null,
        concentration: p ? round(p.concentration, 3) : 0,
      };
    };
    finger.breathing = [mod('riiv', riivSeries), mod('riav', riav), mod('rifv', rifv)];
    const br = fuseBreathing(finger.breathing);
    const lowBr = br === null ? lowConfidenceBreathing(finger.breathing) : null;
    if (br === null && lowBr !== null) {
      const res = valid('breathing_rate', Math.round(lowBr), quality * 0.5);
      results.set('breathing_rate', {
        ...res,
        qualityFlags: [...res.qualityFlags, 'low_confidence'],
      });
    } else if (br === null) {
      const clear = finger.breathing.filter(
        (m) => m.perMin !== null && m.concentration >= fc.minBreathingConcentration,
      ).length;
      results.set(
        'breathing_rate',
        unavailable('breathing_rate', clear >= 2 ? 'inconsistent_estimates' : 'low_signal_quality'),
      );
    } else results.set('breathing_rate', valid('breathing_rate', Math.round(br), quality));
  }
  return finish(results, waveform);
}

export type FingerLiveQuality = FingerFrameFlag | 'ready' | 'starting';

export interface FingerLiveState {
  quality: FingerLiveQuality;
  guidance: string;
  /** Extra hint from the live pulse (e.g. pressing too hard); null when none. */
  hint: string | null;
  elapsedSec: number;
  usableSec: number;
  progress: number;
  /** Last ~5 s of the live pulse at ~30 Hz, scaled to ±1; empty until there is a signal. */
  waveform: number[];
  metrics: Record<MetricId, 'pending' | 'measuring' | 'available' | 'unavailable'>;
  interimHeartRate: number | null;
  interimHrv: number | null;
  interimBreathingRate: number | null;
  /** Live pulse SNR, dB, recomputed every 2 s after 15 s of clean signal. */
  interimSnrDb: number | null;
  /** Seconds left before the torch-heat limit stops the scan. */
  secondsLeft: number;
}

/**
 * Stateful finger scan. Holds only per-frame colour averages and is cleared
 * on finish() and cancel().
 */
export class FingerScanSession {
  private frames: FingerFrameSample[] = [];
  private startT: number | null = null;
  private lastInterimAt = 0;
  private interim: {
    hr: number | null;
    hrv: number | null;
    br: number | null;
    snr: number | null;
  } = {
    hr: null,
    hrv: null,
    br: null,
    snr: null,
  };
  private done = false;

  constructor(
    private readonly targetUsableSec: number = fc.targetUsableSec,
    private readonly maxScanSec: number = fc.maxScanSec,
  ) {}

  get frameCount(): number {
    return this.frames.length;
  }

  pushFrame(input: FingerFrameInput): FingerFrameSample {
    if (this.done) throw new Error('FingerScanSession already finished');
    if (this.startT === null) this.startT = input.t;
    let prev: FingerSample | null = null;
    for (let i = this.frames.length - 1; i >= 0 && i >= this.frames.length - 3; i--) {
      const f = this.frames[i]!;
      if (f.sample && f.usable) {
        prev = f.sample;
        break;
      }
    }
    const flags = assessFingerFrame(input.sample, prev);
    const s: FingerFrameSample = { ...input, flags, usable: flags.length === 0 && !!input.sample };
    this.frames.push(s);
    return s;
  }

  private usableSec(): number {
    return duration(fingerSegment(this.frames));
  }

  private elapsedSec(): number {
    const last = this.frames[this.frames.length - 1];
    return last && this.startT !== null ? (last.t - this.startT) / 1000 : 0;
  }

  liveState(): FingerLiveState {
    const elapsedSec = this.elapsedSec();
    const usableSec = this.usableSec();
    const recent = this.frames.slice(-10);
    let quality: FingerLiveQuality = 'starting';
    if (recent.length) {
      if (recent.filter((f) => f.usable).length / recent.length >= 0.7) quality = 'ready';
      else {
        const counts = new Map<FingerFrameFlag, number>();
        for (const f of recent) for (const fl of f.flags) counts.set(fl, (counts.get(fl) ?? 0) + 1);
        quality =
          [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'finger_not_detected';
      }
    }
    const last = this.frames[this.frames.length - 1];
    if (usableSec >= fc.minHrDurationSec && last && last.t - this.lastInterimAt > 2000) {
      this.lastInterimAt = last.t;
      const res = analyzeFingerSession(this.frames);
      const v = (m: MetricId) => {
        const r = res.metrics.find((x) => x.metric === m);
        return r?.status === 'valid' ? r.value : null;
      };
      this.interim = {
        hr: v('heart_rate'),
        hrv: v('hrv'),
        br: v('breathing_rate'),
        snr: res.diagnostics.hrSnrDb,
      };
    }
    const { waveform, strengthPct } = this.liveWaveform();
    let hint: string | null = null;
    if (quality === 'ready' && usableSec >= 6 && strengthPct !== null && strengthPct < 0.1)
      hint = 'The pulse looks faint. Press more lightly, and warm your hand if it is cold.';
    const metrics = {} as FingerLiveState['metrics'];
    for (const m of FINGER_METRICS) metrics[m] = usableSec > 0 ? 'measuring' : 'pending';
    if (this.interim.hr !== null) metrics.heart_rate = 'available';
    if (this.interim.hrv !== null) metrics.hrv = 'available';
    if (this.interim.br !== null) metrics.breathing_rate = 'available';
    metrics.spo2 = 'unavailable';
    metrics.blood_pressure = 'unavailable';
    return {
      quality,
      guidance: FINGER_GUIDANCE[quality],
      hint,
      elapsedSec,
      usableSec,
      progress: Math.min(1, usableSec / this.targetUsableSec),
      waveform,
      metrics,
      interimHeartRate: this.interim.hr,
      interimHrv: this.interim.hrv,
      interimBreathingRate: this.interim.br,
      interimSnrDb: this.interim.snr,
      secondsLeft: Math.max(0, Math.ceil(this.maxScanSec - elapsedSec)),
    };
  }

  /**
   * Live trace of the last ~5 s of usable frames: inverted green (or red when
   * green is too dark), minus a 1 s moving average, scaled to ±1. Display
   * only; the analysis never uses it.
   */
  private liveWaveform(): { waveform: number[]; strengthPct: number | null } {
    const last = this.frames[this.frames.length - 1];
    if (!last) return { waveform: [], strengthPct: null };
    const win = this.frames.filter((f) => f.usable && f.sample && last.t - f.t <= 6000);
    if (win.length < 30) return { waveform: [], strengthPct: null };
    const useRed = mean(win.map((f) => f.sample!.g)) < 8;
    const raw = win.map((f) => -(useRed ? f.sample!.r : f.sample!.g));
    const dc = -mean(raw);
    const half = 15;
    const hp = raw.map((v, i) => {
      const a = Math.max(0, i - half);
      const b = Math.min(raw.length, i + half + 1);
      let s = 0;
      for (let k = a; k < b; k++) s += raw[k]!;
      return v - s / (b - a);
    });
    // Three-point smoothing for display.
    const sm = hp.map(
      (v, i) => (hp[Math.max(0, i - 1)]! + v + hp[Math.min(hp.length - 1, i + 1)]!) / 3,
    );
    const tail = sm.slice(-150);
    const peak = Math.max(1e-9, ...tail.map(Math.abs));
    const strengthPct = dc > 0 ? (100 * 2 * std(tail)) / dc : null;
    return { waveform: tail.map((v) => v / peak), strengthPct };
  }

  shouldFinish(): boolean {
    if (this.elapsedSec() >= this.maxScanSec) return true;
    return this.usableSec() >= this.targetUsableSec;
  }

  /**
   * Per-frame colour averages, for offline analysis of a failed scan.
   * Format: header, then dt_ms, r/g/b x100, usable, coverage x1000, red-clipped x1000.
   */
  exportTrace(): string {
    const lines = [
      'edgevitals-finger-trace v1 dt_ms,r100,g100,b100,usable,coverage1000,redclip1000',
    ];
    let prev: number | null = null;
    for (const f of this.frames) {
      const dt = prev === null ? 0 : Math.round(f.t - prev);
      prev = f.t;
      const s = f.sample;
      lines.push(
        [
          dt,
          Math.round((s?.r ?? 0) * 100),
          Math.round((s?.g ?? 0) * 100),
          Math.round((s?.b ?? 0) * 100),
          f.usable ? 1 : 0,
          Math.round((s?.coverage ?? 0) * 1000),
          Math.round((s?.redClipped ?? 0) * 1000),
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  finish(): SessionResult {
    const r = analyzeFingerSession(this.frames);
    this.clear();
    return r;
  }

  cancel(): SessionResult {
    const r = analyzeFingerSession(this.frames, { cancelled: true });
    this.clear();
    return r;
  }

  private clear(): void {
    this.frames = [];
    this.done = true;
    this.interim = { hr: null, hrv: null, br: null, snr: null };
  }
}
