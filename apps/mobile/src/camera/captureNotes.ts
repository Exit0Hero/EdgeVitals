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
