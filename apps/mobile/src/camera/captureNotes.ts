/** Outcome of the last auto-exposure/white-balance lock attempt (native only). */
export type ExposureLockState = 'off' | 'pending' | 'locked' | 'unsupported' | 'failed';

let exposureLock: ExposureLockState = 'off';

export function setExposureLock(state: ExposureLockState): void {
  exposureLock = state;
}

/** Recorded in the signal trace header so a failed scan shows whether AE/AWB was locked. */
export function getExposureLock(): ExposureLockState {
  return exposureLock;
}

/**
 * Frame rate the face scan asked the camera for, and the rate the camera
 * reported selecting (VisionCamera onSessionConfigSelected). The rate frames
 * actually arrive at is measured from their timestamps by the measurement
 * package; these two only say what was requested and promised.
 */
export interface CaptureFps {
  requested: number | null;
  selected: number | null;
}

let captureFps: CaptureFps = { requested: null, selected: null };

export function setCaptureFps(fps: CaptureFps): void {
  captureFps = fps;
}

export function getCaptureFps(): CaptureFps {
  return captureFps;
}

/** First line of a shared signal trace: capture settings that are not in the per-frame data. */
export function traceHeader(): string {
  const f = captureFps;
  return `exposure_lock=${exposureLock} requested_fps=${f.requested ?? 'na'} selected_fps=${f.selected ?? 'na'}`;
}
