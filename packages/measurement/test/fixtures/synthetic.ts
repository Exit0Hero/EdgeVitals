/**
 * TEST FIXTURE ONLY. Generates synthetic skin-colour traces with a known
 * pulse, beat-to-beat variability and breathing rate so the estimators can
 * be checked against ground truth. Not a model of real physiology, never
 * shipped in the app, and never a substitute for validation on real data.
 */
import type { FrameSample } from '../../src/types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export interface SyntheticOptions {
  durationSec?: number;
  fps?: number;
  heartRateBpm?: number;
  breathingPerMin?: number;
  /** Peak-to-peak RSA modulation of IBI, seconds. */
  rsaSec?: number;
  /** Random beat-to-beat jitter SD, seconds. */
  jitterSec?: number;
  /** Relative pulse amplitude (fraction of DC). */
  pulseAmplitude?: number;
  /** Gaussian noise SD in 8-bit units on each channel mean. */
  noise?: number;
  /** Frame timing jitter SD, ms. */
  timingJitterMs?: number;
  seed?: number;
  /** Replace pulse with pure noise. */
  noPulse?: boolean;
  /** Respiratory intensity modulation (fraction of DC); default 0.003. */
  respAmplitude?: number;
  /** Relative pulse strength per channel [r, g, b]. */
  pulseVec?: [number, number, number];
}

export interface SyntheticTruth {
  frames: FrameSample[];
  beatTimes: number[];
  ibis: number[];
  rmssdMs: number;
  meanHrBpm: number;
  breathingPerMin: number;
}

export function syntheticSession(o: SyntheticOptions = {}): SyntheticTruth {
  const dur = o.durationSec ?? 45;
  const fps = o.fps ?? 30;
  const hr = o.heartRateBpm ?? 66;
  const br = o.breathingPerMin ?? 15;
  const rsa = o.rsaSec ?? 0.06;
  const jit = o.jitterSec ?? 0.012;
  const amp = o.pulseAmplitude ?? 0.008;
  const noise = o.noise ?? 0.15;
  const rng = mulberry32(o.seed ?? 42);
  const fb = br / 60;

  // Beat times with RSA + jitter.
  const beats: number[] = [-0.5];
  while (beats[beats.length - 1]! < dur + 1) {
    const t = beats[beats.length - 1]!;
    const ibi = 60 / hr + (rsa / 2) * Math.sin(2 * Math.PI * fb * t) + jit * gauss(rng);
    beats.push(t + ibi);
  }
  const inWin = beats.filter((t) => t > 0 && t < dur);
  const ibis: number[] = [];
  for (let i = 1; i < inWin.length; i++) ibis.push(inWin[i]! - inWin[i - 1]!);
  let ss = 0;
  for (let i = 1; i < ibis.length; i++) ss += (ibis[i]! - ibis[i - 1]!) ** 2;
  const rmssdMs = Math.sqrt(ss / (ibis.length - 1)) * 1000;

  const pulseAt = (t: number): number => {
    // Sum of skewed Gaussian pulses centred at each beat.
    let v = 0;
    for (const b of beats) {
      const d = t - b;
      if (d < -0.5 || d > 1.0) continue;
      v +=
        Math.exp(-((d - 0.08) ** 2) / (2 * 0.1 ** 2)) +
        0.35 * Math.exp(-((d - 0.4) ** 2) / (2 * 0.12 ** 2));
    }
    return v;
  };

  const base = [175, 125, 105];
  const pulseVec = o.pulseVec ?? [0.33, 0.77, 0.53];
  const frames: FrameSample[] = [];
  const n = Math.floor(dur * fps);
  for (let i = 0; i < n; i++) {
    const t = i / fps + ((o.timingJitterMs ?? 2) / 1000) * gauss(rng);
    const p = o.noPulse ? 0 : pulseAt(t) - 0.55;
    const resp = (o.respAmplitude ?? 0.003) * Math.sin(2 * Math.PI * fb * t);
    const drift = 0.01 * Math.sin((2 * Math.PI * t) / 40);
    const ch = base.map(
      (c, k) => c * (1 + amp * pulseVec[k]! * p + resp + drift) + noise * gauss(rng),
    );
    frames.push({
      t: t * 1000,
      roi: { r: ch[0]!, g: ch[1]!, b: ch[2]!, skinPixels: 2000, luma: 140, clippedFraction: 0 },
      face: { x: 200, y: 150, width: 240, height: 300 },
      faceCount: 1,
      frameWidth: 640,
      frameHeight: 640,
      flags: [],
      usable: true,
    });
  }
  frames.sort((a, b) => a.t - b.t);
  return {
    frames,
    beatTimes: inWin,
    ibis,
    rmssdMs,
    meanHrBpm: 60 / (ibis.reduce((a, b) => a + b, 0) / ibis.length),
    breathingPerMin: br,
  };
}
