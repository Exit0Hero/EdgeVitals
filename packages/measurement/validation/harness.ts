/**
 * Offline validation harness: runs the measurement engine (and comparison
 * arms) over timestamped recordings and compares every reported value with
 * the reference measurement recorded alongside it.
 *
 * Arms:
 *  - hr:pipeline         final face heart rate (v0.4 fusion, all gates)
 *  - hr:legacy-v0.3      what the v0.3 estimators would have reported
 *  - hr:<method>:<roi>   one extractor on one ROI, whole-segment spectral
 *                        peak with a fixed 3 dB SNR gate. This isolates the
 *                        extractor (POS vs POS v2 vs CHROM vs PBV) and the
 *                        region (combined, forehead, left/right cheek).
 *  - prv:pipeline        pulse intervals vs reference (ECG) intervals, and
 *                        RMSSD vs reference RMSSD
 *  - br:pipeline         breathing rate vs reference
 *  - br:legacy-v0.3      v0.3 breathing estimator
 *
 * Every arm reports coverage (values reported / recordings attempted) next
 * to its error, because an estimator that abstains on hard recordings will
 * look more accurate. Pulseless recordings (reference.pulsePresent false)
 * count every reported value as a false acceptance.
 */
import {
  acquisitionReport,
  detectWindowArtefacts,
  monotonicFrames,
  resampleWithMask,
} from '../src/acquisition';
import { PIPELINE_CONFIG } from '../src/config';
import { peakFrequency, welch } from '../src/dsp';
import { HR_FUSION, snrFromSpectrum } from '../src/hrFusion';
import { analyzeSession, longestUsableSegment } from '../src/pipeline';
import {
  RPPG_METHODS,
  buildCandidates,
  regionSeries,
  type RppgMethod,
  type SignalRegion,
} from '../src/rppg';
import type { FrameSample, SessionResult } from '../src/types';
import { isLabelled, type ValidationRecording } from './recording';
import {
  agreement,
  coverage,
  groupBy,
  rmssdMs,
  type AgreementStats,
  type CoverageStats,
} from './stats';
import { labelFrames } from './synthetic';

export interface ArmOutcome {
  arm: string;
  recordingId: string;
  participantId: string;
  deviceModel: string;
  condition: string;
  source: ValidationRecording['source'];
  estimate: number | null;
  reference: number | null;
  /** The recording had no pulse; any estimate is a false acceptance. */
  pulseless: boolean;
}

export interface IntervalOutcome {
  recordingId: string;
  participantId: string;
  deviceModel: string;
  condition: string;
  /** Detected minus reference interval, ms, for each matched interval. */
  errorsMs: number[];
  /** Detected beats matched to a reference beat / detected beats. */
  matchedFraction: number;
  /** Median detected-minus-reference beat offset (pulse transit delay), ms. */
  offsetMs: number | null;
  rmssdMs: number | null;
  referenceRmssdMs: number | null;
}

export interface ArmSummary {
  arm: string;
  coverage: CoverageStats;
  agreement: AgreementStats;
  falseAcceptances: number;
  pulselessAttempted: number;
  byParticipant: Record<string, AgreementStats & { coverage: number | null }>;
  byDevice: Record<string, AgreementStats & { coverage: number | null }>;
  byCondition: Record<string, AgreementStats & { coverage: number | null }>;
}

export interface ValidationReport {
  generatedAt: string;
  pipelineVersion: string;
  configVersion: string;
  /** true when any recording is synthetic: results are software verification only. */
  synthetic: boolean;
  sources: Record<string, number>;
  recordings: number;
  participants: number;
  arms: ArmSummary[];
  intervals: {
    recordings: number;
    agreement: AgreementStats;
    rmssd: AgreementStats;
    meanMatchedFraction: number | null;
  } | null;
}

function framesOf(rec: ValidationRecording): FrameSample[] {
  return isLabelled(rec.frames) ? rec.frames : labelFrames(rec.frames);
}

