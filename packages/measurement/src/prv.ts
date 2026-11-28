/**
 * Beat detection and pulse-rate variability (PRV) for the camera pulse.
 *
 * Camera-derived beat intervals are PULSE intervals: they include the
 * pulse-transit time to the skin and its beat-to-beat changes, plus the
 * camera's timing error. Pulse-rate variability is therefore not the same
 * quantity as ECG heart-rate variability (Schäfer & Vagedes, Int J Cardiol
 * 2013; Mejía-Mejía et al., Physiol Meas 2020). The metric id stays `hrv`
 * for API and storage compatibility; everything user-facing calls it PRV.
 *
 * This module works on the continuous pulse waveform, not on its dominant
 * frequency:
 *  1. orient the waveform so the systolic upstroke rises (derivative skew);
 *  2. find candidate peaks no closer than 0.55 of the expected beat period and
 *     drop peaks far smaller than their neighbours (false peaks);
 *  3. place each beat at the maximum upstroke slope before its peak (a
 *     fiducial less sensitive to waveform shape than the peak itself),
 *     refined to sub-sample precision;
 *  4. classify every interval: accepted, out of physiological range, missed
 *     beat (about twice the local period), extra beat (short), irregular
 *     (far from the local median) or overlapping a motion/lighting artefact.
 *     Missed beats are never filled in.
 *  5. RMSSD uses only successive differences of two adjacent accepted
 *     intervals; SDNN uses accepted intervals.
 *
 * Thresholds are engineering defaults tested on synthetic signals
 * (test/prv.test.ts). PRV has not been validated against ECG intervals.
 */
import { mean, median } from './dsp';

export const PRV = {
  algorithm: 'prv-slope-fiducial',
  version: '0.1.0',
  /** Candidate peaks must be this fraction of the expected period apart. */
  minPeakSpacing: 0.55,
  /** A peak whose prominence is below this share of the median prominence is a false peak. */
  minRelativeProminence: 0.3,
  /** Intervals outside 40-200 bpm are physiologically implausible here. */
  intervalRangeSec: [0.3, 1.5] as [number, number],
  /** Accepted if within this fraction of the local (5-interval) median. */
  localTolerance: 0.25,
  /** An interval this many local periods long means a beat was missed. */
  missedBeatRatio: 1.6,
  /** An interval this short (fraction of the local period) means an extra beat. */
  extraBeatRatio: 0.6,
} as const;

export type IntervalStatus =
  'accepted' | 'out_of_range' | 'missed_beat' | 'extra_beat' | 'irregular' | 'artefact';

export interface PulseInterval {
  /** Time of the beat that ends the interval, seconds from the signal start. */
  t: number;
  /** Interval length, seconds. */
  ibi: number;
  status: IntervalStatus;
}

export interface BeatAnalysis {
  /** Beat fiducial times, seconds from the signal start. */
  beats: number[];
  /** +1 if the waveform was used as given, -1 if it was inverted. */
  polarity: 1 | -1;
  intervals: PulseInterval[];
  acceptedCount: number;
  rejectedCount: number;
  rejectedByReason: Partial<Record<Exclude<IntervalStatus, 'accepted'>, number>>;
  acceptedFraction: number;
  /** Candidate peaks removed as false (small) peaks. */
  falsePeaksRemoved: number;
  /** Mean rate of accepted intervals, bpm. */
  meanRateBpm: number | null;
  /** Successive differences used for RMSSD (adjacent accepted pairs). */
  successivePairs: number;
  rmssdMs: number | null;
  sdnnMs: number | null;
  /** Beat amplitude (peak minus preceding trough) of each beat, in waveform units. */
  amplitudes: number[];
  /** Trough value before each beat, in waveform units. */
  troughs: number[];
}

