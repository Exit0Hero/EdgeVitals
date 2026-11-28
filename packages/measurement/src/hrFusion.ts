/**
 * Face heart rate from several rPPG methods and skin regions, with
 * quality-weighted fusion and abstention.
 *
 * Candidates: every (method, region) pulse from rppg.ts, using POS (revised),
 * CHROM and PBV over the pooled ROI and each usable region. Estimates are
 * never simply averaged. Instead:
 *
 * 1. Spectral evidence is fused, weighted by quality. For each candidate the
 *    Welch spectrum is normalised to unit power in the cardiac band and
 *    weighted by its own SNR (de Haan & Jeanne 2013 definition), so a clean
 *    region counts for more than a noisy one and no candidate can dominate by
 *    raw amplitude.
 *
 * 2. Two independent decision paths:
 *    - Windowed consensus: 10 s windows every 2 s, skipping windows with a
 *      motion, lighting, ROI or interpolation artefact (acquisition.ts). Each
 *      clean window votes with the peak of its fused spectrum. The capture
 *      passes when enough clean windows agree within ±6 bpm (0.55 + 6/windows
 *      of at least 18 windows, stricter than v0.3) and the SNR at the agreed
 *      rate is at least -2 dB. For weak but steady pulses.
 *    - Whole-segment spectrum: the fused SNR must reach the spectral floor,
 *      both halves must agree, the autocorrelation rate must agree, and the
 *      beats must be regular (prv.ts). For strong pulses and short captures.
 *
 * 3. Agreement checks:
 *    - At least two methods must independently support the rate.
 *    - When two or more regions are usable, at least two regions must also
 *      support it.
 *    - A method or region whose own evidence clearly points to a different
 *      rate makes the result inconsistent.
 *    - So does a confident autocorrelation at a non-harmonic rate, or the two
 *      paths disagreeing. An inconsistent result abstains.
 *
 * 4. Temporal tracking only fixes octave errors, and conservatively. A window
 *    voting near twice or half the consensus may be re-read at the consensus
 *    rate, but only if its own fused spectrum has a peak there with at least
 *    half the power of its top peak. That window still needs the full
 *    agreement rule. If more than a quarter of the windows would need it, no
 *    correction is made. Earlier estimates never fill in or replace a
 *    window's evidence.
 *
 * All thresholds are engineering defaults. Their false-acceptance rate was
 * measured on simulated pulseless captures (test/hrFusion.test.ts and
 * docs/adr/0011). None has been validated against a reference device.
 */
import { type WindowArtefacts } from './acquisition';
import {
  acfPeak,
  autocorrelation,
  bandPower,
  createWelchPlan,
  median,
  peakFrequency,
  welch,
  type Spectrum,
  type WelchPlan,
} from './dsp';
import { PIPELINE_CONFIG } from './config';
import { detectPulseBeats, type BeatAnalysis } from './prv';
import type { PulseCandidate, RppgMethod, SignalRegion } from './rppg';
import type { UnavailableReason } from './types';

