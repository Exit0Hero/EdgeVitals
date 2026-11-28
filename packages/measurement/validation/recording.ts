/**
 * Recording format for the offline validation harness.
 *
 * A recording holds the per-frame aggregates the app already computes (no
 * pixels: timestamps, face box, mean skin colour per region) plus the
 * reference measurements taken at the same time by an independent device.
 * Real recordings can only come from a study with consent for that purpose;
 * the app never uploads frames (ADR 0003), and none have been collected yet.
 */
import type { FrameInput } from '../src/session';
import type { FaceBox, FrameSample, RoiRegionSample } from '../src/types';

export interface ValidationReference {
  /** false for a deliberately pulseless recording (e.g. a photo, a wall); any value reported is a false acceptance. */
  pulsePresent?: boolean;
  /** Mean heart rate over the recording from the reference device, bpm. */
  heartRateBpm?: number;
  heartRateDevice?: string;
  /** ECG R-peak (or reference beat) times on the recording clock, seconds. */
  beatTimesSec?: number[];
  /** Reference breathing rate over the recording, /min (capnography or chest belt). */
  breathingPerMin?: number;
  breathingDevice?: string;
}

export interface ValidationRecording {
  id: string;
  /** Pseudonymous participant id. Splits are always by participant. */
  participantId: string;
  deviceModel: string;
  /** Free text, e.g. 'daylight-still', 'lamp-talking'. */
  condition: string;
  /** 'synthetic' recordings are generated test signals, never evidence of accuracy. */
  source: 'synthetic' | 'real';
  scanType: 'face';
  /**
   * Frames before the live gates (re-labelled by the harness exactly as the app
   * does), or frames already labelled on the device (imported traces).
   */
  frames: FrameInput[] | FrameSample[];
  reference: ValidationReference;
  notes?: string;
}

export function isLabelled(frames: FrameInput[] | FrameSample[]): frames is FrameSample[] {
  return frames.length > 0 && 'usable' in frames[0]!;
}

/**
 * Parse a signal trace shared from the app (Scan details › Share signal
 * trace), formats v3 and v4. The device's own usable flag is kept, so the
 * gates are as they were on the phone. v3 has no face position: a centred
 * box of the recorded width is used, so head-motion breathing and the
 * motion artefact check cannot be reproduced from v3 traces.
 */
export function parseTrace(
  text: string,
  meta: Omit<ValidationRecording, 'frames' | 'source' | 'scanType'>,
): ValidationRecording {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const hi = lines.findIndex((l) => l.startsWith('edgevitals-trace'));
  if (hi < 0) throw new Error('not an edgevitals signal trace');
  const version = /edgevitals-trace v(\d+)/.exec(lines[hi]!)?.[1];
  if (version !== '3' && version !== '4') throw new Error(`unsupported trace version v${version}`);
  const frames: FrameSample[] = [];
  let t = 0;
  for (const line of lines.slice(hi + 1)) {
    const c = line.split(',').map(Number);
    if (c.some((v) => !Number.isFinite(v))) continue;
    t += c[0]!;
    const regions: RoiRegionSample[] = [];
    for (let k = 0; k < 3; k++) {
      const [r, g, b] = [c[8 + 3 * k]! / 100, c[9 + 3 * k]! / 100, c[10 + 3 * k]! / 100];
      const reg: RoiRegionSample = { r, g, b, n: r > 0 ? 1 : 0 };
      if (version === '4') {
        reg.n = c[20 + 3 * k] ?? 0;
        reg.luma = (c[21 + 3 * k] ?? 0) / 10;
        reg.clipped = (c[22 + 3 * k] ?? 0) / 1000;
      }
      regions.push(reg);
    }
    if (version === '3') {
      // v3 has no per-region pixel count; spread the total by presence.
      const present = regions.filter((r) => r.n > 0).length || 1;
      for (const r of regions) if (r.n > 0) r.n = Math.max(1, Math.round(c[5]! / present));
    }
    const w = c[7]!;
    const face: FaceBox | null =
      w > 0
        ? version === '4'
          ? { x: c[17]!, y: c[18]!, width: w, height: c[19]! }
          : { x: 240 - w / 2, y: 320 - (1.25 * w) / 2, width: w, height: 1.25 * w }
        : null;
    const hasRoi = c[1]! > 0;
    frames.push({
      t,
      roi: hasRoi
        ? {
            r: c[1]! / 100,
            g: c[2]! / 100,
            b: c[3]! / 100,
            skinPixels: c[5]!,
            luma: c[6]! / 10,
            clippedFraction: 0,
            regions,
          }
        : null,
      face,
      faceCount: face ? 1 : 0,
      frameWidth: 480,
      frameHeight: 640,
      flags: c[4] === 1 ? [] : ['signal_insufficient'],
      usable: c[4] === 1 && hasRoi,
    });
  }
  return { ...meta, frames, source: 'real', scanType: 'face' };
}
