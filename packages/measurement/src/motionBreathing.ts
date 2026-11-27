/**
 * Breathing rate from head movement during the face scan.
 *
 * Breathing moves the head and shoulders slightly up and down. The face
 * detector's box follows that movement, so the vertical position of the face
 * centre carries the breathing rhythm independently of the faint colour pulse
 * (Shao et al., IEEE TBME 2014, used shoulder motion; we only have the face
 * box). Detector jitter and posture drift also move the box, so the rate is
 * reported only when the rhythm is clear in the whole scan AND most 20 s
 * windows agree on it.
 *
 * Thresholds are engineering defaults from synthetic traces
 * (test/motionBreathing.test.ts); not validated against a reference.
 */
import { bandpass, mean, median, resampleUniform, std, welch } from './dsp';
import { respiratoryPeak } from './finger';
import type { FrameSample, MotionBreathingDiagnostics } from './types';

export const MOTION_BREATHING = {
  algorithm: 'face-box-vertical-motion',
  sampleRateHz: 10,
  minDurationSec: 30,
  bandHz: [0.1, 0.5] as [number, number],
  windowSec: 20,
  hopSec: 2,
  toleranceBpm: 2,
  minConcentration: 0.55,
  minAgreement: 0.75,
  minWindows: 6,
  /** Band-passed movement SD, % of face height. Smaller is pixel quantisation; larger is swaying or talking. */
  amplitudePctRange: [0.05, 3] as [number, number],
} as const;

const mb = MOTION_BREATHING;

export function estimateMotionBreathing(seg: FrameSample[]): MotionBreathingDiagnostics | null {
  const withFace = seg.filter((f) => f.face && f.face.height > 0);
  if (withFace.length < 2) return null;
  const dur = (withFace[withFace.length - 1]!.t - withFace[0]!.t) / 1000;
  if (dur < mb.minDurationSec) return null;
  const h = median(withFace.map((f) => f.face!.height));
  const t = withFace.map((f) => f.t / 1000);
  const y = withFace.map((f) => (f.face!.y + f.face!.height / 2) / h);
  const fs = mb.sampleRateHz;
  const series = resampleUniform(t, y, fs);
  const amplitudePct = 100 * std(bandpass(series, 0.05, 0.7, fs));
  // Analyse vertical velocity, not position: posture drift is a random walk
  // whose power piles up at low frequencies (it produced false 6-8 /min
  // "breathing" peaks on position); differencing flattens it.
  const velocity = series.slice(1).map((v, i) => (v - series[i]!) * fs);
  const filtered = bandpass(velocity, 0.05, 0.7, fs);
  const none = (extra: Partial<MotionBreathingDiagnostics> = {}): MotionBreathingDiagnostics => ({
    perMin: null,
    concentration: 0,
    agreement: 0,
    windows: 0,
    amplitudePct: Math.round(amplitudePct * 1000) / 1000,
    passed: false,
    ...extra,
  });
  if (!(amplitudePct > 0)) return none();
  const whole = respiratoryPeak(filtered, fs);
  if (!whole) return none();
  const winLen = Math.round(mb.windowSec * fs);
  const hop = Math.round(mb.hopSec * fs);
  const votes: number[] = [];
  for (let s = 0; s + winLen <= filtered.length; s += hop) {
    const w = filtered.slice(s, s + winLen);
    const m = mean(w);
    const spec = welch(
      w.map((v) => v - m),
      fs,
      mb.windowSec,
      2048,
    );
    let best = -1;
    for (let k = 0; k < spec.freqs.length; k++) {
      const f = spec.freqs[k]!;
      if (f < mb.bandHz[0] || f > mb.bandHz[1]) continue;
      if (best < 0 || spec.power[k]! > spec.power[best]!) best = k;
    }
    if (best >= 0) votes.push(spec.freqs[best]! * 60);
  }
  const agree = votes.filter((v) => Math.abs(v - whole.perMin) <= mb.toleranceBpm).length;
  const agreement = votes.length ? agree / votes.length : 0;
  const passed =
    votes.length >= mb.minWindows &&
    whole.concentration >= mb.minConcentration &&
    agreement >= mb.minAgreement &&
    amplitudePct >= mb.amplitudePctRange[0] &&
    amplitudePct <= mb.amplitudePctRange[1];
  return {
    perMin: Math.round(whole.perMin * 10) / 10,
    concentration: Math.round(whole.concentration * 1000) / 1000,
    agreement: Math.round(agreement * 1000) / 1000,
    windows: votes.length,
    amplitudePct: Math.round(amplitudePct * 1000) / 1000,
    passed,
  };
}