export const HR_FUSION = {
  algorithm: 'rppg-fusion-welch',
  version: '0.1.0',
  methods: ['pos_v2', 'chrom', 'pbv'] as readonly RppgMethod[],
  band: PIPELINE_CONFIG.hrBandHz,
  windowSec: 10,
  hopSec: 2,
  nfft: 512,
  /** Zero-padded FFT size for whole-segment and half-segment spectra. */
  wholeNfft: 2048,
  toleranceBpm: 6,
  /**
   * Window agreement needed: consensusBase + consensusPerWindow / windows,
   * with at least minWindows clean windows (about 45 s). Set from simulated
   * pulseless captures (3,280 phone-like and white-noise captures of 40-90 s,
   * one per interim look). The v0.3 bar (0.55 + 5/w, 16 windows) let 3 of
   * them through once several candidates were fused, because fusion selects
   * the most stable candidate. With 0.55 + 6/w and 18 windows none passed,
   * and the closest was 0.05 below the bar. Weak simulated pulses (0.08% of
   * skin brightness): 76% read at 45 s, 88% at 75 s. See docs/adr/0011.
   */
  minWindows: 18,
  consensusBase: 0.55,
  consensusPerWindow: 6,
  minConsensusSnrDb: PIPELINE_CONFIG.minHrSnrDb,
  /** Above this share of artefact windows the capture is too disturbed for either path. */
  maxArtefactShare: 0.5,
  /** The whole-segment path needs a mostly clean segment. */
  maxSpectralArtefactShare: 0.2,
  spectral: {
    minSnrDb: PIPELINE_CONFIG.minSpectralHrSnrDb,
    halvesAgreementBpm: PIPELINE_CONFIG.hrHalvesAgreementBpm,
    minBeatAcceptedFraction: PIPELINE_CONFIG.minHrBeatAcceptedFraction,
    beatRateAgreementBpm: PIPELINE_CONFIG.hrvHrAgreementBpm,
    minAcfStrength: 0.3,
  },
  /** A confident autocorrelation (≥ this) at a non-harmonic rate vetoes the result. */
  acfVetoStrength: 0.5,
  /**
   * Candidate weight = clamp(SNR linear) x stability^stabilityExponent, where
   * stability is the share of the candidate's own window peaks at its own
   * modal rate. A high exponent makes fusion follow the most stable
   * candidates (a soft selection) instead of letting noisy projections
   * dilute a clean one.
   */
  stabilityExponent: 4,
  /** Candidate weight = SNR (linear), clamped to this range. */
  weightRange: [0.1, 10] as [number, number],
  octave: { minRelativePower: 0.5, maxShare: 0.25 },
  /** Supporting methods / regions needed for the 'good' grade (quality.ts). */
  minMethodSupport: 2,
  minRegionSupport: 2,
  /** Plausible range for a resting adult wellness scan. */
  rangeBpm: [42, 180] as [number, number],
} as const;

const F = HR_FUSION;

export type HrFusionFailure =
  | 'too_short'
  | 'artefacts'
  | 'no_peak'
  | 'weak_signal'
  | 'windows_disagree'
  | 'methods_disagree'
  | 'regions_disagree'
  | 'autocorrelation_disagrees'
  | 'paths_disagree'
  | 'beats_irregular'
  | 'out_of_range';

export interface HrSupport {
  /** Modal rate of this method's (or region's) own windows or spectrum, bpm. */
  bpm: number | null;
  /** Share of its clean windows within tolerance of the fused rate (windowed path). */
  agreement: number | null;
  /** Its own evidence alone reaches the window-agreement or spectral-SNR bar. */
  adequate: boolean;
  /** Adequate and pointing at the fused rate. */
  supports: boolean;
  /** Its own evidence clearly points elsewhere. */
  conflicts: boolean;
}

export interface HrFusionResult {
  status: 'valid' | 'abstain';
  bpm: number | null;
  reason: UnavailableReason | null;
  failure: HrFusionFailure | null;
  path: 'spectral' | 'windowed' | null;
  /** Whole-segment SNR of the best candidate at the reported (or best) rate, dB. */
  snrDb: number | null;
  /** Peak power over median in-band power of the fused whole-segment spectrum. */
  prominence: number | null;
  best: { method: RppgMethod; region: SignalRegion } | null;
  windows: {
    total: number;
    clean: number;
    agreeing: number;
    agreement: number;
    required: number;
    octaveCorrections: number;
    bpm: number | null;
    passed: boolean;
  };
  spectral: {
    bpm: number | null;
    snrDb: number | null;
    halvesDiffBpm: number | null;
    beatAcceptedFraction: number | null;
    beatRateBpm: number | null;
    passed: boolean;
  };
  autocorrelation: { bpm: number; strength: number } | null;
  methods: Partial<Record<RppgMethod, HrSupport>>;
  regions: Partial<Record<SignalRegion, HrSupport>>;
  /** Beat analysis of the best candidate at the fused rate (reused by PRV). */
  beats: BeatAnalysis | null;
}

interface NormSpectrum {
  spec: Spectrum;
  snrDb: number;
  peakHz: number | null;
}

