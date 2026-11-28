/**
 * The SYNTHETIC verification set used by `npm run validate -- --synthetic`
 * and by test/validation.test.ts. Six simulated "participants" (different
 * heart rates, pulse strengths and noise levels) x seven conditions. All of
 * it is generated; none of it is evidence of accuracy on people.
 */
import type { ValidationRecording } from './recording';
import { syntheticRecording, type FaceSyntheticOptions } from './synthetic';

const PARTICIPANTS: { id: string; hr: number; amp: number; noise: number; br: number }[] = [
  { id: 'S01', hr: 58, amp: 0.004, noise: 0.3, br: 12 },
  { id: 'S02', hr: 66, amp: 0.003, noise: 0.4, br: 14 },
  { id: 'S03', hr: 74, amp: 0.0025, noise: 0.5, br: 16 },
  { id: 'S04', hr: 83, amp: 0.002, noise: 0.5, br: 18 },
  { id: 'S05', hr: 95, amp: 0.0015, noise: 0.6, br: 13 },
  { id: 'S06', hr: 108, amp: 0.0035, noise: 0.3, br: 20 },
];

const CONDITIONS: Record<string, (p: (typeof PARTICIPANTS)[number]) => FaceSyntheticOptions> = {
  still: () => ({}),
  'motion-bursts': () => ({
    motionBursts: [
      { t0: 14, t1: 15.5, px: 40, colourPct: 2 },
      { t0: 33, t1: 34, px: 30, colourPct: 1.5 },
    ],
  }),
  'lighting-step': () => ({ lightingSteps: [{ t: 25, factor: 1.06 }] }),
  'dropped-frames': () => ({ dropProbability: 0.05, dropBursts: [{ t0: 20, t1: 20.25 }] }),
  'distorted-peaks': () => ({ shapeDistortion: 0.6 }),
  'one-region-no-pulse': () => ({ regionPulseGain: [1, 1, 0] }),
  // No subject at all (a photo or an empty frame): no pulse, no breathing
  // modulation and no breathing head movement, so any reported vital is false.
  pulseless: () => ({ noPulse: true, respAmplitude: 0, respMotionPx: 0, rsaSec: 0 }),
};

export function syntheticDataset(durationSec = 60): ValidationRecording[] {
  const out: ValidationRecording[] = [];
  let seed = 1000;
  for (const p of PARTICIPANTS)
    for (const [cond, mk] of Object.entries(CONDITIONS))
      for (const fps of [20, 30])
        out.push(
          syntheticRecording(`${p.id}-${cond}-${fps}`, p.id, cond, {
            seed: seed++,
            durationSec,
            fps,
            heartRateBpm: p.hr,
            pulseAmplitude: p.amp,
            regionNoise: p.noise,
            breathingPerMin: p.br,
            rsaSec: 0.06,
            respMotionPx: 1.5,
            ...mk(p),
          }),
        );
  return out;
}
