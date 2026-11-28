import {
  ACQUISITION,
  acquisitionReport,
  analyzeFrameTiming,
  detectWindowArtefacts,
  monotonicFrames,
  resampleWithMask,
  type AcquisitionReport,
} from './acquisition';
import { ALGORITHM_NAME, CONFIG_VERSION, PIPELINE_CONFIG, PIPELINE_VERSION } from './config';
import { bandpass, mean, median, resampleUniform, std } from './dsp';
import { HR_FUSION, fuseHeartRate } from './hrFusion';
import { MOTION_BREATHING } from './motionBreathing';
import { PRV, type BeatAnalysis } from './prv';
import { buildQuality, component, type QualityComponent, type QualityComponentId } from './quality';
import { RESPIRATION, estimateRespiration, type RespirationEstimate } from './respiration';
import { buildCandidates, regionSeries } from './rppg';
import {
  consensusHeartRate,
  estimateBreathing,
  estimateHeartRate,
  estimateHrv,
  snrAt,
} from './estimators';
import { pos } from './pos';
import { pbv } from './pbv';
import { EXPERIMENTAL_SPO2, estimateExperimentalSpo2 } from './experimentalSpo2';
import { estimateMotionBreathing } from './motionBreathing';
import type {
  AcquisitionDiagnostics,
  BreathingModulation,
  CaptureDiagnostics,
  LegacyDiagnostics,
  MotionBreathingDiagnostics,
  FrameSample,
  MetricId,
  MetricProvenance,
  MetricResult,
  SessionOutcome,
  SessionResult,
  SignalDiagnostics,
  SignalStatsDiagnostics,
  UnavailableReason,
} from './types';
import { METRIC_UNITS } from './types';

const cfg = PIPELINE_CONFIG;

/** Metrics this pipeline can attempt. SpO2 and BP are not supported by RGB rPPG. */
export const SUPPORTED_METRICS: readonly MetricId[] = ['heart_rate', 'hrv', 'breathing_rate'];

const PROVENANCE: MetricProvenance = {
  method: 'camera_rppg',
  algorithm: ALGORITHM_NAME,
  version: PIPELINE_VERSION,
  source: 'measured',
  validation: 'unvalidated',
};

/** Estimator that attempted each metric, so an abstention names the algorithm that abstained. */
const METRIC_ALGORITHM: Partial<Record<MetricId, string>> = {
  heart_rate: HR_FUSION.algorithm,
  hrv: PRV.algorithm,
  breathing_rate: RESPIRATION.algorithm,
};

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
    qualityFlags: flags,
    reason,
    provenance: { ...PROVENANCE, algorithm: METRIC_ALGORITHM[metric] ?? ALGORITHM_NAME },
  };
}

function valid(
  metric: MetricId,
  value: number,
  qualityScore: number,
  flags: string[] = [],
): MetricResult {
  return {
    metric,
    status: 'valid',
    value,
    valueSecondary: null,
    unit: METRIC_UNITS[metric],
    qualityScore: Math.max(0, Math.min(1, qualityScore)),
    qualityFlags: flags,
    reason: null,
    provenance: PROVENANCE,
  };
}

/**
 * Longest run of usable frames in which consecutive usable frames are never
 * more than `maxGapSec` apart. An isolated unusable frame (a missed face
 * detection, one dark frame) is skipped and bridged by resampling, as long as
 * the gap it leaves stays within `maxGapSec`; longer interruptions split the
 * signal.
 */