/** SNR at f0 (de Haan & Jeanne 2013, windows widened as in estimators.ts). */
export function snrFromSpectrum(spec: Spectrum, f0: number): number {
  const signal = bandPower(spec, f0 - 0.2, f0 + 0.2) + bandPower(spec, 2 * f0 - 0.3, 2 * f0 + 0.3);
  const total = bandPower(spec, 0.7, 4.0);
  const noise = total - signal;
  return noise > 0 ? 10 * Math.log10(signal / noise) : 30;
}

function normalisedSpectrum(
  x: number[],
  fs: number,
  segSec: number,
  nfft: number,
  plan?: WelchPlan,
  start = 0,
  end = x.length,
): NormSpectrum {
  let spec: Spectrum;
  if (plan) spec = { freqs: plan.freqs, power: plan.run(x, start, end) as unknown as number[] };
  else spec = welch(start === 0 && end === x.length ? x : x.slice(start, end), fs, segSec, nfft);
  // Normalise to unit power in the cardiac band.
  let total = 0;
  for (let k = 0; k < spec.freqs.length; k++) {
    const f = spec.freqs[k]!;
    if (f >= F.band[0] && f <= F.band[1]) total += spec.power[k]!;
  }
  const power = new Array<number>(spec.power.length);
  for (let k = 0; k < power.length; k++) power[k] = total > 0 ? spec.power[k]! / total : 0;
  const out = { freqs: spec.freqs, power };
  const pk = total > 0 ? peakFrequency(out, F.band[0], F.band[1]) : null;
  return { spec: out, snrDb: pk ? snrFromSpectrum(out, pk.freq) : -30, peakHz: pk?.freq ?? null };
}

function weightOf(snrDb: number): number {
  return Math.min(F.weightRange[1], Math.max(F.weightRange[0], 10 ** (snrDb / 10)));
}

function fuse(spectra: NormSpectrum[], stability?: number[]): Spectrum | null {
  if (!spectra.length) return null;
  const freqs = spectra[0]!.spec.freqs;
  const acc = new Array<number>(freqs.length).fill(0);
  let wsum = 0;
  spectra.forEach((s, i) => {
    const w = weightOf(s.snrDb) * (stability ? stability[i]! ** F.stabilityExponent : 1);
    wsum += w;
    for (let k = 0; k < acc.length; k++) acc[k] = acc[k]! + w * s.spec.power[k]!;
  });
  if (!(wsum > 0)) return { freqs, power: acc };
  return { freqs, power: acc.map((p) => p / wsum) };
}

/** Consensus of votes: centre with most votes within tolerance, median of those. */
function consensus(votes: number[]): { bpm: number; agreeing: number } | null {
  if (!votes.length) return null;
  let best = 0;
  let centre = 0;
  for (let c = F.band[0] * 60; c <= F.band[1] * 60; c += 0.5) {
    let k = 0;
    for (const v of votes) if (Math.abs(v - c) <= F.toleranceBpm) k++;
    if (k > best) {
      best = k;
      centre = c;
    }
  }
  const agree = votes.filter((v) => Math.abs(v - centre) <= F.toleranceBpm);
  return { bpm: median(agree), agreeing: agree.length };
}

function requiredAgreement(windows: number): number {
  return F.consensusBase + F.consensusPerWindow / windows;
}

const near = (a: number, b: number) => Math.abs(a - b) <= F.toleranceBpm;
const harmonicOf = (a: number, b: number) => near(a, b) || near(a, 2 * b) || near(a, b / 2);

/** Local peak of `spec` within tolerance of `bpm`, relative to the top in-band peak. */
function peakNear(
  spec: Spectrum,
  bpm: number,
): { bpm: number; relative: number; power: number } | null {
  const top = peakFrequency(spec, F.band[0], F.band[1]);
  if (!top) return null;
  const lo = Math.max(F.band[0], (bpm - F.toleranceBpm) / 60);
  const hi = Math.min(F.band[1], (bpm + F.toleranceBpm) / 60);
  const p = peakFrequency(spec, lo, hi);
  if (!p) return null;
  const k = p.index;
  if (k <= 0 || k >= spec.power.length - 1) return null;
  if (!(spec.power[k]! >= spec.power[k - 1]! && spec.power[k]! >= spec.power[k + 1]!)) return null;
  return {
    bpm: p.freq * 60,
    relative: spec.power[k]! / spec.power[top.index]!,
    power: spec.power[k]!,
  };
}

