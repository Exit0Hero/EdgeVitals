import { describe, expect, it } from 'vitest';
import {
  StartLog,
  enableTorchWithRetry,
  startProblem,
  type TorchController,
} from '../src/camera/fingerStart';

const noSleep = async () => undefined;

/** A fake CameraX torch: rejects until the session is "active", like CameraX does. */
function fakeTorch(failures: number, settles = true): TorchController & { calls: number } {
  const c = {
    calls: 0,
    torchMode: 'off' as 'on' | 'off',
    async setTorchMode(mode: 'on' | 'off') {
      c.calls++;
      if (c.calls <= failures) throw new Error('Camera is not active.');
      if (settles) c.torchMode = mode;
    },
  };
  return c;
}

describe('finger scan flash start-up', () => {
  it('turns the flash on first time when the camera is ready', async () => {
    const log = new StartLog();
    const t = fakeTorch(0);
    const r = await enableTorchWithRetry(t, log, undefined, noSleep);
    expect(r).toEqual({ ok: true, attempts: 1, error: null });
    expect(log.text()).toMatch(/attempt 1 resolved, state=on/);
  });

  it('retries while CameraX says the camera is not active yet', async () => {
    const log = new StartLog();
    const t = fakeTorch(2);
    const r = await enableTorchWithRetry(t, log, undefined, noSleep);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(log.text()).toMatch(/attempt 1 failed: Camera is not active/);
  });

  it('reports a visible error after the last attempt instead of failing silently', async () => {
    const log = new StartLog();
    const r = await enableTorchWithRetry(fakeTorch(99), log, [0, 1, 1], noSleep);
    expect(r).toEqual({ ok: false, attempts: 3, error: 'Camera is not active.' });
  });

  it('treats a torch that never reports on as a failure', async () => {
    const r = await enableTorchWithRetry(fakeTorch(0, false), new StartLog(), [0, 1], noSleep);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/stayed off/);
  });

  it('fails clearly without a camera controller', async () => {
    const r = await enableTorchWithRetry(undefined, new StartLog(), [0, 1], noSleep);
    expect(r).toEqual({ ok: false, attempts: 0, error: 'no camera controller' });
  });

  it('stops when the screen goes away', async () => {
    const r = await enableTorchWithRetry(
      fakeTorch(5),
      new StartLog(),
      [0, 1, 1],
      noSleep,
      () => true,
    );
    expect(r.error).toBe('cancelled');
  });
});

describe('finger scan start-up watchdog', () => {
  it('flags a camera that never starts or never sends frames', () => {
    expect(startProblem(3_000, null, 0)).toBeNull();
    expect(startProblem(10_000, null, 0)).toBe('not_started');
    expect(startProblem(12_000, 2_000, 0)).toBeNull();
    expect(startProblem(15_000, 5_000, 0)).toBe('no_frames');
    expect(startProblem(15_000, 5_000, 40)).toBeNull();
  });

  it('keeps a timestamped log', () => {
    let now = 1000;
    const log = new StartLog(() => now);
    now = 1500;
    log.add('camera started');
    expect(log.text()).toBe('+0.50s camera started');
  });
});