/** Whole-segment spectral peak of one extractor on one ROI, with a fixed 3 dB SNR gate. */
function extractorEstimates(frames: FrameSample[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const ordered = monotonicFrames(frames);
  const seg = longestUsableSegment(ordered);
  const fs = PIPELINE_CONFIG.sampleRateHz;
  const dur = seg.length > 1 ? (seg[seg.length - 1]!.t - seg[0]!.t) / 1000 : 0;
  const keys: string[] = [];
  for (const m of RPPG_METHODS)
    for (const r of ['combined', 'forehead', 'left_cheek', 'right_cheek'])
      keys.push(`hr:${m}:${r}`);
  for (const k of keys) out.set(k, null);
  if (dur < PIPELINE_CONFIG.minHrDurationSec) return out;
  const series = resampleWithMask(
    seg.map((f) => f.t / 1000),
    [seg.map((f) => f.roi!.r), seg.map((f) => f.roi!.g), seg.map((f) => f.roi!.b)],
    fs,
  );
  const [r, g, b] = series.channels as [number[], number[], number[]];
  const acq = acquisitionReport(ordered, seg, series, detectWindowArtefacts(seg, series, 10, 2));
  const regions = acq.regions ? regionSeries(seg, acq.regions.usable, series.t0, fs, r.length) : [];
  for (const c of buildCandidates({ r, g, b }, regions, fs, RPPG_METHODS)) {
    const spec = welch(c.pulse, fs, Math.min(12, c.pulse.length / fs), 2048);
    const p = peakFrequency(spec, HR_FUSION.band[0], HR_FUSION.band[1]);
    const ok = p && snrFromSpectrum(spec, p.freq) >= 3;
    out.set(`hr:${c.method}:${c.region}`, ok ? p!.freq * 60 : null);
  }
  return out;
}

/**
 * Match detected pulse beats to reference beats. The pulse arrives at the
 * skin a roughly constant delay after the R-peak, so the median offset is
 * estimated first; each detected beat then matches the reference beat
 * nearest to (beat - offset) within ±150 ms, one to one.
 */
export function matchIntervals(
  detected: number[],
  reference: number[],
  accepted?: boolean[],
): { errorsMs: number[]; matchedFraction: number; offsetMs: number | null } {
  if (detected.length < 2 || reference.length < 2)
    return { errorsMs: [], matchedFraction: 0, offsetMs: null };
  const nearestRef = (t: number) => {
    let best = 0;
    for (let i = 1; i < reference.length; i++)
      if (Math.abs(reference[i]! - t) < Math.abs(reference[best]! - t)) best = i;
    return best;
  };
  // Offset: detected beat minus the latest reference beat before it, within 0.5 s.
  const offs: number[] = [];
  for (const t of detected) {
    let k = -1;
    for (let i = 0; i < reference.length; i++)
      if (reference[i]! <= t && t - reference[i]! < 0.5) k = i;
    if (k >= 0) offs.push(t - reference[k]!);
  }
  if (!offs.length) return { errorsMs: [], matchedFraction: 0, offsetMs: null };
  offs.sort((a, b) => a - b);
  const offset = offs[Math.floor(offs.length / 2)]!;
  const match: (number | null)[] = detected.map((t) => {
    const k = nearestRef(t - offset);
    return Math.abs(reference[k]! - (t - offset)) <= 0.15 ? k : null;
  });
  const errorsMs: number[] = [];
  for (let i = 1; i < detected.length; i++) {
    const a = match[i - 1];
    const b = match[i];
    if (a == null || b == null || b !== a + 1) continue;
    if (accepted && !accepted[i - 1]) continue;
    errorsMs.push(1000 * (detected[i]! - detected[i - 1]! - (reference[b]! - reference[a]!)));
  }
  return {
    errorsMs,
    matchedFraction: match.filter((m) => m !== null).length / detected.length,
    offsetMs: 1000 * offset,
  };
}

export interface RunOptions {
  /** Include the per-extractor / per-ROI comparison arms (slower). Default true. */
  extractors?: boolean;
}

export function runRecording(
  rec: ValidationRecording,
  opts: RunOptions = {},
): {
  outcomes: ArmOutcome[];
  intervals: IntervalOutcome | null;
  result: SessionResult;
} {
  const frames = framesOf(rec);
  const result = analyzeSession(frames, { keepBeats: true });
  const pulseless = rec.reference.pulsePresent === false;
  const ref = rec.reference;
  const base = {
    recordingId: rec.id,
    participantId: rec.participantId,
    deviceModel: rec.deviceModel,
    condition: rec.condition,
    source: rec.source,
    pulseless,
  };
  const val = (metric: string) => {
    const m = result.metrics.find((x) => x.metric === metric);
    return m && m.status === 'valid' ? m.value : null;
  };
  const outcomes: ArmOutcome[] = [
    {
      ...base,
      arm: 'hr:pipeline',
      estimate: val('heart_rate'),
      reference: ref.heartRateBpm ?? null,
    },
    {
      ...base,
      arm: 'hr:legacy-v0.3',
      estimate: result.diagnostics.legacy?.hrBpm ?? null,
      reference: ref.heartRateBpm ?? null,
    },
    {
      ...base,
      arm: 'br:pipeline',
      estimate: val('breathing_rate'),
      reference: ref.breathingPerMin ?? null,
    },
    {
      ...base,
      arm: 'br:legacy-v0.3',
      estimate: result.diagnostics.legacy?.breathingPerMin ?? null,
      reference: ref.breathingPerMin ?? null,
    },
  ];
  if (opts.extractors !== false)
    for (const [arm, estimate] of extractorEstimates(frames))
      outcomes.push({ ...base, arm, estimate, reference: ref.heartRateBpm ?? null });

  let intervals: IntervalOutcome | null = null;
  const prv = result.diagnostics.prv;
  if (ref.beatTimesSec && ref.beatTimesSec.length > 2) {
    const det = prv?.beatTimesSec ?? [];
    const acceptedFlags = prv?.intervals?.map((iv) => iv.status === 'accepted');
    const m = matchIntervals(det, ref.beatTimesSec, acceptedFlags);
    const t0 = det[0] ?? 0;
    const t1 = det[det.length - 1] ?? 0;
    const refIn = ref.beatTimesSec.filter((t) => t >= t0 && t <= t1);
    const refIbis: number[] = [];
    for (let i = 1; i < refIn.length; i++) refIbis.push(refIn[i]! - refIn[i - 1]!);
    intervals = {
      ...base,
      errorsMs: m.errorsMs,
      matchedFraction: m.matchedFraction,
      offsetMs: m.offsetMs,
      rmssdMs: val('hrv'),
      referenceRmssdMs: rmssdMs(refIbis),
    };
  }
  return { outcomes, intervals, result };
}

function summarise(arm: string, list: ArmOutcome[]): ArmSummary {
  const withPulse = list.filter((o) => !o.pulseless);
  const pulseless = list.filter((o) => o.pulseless);
  const scored = withPulse.filter((o) => o.reference !== null);
  const pairs = (xs: ArmOutcome[]) =>
    xs
      .filter((o) => o.estimate !== null && o.reference !== null)
      .map((o) => ({ estimate: o.estimate!, reference: o.reference! }));
  const grouped = (key: (o: ArmOutcome) => string) => {
    const out: ArmSummary['byParticipant'] = {};
    for (const [k, xs] of groupBy(scored, key)) {
      const c = coverage(xs.length, xs.filter((o) => o.estimate !== null).length);
      out[k] = { ...agreement(pairs(xs)), coverage: c.coverage };
    }
    return out;
  };
  return {
    arm,
    coverage: coverage(scored.length, scored.filter((o) => o.estimate !== null).length),
    agreement: agreement(pairs(scored)),
    falseAcceptances: pulseless.filter((o) => o.estimate !== null).length,
    pulselessAttempted: pulseless.length,
    byParticipant: grouped((o) => o.participantId),
    byDevice: grouped((o) => o.deviceModel),
    byCondition: grouped((o) => o.condition),
  };
}

export function runValidation(
  recordings: ValidationRecording[],
  opts: RunOptions = {},
): ValidationReport {
  const all: ArmOutcome[] = [];
  const ivs: IntervalOutcome[] = [];
  let versions = { pipelineVersion: '', configVersion: '' };
  for (const rec of recordings) {
    const { outcomes, intervals, result } = runRecording(rec, opts);
    versions = { pipelineVersion: result.pipelineVersion, configVersion: result.configVersion };
    all.push(...outcomes);
    if (intervals) ivs.push(intervals);
  }
  const arms = [...groupBy(all, (o) => o.arm)].map(([arm, list]) => summarise(arm, list));
  const sources: Record<string, number> = {};
  for (const r of recordings) sources[r.source] = (sources[r.source] ?? 0) + 1;
  const rmssdPairs = ivs
    .filter((i) => i.rmssdMs !== null && i.referenceRmssdMs !== null)
    .map((i) => ({ estimate: i.rmssdMs!, reference: i.referenceRmssdMs! }));
  return {
    generatedAt: new Date().toISOString(),
    ...versions,
    synthetic: recordings.some((r) => r.source === 'synthetic'),
    sources,
    recordings: recordings.length,
    participants: new Set(recordings.map((r) => r.participantId)).size,
    arms,
    intervals: ivs.length
      ? {
          recordings: ivs.length,
          agreement: agreement(
            ivs.flatMap((i) => i.errorsMs.map((e) => ({ estimate: e, reference: 0 }))),
          ),
          rmssd: agreement(rmssdPairs),
          meanMatchedFraction: ivs.reduce((a, i) => a + i.matchedFraction, 0) / ivs.length,
        }
      : null,
  };
}

export type { RppgMethod, SignalRegion };
