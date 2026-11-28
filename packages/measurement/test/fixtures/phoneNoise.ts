import type { FrameSample } from '../../src/types';
import { gauss, mulberry32 } from './synthetic';

/**
 * Pulseless capture with phone-like noise: each channel is the sum of white
 * sensor noise and slowly wandering (AR(1)) noise, correlated across
 * channels like the locked-exposure iQOO trace (band correlations R-G 0.5,
 * G-B 0.3, R-B 0.1; per-frame noise ~0.12-0.24%). Optional `pulse` adds a
 * known heart rate at the given relative amplitude, for sensitivity checks.
 */
export function phoneNoiseSession(o: {
  seed: number;
  durationSec?: number;
  fps?: number;
  scale?: number;
  ar?: number;
  pulse?: { bpm: number; amplitude: number };
  /** Pulse start phase, radians (default random). */
  phase?: number;
}): FrameSample[] {
  const rng = mulberry32(o.seed);
  const fps = o.fps ?? 20;
  const n = Math.floor((o.durationSec ?? 45) * fps);
  const k = o.scale ?? 1;
  const ar = o.ar ?? 0.95;
  const base = [173, 140, 117];
  const white = [0.0014, 0.0012, 0.0024];
  const slow = [0.0006, 0.0006, 0.0008];
  const st = [0, 0, 0];
  const frames: FrameSample[] = [];
  const randomPhase = rng() * 2 * Math.PI;
  let phase = o.phase ?? randomPhase;
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    // Shared factors give the cross-channel correlation.
    const common = gauss(rng);
    const rg = gauss(rng);
    const gb = gauss(rng);
    const e = [
      0.25 * common + 0.6 * rg,
      0.25 * common + 0.6 * rg + 0.4 * gb,
      0.25 * common + 0.4 * gb,
    ];
    const ch = base.map((c, j) => {
      st[j] = ar * st[j]! + Math.sqrt(1 - ar * ar) * (e[j]! + 0.6 * gauss(rng));
      return c * (1 + k * (white[j]! * gauss(rng) + slow[j]! * st[j]!));
    });
    if (o.pulse) {
      phase += (2 * Math.PI * o.pulse.bpm) / 60 / fps;
      const p = Math.sin(phase) + 0.3 * Math.sin(2 * phase);
      const sig = [0.33, 0.77, 0.53];
      for (let j = 0; j < 3; j++) ch[j] = ch[j]! * (1 + o.pulse.amplitude * sig[j]! * p);
    }
    frames.push({
      t: t * 1000,
      roi: { r: ch[0]!, g: ch[1]!, b: ch[2]!, skinPixels: 3000, luma: 140, clippedFraction: 0 },
      face: { x: 140, y: 150, width: 200, height: 240 },
      faceCount: 1,
      frameWidth: 480,
      frameHeight: 640,
      flags: [],
      usable: true,
    });
  }
  return frames;
}

/**
 * Phone-like noise with an independent noise draw in each of the three skin
 * regions (forehead, left and right cheek), pooled ROI = their mean. Each
 * region is noisier by sqrt(3), as a third of the pixels would be. The pulse,
 * if any, is the same in all regions. SYNTHETIC.
 */
export function phoneNoiseRegionsSession(o: {
  seed: number;
  durationSec?: number;
  pulse?: { bpm: number; amplitude: number };
}): FrameSample[] {
  const parts = [0, 1, 2].map((k) =>
    phoneNoiseSession({
      seed: o.seed * 3 + k,
      durationSec: o.durationSec,
      scale: Math.sqrt(3),
      pulse: o.pulse,
      // One pulse: the same phase in every region.
      phase: mulberry32(o.seed)() * 2 * Math.PI,
    }),
  );
  return parts[0]!.map((f, i) => {
    const regs = parts.map((p) => p[i]!.roi!);
    const avg = (c: 'r' | 'g' | 'b') => regs.reduce((s, r) => s + r[c], 0) / 3;
    return {
      ...f,
      roi: {
        ...f.roi!,
        r: avg('r'),
        g: avg('g'),
        b: avg('b'),
        regions: regs.map((r) => ({ r: r.r, g: r.g, b: r.b, n: 1000, luma: 140, clipped: 0 })),
      },
    };
  });
}