export function longestUsableSegment(frames: FrameSample[]): FrameSample[] {
  let best: FrameSample[] = [];
  let cur: FrameSample[] = [];
  for (const f of frames) {
    if (!f.usable || !f.roi) continue;
    const last = cur[cur.length - 1];
    if (last && ((f.t - last.t) / 1000 > cfg.maxGapSec || isColourStep(last, f))) {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
    cur.push(f);
  }
  if (cur.length > best.length) best = cur;
  return best;
}

/**
 * A jump in mean skin colour far larger than any pulse (<1%) between two
 * analysed frames: auto-exposure or white balance still settling (phones
 * ramp brightness by 5-17% per frame for the first second), or a lighting
 * change. The signal is split there instead of analysed across the step.
 */
function isColourStep(a: FrameSample, b: FrameSample): boolean {
  const x = a.roi!;
  const y = b.roi!;
  const rel = (p: number, q: number) => (p > 0 ? Math.abs(q - p) / p : 0);
  return Math.max(rel(x.r, y.r), rel(x.g, y.g), rel(x.b, y.b)) > cfg.maxColourStep;
}

function segDuration(seg: FrameSample[]): number {
  return seg.length > 1 ? (seg[seg.length - 1]!.t - seg[0]!.t) / 1000 : 0;
}

export function computeDiagnostics(frames: FrameSample[], seg: FrameSample[]): SignalDiagnostics {
  const dts: number[] = [];
  for (let i = 1; i < frames.length; i++) dts.push(frames[i]!.t - frames[i - 1]!.t);
  const md = dts.length ? median(dts) : 0;
  const dropped = md > 0 ? dts.filter((d) => d > 2.5 * md).length / dts.length : 0;
  return {
    durationSec: segDuration(frames),
    usableDurationSec: segDuration(seg),
    sampleRateHz: cfg.sampleRateHz,
    droppedFrameFraction: dropped,
    usableFrameFraction: frames.length ? frames.filter((f) => f.usable).length / frames.length : 0,
    hrSnrDb: null,
    ibiCount: 0,
    ibiAcceptedFraction: null,
    capture: captureDiagnostics(frames, md),
  };
}

function captureDiagnostics(frames: FrameSample[], medianIntervalMs: number): CaptureDiagnostics {
  const flagCounts: CaptureDiagnostics['flagCounts'] = {};
  let roiFrames = 0;
  let luma = 0;
  let skin = 0;
  for (const f of frames) {
    for (const fl of f.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1;
    if (f.roi) {
      roiFrames++;
      luma += f.roi.luma;
      skin += f.roi.skinPixels;
    }
  }
  return {
    frameCount: frames.length,
    medianFrameIntervalMs: round(medianIntervalMs, 1),
    flagCounts,
    roiFrames,
    meanLuma: roiFrames ? round(luma / roiFrames, 1) : null,
    meanSkinPixels: roiFrames ? Math.round(skin / roiFrames) : null,
  };
}

/**
 * Run the full rPPG analysis over captured frame samples and return one
 * result per metric. Each metric passes or abstains independently.
 */
export interface AnalyzeOptions {
  cancelled?: boolean;
  /** Opt-in experimental SpO2 (ADR 0008). Off by default. */
  experimentalSpo2?: boolean;
  /**
   * Interim (live) analysis: skips the legacy comparison, raw-signal
   * statistics and experimental SpO2, which only the final result needs.
   */
  interim?: boolean;
  /**
   * With `interim`: still fuse every usable region, as the final analysis
   * does. The session uses it for the finish decision once the target length
   * is reached, so that a scan the final analysis would accept is not
   * extended just because the pooled ROI alone fell short.
   */
  interimRegions?: boolean;
  /**
   * Keep detected beat times (seconds on the capture clock) in
   * diagnostics.prv.beatTimesSec, for the offline validation harness.
   */
  keepBeats?: boolean;
}

const EXPERIMENTAL_PROVENANCE: MetricProvenance = {
  method: 'camera_experimental',
  algorithm: EXPERIMENTAL_SPO2.algorithm,
  version: EXPERIMENTAL_SPO2.version,
  source: 'measured',
  validation: 'unvalidated',
};

function experimentalUnavailable(reason: UnavailableReason, flags: string[]): MetricResult {
  return {
    ...unavailable('spo2', reason, ['experimental', ...flags]),
    provenance: EXPERIMENTAL_PROVENANCE,
  };
}

export function analyzeSession(frames: FrameSample[], opts: AnalyzeOptions = {}): SessionResult {
  const base = { pipelineVersion: PIPELINE_VERSION, configVersion: CONFIG_VERSION };
  // Out-of-order or repeated timestamps are dropped (and counted) first.
  const ordered = monotonicFrames(frames);
  const seg = longestUsableSegment(ordered);
  const diagnostics = computeDiagnostics(ordered, seg);
  const timing = analyzeFrameTiming(frames.map((f) => f.t));
  diagnostics.droppedFrameFraction = round(timing.droppedFrameFraction, 4);
  let spo2Result: MetricResult = unavailable('spo2', 'unsupported_method');
  const unsupported = () => [spo2Result, unavailable('blood_pressure', 'unsupported_method')];

  if (opts.cancelled) {
    return {
      ...base,
      outcome: 'cancelled',
      diagnostics,
      metrics: [...SUPPORTED_METRICS.map((m) => unavailable(m, 'cancelled')), ...unsupported()],
    };
  }

  const fs = cfg.sampleRateHz;
  const dur = diagnostics.usableDurationSec;
  const results = new Map<MetricId, MetricResult>();
  const acqOnly = acquisitionReport(ordered, seg, null, null);
  diagnostics.acquisition = acquisitionDiagnostics(acqOnly);

  if (dur < cfg.minHrDurationSec) {
    for (const m of SUPPORTED_METRICS)
      results.set(
        m,
        withQuality(unavailable(m, 'insufficient_duration'), dur, 'too_short', {
          recording_duration: component(dur, 's', `>= ${durationGate(m)} s`, false),
        }),
      );
    if (opts.experimentalSpo2)
      spo2Result = experimentalUnavailable('insufficient_duration', ['too_short']);
  } else {
    const t = seg.map((f) => f.t / 1000);
    const series = resampleWithMask(
      t,
      [seg.map((f) => f.roi!.r), seg.map((f) => f.roi!.g), seg.map((f) => f.roi!.b)],
      fs,
    );
    const [r, g, b] = series.channels as [number[], number[], number[]];
    const windows = detectWindowArtefacts(seg, series, HR_FUSION.windowSec, HR_FUSION.hopSec);
    const acq = acquisitionReport(ordered, seg, series, windows);
    diagnostics.acquisition = acquisitionDiagnostics(acq);
    if (!opts.interim) {
      diagnostics.signal = signalStats(seg, g, fs);
      diagnostics.legacy = legacyAnalysis(r, g, b, fs, dur, diagnostics);
    }

    // Per-sample artefact mask: interpolated runs longer than
    // QUALITY_GATES.maxBridgedGapSec (a peak could be lost there) plus every
    // sample of a rejected window (conservative: beats near an artefact are
    // not used). A single missing frame is bridged; it shifts a peak by at
    // most a fraction of one frame interval, which PRV's own interpolated
    // share limit already bounds.
    const mask = longInterpolatedRuns(
      series.interpolated,
      Math.round(QUALITY_GATES.maxBridgedGapSec * fs),
    );
    windows.starts.forEach((s, i) => {
      if (!windows.artefact[i]) return;
      const i0 = Math.round(s * fs);
      const i1 = Math.min(mask.length, Math.round((s + HR_FUSION.windowSec) * fs));
      for (let k = i0; k < i1; k++) mask[k] = true;
    });

    // Interim (live) updates use the pooled ROI only, to keep the JS thread
    // light; the final analysis adds every usable region.
    const regions =
      acq.regions && (!opts.interim || opts.interimRegions)
        ? regionSeries(seg, acq.regions.usable, series.t0, fs, r.length)
        : [];
    const candidates = buildCandidates({ r, g, b }, regions, fs, HR_FUSION.methods);
    const hr = fuseHeartRate(candidates, fs, windows, mask);
    const { beats: _beats, ...hrDiag } = hr;
    diagnostics.hrFusion = hrDiag;
    diagnostics.hrSnrDb = hr.snrDb;
    const segFps = acq.segmentTiming?.medianFps ?? acq.timing.medianFps;
    const artefactShare = windows.artefact.length
      ? windows.artefact.filter((x) => x !== null).length / windows.artefact.length
      : 0;
    const share = (k: string) => acq.windowArtefacts[k as keyof typeof acq.windowArtefacts] ?? 0;
    const methodSupport = Object.values(hr.methods).filter((x) => x.supports).length;
    const regionCount = Object.keys(hr.regions).length;
    const regionSupport = Object.values(hr.regions).filter((x) => x.supports).length;
    const hrComponents: Partial<Record<QualityComponentId, QualityComponent>> = {
      recording_duration: component(dur, 's', `>= ${cfg.minHrDurationSec} s`, true),
      effective_sample_rate: component(
        segFps,
        'fps',
        `>= ${QUALITY_GATES.minHrFps} fps`,
        segFps >= QUALITY_GATES.minHrFps,
      ),
      dropped_frames: component(
        100 * timing.droppedFrameFraction,
        '%',
        `<= ${100 * QUALITY_GATES.maxHrDroppedFraction} %`,
        timing.droppedFrameFraction <= QUALITY_GATES.maxHrDroppedFraction,
      ),
      interpolated_signal: component(
        100 * series.interpolatedFraction,
        '%',
        `<= ${100 * ACQUISITION.maxInterpolatedFraction} %`,
        series.interpolatedFraction <= ACQUISITION.maxInterpolatedFraction,
      ),
      lighting: component(
        100 * (share('sudden_lighting_change') + share('lighting_unstable')),
        '% windows',
        `artefact windows <= ${100 * HR_FUSION.maxArtefactShare} % (all causes)`,
        artefactShare <= HR_FUSION.maxArtefactShare,
      ),
      motion: component(
        100 * share('face_motion'),
        '% windows',
        `artefact windows <= ${100 * HR_FUSION.maxArtefactShare} % (all causes)`,
        artefactShare <= HR_FUSION.maxArtefactShare,
      ),
      roi_stability: component(100 * share('roi_unstable'), '% windows', 'informational', null),
      face_tracking: component(acq.faceJitterPct, '% face width', 'informational', null),
      pulse_snr: component(
        hr.snrDb,
        'dB',
        hr.path === 'spectral'
          ? `fused >= ${HR_FUSION.spectral.minSnrDb} dB`
          : `>= ${HR_FUSION.minConsensusSnrDb} dB with window consensus`,
        hr.status === 'valid'
          ? true
          : hr.failure === 'weak_signal' || hr.failure === 'no_peak'
            ? false
            : null,
      ),
      spectral_peak: component(hr.prominence, 'x median', 'informational', null),
      algorithm_agreement: component(
        methodSupport,
        'methods',
        `>= ${HR_FUSION.minMethodSupport} methods agree, none conflicts`,
        hr.failure === 'methods_disagree' ? false : hr.status === 'valid' ? true : null,
      ),
      region_agreement: component(
        regionCount ? regionSupport : null,
        'regions',
        regionCount >= 2
          ? `>= ${HR_FUSION.minRegionSupport} regions agree, none conflicts`
          : 'fewer than 2 usable regions',
        hr.failure === 'regions_disagree'
          ? false
          : hr.status === 'valid' && regionCount >= 2
            ? true
            : null,
      ),
    };
    // A hard acquisition gate overrides an otherwise passing fusion.
    const acqFailure =
      segFps < QUALITY_GATES.minHrFps
        ? 'low_frame_rate'
        : series.interpolatedFraction > ACQUISITION.maxInterpolatedFraction
          ? 'excessive_interpolation'
          : timing.droppedFrameFraction > QUALITY_GATES.maxHrDroppedFraction
            ? 'frames_dropped'
            : null;
    const hrValid = hr.status === 'valid' && hr.bpm !== null && !acqFailure;
    const hrMargins = [
      (hr.snrDb ?? -99) >=
        (hr.path === 'spectral' ? HR_FUSION.spectral.minSnrDb : HR_FUSION.minConsensusSnrDb) + 6,
      artefactShare === 0,
      timing.droppedFrameFraction <= 0.02,
      series.interpolatedFraction <= 0.02,
      segFps >= 25,
      regionCount < 2 || regionSupport >= 2,
    ];
    if (!hrValid) {
      const reason: UnavailableReason = acqFailure
        ? 'low_signal_quality'
        : (hr.reason ?? 'low_signal_quality');
      const failure = acqFailure ?? hr.failure ?? 'weak_signal';
      for (const m of SUPPORTED_METRICS)
        results.set(
          m,
          withQuality(
            unavailable(m, reason, [failure]),
            dur,
            failure,
            m === 'heart_rate' ? hrComponents : {},
          ),
        );
      if (opts.experimentalSpo2)
        spo2Result = experimentalUnavailable('low_signal_quality', ['heart_rate_gate']);
    } else {
      const hrBpm = hr.bpm!;
      const hrSnr = hr.snrDb ?? HR_FUSION.minConsensusSnrDb;
      const hrQuality = hrQualityFor(hrSnr);
      const best = candidates.find(
        (c) => c.method === hr.best?.method && c.region === hr.best?.region,
      );
      results.set(
        'heart_rate',
        withQuality(
          {
            ...valid('heart_rate', round(hrBpm, 0), hrQuality, [
              hr.path === 'spectral' ? 'spectral' : 'window_consensus',
            ]),
            provenance: { ...PROVENANCE, algorithm: HR_FUSION.algorithm },
          },
          dur,
          null,
          hrComponents,
          hrMargins,
        ),
      );
      if (opts.experimentalSpo2 && !opts.interim) {
        const s = estimateExperimentalSpo2(r, b, best?.pulse ?? candidates[0]!.pulse, fs);
        diagnostics.experimentalSpo2 = {
          ratio: s.ratio === null ? null : round(s.ratio, 4),
          acceptedFraction: round(s.acceptedFraction, 3),
          iqr: s.iqr === null ? null : round(s.iqr, 2),
          failure: s.failure,
        };
        spo2Result =
          s.value !== null
            ? {
                ...valid('spo2', s.value, hrQuality * s.acceptedFraction, ['experimental']),
                provenance: EXPERIMENTAL_PROVENANCE,
              }
            : s.failure === 'out_of_range'
              ? {
                  ...experimentalUnavailable('out_of_operating_range', ['out_of_range']),
                  status: 'invalid',
                }
              : experimentalUnavailable(
                  s.failure === 'too_short' ? 'insufficient_duration' : 'low_signal_quality',
                  [s.failure ?? 'weak_pulse'],
                );
      }

      // Pulse-rate variability (stored as metric 'hrv' for compatibility).
      const beats = hr.beats;
      if (beats) {
        diagnostics.ibiCount = beats.intervals.length;
        diagnostics.ibiAcceptedFraction = round(beats.acceptedFraction, 3);
        diagnostics.prv = {
          kind: 'pulse_rate_variability',
          beats: beats.beats.length,
          acceptedIntervals: beats.acceptedCount,
          rejectedIntervals: beats.rejectedCount,
          rejectedByReason: beats.rejectedByReason,
          falsePeaksRemoved: beats.falsePeaksRemoved,
          successivePairs: beats.successivePairs,
          rmssdMs: beats.rmssdMs === null ? null : round(beats.rmssdMs, 1),
          sdnnMs: beats.sdnnMs === null ? null : round(beats.sdnnMs, 1),
          meanRateBpm: beats.meanRateBpm === null ? null : round(beats.meanRateBpm, 1),
          polarity: beats.polarity,
          source: hr.best,
        };
        if (opts.keepBeats) {
          diagnostics.prv.beatTimesSec = beats.beats.map((x) => round(series.t0 + x, 4));
          diagnostics.prv.intervals = beats.intervals.map((iv) => ({
            t: round(series.t0 + iv.t, 4),
            ibi: round(iv.ibi, 4),
            status: iv.status,
          }));
        }
      }
      results.set(
        'hrv',
        prvResult(
          beats,
          hrBpm,
          hr.snrDb,
          dur,
          segFps,
          timing.droppedFrameFraction,
          series.interpolatedFraction,
        ),
      );

      // Breathing rate: independent respiratory signals (respiration.ts),
      // with head motion as one of them.
      const motion = dur >= cfg.minBreathingDurationSec ? estimateMotionBreathing(seg) : null;
      if (motion) diagnostics.motionBreathing = motion;
      const gm = mean(g);
      const intensity = g.map((v) => v / gm - 1);
      const extra: BreathingModulation[] =
        motion && motion.perMin !== null
          ? [{ name: 'head_motion', perMin: motion.perMin, concentration: motion.concentration }]
          : [];
      const resp =
        dur >= cfg.minBreathingDurationSec
          ? estimateRespiration(beats, intensity, fs, extra)
          : null;
      if (resp) diagnostics.respiration = resp;
      results.set('breathing_rate', breathingResult(resp, motion, dur));
    }
  }

  // Breathing from head movement alone, on its own stricter gates (ADR 0010):
  // independent of the colour pulse, so it can pass when the pulse is too
  // faint for the colour-derived respiratory signals.
  if (dur >= cfg.minBreathingDurationSec && results.get('breathing_rate')?.status !== 'valid') {
    const motion = diagnostics.motionBreathing ?? estimateMotionBreathing(seg);
    if (motion) diagnostics.motionBreathing = motion;
    if (motion?.passed && motion.perMin !== null)
      results.set(
        'breathing_rate',
        withQuality(
          {
            ...valid(
              'breathing_rate',
              round(motion.perMin, 0),
              motion.concentration * motion.agreement,
              ['head_motion'],
            ),
            provenance: { ...PROVENANCE, algorithm: MOTION_BREATHING.algorithm },
          },
          dur,
          null,
          {
            recording_duration: component(dur, 's', `>= ${cfg.minBreathingDurationSec} s`, true),
            respiratory_agreement: component(
              motion.agreement,
              'share of 20 s windows',
              `>= ${MOTION_BREATHING.minAgreement}`,
              true,
            ),
          },
          [false],
        ),
      );
  }

  const metrics = [...SUPPORTED_METRICS.map((m) => results.get(m)!), ...unsupported()];
  // Outcome depends only on the pipeline's own metrics, never on experimental or SDK ones.
  const validCount = SUPPORTED_METRICS.filter((m) => results.get(m)!.status === 'valid').length;
  const outcome: SessionOutcome =
    validCount === SUPPORTED_METRICS.length ? 'completed' : validCount > 0 ? 'partial' : 'failed';
  return { ...base, outcome, metrics, diagnostics };
}

/** Hard gates of the quality model that are not part of a single estimator. */
export const QUALITY_GATES = {
  /** HR needs at least this median frame rate (Nyquist 5 Hz, above the 3 Hz band). */
  minHrFps: 10,
  maxHrDroppedFraction: 0.25,
  /** PRV needs regular, fast frames for beat timing. */
  minPrvFps: ACQUISITION.minFps,
  maxPrvDroppedFraction: ACQUISITION.maxDroppedFraction,
  maxPrvInterpolatedFraction: 0.05,
  /** Interpolated runs up to this long are bridged for beat detection; longer ones are artefacts. */
  maxBridgedGapSec: 0.1,
} as const;

/** Mask of the interpolated runs longer than `maxRun` samples. */
export function longInterpolatedRuns(interpolated: boolean[], maxRun: number): boolean[] {
  const out = new Array<boolean>(interpolated.length).fill(false);
  for (let i = 0; i < interpolated.length;) {
    if (!interpolated[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < interpolated.length && interpolated[j]) j++;
    if (j - i > maxRun) for (let k = i; k < j; k++) out[k] = true;
    i = j;
  }
  return out;
}

function durationGate(m: MetricId): number {
  return m === 'heart_rate'
    ? cfg.minHrDurationSec
    : m === 'hrv'
      ? cfg.minHrvDurationSec
      : cfg.minBreathingDurationSec;
}

function withQuality(
  res: MetricResult,
  durationSec: number,
  abstention: string | null,
  components: Partial<Record<QualityComponentId, QualityComponent>>,
  margins: boolean[] = [],
): MetricResult {
  const quality = buildQuality(
    res.status,
    res.reason,
    abstention,
    durationSec,
    res.provenance.algorithm,
    res.provenance.version,
    components,
    margins,
  );
  const flags =
    res.status === 'valid' ? [...res.qualityFlags, `grade_${quality.grade}`] : res.qualityFlags;
  return { ...res, qualityFlags: flags, quality };
}

function prvResult(
  beats: BeatAnalysis | null,
  hrBpm: number,
  snrDb: number | null,
  dur: number,
  fps: number,
  dropped: number,
  interpolated: number,
): MetricResult {
  const prov = { ...PROVENANCE, algorithm: PRV.algorithm };
  const mk = (reason: UnavailableReason, failure: string) => ({
    ...unavailable('hrv', reason, ['pulse_rate_variability', failure]),
    provenance: prov,
  });
  const accepted = beats?.acceptedCount ?? 0;
  const comps: Partial<Record<QualityComponentId, QualityComponent>> = {
    recording_duration: component(
      dur,
      's',
      `>= ${cfg.minHrvDurationSec} s`,
      dur >= cfg.minHrvDurationSec,
    ),
    effective_sample_rate: component(
      fps,
      'fps',
      `>= ${QUALITY_GATES.minPrvFps} fps`,
      fps >= QUALITY_GATES.minPrvFps,
    ),
    dropped_frames: component(
      100 * dropped,
      '%',
      `<= ${100 * QUALITY_GATES.maxPrvDroppedFraction} %`,
      dropped <= QUALITY_GATES.maxPrvDroppedFraction,
    ),
    interpolated_signal: component(
      100 * interpolated,
      '%',
      `<= ${100 * QUALITY_GATES.maxPrvInterpolatedFraction} %`,
      interpolated <= QUALITY_GATES.maxPrvInterpolatedFraction,
    ),
    pulse_snr: component(
      snrDb,
      'dB',
      `>= ${cfg.minHrvSnrDb} dB`,
      snrDb !== null && snrDb >= cfg.minHrvSnrDb,
    ),
    beat_intervals: component(
      accepted,
      'accepted intervals',
      `>= ${cfg.minIbiCount} and >= ${100 * cfg.minIbiAcceptedFraction}% accepted`,
      !!beats &&
        accepted >= cfg.minIbiCount &&
        beats.acceptedFraction >= cfg.minIbiAcceptedFraction,
    ),
  };
  const failed = Object.entries(comps).find(([, c]) => c?.pass === false)?.[0];
  if (dur < cfg.minHrvDurationSec)
    return withQuality(mk('insufficient_duration', 'too_short'), dur, 'too_short', comps);
  if (failed || !beats || beats.rmssdMs === null)
    return withQuality(
      mk('low_signal_quality', failed ?? 'no_beats'),
      dur,
      failed ?? 'no_beats',
      comps,
    );
  if (beats.meanRateBpm === null || Math.abs(beats.meanRateBpm - hrBpm) > cfg.hrvHrAgreementBpm)
    return withQuality(
      mk('inconsistent_estimates', 'beat_rate_disagrees'),
      dur,
      'beat_rate_disagrees',
      comps,
    );
  if (beats.rmssdMs < cfg.hrvRangeMs[0] || beats.rmssdMs > cfg.hrvRangeMs[1])
    return withQuality(
      mk('out_of_operating_range', 'rmssd_out_of_range'),
      dur,
      'rmssd_out_of_range',
      comps,
    );
  const res: MetricResult = {
    ...valid('hrv', round(beats.rmssdMs, 0), hrQualityFor(snrDb ?? 0) * beats.acceptedFraction, [
      'pulse_rate_variability',
    ]),
    valueSecondary: beats.sdnnMs === null ? null : round(beats.sdnnMs, 0),
    provenance: prov,
  };
  return withQuality(res, dur, null, comps, [
    (snrDb ?? 0) >= cfg.minHrvSnrDb + 6,
    beats.acceptedFraction >= 0.95,
    fps >= 25,
    dropped <= 0.02,
  ]);
}

function breathingResult(
  resp: RespirationEstimate | null,
  motion: MotionBreathingDiagnostics | null,
  dur: number,
): MetricResult {
  const prov = { ...PROVENANCE, algorithm: RESPIRATION.algorithm };
  const comps: Partial<Record<QualityComponentId, QualityComponent>> = {
    recording_duration: component(
      dur,
      's',
      `>= ${cfg.minBreathingDurationSec} s`,
      dur >= cfg.minBreathingDurationSec,
    ),
    respiratory_agreement: component(
      resp?.agreeing.length ?? 0,
      'signals',
      `>= 2 clear signals within ${RESPIRATION.agreementPerMin} /min`,
      resp ? resp.perMin !== null : null,
    ),
  };
  if (!resp || dur < cfg.minBreathingDurationSec)
    return withQuality(
      {
        ...unavailable('breathing_rate', 'insufficient_duration', ['too_short']),
        provenance: prov,
      },
      dur,
      'too_short',
      comps,
    );
  if (resp.perMin === null) {
    const reason: UnavailableReason =
      resp.failure === 'signals_disagree' ? 'inconsistent_estimates' : 'low_signal_quality';
    return withQuality(
      {
        ...unavailable('breathing_rate', reason, [resp.failure ?? 'no_clear_signal']),
        provenance: prov,
      },
      dur,
      resp.failure,
      comps,
    );
  }
  void motion;
  const clarity = Math.min(
    ...resp.signals.filter((m) => resp.agreeing.includes(m.name)).map((m) => m.concentration),
  );
  return withQuality(
    {
      ...valid(
        'breathing_rate',
        round(resp.perMin, 0),
        clarity,
        resp.agreeing.map((n) => `resp_${n}`),
      ),
      provenance: prov,
    },
    dur,
    null,
    comps,
    [resp.agreeing.length >= 3, clarity >= 0.7],
  );
}

function acquisitionDiagnostics(a: AcquisitionReport): AcquisitionDiagnostics {
  const st = a.segmentTiming ?? a.timing;
  const windowArtefacts: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.windowArtefacts)) windowArtefacts[k] = round(v ?? 0, 3);
  return {
    measuredFps: round(a.timing.measuredFps, 2),
    medianFps: round(st.medianFps, 2),
    intervalCv: round(st.intervalCv, 3),
    droppedFramePct: round(100 * a.timing.droppedFrameFraction, 2),
    longestGapMs: round(a.timing.longestGapMs, 1),
    nonMonotonicTimestamps: a.timing.nonMonotonic,
    interpolatedPct: round(100 * a.interpolatedFraction, 2),
    maxIntensityStepPct: round(a.maxIntensityStepPct, 2),
    faceJitterPct: a.faceJitterPct === null ? null : round(a.faceJitterPct, 2),
    regionUsableFraction: a.regions ? a.regions.usableFraction.map((v) => round(v, 3)) : null,
    regionProblem: a.regions ? a.regions.problem : null,
    windowArtefacts,
    flags: a.flags,
  };
}

/**
 * The v0.3 estimators (POS spectral OR PBV consensus, peak-based RMSSD,
 * RIFV + green-RIIV breathing), recorded for comparison only. They no longer
 * decide any reported value. Also fills the v0.3 `hrGate` diagnostics block
 * that the scan-details screen reads.
 */
function legacyAnalysis(
  r: number[],
  g: number[],
  b: number[],
  fs: number,
  dur: number,
  diagnostics: SignalDiagnostics,
): LegacyDiagnostics {
  const h = pos(r, g, b, Math.round(cfg.posWindowSec * fs));
  const hr = estimateHeartRate(h, fs);
  const beats = hr ? estimateHrv(hr.pulse, fs, hr.bpm) : null;
  const pbvPulse = pbv(r, g, b, Math.round(cfg.hrPbvWindowSec * fs), fs, cfg.hrBandHz);
  const cons = consensusHeartRate(pbvPulse, fs);
  const consSnr = cons ? snrAt(pbvPulse, fs, cons.bpm / 60) : null;
  const consensusOk =
    !!cons &&
    consSnr !== null &&
    cons.agreement >= cons.required &&
    consSnr >= cfg.minHrSnrDb &&
    cons.bpm >= 42 &&
    cons.bpm <= 180;
  const spectralOk =
    !!hr &&
    hr.snrDb >= cfg.minSpectralHrSnrDb &&
    hr.halvesDiffBpm <= cfg.hrHalvesAgreementBpm &&
    hr.bpm >= 42 &&
    hr.bpm <= 180 &&
    !!beats &&
    beats.acceptedFraction >= cfg.minHrBeatAcceptedFraction &&
    Math.abs(beats.meanHrBpm - hr.bpm) <= cfg.hrvHrAgreementBpm;
  const acceptedBy = spectralOk ? 'spectral' : consensusOk ? 'consensus' : null;
  const hrBpm = spectralOk ? hr!.bpm : consensusOk ? cons!.bpm : null;
  if (hr) {
    diagnostics.hrGate = {
      bpm: round(hr.bpm, 1),
      snrDb: round(hr.snrDb, 2),
      halvesDiffBpm: Number.isFinite(hr.halvesDiffBpm) ? round(hr.halvesDiffBpm, 1) : -1,
      beatAcceptedFraction: beats ? round(beats.acceptedFraction, 3) : null,
      beatMeanHrBpm: beats ? round(beats.meanHrBpm, 1) : null,
      acceptedBy,
    };
    if (cons && consSnr !== null)
      diagnostics.hrGate.consensus = {
        bpm: round(cons.bpm, 1),
        agreement: round(cons.agreement, 3),
        required: round(cons.required, 3),
        windows: cons.windows,
        snrDb: round(consSnr, 2),
      };
  }
  let rmssdMs: number | null = null;
  if (
    hrBpm !== null &&
    hr &&
    beats &&
    dur >= cfg.minHrvDurationSec &&
    hr.snrDb >= cfg.minHrvSnrDb &&
    beats.ibiCount >= cfg.minIbiCount &&
    beats.acceptedFraction >= cfg.minIbiAcceptedFraction &&
    Math.abs(beats.meanHrBpm - hrBpm) <= cfg.hrvHrAgreementBpm &&
    beats.rmssdMs >= cfg.hrvRangeMs[0] &&
    beats.rmssdMs <= cfg.hrvRangeMs[1]
  )
    rmssdMs = round(beats.rmssdMs, 1);
  let breathingPerMin: number | null = null;
  if (hrBpm !== null && dur >= cfg.minBreathingDurationSec) {
    const gm = mean(g);
    const br = estimateBreathing(
      beats?.ibis ?? null,
      g.map((v) => v / gm - 1),
      fs,
    );
    breathingPerMin = br.perMin === null ? null : round(br.perMin, 1);
  }
  return {
    hrBpm: hrBpm === null ? null : round(hrBpm, 1),
    acceptedBy,
    rmssdMs,
    breathingPerMin,
  };
}

/** Raw-signal statistics that separate "no pulse in the colour" from "pulse buried in noise". */
function signalStats(seg: FrameSample[], g: number[], fs: number): SignalStatsDiagnostics {
  const gm = mean(g);
  const green = estimateHeartRate(g, fs);
  const band = bandpass(g, cfg.hrBandHz[0], cfg.hrBandHz[1], fs);
  let maxStep = 0;
  const dts: number[] = [];
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1]!.roi!.g;
    const b = seg[i]!.roi!.g;
    if (a > 0) maxStep = Math.max(maxStep, Math.abs(b - a) / a);
    dts.push(seg[i]!.t - seg[i - 1]!.t);
  }
  dts.sort((x, y) => x - y);
  const pct = (q: number) =>
    dts.length ? dts[Math.min(dts.length - 1, Math.floor(q * dts.length))]! : 0;
  return {
    greenPeakBpm: green ? round(green.bpm, 1) : null,
    greenSnrDb: green ? round(green.snrDb, 2) : null,
    bandAmplitudePct: gm > 0 ? round((100 * std(band)) / gm, 3) : 0,
    maxStepPct: round(100 * maxStep, 2),
    intervalP10Ms: round(pct(0.1), 1),
    intervalP90Ms: round(pct(0.9), 1),
    regionSnrDb: regionSnr(seg, fs),
  };
}

/** Pulse SNR of each ROI region on its own, when every analysed frame has it. */
function regionSnr(seg: FrameSample[], fs: number): (number | null)[] | undefined {
  const first = seg[0]?.roi?.regions;
  if (!first) return undefined;
  const t = seg.map((f) => f.t / 1000);
  return first.map((_, k) => {
    if (!seg.every((f) => (f.roi!.regions?.[k]?.n ?? 0) > 0)) return null;
    const ch = (c: 'r' | 'g' | 'b') =>
      resampleUniform(
        t,
        seg.map((f) => f.roi!.regions![k]![c]),
        fs,
      );
    const hr = estimateHeartRate(
      pos(ch('r'), ch('g'), ch('b'), Math.round(cfg.posWindowSec * fs)),
      fs,
    );
    return hr ? round(hr.snrDb, 2) : null;
  });
}

function hrQualityFor(snrDb: number): number {
  return 0.5 + 0.5 * Math.min(1, Math.max(0, (snrDb - cfg.minHrSnrDb) / 8));
}

function round(v: number, dp: number): number {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
}
