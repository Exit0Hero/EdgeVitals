import type { SessionResult } from '@edgevitals/measurement';

/**
 * The on-device result of the most recent scan, kept in memory only so the
 * results screen can show "Scan details" for it. It is never uploaded or
 * written to disk, and it is kept apart from the assessment draft so that a
 * screen resetting the draft cannot hide the details.
 */
let last: { assessmentId: string; result: SessionResult } | null = null;

export function rememberScan(assessmentId: string, result: SessionResult): void {
  last = { assessmentId, result };
}

export function scanFor(assessmentId: string | undefined): SessionResult | null {
  return last && assessmentId && last.assessmentId === assessmentId ? last.result : null;
}
