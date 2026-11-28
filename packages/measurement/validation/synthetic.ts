/**
 * SYNTHETIC face-scan recordings with known ground truth, for software
 * verification of the measurement engine and of this validation harness.
 *
 * This is NOT a physiological model and NOT validation data. A result
 * computed on these recordings shows only that the code behaves as designed
 * on signals built to match its assumptions. It says nothing about accuracy
 * on people, cameras or lighting. Every recording made here is tagged
 * `source: 'synthetic'`, and the report generator prints a banner saying so.
 *
 * Never imported by the app (not exported from src/index.ts).
 */
import { ScanSession } from '../src/session';
import type { FrameInput } from '../src/session';
import type { FaceBox, FrameSample, RoiRegionSample } from '../src/types';
import type { ValidationRecording } from './recording';

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

export interface FaceSyntheticOptions {
  seed?: number;
  durationSec?: number;
  fps?: number;
  heartRateBpm?: number;
  /** Peak-to-peak respiratory sinus arrhythmia, s. */
  rsaSec?: number;
  /** Random beat-to-beat jitter SD, s. */
  jitterSec?: number;
  breathingPerMin?: number;
  /** Respiratory intensity modulation, fraction of DC. */
  respAmplitude?: number;
  /** Vertical head movement from breathing, pixels (peak). */
  respMotionPx?: number;
  /** Pulse strength, fraction of DC (green), before the per-channel signature. */
  pulseAmplitude?: number;
  /** Relative pulse per channel [r, g, b]. */
  pulseVec?: [number, number, number];
  /** Pulse gain per region (forehead, left cheek, right cheek); 0 = no pulse there. */
  regionPulseGain?: [number, number, number];
  /** Independent sensor noise per region per channel, 8-bit units. */
  regionNoise?: number;
  /** Noise common to all regions (illumination flicker), fraction of DC. */
  commonNoise?: number;
  /** Frame timing jitter SD, ms. */
  timingJitterMs?: number;
  /** Random frame drop probability. */
  dropProbability?: number;
  /** Bursts of dropped frames, seconds. */
  dropBursts?: { t0: number; t1: number }[];
  /** Brightness steps: at time t all channels multiply by factor. */
  lightingSteps?: { t: number; factor: number }[];
  /** Head movements: the face box shifts by px (and colour changes by colourPct %) between t0 and t1. */
  motionBursts?: { t0: number; t1: number; px: number; colourPct?: number }[];
  /** 0-1: per-beat random changes of pulse width, amplitude and notch (distorted peaks). */
  shapeDistortion?: number;
  /** Replace a share of frames' timestamps with the previous one (duplicate timestamps). */
  duplicateTimestampFraction?: number;
  noPulse?: boolean;
}

export interface FaceSyntheticTruth {
  inputs: FrameInput[];
  frames: FrameSample[];
  beatTimesSec: number[];
  ibisSec: number[];
  rmssdMs: number;
  meanHrBpm: number;
  breathingPerMin: number;
}

/** Run inputs through the live frame gates exactly as the app does, keeping the labelled frames. */
export function labelFrames(inputs: FrameInput[]): FrameSample[] {
  const s = new ScanSession(1e9, 1e9);
  return inputs.map((f) => s.pushFrame(f));
}

