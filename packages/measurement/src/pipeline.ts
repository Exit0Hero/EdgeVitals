import { ALGORITHM_NAME, CONFIG_VERSION, PIPELINE_CONFIG, PIPELINE_VERSION } from './config';
import { bandpass, mean, median, resampleUniform, std } from './dsp';
import { estimateBreathing, estimateHeartRate, estimateHrv } from './estimators';
import { pos } from './pos';
import { EXPERIMENTAL_SPO2, estimateExperimentalSpo2 } from './experimentalSpo2';
import type {
  CaptureDiagnostics,
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
    provenance: PROVENANCE,
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
  const seg = longestUsableSegment(frames);
  const diagnostics = computeDiagnostics(frames, seg);
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

  if (dur < cfg.minHrDurationSec) {
    for (const m of SUPPORTED_METRICS) results.set(m, unavailable(m, 'insufficient_duration'));
    if (opts.experimentalSpo2)
      spo2Result = experimentalUnavailable('insufficient_duration', ['too_short']);
  } else {
    const t = seg.map((f) => f.t / 1000);
    const r = resampleUniform(
      t,
      seg.map((f) => f.roi!.r),
      fs,
    );
    const g = resampleUniform(
      t,
      seg.map((f) => f.roi!.g),
      fs,
    );
    const b = resampleUniform(
      t,
      seg.map((f) => f.roi!.b),
      fs,
    );
    diagnostics.signal = signalStats(seg, g, fs);
    const h = pos(r, g, b, Math.round(cfg.posWindowSec * fs));
    const hr = estimateHeartRate(h, fs);
    diagnostics.hrSnrDb = hr ? round(hr.snrDb, 2) : null;

    // Beat analysis is shared by the HR consistency gate and HRV.
    const beats = hr ? estimateHrv(hr.pulse, fs, hr.bpm) : null;
    const hrOk =
      !!hr &&
      hr.snrDb >= cfg.minHrSnrDb &&
      hr.halvesDiffBpm <= cfg.hrHalvesAgreementBpm &&
      hr.bpm >= 42 &&
      hr.bpm <= 180 &&
      !!beats &&
      beats.acceptedFraction >= cfg.minHrBeatAcceptedFraction &&
      Math.abs(beats.meanHrBpm - hr.bpm) <= cfg.hrvHrAgreementBpm;
    if (hr) {
      diagnostics.hrGate = {
        bpm: round(hr.bpm, 1),
        snrDb: round(hr.snrDb, 2),
        halvesDiffBpm: Number.isFinite(hr.halvesDiffBpm) ? round(hr.halvesDiffBpm, 1) : -1,
        beatAcceptedFraction: beats ? round(beats.acceptedFraction, 3) : null,
        beatMeanHrBpm: beats ? round(beats.meanHrBpm, 1) : null,
      };
    }
    diagnostics.ibiCount = beats?.ibiCount ?? 0;
    diagnostics.ibiAcceptedFraction = beats ? round(beats.acceptedFraction, 3) : null;
    if (!hr || !hrOk) {
      for (const m of SUPPORTED_METRICS) results.set(m, unavailable(m, 'low_signal_quality'));
      if (opts.experimentalSpo2)
        spo2Result = experimentalUnavailable('low_signal_quality', ['heart_rate_gate']);
    } else {
      if (opts.experimentalSpo2) {
        const s = estimateExperimentalSpo2(r, b, hr.pulse, fs);
        diagnostics.experimentalSpo2 = {
          ratio: s.ratio === null ? null : round(s.ratio, 4),
          acceptedFraction: round(s.acceptedFraction, 3),
          iqr: s.iqr === null ? null : round(s.iqr, 2),
          failure: s.failure,
        };
        spo2Result =
          s.value !== null
            ? {
                ...valid('spo2', s.value, hrQualityFor(hr.snrDb) * s.acceptedFraction, [
                  'experimental',
                ]),
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
      const hrQuality = hrQualityFor(hr.snrDb);
      results.set('heart_rate', valid('heart_rate', round(hr.bpm, 0), hrQuality));

      // HRV
      const hrv = beats;
      if (dur < cfg.minHrvDurationSec) {
        results.set('hrv', unavailable('hrv', 'insufficient_duration'));
      } else {
        if (
          !hrv ||
          hr.snrDb < cfg.minHrvSnrDb ||
          hrv.ibiCount < cfg.minIbiCount ||
          hrv.acceptedFraction < cfg.minIbiAcceptedFraction
        ) {
          results.set('hrv', unavailable('hrv', 'low_signal_quality'));
        } else if (Math.abs(hrv.meanHrBpm - hr.bpm) > cfg.hrvHrAgreementBpm) {
          results.set('hrv', unavailable('hrv', 'inconsistent_estimates'));
        } else if (hrv.rmssdMs < cfg.hrvRangeMs[0] || hrv.rmssdMs > cfg.hrvRangeMs[1]) {
          results.set('hrv', unavailable('hrv', 'out_of_operating_range'));
        } else {
          results.set('hrv', valid('hrv', round(hrv.rmssdMs, 0), hrQuality * hrv.acceptedFraction));
        }
      }

      // Breathing rate
      if (dur < cfg.minBreathingDurationSec) {
        results.set('breathing_rate', unavailable('breathing_rate', 'insufficient_duration'));
      } else {
        const gm = mean(g);
        const intensity = g.map((v) => v / gm - 1);
        const br = estimateBreathing(hrv?.ibis ?? null, intensity, fs);
        if (br.perMin === null) {
          const reason: UnavailableReason =
            br.rifvPerMin !== null && br.riivPerMin !== null
              ? 'inconsistent_estimates'
              : 'low_signal_quality';
          results.set('breathing_rate', unavailable('breathing_rate', reason));
        } else {
          const spread = Math.abs((br.rifvPerMin ?? 0) - (br.riivPerMin ?? 0));
          const q = hrQuality * (1 - spread / (2 * cfg.breathingAgreementPerMin));
          results.set('breathing_rate', valid('breathing_rate', round(br.perMin, 0), q));
        }
      }
    }
  }

  const metrics = [...SUPPORTED_METRICS.map((m) => results.get(m)!), ...unsupported()];
  // Outcome depends only on the pipeline's own metrics, never on experimental or SDK ones.
  const validCount = SUPPORTED_METRICS.filter((m) => results.get(m)!.status === 'valid').length;
  const outcome: SessionOutcome =
    validCount === SUPPORTED_METRICS.length ? 'completed' : validCount > 0 ? 'partial' : 'failed';
  return { ...base, outcome, metrics, diagnostics };
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
  };
}

function hrQualityFor(snrDb: number): number {
  return 0.5 + 0.5 * Math.min(1, Math.max(0, (snrDb - cfg.minHrSnrDb) / 8));
}

function round(v: number, dp: number): number {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
}
