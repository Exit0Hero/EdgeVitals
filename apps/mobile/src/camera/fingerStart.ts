/**
 * Start-up of the finger scan: switching the flash on reliably, and a
 * plain-text log of every start-up step so a failure on a phone can be
 * shared and diagnosed. Plain TypeScript (no React Native imports) so it is
 * unit-tested in Node.
 */

export interface TorchController {
  setTorchMode(mode: 'on' | 'off'): Promise<void>;
  readonly torchMode: 'on' | 'off';
}

/** Ordered, timestamped start-up events (no images, no personal data). */
export class StartLog {
  private readonly t0: number;
  private lines: string[] = [];

  constructor(private readonly now: () => number = Date.now) {
    this.t0 = now();
  }

  add(event: string): void {
    const ms = this.now() - this.t0;
    this.lines.push(`+${(ms / 1000).toFixed(2)}s ${event}`);
    if (this.lines.length > 80) this.lines.splice(1, 1);
  }

  text(): string {
    return this.lines.join('\n');
  }

  get length(): number {
    return this.lines.length;
  }
}

export interface TorchOutcome {
  ok: boolean;
  attempts: number;
  /** Last error message, when it failed. */
  error: string | null;
}

/**
 * Turn the flash on, retrying while the camera finishes starting.
 *
 * Why: the earlier build passed `torchMode="on"` as a Camera prop. VisionCamera
 * sends that to CameraX as soon as the controller exists, which can be before
 * the session is running; CameraX then rejects it ("Camera is not active"),
 * and the prop never retries. The scan screen showed a camera error, or ran
 * in the dark. Here the flash is switched on after the camera reports it has
 * started, retried with back-off, and checked by reading the torch state.
 */
export async function enableTorchWithRetry(
  controller: TorchController | null | undefined,
  log: StartLog,
  delaysMs: number[] = [0, 250, 600, 1200, 2000, 3000],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  isCancelled: () => boolean = () => false,
): Promise<TorchOutcome> {
  let error: string | null = controller ? null : 'no camera controller';
  let attempts = 0;
  for (const d of delaysMs) {
    if (d > 0) await sleep(d);
    if (isCancelled()) return { ok: false, attempts, error: 'cancelled' };
    if (!controller) {
      log.add('flash: camera controller not ready yet');
      continue;
    }
    attempts++;
    try {
      await controller.setTorchMode('on');
      // Some devices resolve before the torch state updates; give it a moment.
      if (controller.torchMode !== 'on') await sleep(150);
      const state = controller.torchMode;
      log.add(`flash: attempt ${attempts} resolved, state=${state}`);
      if (state === 'on') return { ok: true, attempts, error: null };
      error = `torch state stayed ${state}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log.add(`flash: attempt ${attempts} failed: ${error}`);
    }
  }
  return { ok: false, attempts, error };
}

export type StartProblem = 'not_started' | 'no_frames' | null;

/**
 * Start-up watchdog: the camera must report running within `startMs` of the
 * screen opening, and deliver frames within `framesMs` of running. Otherwise
 * the screen shows an error instead of waiting forever.
 */
export function startProblem(
  sinceOpenMs: number,
  runningForMs: number | null,
  framesReceived: number,
  startMs = 10_000,
  framesMs = 5_000,
): StartProblem {
  if (runningForMs === null) return sinceOpenMs >= startMs ? 'not_started' : null;
  return framesReceived === 0 && runningForMs >= framesMs ? 'no_frames' : null;
}
