import { describe, expect, it } from 'vitest';
import { ScanSession } from '../src/session';
import { syntheticSession } from './fixtures/synthetic';

describe('ScanSession', () => {
  it('reports real progress, interim heart rate and finishes at the target', () => {
    const truth = syntheticSession({ durationSec: 46, noise: 0.03, seed: 21 });
    const s = new ScanSession(45, 90);
    let finished = false;
    let sawInterim = false;
    for (const f of truth.frames) {
      s.pushFrame({ t: f.t, faces: [f.face!], roi: f.roi, frameWidth: 640, frameHeight: 640 });
      const live = s.liveState();
      expect(live.metrics.spo2).toBe('unavailable');
      if (live.interimHeartRate !== null) sawInterim = true;
      if (s.shouldFinish()) {
        finished = true;
        break;
      }
    }
    expect(sawInterim).toBe(true);
    expect(finished).toBe(true);
    const res = s.finish();
    expect(res.outcome).toBe('completed');
    expect(s.frameCount).toBe(0);
  });

  it('shows the dominant problem instead of "ready" when no face is visible', () => {
    const s = new ScanSession();
    for (let i = 0; i < 10; i++)
      s.pushFrame({ t: i * 33, faces: [], roi: null, frameWidth: 640, frameHeight: 640 });
    const live = s.liveState();
    expect(live.quality).toBe('face_not_found');
    expect(live.progress).toBe(0);
  });

  it('clears buffers on cancel and refuses further frames', () => {
    const s = new ScanSession();
    const truth = syntheticSession({ durationSec: 5 });
    for (const f of truth.frames)
      s.pushFrame({ t: f.t, faces: [f.face!], roi: f.roi, frameWidth: 640, frameHeight: 640 });
    const res = s.cancel();
    expect(res.outcome).toBe('cancelled');
    expect(s.frameCount).toBe(0);
    expect(() =>
      s.pushFrame({ t: 0, faces: [], roi: null, frameWidth: 1, frameHeight: 1 }),
    ).toThrow();
  });
});
