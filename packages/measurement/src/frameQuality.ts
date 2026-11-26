import { PIPELINE_CONFIG } from './config';
import type { FaceBox, FrameQualityFlag, RoiSample } from './types';

export interface FrameQualityInput {
  t: number;
  faces: FaceBox[];
  roi: RoiSample | null;
  frameWidth: number;
  frameHeight: number;
  /** Previous primary face and its timestamp, for motion estimation. */
  previous?: { t: number; face: FaceBox } | null;
}

const cfg = PIPELINE_CONFIG.frame;

/**
 * Evaluate one frame against the capture quality gates. A frame is usable
 * only when no flag is raised. Flags are ordered by what the user should fix
 * first (face presence before lighting before motion).
 */
export function assessFrame(input: FrameQualityInput): FrameQualityFlag[] {
  const flags: FrameQualityFlag[] = [];
  const { faces, roi, frameWidth, frameHeight } = input;
  if (faces.length === 0) return ['face_not_found'];
  if (faces.length > 1) flags.push('multiple_faces');
  const face = faces[0]!;

  const cx = (face.x + face.width / 2) / frameWidth;
  const cy = (face.y + face.height / 2) / frameHeight;
  const [gx, gy] = cfg.guideCenter;
  const [rx, ry] = cfg.guideRadii;
  const inEllipse = ((cx - gx) / rx) ** 2 + ((cy - gy) / ry) ** 2 <= 1;
  const wf = face.width / frameWidth;
  if (!inEllipse || wf < cfg.minFaceWidthFraction || wf > cfg.maxFaceWidthFraction) {
    flags.push('face_out_of_region');
  }

  if (roi) {
    if (roi.luma < cfg.minLuma) flags.push('lighting_too_low');
    else if (roi.luma > cfg.maxLuma || roi.clippedFraction > cfg.maxClippedFraction)
      flags.push('lighting_too_high');
    if (roi.skinPixels < cfg.minSkinPixels && !flags.includes('lighting_too_low'))
      flags.push('signal_insufficient');
  } else {
    flags.push('signal_insufficient');
  }

  if (input.previous) {
    const dt = (input.t - input.previous.t) / 1000;
    if (dt > 0 && dt < 1) {
      const p = input.previous.face;
      const dx = face.x + face.width / 2 - (p.x + p.width / 2);
      const dy = face.y + face.height / 2 - (p.y + p.height / 2);
      const speed = Math.hypot(dx, dy) / face.width / dt;
      if (speed > cfg.maxFaceSpeed) flags.push('motion_too_high');
    }
  }
  return flags;
}

/** User-facing guidance for each flag (corrective action, never diagnostic). */
export const FLAG_GUIDANCE: Record<FrameQualityFlag | 'ready', string> = {
  face_not_found: 'We can’t see your face. Centre it in the oval.',
  multiple_faces: 'More than one face is visible. Make sure only you are in view.',
  face_out_of_region: 'Move so your face fills the oval.',
  lighting_too_low: 'It’s too dark. Face a window or turn on a light.',
  lighting_too_high: 'Too much light. Avoid direct light or a bright window behind you.',
  motion_too_high: 'Keep still. Rest your arms and hold the phone steady.',
  signal_insufficient: 'We can’t see enough skin. Move hair or glasses away from your face.',
  ready: 'Face detected · lighting good',
};
