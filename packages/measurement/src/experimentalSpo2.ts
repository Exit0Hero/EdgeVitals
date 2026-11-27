/**
 * EXPERIMENTAL camera SpO2 (ADR 0008). Off unless the user turns on
 * "Experimental estimates" in Settings.
 *
 * Method: ratio of ratios on the face's red and blue channels, with the
 * linear calibration published by Bal (2015):
 *
 *   R    = (AC_red / DC_red) / (AC_blue / DC_blue)
 *   SpO2 = 101.6 − 5.834 · R
 *
 *   U. Bal, "Non-contact estimation of heart rate and oxygen saturation using
 *   ambient light", Biomedical Optics Express 6(1):86–97, 2015,
 *   doi:10.1364/BOE.6.000086. Coefficients from Sec. 3 / Fig. 7, fitted on 6
 *   healthy volunteers against a Masimo Rad-87 oximeter.
 *
 * Deviation from the paper: Bal took AC as the standard deviation of each
 * channel in a 10 s window. We take the standard deviation of the band-passed
 * (0.7–3 Hz) channel instead, so slow lighting drift and head motion do not
 * count as pulse. The calibration was not refitted for this.
 *
 * Known accuracy (independent benchmark on 107 people, VIPL-HR; Cheng et al.,
 * Bioengineering 2024, 11:251): MAE 1.84 points overall and 4.48 points when
 * SpO2 < 95 %. That is outside the 4-point limit for an approved oximeter.
 * EdgeVitals has not validated this method. It is never a medical reading.
 */
import { bandpass, mean, median, std } from './dsp';

export const EXPERIMENTAL_SPO2 = {
  algorithm: 'bal2015-ror-red-blue',
  version: '0.1.0',
  /** Bal (2015) calibration line. */
  a: 101.6,
  b: 5.834,
  windowSec: 10,
  stepSec: 1,
  bandHz: [0.7, 3.0] as const,
  /** Each channel's pulse band must track the rPPG pulse at least this well. */
  minPulseCorrelation: 0.5,
  /** Share of windows that must pass the per-window gates. */
  minAcceptedFraction: 0.6,
  /** Interquartile range of per-window SpO2 allowed, in points. */
  maxIqr: 3,
  /** Values outside this range are reported as no reliable reading. Bal's fit data did not include desaturation. */
  range: [90, 100] as const,
  minDurationSec: 20,
} as const;

export interface ExperimentalSpo2Result {
  /** Rounded SpO2 in %, or null when a gate failed. */
  value: number | null;
  ratio: number | null;
  acceptedFraction: number;
  iqr: number | null;
  failure: 'too_short' | 'weak_pulse' | 'unstable' | 'out_of_range' | null;
}

function correlation(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Estimate SpO2 from uniformly resampled red and blue face traces and the
 * rPPG pulse (same length, rate `fs`). Call only after heart rate passed its
 * own quality gates.
 */
export function estimateExperimentalSpo2(
  red: number[],
  blue: number[],
  pulse: number[],
  fs: number,
): ExperimentalSpo2Result {
  const c = EXPERIMENTAL_SPO2;
  const none = (failure: ExperimentalSpo2Result['failure'], extra = {}) => ({
    value: null,
    ratio: null,
    acceptedFraction: 0,
    iqr: null,
    failure,
    ...extra,
  });
  if (red.length / fs < c.minDurationSec) return none('too_short');

  const acR = bandpass(red, c.bandHz[0], c.bandHz[1], fs);
  const acB = bandpass(blue, c.bandHz[0], c.bandHz[1], fs);
  const win = Math.round(c.windowSec * fs);
  const step = Math.round(c.stepSec * fs);
  // Skip the filter's edge transient.
  const edge = Math.round(fs);
  const ratios: number[] = [];
  let total = 0;
  for (let s = edge; s + win <= red.length - edge; s += step) {
    total++;
    const e = s + win;
    const p = pulse.slice(s, e);
    const r = acR.slice(s, e);
    const b = acB.slice(s, e);
    if (
      Math.abs(correlation(r, p)) < c.minPulseCorrelation ||
      Math.abs(correlation(b, p)) < c.minPulseCorrelation
    )
      continue;
    const dcR = mean(red.slice(s, e));
    const dcB = mean(blue.slice(s, e));
    const sdB = std(b);
    if (dcR <= 0 || dcB <= 0 || sdB <= 0) continue;
    const ratio = std(r) / dcR / (sdB / dcB);
    if (Number.isFinite(ratio) && ratio > 0) ratios.push(ratio);
  }
  const acceptedFraction = total ? ratios.length / total : 0;
  if (!total || acceptedFraction < c.minAcceptedFraction)
    return none('weak_pulse', { acceptedFraction });

  const spo2s = ratios.map((r) => c.a - c.b * r).sort((x, y) => x - y);
  const iqr = quantile(spo2s, 0.75) - quantile(spo2s, 0.25);
  const ratio = median(ratios);
  if (iqr > c.maxIqr) return none('unstable', { acceptedFraction, iqr, ratio });
  const raw = c.a - c.b * ratio;
  if (raw < c.range[0] || raw > c.range[1] + 0.5)
    return none('out_of_range', { acceptedFraction, iqr, ratio });
  return {
    value: Math.min(100, Math.round(raw)),
    ratio,
    acceptedFraction,
    iqr,
    failure: null,
  };
}
