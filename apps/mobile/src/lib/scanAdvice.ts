import type { SessionResult } from '@edgevitals/measurement';

/**
 * What this particular scan showed, and what to change next time.
 *
 * Built only from the scan's own on-device diagnostics (aggregates, never
 * pixels). Each finding names the measured value and the level the analysis
 * needs, so a withheld vital is never left as "signal too weak" without a
 * reason. It never describes a health finding: it is about the recording.
 */
export interface ScanFinding {
  id: string;
  /** What was measured, in plain words, with the number. */
  finding: string;
  /** One concrete thing to change. */
  fix: string;
  /** Vitals this mainly affected. */
  affects: ('heart_rate' | 'hrv' | 'breathing_rate')[];
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((100 * n) / d) : 0);

export function scanFindings(r: SessionResult): ScanFinding[] {
  if (r.outcome === 'cancelled') return [];
  const d = r.diagnostics;
  const status = (m: string) => r.metrics.find((x) => x.metric === m);
  const missing = (m: string) => status(m)?.status !== 'valid';
  const low = (m: string) => !!status(m)?.qualityFlags.includes('low_confidence');
  const out: ScanFinding[] = [];

  if (r.scanType === 'finger') {
    const f = d.finger;
    const c = d.capture as
      { frameCount: number; flagCounts: Partial<Record<string, number>> } | undefined;
    if (c && c.frameCount > 0) {
      const uncovered = (c.flagCounts.finger_not_detected ?? 0) + (c.flagCounts.too_bright ?? 0);
      if (pct(uncovered, c.frameCount) >= 15)
        out.push({
          id: 'finger_uncovered',
          finding: `The lens was not fully covered for ${pct(uncovered, c.frameCount)}% of the scan.`,
          fix: 'Cover both the camera and the flash with the pad of your fingertip.',
          affects: ['heart_rate', 'hrv', 'breathing_rate'],
        });
      const moving = c.flagCounts.finger_moving ?? 0;
      if (pct(moving, c.frameCount) >= 5)
        out.push({
          id: 'finger_moving',
          finding: `Your finger moved in ${pct(moving, c.frameCount)}% of frames.`,
          fix: 'Rest your hand and phone on a table so nothing shifts.',
          affects: ['heart_rate', 'hrv', 'breathing_rate'],
        });
    }
    if (d.usableDurationSec < 30 && d.durationSec >= 15)
      out.push({
        id: 'finger_short',
        finding: `Only ${Math.round(d.usableDurationSec)} s of steady signal (PRV and breathing need 30 s).`,
        fix: 'Keep your fingertip in place until the scan ends.',
        affects: ['hrv', 'breathing_rate'],
      });
    if (
      f?.pulseStrengthPct != null &&
      f.pulseStrengthPct < 1.5 &&
      (missing('hrv') || missing('breathing_rate'))
    )
      out.push({
        id: 'finger_weak_pulse',
        finding: `Your pulse made the image ${f.pulseStrengthPct.toFixed(2)}% darker on each beat, which is weak.`,
        fix: 'Press lightly (pressing hard squeezes the blood out), and warm cold hands first.',
        affects: ['hrv', 'breathing_rate'],
      });
    if (
      missing('hrv') &&
      status('heart_rate')?.status === 'valid' &&
      f?.timingNoiseMs != null &&
      f.timingLimitMs != null &&
      f.timingNoiseMs > f.timingLimitMs
    )
      out.push({
        id: 'finger_timing',
        finding: `Beat timing was uncertain by about ${Math.round(f.timingNoiseMs)} ms. PRV needs ${f.timingLimitMs} ms or less, or it would mostly show noise.`,
        fix: 'A stronger, steadier pulse sharpens each beat: light pressure, warm hands, arm resting.',
        affects: ['hrv'],
      });
    const clearest = f?.breathing.length
      ? Math.max(...f.breathing.map((b) => b.concentration))
      : null;
    if (
      (missing('breathing_rate') || low('breathing_rate')) &&
      clearest !== null &&
      d.usableDurationSec >= 30
    )
      out.push({
        id: 'finger_breathing',
        finding: `The breathing rhythm reached ${Math.round(100 * clearest)}% clarity. A ${missing('breathing_rate') ? 'value needs 45%' : 'confident value needs 50%'}; random noise alone can reach about 40%.`,
        fix: 'Breathe slowly and evenly through the whole scan, without holding your breath.',
        affects: ['breathing_rate'],
      });
    return out;
  }

  // Face scan.
  const c = d.capture;
  const fps = c && c.medianFrameIntervalMs > 0 ? 1000 / c.medianFrameIntervalMs : null;
  if (fps !== null && fps < 25)
    out.push({
      id: 'face_low_fps',
      finding: `The camera ran at ${Math.round(fps)} frames a second. Phones slow down like this in dim light.`,
      fix: 'Face a window or a lamp so light falls evenly on your face.',
      affects: ['heart_rate', 'hrv'],
    });
  if (c && c.frameCount > 0) {
    const noFace = (c.flagCounts.face_not_found ?? 0) + (c.flagCounts.face_out_of_region ?? 0);
    if (pct(noFace, c.frameCount) >= 5)
      out.push({
        id: 'face_lost',
        finding: `Your face was outside the oval in ${pct(noFace, c.frameCount)}% of frames.`,
        fix: 'Prop the phone up at eye level and keep your whole face in the oval.',
        affects: ['heart_rate', 'hrv', 'breathing_rate'],
      });
    const dark = (c.flagCounts.lighting_too_low ?? 0) + (c.flagCounts.lighting_too_high ?? 0);
    if (pct(dark, c.frameCount) >= 5)
      out.push({
        id: 'face_lighting',
        finding: `Lighting was too dark or too bright in ${pct(dark, c.frameCount)}% of frames.`,
        fix: 'Use soft, even light from the front; avoid a bright window behind you.',
        affects: ['heart_rate', 'hrv', 'breathing_rate'],
      });
    const moving = c.flagCounts.motion_too_high ?? 0;
    if (pct(moving, c.frameCount) >= 5)
      out.push({
        id: 'face_motion',
        finding: `Your head moved in ${pct(moving, c.frameCount)}% of frames.`,
        fix: 'Rest your elbows or prop the phone up, and avoid talking.',
        affects: ['heart_rate', 'hrv', 'breathing_rate'],
      });
  }
  if (d.durationSec >= 20 && d.usableDurationSec < 40)
    out.push({
      id: 'face_short',
      finding: `The longest steady stretch was ${Math.round(d.usableDurationSec)} s. Heart rate from the face needs about 45 s without interruption.`,
      fix: 'Stay still until the scan ends; each movement restarts the steady stretch.',
      affects: ['heart_rate', 'hrv', 'breathing_rate'],
    });
  if ((missing('heart_rate') || low('heart_rate')) && d.hrSnrDb !== null && d.hrSnrDb < 3)
    out.push({
      id: 'face_weak_pulse',
      finding: `The pulse was faint in the face signal (${d.hrSnrDb.toFixed(1)} dB above noise).`,
      fix: 'Brighter, even light helps most. The finger scan gives a much stronger signal.',
      affects: ['heart_rate', 'hrv'],
    });
  return out;
}
