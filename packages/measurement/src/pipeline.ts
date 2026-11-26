import { ALGORITHM_NAME, CONFIG_VERSION, PIPELINE_CONFIG, PIPELINE_VERSION } from './config';
import { mean, median, resampleUniform } from './dsp';
import { estimateBreathing, estimateHeartRate, estimateHrv } from './estimators';
import { pos } from './pos';
import type {
  FrameSample,
  MetricId,
  MetricProvenance,
  MetricResult,
  SessionOutcome,
  SessionResult,
  SignalDiagnostics,
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

/** Longest run of usable frames with no gap above `maxGapSec`. */
export function longestUsableSegment(frames: FrameSample[]): FrameSample[] {
  let best: FrameSample[] = [];
  let cur: FrameSample[] = [];
  for (const f of frames) {
    if (!f.usable || !f.roi) {
      if (cur.length > best.length) best = cur;
      cur = [];
      continue;
    }
    const last = cur[cur.length - 1];
    if (last && (f.t - last.t) / 1000 > cfg.maxGapSec) {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
    cur.push(f);
  }
  if (cur.length > best.length) best = cur;
  return best;
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
  };
}

/**
 * Run the full rPPG analysis over captured frame samples and return one
 * result per metric. Each metric passes or abstains independently.
 */
export function analyzeSession(
  frames: FrameSample[],
  opts: { cancelled?: boolean } = {},
): SessionResult {
  const base = { pipelineVersion: PIPELINE_VERSION, configVersion: CONFIG_VERSION };
  const seg = longestUsableSegment(frames);
  const diagnostics = computeDiagnostics(frames, seg);
  const unsupported = [
    unavailable('spo2', 'unsupported_method'),
    unavailable('blood_pressure', 'unsupported_method'),
  ];

  if (opts.cancelled) {
    return {
      ...base,
      outcome: 'cancelled',
      diagnostics,
      metrics: [...SUPPORTED_METRICS.map((m) => unavailable(m, 'cancelled')), ...unsupported],
    };
  }

  const fs = cfg.sampleRateHz;
  const dur = diagnostics.usableDurationSec;
  const results = new Map<MetricId, MetricResult>();

  if (dur < cfg.minHrDurationSec) {
    for (const m of SUPPORTED_METRICS) results.set(m, unavailable(m, 'insufficient_duration'));
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
    diagnostics.ibiCount = beats?.ibiCount ?? 0;
    diagnostics.ibiAcceptedFraction = beats ? round(beats.acceptedFraction, 3) : null;
    if (!hr || !hrOk) {
      for (const m of SUPPORTED_METRICS) results.set(m, unavailable(m, 'low_signal_quality'));
    } else {
      const hrQuality = 0.5 + 0.5 * Math.min(1, Math.max(0, (hr.snrDb - cfg.minHrSnrDb) / 8));
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

  const metrics = [...SUPPORTED_METRICS.map((m) => results.get(m)!), ...unsupported];
  const validCount = metrics.filter((m) => m.status === 'valid').length;
  const outcome: SessionOutcome =
    validCount === SUPPORTED_METRICS.length ? 'completed' : validCount > 0 ? 'partial' : 'failed';
  return { ...base, outcome, metrics, diagnostics };
}

function round(v: number, dp: number): number {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
}
