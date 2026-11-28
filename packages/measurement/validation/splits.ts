/**
 * Participant-level data splits. Frames, windows or recordings of one
 * participant are strongly correlated, so any tuning/evaluation split must
 * keep every participant entirely on one side; splitting by frame or by
 * recording would leak a participant's signal characteristics into the test
 * set and overstate accuracy.
 */
import { mulberry32 } from './synthetic';
import type { ValidationRecording } from './recording';

export interface Fold {
  train: ValidationRecording[];
  test: ValidationRecording[];
  testParticipants: string[];
}

/** k folds; each participant's recordings are in exactly one test fold. */
export function participantFolds(recordings: ValidationRecording[], k: number, seed = 1): Fold[] {
  const ids = [...new Set(recordings.map((r) => r.participantId))].sort();
  if (k < 2 || k > ids.length) throw new Error(`need 2 <= k <= participants (${ids.length})`);
  const rng = mulberry32(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const folds: Fold[] = [];
  for (let f = 0; f < k; f++) {
    const testIds = new Set(ids.filter((_, i) => i % k === f));
    const fold = {
      train: recordings.filter((r) => !testIds.has(r.participantId)),
      test: recordings.filter((r) => testIds.has(r.participantId)),
      testParticipants: [...testIds].sort(),
    };
    assertNoParticipantLeakage(fold.train, fold.test);
    folds.push(fold);
  }
  return folds;
}

/** Throws if any participant appears on both sides. */
export function assertNoParticipantLeakage(
  train: ValidationRecording[],
  test: ValidationRecording[],
): void {
  const a = new Set(train.map((r) => r.participantId));
  const shared = [...new Set(test.map((r) => r.participantId))].filter((p) => a.has(p));
  if (shared.length) throw new Error(`participant leakage between splits: ${shared.join(', ')}`);
}
