import { PIPELINE_CONFIG } from './config';
import {
  bandPower,
  bandpass,
  findPeaks,
  mean,
  median,
  peakFrequency,
  resampleUniform,
  welch,
} from './dsp';

const cfg = PIPELINE_CONFIG;

export interface HeartRateEstimate {
  bpm: number;
  snrDb: number;
  /** |HR(first half) - HR(second half)| in bpm: a stationarity check. */
  halvesDiffBpm: number;
  /** Filtered pulse signal used for beat detection. */
  pulse: number[];
}

/**
 * Spectral heart-rate estimate from a POS pulse signal.
 *
 * SNR follows de Haan & Jeanne (2013): power around the fundamental and
 * its first harmonic versus the remaining power in the 0.7-4 Hz band. The
 * windows are widened to ±0.2 Hz / ±0.3 Hz (from ±0.1 / ±0.2) because a
 * 12 s Hann segment has a ~0.17 Hz main-lobe half-width and respiratory
 * sinus arrhythmia spreads the fundamental.
 */
export function estimateHeartRate(posSignal: number[], fs: number): HeartRateEstimate | null {
  const [lo, hi] = cfg.hrBandHz;
  const pulse = bandpass(posSignal, lo, hi, fs);
  const spec = welch(pulse, fs, Math.min(12, pulse.length / fs), 8192);
  const peak = peakFrequency(spec, lo, hi);
  if (!peak) return null;
  const f0 = peak.freq;
  const signal = bandPower(spec, f0 - 0.2, f0 + 0.2) + bandPower(spec, 2 * f0 - 0.3, 2 * f0 + 0.3);
  const total = bandPower(spec, 0.7, 4.0);
  const noise = total - signal;
  const snrDb = noise > 0 ? 10 * Math.log10(signal / noise) : 30;
  const half = Math.floor(pulse.length / 2);
  const halfPeak = (x: number[]) => peakFrequency(welch(x, fs, x.length / fs, 8192), lo, hi);
  const p1 = halfPeak(pulse.slice(0, half));
  const p2 = halfPeak(pulse.slice(half));
  const halvesDiffBpm = p1 && p2 ? Math.abs(p1.freq - p2.freq) * 60 : Infinity;
  return { bpm: f0 * 60, snrDb, halvesDiffBpm, pulse };
}

export interface HrvEstimate {
  rmssdMs: number;
  meanHrBpm: number;
  ibiCount: number;
  acceptedFraction: number;
  /** Accepted inter-beat intervals in seconds, with their beat times. */
  ibis: { t: number; ibi: number }[];
}

/**
 * Beat-to-beat analysis: detect systolic peaks in the filtered pulse,
 * reject intervals deviating more than `ibiTolerance` from the local
 * median (5-beat window), and compute RMSSD over consecutive accepted
 * intervals.
 */
export function estimateHrv(
  pulse: number[],
  fs: number,
  spectralHrBpm: number,
): HrvEstimate | null {
  const period = 60 / spectralHrBpm;
  const peaks = findPeaks(pulse, Math.max(2, Math.floor(0.6 * period * fs)));
  if (peaks.length < 3) return null;
  const times = peaks.map((p) => p / fs);
  const raw: { t: number; ibi: number }[] = [];
  for (let i = 1; i < times.length; i++) raw.push({ t: times[i]!, ibi: times[i]! - times[i - 1]! });
  const accepted: boolean[] = raw.map((r, i) => {
    const win = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3)).map((x) => x.ibi);
    const m = median(win);
    const inRange = r.ibi >= 60 / 200 && r.ibi <= 60 / 35;
    return inRange && Math.abs(r.ibi - m) <= cfg.ibiTolerance * m;
  });
  const ibis = raw.filter((_, i) => accepted[i]);
  const diffs: number[] = [];
  for (let i = 1; i < raw.length; i++) {
    if (accepted[i] && accepted[i - 1]) diffs.push(raw[i]!.ibi - raw[i - 1]!.ibi);
  }
  if (ibis.length < 2 || diffs.length < 1) return null;
  const rmssd = Math.sqrt(mean(diffs.map((d) => d * d))) * 1000;
  return {
    rmssdMs: rmssd,
    meanHrBpm: 60 / mean(ibis.map((x) => x.ibi)),
    ibiCount: raw.length,
    acceptedFraction: ibis.length / raw.length,
    ibis,
  };
}

export interface BreathingEstimate {
  /** Respiratory-induced frequency variation (RSA from the IBI series). */
  rifvPerMin: number | null;
  /** Respiratory-induced intensity variation (low-frequency skin signal). */
  riivPerMin: number | null;
  /** Combined estimate, only when both agree. */
  perMin: number | null;
}

/**
 * Two independent breathing-rate estimators. Reporting requires both to
 * agree within `breathingAgreementPerMin`; disagreement means abstention.
 */
export function estimateBreathing(
  ibis: { t: number; ibi: number }[] | null,
  intensity: number[],
  fs: number,
): BreathingEstimate {
  const [lo, hi] = cfg.breathingBandHz;
  let rifv: number | null = null;
  if (ibis && ibis.length >= 8) {
    const series = resampleUniform(
      ibis.map((x) => x.t),
      ibis.map((x) => x.ibi),
      4,
    );
    const m = mean(series);
    const spec = welch(
      series.map((v) => v - m),
      4,
      series.length / 4,
      2048,
    );
    const p = peakFrequency(spec, lo, hi);
    rifv = p ? p.freq * 60 : null;
  }
  let riiv: number | null = null;
  if (intensity.length > fs * 10) {
    const filtered = bandpass(intensity, lo, hi, fs);
    const spec = welch(filtered, fs, filtered.length / fs, 8192);
    const p = peakFrequency(spec, lo, hi);
    riiv = p ? p.freq * 60 : null;
  }
  const agree =
    rifv !== null && riiv !== null && Math.abs(rifv - riiv) <= cfg.breathingAgreementPerMin;
  return { rifvPerMin: rifv, riivPerMin: riiv, perMin: agree ? (rifv! + riiv!) / 2 : null };
}