function skewness(x: number[]): number {
  const m = mean(x);
  let m2 = 0;
  let m3 = 0;
  for (const v of x) {
    const d = v - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= x.length;
  m3 /= x.length;
  return m2 > 0 ? m3 / m2 ** 1.5 : 0;
}

/**
 * Detect beats in a band-passed pulse waveform sampled at `fs`, given the
 * accepted pulse rate. `artefact[i]` (optional, same length as `pulse`) marks
 * samples inside motion, lighting or interpolation artefacts.
 */
export function detectPulseBeats(
  pulse: number[],
  fs: number,
  rateBpm: number,
  artefact?: boolean[],
): BeatAnalysis | null {
  const n = pulse.length;
  if (n < fs * 3 || !(rateBpm > 0)) return null;
  // 1. Orientation: the upstroke is steeper than the decline, so the
  // derivative of a correctly oriented pulse is positively skewed.
  const d0: number[] = [];
  for (let i = 1; i < n; i++) d0.push(pulse[i]! - pulse[i - 1]!);
  const polarity: 1 | -1 = skewness(d0) >= 0 ? 1 : -1;
  const x = polarity === 1 ? pulse : pulse.map((v) => -v);
  const dx: number[] = [0];
  for (let i = 1; i < n; i++) dx.push(x[i]! - x[i - 1]!);

  // 2. Candidate peaks with a minimum spacing; larger peaks win.
  const period = 60 / rateBpm;
  const minDist = Math.max(2, Math.floor(PRV.minPeakSpacing * period * fs));
  const cands: number[] = [];
  for (let i = 1; i < n - 1; i++) if (x[i]! > x[i - 1]! && x[i]! >= x[i + 1]!) cands.push(i);
  cands.sort((a, b) => x[b]! - x[a]!);
  const taken = new Uint8Array(n);
  let peaks: number[] = [];
  for (const i of cands) {
    let ok = true;
    for (let j = Math.max(0, i - minDist + 1); j <= Math.min(n - 1, i + minDist - 1); j++)
      if (taken[j]) {
        ok = false;
        break;
      }
    if (ok) {
      taken[i] = 1;
      peaks.push(i);
    }
  }
  peaks.sort((a, b) => a - b);
  // Prominence: peak minus the lowest point since the previous peak.
  const troughIdx = (p: number, prev: number) => {
    let k = p;
    for (let j = prev; j < p; j++) if (x[j]! < x[k]!) k = j;
    return k;
  };
  const prom = (list: number[]) =>
    list.map((p, i) => {
      const prev = i === 0 ? Math.max(0, p - Math.round(period * fs)) : list[i - 1]!;
      return x[p]! - x[troughIdx(p, prev)]!;
    });
  let falsePeaksRemoved = 0;
  if (peaks.length >= 3) {
    const pr = prom(peaks);
    const mp = median(pr);
    const kept = peaks.filter((_, i) => pr[i]! >= PRV.minRelativeProminence * mp);
    falsePeaksRemoved = peaks.length - kept.length;
    peaks = kept;
  }
  if (peaks.length < 3) return null;

  // 3. Fiducial: maximum upstroke slope between the preceding trough and the peak.
  const beats: number[] = [];
  const amplitudes: number[] = [];
  const troughs: number[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i]!;
    const prev = i === 0 ? Math.max(0, p - Math.round(period * fs)) : peaks[i - 1]!;
    const tr = troughIdx(p, prev);
    let k = Math.max(1, tr + 1);
    for (let j = k; j <= p; j++) if (dx[j]! > dx[k]!) k = j;
    let pos = k;
    if (k > 0 && k < n - 1) {
      const a = dx[k - 1]!,
        b = dx[k]!,
        c = dx[k + 1]!;
      const den = a - 2 * b + c;
      if (den !== 0) pos = k + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    }
    // dx[k] is the slope between samples k-1 and k: its time is k - 0.5.
    beats.push((pos - 0.5) / fs);
    amplitudes.push(x[p]! - x[tr]!);
    troughs.push(x[tr]!);
  }

  // 4. Interval classification.
  const raw: number[] = [];
  for (let i = 1; i < beats.length; i++) raw.push(beats[i]! - beats[i - 1]!);
  const intervals: PulseInterval[] = raw.map((ibi, i) => {
    const win = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3));
    const local = median(win);
    const t = beats[i + 1]!;
    let status: IntervalStatus = 'accepted';
    if (ibi < PRV.intervalRangeSec[0] || ibi > PRV.intervalRangeSec[1]) status = 'out_of_range';
    else if (ibi >= PRV.missedBeatRatio * local) status = 'missed_beat';
    else if (ibi <= PRV.extraBeatRatio * local) status = 'extra_beat';
    else if (Math.abs(ibi - local) > PRV.localTolerance * local) status = 'irregular';
    if (status === 'accepted' && artefact) {
      const i0 = Math.max(0, Math.floor(beats[i]! * fs));
      const i1 = Math.min(artefact.length - 1, Math.ceil(t * fs));
      for (let j = i0; j <= i1; j++)
        if (artefact[j]) {
          status = 'artefact';
          break;
        }
    }
    return { t, ibi, status };
  });
  const acc = intervals.filter((iv) => iv.status === 'accepted');
  const rejectedByReason: BeatAnalysis['rejectedByReason'] = {};
  for (const iv of intervals)
    if (iv.status !== 'accepted')
      rejectedByReason[iv.status] = (rejectedByReason[iv.status] ?? 0) + 1;
  // 5. RMSSD from adjacent accepted pairs only; SDNN from accepted intervals.
  const diffs: number[] = [];
  for (let i = 1; i < intervals.length; i++)
    if (intervals[i]!.status === 'accepted' && intervals[i - 1]!.status === 'accepted')
      diffs.push(intervals[i]!.ibi - intervals[i - 1]!.ibi);
  const accIbis = acc.map((iv) => iv.ibi);
  const mIbi = accIbis.length ? mean(accIbis) : NaN;
  return {
    beats,
    polarity,
    intervals,
    acceptedCount: acc.length,
    rejectedCount: intervals.length - acc.length,
    rejectedByReason,
    acceptedFraction: intervals.length ? acc.length / intervals.length : 0,
    falsePeaksRemoved,
    meanRateBpm: accIbis.length ? 60 / mIbi : null,
    successivePairs: diffs.length,
    rmssdMs: diffs.length ? 1000 * Math.sqrt(mean(diffs.map((v) => v * v))) : null,
    sdnnMs:
      accIbis.length > 1
        ? 1000 * Math.sqrt(accIbis.reduce((s, v) => s + (v - mIbi) ** 2, 0) / (accIbis.length - 1))
        : null,
    amplitudes,
    troughs,
  };
}
