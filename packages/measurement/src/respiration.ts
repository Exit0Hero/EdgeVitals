/**
 * Face-scan breathing rate from independent respiratory signals.
 *
 * Kept separate from the heart-rate estimator. It takes the beats that the PRV
 * beat detector found in the pulse waveform, plus the skin intensity and the
 * face boxes. Four respiratory signals are evaluated (Karlen et al., IEEE
 * TBME 2013; Charlton et al., Physiol Meas 2016):
 *  - RIIV: baseline (intensity) variation, from the beat-averaged skin
 *    intensity;
 *  - RIAV: pulse amplitude modulation, from the beat amplitudes;
 *  - RIFV: pulse frequency modulation, from the accepted beat intervals;
 *  - head motion: vertical face movement (motionBreathing.ts).
 *
 * Each signal is resampled to 4 Hz and gets its own rate and clarity (the
 * share of 0.05-0.7 Hz power within ±0.04 Hz of its peak). It must also have
 * enough beats and duration. A rate is reported only when at least two
 * clear signals agree within 2 /min (finger.ts `fuseBreathing`, the same rule
 * as the finger scan). Head motion alone may still pass on its own stricter
 * window-agreement gates (ADR 0010); the pipeline decides that.
 *
 * Clarity threshold 0.5: on synthetic pulses with no respiratory
 * modulation, pairs of noise peaks reached about 0.48. Not validated against a
 * respiration reference.
 */
import { detrendSmoothnessPriors, mean, resampleUniform } from './dsp';
import { FINGER_CONFIG, fuseBreathing, respiratoryPeak } from './finger';
import type { BeatAnalysis } from './prv';
import type { BreathingModulation } from './types';

export const RESPIRATION = {
  algorithm: 'resp-fusion-riiv-riav-rifv',
  version: '0.1.0',
  seriesHz: 4,
  minDurationSec: 30,
  /** Each beat-derived series needs at least this many beats. */
  minBeats: 20,
  detrendCutoffHz: 0.06,
  minConcentration: FINGER_CONFIG.minBreathingConcentration,
  agreementPerMin: FINGER_CONFIG.breathingAgreementPerMin,
} as const;

export interface RespirationEstimate {
  perMin: number | null;
  signals: BreathingModulation[];
  /** Names of the signals that formed the agreeing group. */
  agreeing: BreathingModulation['name'][];
  failure: null | 'too_short' | 'too_few_beats' | 'no_clear_signal' | 'signals_disagree';
}

/**
 * Beat-indexed values on a uniform grid, with slow drift (posture, lighting,
 * exposure) removed by smoothness-priors detrending below 0.06 Hz (3.6 /min,
 * under the 6 /min band edge). Without it, drift leaks into the 0.05-0.7 Hz
 * clarity measure and hides a real breathing peak.
 */
function seriesAt(times: number[], values: number[], fs: number): number[] | null {
  if (times.length < RESPIRATION.minBeats) return null;
  const s = resampleUniform(times, values, fs);
  return s.length >= fs * 15 ? detrendSmoothnessPriors(s, fs, RESPIRATION.detrendCutoffHz) : null;
}

/**
 * @param beats beat analysis of the pulse (prv.ts), times relative to the signal start
 * @param intensity normalised skin intensity (value / mean - 1) at `fs`
 */
export function estimateRespiration(
  beats: BeatAnalysis | null,
  intensity: number[],
  fs: number,
  extra: BreathingModulation[] = [],
): RespirationEstimate {
  const R = RESPIRATION;
  const signals: BreathingModulation[] = [];
  const dur = intensity.length / fs;
  if (dur < R.minDurationSec) return { perMin: null, signals, agreeing: [], failure: 'too_short' };
  if (!beats || beats.beats.length < R.minBeats)
    return { perMin: null, signals: [...extra], agreeing: [], failure: 'too_few_beats' };
  const fsR = R.seriesHz;
  const mod = (name: BreathingModulation['name'], s: number[] | null) => {
    const p = s ? respiratoryPeak(s, fsR) : null;
    signals.push({
      name,
      perMin: p ? Math.round(p.perMin * 10) / 10 : null,
      concentration: p ? Math.round(p.concentration * 1000) / 1000 : 0,
    });
  };
  // RIIV: mean skin intensity over each beat, at the beat time.
  const bt = beats.beats;
  const riivT: number[] = [];
  const riivV: number[] = [];
  for (let i = 1; i < bt.length; i++) {
    const a = Math.max(0, Math.floor(bt[i - 1]! * fs));
    const b = Math.min(intensity.length, Math.ceil(bt[i]! * fs));
    if (b - a < 2) continue;
    riivT.push(bt[i]!);
    riivV.push(mean(intensity.slice(a, b)));
  }
  mod('riiv', seriesAt(riivT, riivV, fsR));
  // RIAV: beat amplitude.
  mod('riav', seriesAt(bt, beats.amplitudes, fsR));
  // RIFV: accepted intervals only (missed or extra beats would add false modulation).
  const acc = beats.intervals.filter((iv) => iv.status === 'accepted');
  mod(
    'rifv',
    seriesAt(
      acc.map((iv) => iv.t),
      acc.map((iv) => iv.ibi),
      fsR,
    ),
  );
  const all = [...signals, ...extra];
  const clear = all.filter((m) => m.perMin !== null && m.concentration >= R.minConcentration);
  const perMin = fuseBreathing(all);
  if (perMin === null)
    return {
      perMin: null,
      signals: all,
      agreeing: [],
      failure: clear.length < 2 ? 'no_clear_signal' : 'signals_disagree',
    };
  const agreeing = clear
    .filter((m) => Math.abs(m.perMin! - perMin) <= R.agreementPerMin)
    .map((m) => m.name);
  return { perMin, signals: all, agreeing, failure: null };
}