export function syntheticFaceSession(o: FaceSyntheticOptions = {}): FaceSyntheticTruth {
  const rng = mulberry32(o.seed ?? 1);
  const dur = o.durationSec ?? 45;
  const fps = o.fps ?? 30;
  const hr = o.heartRateBpm ?? 70;
  const br = o.breathingPerMin ?? 15;
  const fb = br / 60;
  const rsa = o.rsaSec ?? 0.05;
  const jit = o.jitterSec ?? 0.01;
  const amp = o.pulseAmplitude ?? 0.004;
  const pulseVec = o.pulseVec ?? [0.33, 0.77, 0.53];
  const gains = o.regionPulseGain ?? [1, 1, 1];
  const rn = o.regionNoise ?? 0.3;
  const cn = o.commonNoise ?? 0;
  const distortion = o.shapeDistortion ?? 0;

  const beats: number[] = [-0.8];
  const beatShape: { w: number; a: number; notch: number }[] = [{ w: 0.1, a: 1, notch: 0.35 }];
  while (beats[beats.length - 1]! < dur + 1) {
    const t = beats[beats.length - 1]!;
    beats.push(t + 60 / hr + (rsa / 2) * Math.sin(2 * Math.PI * fb * t) + jit * gauss(rng));
    beatShape.push({
      w: 0.1 * (1 + 0.4 * distortion * gauss(rng)),
      a: Math.max(0.2, 1 + 0.5 * distortion * gauss(rng)),
      notch: Math.max(0, 0.35 + 0.3 * distortion * gauss(rng)),
    });
  }
  const inWin = beats.filter((t) => t > 0 && t < dur);
  const ibis: number[] = [];
  for (let i = 1; i < inWin.length; i++) ibis.push(inWin[i]! - inWin[i - 1]!);
  let ss = 0;
  for (let i = 1; i < ibis.length; i++) ss += (ibis[i]! - ibis[i - 1]!) ** 2;

  const pulseAt = (t: number) => {
    let v = 0;
    for (let k = 0; k < beats.length; k++) {
      const d = t - beats[k]!;
      if (d < -0.5 || d > 1.0) continue;
      const sh = beatShape[k]!;
      v +=
        sh.a *
        (Math.exp(-((d - 0.08) ** 2) / (2 * Math.max(0.03, sh.w) ** 2)) +
          sh.notch * Math.exp(-((d - 0.4) ** 2) / (2 * 0.12 ** 2)));
    }
    return v - 0.55;
  };
  const lightAt = (t: number) =>
    (o.lightingSteps ?? []).reduce((f, s) => (t >= s.t ? f * s.factor : f), 1);
  const motionAt = (t: number) => {
    for (const m of o.motionBursts ?? [])
      if (t >= m.t0 && t <= m.t1) {
        const ph = Math.sin((Math.PI * (t - m.t0)) / Math.max(0.1, m.t1 - m.t0));
        return { dx: m.px * ph, colour: ((m.colourPct ?? 0) / 100) * ph };
      }
    return { dx: 0, colour: 0 };
  };
  const dropped = (t: number) =>
    rng() < (o.dropProbability ?? 0) || (o.dropBursts ?? []).some((b) => t >= b.t0 && t <= b.t1);

  const base = [176, 128, 106];
  const face0: FaceBox = { x: 120, y: 160, width: 240, height: 300 };
  const inputs: FrameInput[] = [];
  const n = Math.floor(dur * fps);
  let lastT = -1;
  for (let i = 0; i < n; i++) {
    const nominal = i / fps;
    let t = nominal + ((o.timingJitterMs ?? 1) / 1000) * gauss(rng);
    if (dropped(nominal)) continue;
    if (lastT >= 0 && rng() < (o.duplicateTimestampFraction ?? 0)) t = lastT;
    lastT = t;
    const p = o.noPulse ? 0 : pulseAt(t);
    const resp = (o.respAmplitude ?? 0.002) * Math.sin(2 * Math.PI * fb * t);
    const drift = 0.006 * Math.sin((2 * Math.PI * t) / 37);
    const light = lightAt(t);
    const mo = motionAt(t);
    const common = cn * gauss(rng);
    const regions: RoiRegionSample[] = gains.map((gain) => {
      const ch = base.map(
        (c, k) =>
          c * light * (1 + amp * gain * pulseVec[k]! * p + resp + drift + common + mo.colour) +
          rn * gauss(rng),
      );
      return {
        r: ch[0]!,
        g: ch[1]!,
        b: ch[2]!,
        n: 500,
        luma: 0.299 * ch[0]! + 0.587 * ch[1]! + 0.114 * ch[2]!,
        clipped: 0,
      };
    });
    const tot = regions.reduce((s, r) => s + r.n, 0);
    const avg = (c: 'r' | 'g' | 'b') => regions.reduce((s, r) => s + r[c] * r.n, 0) / tot;
    const r = avg('r');
    const g = avg('g');
    const b = avg('b');
    const dy = (o.respMotionPx ?? 0) * Math.sin(2 * Math.PI * fb * t);
    const face = { ...face0, x: face0.x + mo.dx, y: face0.y + dy };
    inputs.push({
      t: t * 1000,
      faces: [face],
      roi: {
        r,
        g,
        b,
        skinPixels: tot,
        luma: 0.299 * r + 0.587 * g + 0.114 * b,
        clippedFraction: 0,
        regions,
      },
      frameWidth: 480,
      frameHeight: 640,
    });
  }
  inputs.sort((a, b) => a.t - b.t);
  return {
    inputs,
    frames: labelFrames(inputs),
    beatTimesSec: inWin,
    ibisSec: ibis,
    rmssdMs: Math.sqrt(ss / Math.max(1, ibis.length - 1)) * 1000,
    meanHrBpm: 60 / (ibis.reduce((a, b) => a + b, 0) / ibis.length),
    breathingPerMin: br,
  };
}

/** A synthetic recording in the harness format, with its reference values. */
export function syntheticRecording(
  id: string,
  participantId: string,
  condition: string,
  o: FaceSyntheticOptions,
): ValidationRecording {
  const t = syntheticFaceSession(o);
  return {
    id,
    participantId,
    deviceModel: `synthetic-${o.fps ?? 30}fps`,
    condition,
    source: 'synthetic',
    scanType: 'face',
    frames: t.inputs,
    reference: o.noPulse
      ? { pulsePresent: false }
      : {
          pulsePresent: true,
          heartRateBpm: t.meanHrBpm,
          beatTimesSec: t.beatTimesSec,
          breathingPerMin:
            (o.respAmplitude ?? 0.002) > 0 || (o.rsaSec ?? 0.05) > 0
              ? t.breathingPerMin
              : undefined,
        },
  };
}