/** Mean of per-window autocorrelations of the candidate pulse, then the beat-period peak. */
function windowedAcf(
  pulse: number[],
  fs: number,
  starts: number[],
): { bpm: number; strength: number } | null {
  const minLag = Math.max(1, Math.floor(fs / F.band[1]));
  const maxLag = Math.ceil(fs / F.band[0]);
  const len = Math.round(F.windowSec * fs);
  const acc = new Array<number>(maxLag + 2).fill(0);
  let used = 0;
  const list = starts.length ? starts : [0];
  for (const s of list) {
    const i0 = Math.round(s * fs);
    const seg = pulse.slice(i0, i0 + len);
    if (seg.length < len / 2) continue;
    const r = autocorrelation(seg, maxLag + 1);
    for (let k = 0; k < acc.length && k < r.length; k++) acc[k] = acc[k]! + r[k]!;
    used++;
  }
  if (!used) return null;
  return acfPeak(
    acc.map((v) => v / used),
    fs,
    minLag,
    maxLag,
  );
}

/**
 * Fuse heart-rate evidence from `candidates` (all the same length, sampled
 * at `fs`). `artefacts` are the per-window artefact marks for the same
 * signal; `artefactMask` the per-sample version (for beat intervals).
 */
export function fuseHeartRate(
  candidates: PulseCandidate[],
  fs: number,
  artefacts: WindowArtefacts,
  artefactMask?: boolean[],
): HrFusionResult {
  const used = candidates.filter((c) => F.methods.includes(c.method));
  const n = used[0]?.pulse.length ?? 0;
  const durationSec = n / fs;
  const empty: HrFusionResult = {
    status: 'abstain',
    bpm: null,
    reason: 'low_signal_quality',
    failure: null,
    path: null,
    snrDb: null,
    prominence: null,
    best: null,
    windows: {
      total: artefacts.starts.length,
      clean: artefacts.artefact.filter((a) => a === null).length,
      agreeing: 0,
      agreement: 0,
      required: 1,
      octaveCorrections: 0,
      bpm: null,
      passed: false,
    },
    spectral: {
      bpm: null,
      snrDb: null,
      halvesDiffBpm: null,
      beatAcceptedFraction: null,
      beatRateBpm: null,
      passed: false,
    },
    autocorrelation: null,
    methods: {},
    regions: {},
    beats: null,
  };
  if (!used.length || durationSec < PIPELINE_CONFIG.minHrDurationSec)
    return { ...empty, reason: 'insufficient_duration', failure: 'too_short' };

  const regionsPresent = [...new Set(used.map((c) => c.region))].filter((r) => r !== 'combined');
  const methodsPresent = [...new Set(used.map((c) => c.method))];
  const artefactShare = artefacts.artefact.length
    ? artefacts.artefact.filter((a) => a !== null).length / artefacts.artefact.length
    : 0;
  if (artefactShare > F.maxArtefactShare) return { ...empty, failure: 'artefacts' };

  // ---- Windowed consensus -------------------------------------------------
  const winLen = Math.round(F.windowSec * fs);
  const cleanStarts = artefacts.starts.filter((_, i) => artefacts.artefact[i] === null);
  const windowPlan = createWelchPlan(fs, Math.min(n, winLen), F.nfft);
  const perWindow = cleanStarts.map((s) => {
    const i0 = Math.round(s * fs);
    return used.map((c) =>
      normalisedSpectrum(
        c.pulse,
        fs,
        F.windowSec,
        F.nfft,
        windowPlan,
        i0,
        Math.min(n, i0 + winLen),
      ),
    );
  });
  // Candidate stability: the share of a candidate's own window peaks that
  // agree with its own modal rate. A real pulse keeps its frequency; noise
  // peaks wander. It is computed from each candidate alone (no target rate),
  // raised to stabilityExponent, and multiplies the per-window SNR weight.
  const stability = used.map((_, ci) => {
    const own = perWindow
      .map((specs) => specs[ci]!.peakHz)
      .map((f) => (f === null ? -1000 : f * 60));
    const c = consensus(own);
    return c && own.length ? c.agreeing / own.length : 0;
  });
  const fusedWindows = perWindow.map((specs) => fuse(specs, stability)!);
  // A window whose fused spectrum has no in-band peak (all-zero signal) casts
  // a vote that agrees with nothing, so it still counts against agreement.
  let votes = fusedWindows.map((s) => {
    const p = peakFrequency(s, F.band[0], F.band[1]);
    return p ? p.freq * 60 : -1000;
  });
  let cons = consensus(votes);
  // Octave tracking (see module comment): only re-read windows whose own
  // spectrum has a substantial peak at the consensus rate.
  let octaveCorrections = 0;
  if (cons) {
    const c = cons.bpm;
    const fixed = votes.map((v, i) => {
      if (near(v, c) || !(near(v, 2 * c) || near(v, c / 2))) return v;
      const alt = peakNear(fusedWindows[i]!, c);
      return alt && alt.relative >= F.octave.minRelativePower ? alt.bpm : v;
    });
    const changes = fixed.filter((v, i) => v !== votes[i]).length;
    if (changes > 0 && changes <= F.octave.maxShare * votes.length) {
      votes = fixed;
      octaveCorrections = changes;
      cons = consensus(votes);
    }
  }
  const clean = cleanStarts.length;
  const required = clean ? requiredAgreement(clean) : 1;
  const agreement = cons && clean ? cons.agreeing / clean : 0;
  const windowsBpm = cons?.bpm ?? null;

  // Whole-segment spectra (also give the session SNR).
  const segSec = Math.min(12, durationSec);
  const wholePlan = createWelchPlan(
    fs,
    Math.min(n, Math.max(8, Math.round(segSec * fs))),
    F.wholeNfft,
  );
  const whole = used.map((c) => normalisedSpectrum(c.pulse, fs, segSec, F.wholeNfft, wholePlan));
  const fusedWhole = fuse(whole)!;
  const wholePeak = peakFrequency(fusedWhole, F.band[0], F.band[1]);
  const spectralBpm = wholePeak ? wholePeak.freq * 60 : null;

  // Best candidate at a rate: highest whole-segment SNR at that rate.
  const bestAt = (bpm: number) => {
    let bi = 0;
    let bs = -Infinity;
    for (let i = 0; i < used.length; i++) {
      const s = snrFromSpectrum(whole[i]!.spec, bpm / 60);
      if (s > bs) {
        bs = s;
        bi = i;
      }
    }
    return { cand: used[bi]!, snrDb: bs };
  };

  // Support of each method / region, from its own evidence.
  const groupSupport = (
    key: 'method' | 'region',
    value: string,
    targetBpm: number | null,
  ): HrSupport => {
    const idx = used.map((c, i) => (c[key] === value ? i : -1)).filter((i) => i >= 0);
    const ownVotes = perWindow.map((specs) => {
      const f = fuse(idx.map((i) => specs[i]!));
      const p = f ? peakFrequency(f, F.band[0], F.band[1]) : null;
      return p ? p.freq * 60 : -1000;
    });
    const own = ownVotes.length >= F.minWindows ? consensus(ownVotes) : null;
    const ownWhole = fuse(idx.map((i) => whole[i]!));
    const ownPeak = ownWhole ? peakFrequency(ownWhole, F.band[0], F.band[1]) : null;
    const ownBpm = own?.bpm ?? (ownPeak ? ownPeak.freq * 60 : null);
    const agreementAt =
      targetBpm !== null && ownVotes.length
        ? ownVotes.filter((v) => near(v, targetBpm)).length / ownVotes.length
        : null;
    const ownStrong = own
      ? own.agreeing / ownVotes.length >= requiredAgreement(ownVotes.length)
      : false;
    const ownWholeSnr = ownWhole && ownPeak ? snrFromSpectrum(ownWhole, ownPeak.freq) : -30;
    const ownWholeStrong = ownPeak !== null && ownWholeSnr >= F.spectral.minSnrDb;
    // Adequate: this method/region alone would pass the window-agreement or
    // spectral-SNR bar. Only adequate evidence can support or contradict.
    const adequate = ownStrong || ownWholeStrong;
    const pointsAt = (bpm: number) =>
      (ownStrong && own !== null && near(own.bpm, bpm)) ||
      (ownWholeStrong && near(ownPeak!.freq * 60, bpm));
    const supports = targetBpm !== null && adequate && pointsAt(targetBpm);
    const conflicts =
      targetBpm !== null &&
      adequate &&
      !supports &&
      ((ownStrong && own !== null && !harmonicOf(own.bpm, targetBpm)) ||
        (ownWholeStrong && !harmonicOf(ownPeak!.freq * 60, targetBpm)));
    return {
      bpm: ownBpm === null ? null : round(ownBpm, 1),
      agreement: agreementAt === null ? null : round(agreementAt, 3),
      adequate,
      supports,
      conflicts,
    };
  };

  const windowedPassedRaw =
    clean >= F.minWindows &&
    cons !== null &&
    agreement >= required &&
    windowsBpm !== null &&
    bestAt(windowsBpm).snrDb >= F.minConsensusSnrDb;

  // Spectral path checks.
  let halvesDiff: number | null = null;
  let spectralSnr: number | null = null;
  let spectralBeats: BeatAnalysis | null = null;
  let spectralAcfOk = false;
  if (spectralBpm !== null) {
    spectralSnr = snrFromSpectrum(fusedWhole, spectralBpm / 60);
    const half = Math.floor(n / 2);
    const halfPeak = (a: number, b: number) => {
      const f = fuse(
        used.map((c) => normalisedSpectrum(c.pulse.slice(a, b), fs, (b - a) / fs, F.wholeNfft)),
      );
      const p = f ? peakFrequency(f, F.band[0], F.band[1]) : null;
      return p ? p.freq * 60 : null;
    };
    const h1 = halfPeak(0, half);
    const h2 = halfPeak(half, n);
    halvesDiff = h1 !== null && h2 !== null ? Math.abs(h1 - h2) : null;
    const b = bestAt(spectralBpm).cand;
    spectralBeats = detectPulseBeats(b.pulse, fs, spectralBpm, artefactMask);
    const acf = windowedAcf(b.pulse, fs, artefacts.starts);
    spectralAcfOk =
      !!acf && acf.strength >= F.spectral.minAcfStrength && near(acf.bpm, spectralBpm);
  }
  const spectralPassedRaw =
    spectralBpm !== null &&
    artefactShare <= F.maxSpectralArtefactShare &&
    spectralSnr !== null &&
    spectralSnr >= F.spectral.minSnrDb &&
    halvesDiff !== null &&
    halvesDiff <= F.spectral.halvesAgreementBpm &&
    spectralAcfOk &&
    !!spectralBeats &&
    spectralBeats.acceptedFraction >= F.spectral.minBeatAcceptedFraction &&
    spectralBeats.meanRateBpm !== null &&
    Math.abs(spectralBeats.meanRateBpm - spectralBpm) <= F.spectral.beatRateAgreementBpm;

  // Candidate rate for agreement checks: spectral if it passed, else windowed.
  const target = spectralPassedRaw
    ? spectralBpm
    : windowedPassedRaw
      ? windowsBpm
      : (windowsBpm ?? spectralBpm);
  const methods: HrFusionResult['methods'] = {};
  for (const m of methodsPresent) methods[m] = groupSupport('method', m, target);
  const regions: HrFusionResult['regions'] = {};
  for (const r of regionsPresent) regions[r] = groupSupport('region', r, target);

  const result: HrFusionResult = {
    ...empty,
    windows: {
      total: artefacts.starts.length,
      clean,
      agreeing: cons?.agreeing ?? 0,
      agreement: round(agreement, 3),
      required: round(required, 3),
      octaveCorrections,
      bpm: windowsBpm === null ? null : round(windowsBpm, 1),
      passed: windowedPassedRaw,
    },
    spectral: {
      bpm: spectralBpm === null ? null : round(spectralBpm, 1),
      snrDb: spectralSnr === null ? null : round(spectralSnr, 2),
      halvesDiffBpm: halvesDiff === null ? null : round(halvesDiff, 1),
      beatAcceptedFraction: spectralBeats ? round(spectralBeats.acceptedFraction, 3) : null,
      beatRateBpm: spectralBeats?.meanRateBpm != null ? round(spectralBeats.meanRateBpm, 1) : null,
      passed: spectralPassedRaw,
    },
    methods,
    regions,
  };
  if (target !== null) {
    const b = bestAt(target);
    result.best = { method: b.cand.method, region: b.cand.region };
    result.snrDb = round(b.snrDb, 2);
    const inBand = fusedWhole.power.filter(
      (_, k) => fusedWhole.freqs[k]! >= F.band[0] && fusedWhole.freqs[k]! <= F.band[1],
    );
    const pk = peakNear(fusedWhole, target);
    const med = median(inBand);
    if (pk && med > 0) result.prominence = round(pk.power / med, 2);
    result.autocorrelation = windowedAcf(b.cand.pulse, fs, cleanStarts);
    if (result.autocorrelation)
      result.autocorrelation = {
        bpm: round(result.autocorrelation.bpm, 1),
        strength: round(result.autocorrelation.strength, 3),
      };
  }

  const abstain = (failure: HrFusionFailure, reason: UnavailableReason = 'low_signal_quality') => ({
    ...result,
    status: 'abstain' as const,
    bpm: null,
    reason,
    failure,
  });

  if (!windowedPassedRaw && !spectralPassedRaw) {
    if (spectralBpm === null && windowsBpm === null) return abstain('no_peak');
    if (clean >= F.minWindows && cons && agreement < required) return abstain('windows_disagree');
    if (
      spectralBeats &&
      spectralSnr !== null &&
      spectralSnr >= F.spectral.minSnrDb &&
      !spectralAcfOk
    )
      return abstain('autocorrelation_disagrees');
    return abstain('weak_signal');
  }
  if (windowedPassedRaw && spectralPassedRaw && !near(windowsBpm!, spectralBpm!))
    return abstain('paths_disagree', 'inconsistent_estimates');
  const bpm = spectralPassedRaw ? spectralBpm! : windowsBpm!;
  const path = spectralPassedRaw ? 'spectral' : 'windowed';

  // Algorithm- and region-level agreement. Inadequate evidence (a method or
  // region too noisy to decide anything on its own) neither supports nor
  // contradicts; adequate evidence pointing elsewhere is a conflict.
  const ms = Object.values(methods);
  if (ms.some((s) => s.conflicts)) return abstain('methods_disagree', 'inconsistent_estimates');
  const rs = Object.values(regions);
  if (rs.some((s) => s.conflicts)) return abstain('regions_disagree', 'inconsistent_estimates');
  const acf = result.autocorrelation;
  if (acf && acf.strength >= F.acfVetoStrength && !harmonicOf(acf.bpm, bpm))
    return abstain('autocorrelation_disagrees', 'inconsistent_estimates');
  if (bpm < F.rangeBpm[0] || bpm > F.rangeBpm[1])
    return abstain('out_of_range', 'out_of_operating_range');

  const best = bestAt(bpm);
  const beats =
    path === 'spectral' && spectralBeats
      ? spectralBeats
      : detectPulseBeats(best.cand.pulse, fs, bpm, artefactMask);
  return {
    ...result,
    status: 'valid',
    bpm,
    reason: null,
    failure: null,
    path,
    best: { method: best.cand.method, region: best.cand.region },
    snrDb: round(best.snrDb, 2),
    beats,
  };
}

function round(v: number, dp: number): number {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
}
