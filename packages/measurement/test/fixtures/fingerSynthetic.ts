/**
 * TEST FIXTURE ONLY. Synthetic finger-on-camera traces (torch-lit fingertip)
 * with known beat times, HRV and breathing, to check the finger estimators
 * against ground truth. Not a physiological model and never shipped.
 */
import { assessFingerFrame, type FingerFrameSample, type FingerSample } from '../../src/finger';
import { gauss, mulberry32 } from './synthetic';

export interface FingerSyntheticOptions {
  durationSec?: number;
  fps?: number;
  heartRateBpm?: number;
  breathingPerMin?: number;
  /** Peak-to-peak respiratory sinus arrhythmia of the beat interval, s. */
  rsaSec?: number;
  /** Random beat-to-beat interval jitter SD, s. */
  jitterSec?: number;
  /** Pulse depth as a fraction of the channel mean (finger PPG: ~0.005-0.05). */
  pulseDepth?: number;
  /** Respiratory amplitude modulation of the pulse (fraction). */
  ampMod?: number;
  /** Respiratory baseline modulation (fraction of DC). */
  baseMod?: number;
  /** Sensor noise SD on each channel mean, 8-bit units. */
  noise?: number;
  timingJitterMs?: number;
  /** Red channel clipped at 255 (common with the torch on). */
  redClipped?: boolean;
  noPulse?: boolean;
  seed?: number;
}

export interface FingerTruth {
  frames: FingerFrameSample[];
  ibis: number[];
  rmssdMs: number;
  sdnnMs: number;
  meanHrBpm: number;
  breathingPerMin: number;
}

export function fingerSession(o: FingerSyntheticOptions = {}): FingerTruth {
  const dur = o.durationSec ?? 62;
  const fps = o.fps ?? 30;
  const hr = o.heartRateBpm ?? 68;
  const br = o.breathingPerMin ?? 14;
  const rsa = o.rsaSec ?? 0.08;
  const jit = o.jitterSec ?? 0.02;
  const depth = o.pulseDepth ?? 0.02;
  const ampMod = o.ampMod ?? 0.15;
  const baseMod = o.baseMod ?? 0.004;
  const noise = o.noise ?? 0.3;
  const rng = mulberry32(o.seed ?? 7);
  const fb = br / 60;

  const beats: number[] = [-0.8];
  while (beats[beats.length - 1]! < dur + 1) {
    const t = beats[beats.length - 1]!;
    beats.push(t + 60 / hr + (rsa / 2) * Math.sin(2 * Math.PI * fb * t) + jit * gauss(rng));
  }
  // Ground truth over the part of the scan the analysis keeps (after settling).
  const kept = beats.filter((b) => b > 2.5 && b < dur - 0.5);
  const ibis: number[] = [];
  for (let i = 1; i < kept.length; i++) ibis.push(kept[i]! - kept[i - 1]!);
  let ss = 0;
  for (let i = 1; i < ibis.length; i++) ss += (ibis[i]! - ibis[i - 1]!) ** 2;
  const m = ibis.reduce((a, b) => a + b, 0) / ibis.length;
  const sd = Math.sqrt(ibis.reduce((a, b) => a + (b - m) ** 2, 0) / ibis.length);

  // Blood volume pulse: fast systolic rise, slower decay, small diastolic wave.
  const bvp = (t: number): number => {
    let v = 0;
    for (const b of beats) {
      const d = t - b;
      if (d < -0.3 || d > 1.2) continue;
      const am = 1 + ampMod * Math.sin(2 * Math.PI * fb * b);
      v +=
        am *
        (Math.exp(-((d - 0.15) ** 2) / (2 * 0.07 ** 2)) +
          0.3 * Math.exp(-((d - 0.42) ** 2) / (2 * 0.1 ** 2)));
    }
    return v;
  };

  const frames: FingerFrameSample[] = [];
  let prev: FingerSample | null = null;
  const n = Math.floor(dur * fps);
  for (let i = 0; i < n; i++) {
    const t = i / fps + ((o.timingJitterMs ?? 3) / 1000) * gauss(rng);
    const p = o.noPulse ? 0 : bvp(t) - 0.5;
    const base =
      1 + baseMod * Math.sin(2 * Math.PI * fb * t) + 0.01 * Math.sin((2 * Math.PI * t) / 50);
    // More blood absorbs more light: the image darkens on each beat.
    const k = base * (1 - depth * p);
    const r = o.redClipped ? 255 : Math.min(255, 205 * k + noise * gauss(rng));
    const g = 60 * k + noise * gauss(rng);
    const b = 18 * k + noise * gauss(rng);
    const sample: FingerSample = {
      r,
      g,
      b,
      luma: 0.299 * r + 0.587 * g + 0.114 * b,
      coverage: 0.97,
      redClipped: o.redClipped ? 0.95 : 0,
    };
    const flags = assessFingerFrame(sample, prev);
    frames.push({ t: t * 1000, sample, flags, usable: flags.length === 0 });
    if (flags.length === 0) prev = sample;
  }
  frames.sort((a, b) => a.t - b.t);
  return {
    frames,
    ibis,
    rmssdMs: Math.sqrt(ss / (ibis.length - 1)) * 1000,
    sdnnMs: sd * 1000,
    meanHrBpm: 60 / m,
    breathingPerMin: br,
  };
}
