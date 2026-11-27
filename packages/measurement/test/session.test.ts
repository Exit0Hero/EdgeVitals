import { describe, expect, it } from 'vitest';
import { ScanSession } from '../src/session';
import { syntheticSession } from './fixtures/synthetic';

describe('ScanSession', () => {
  it('reports real progress, interim heart rate and finishes at the target', () => {
    const truth = syntheticSession({ durationSec: 46, noise: 0.03, seed: 21 });
    const s = new ScanSession(45, 90);
    let finished = false;
    let sawInterim = false;
    let sawHrv = false;
    let sawBreathing = false;
    for (const f of truth.frames) {
      s.pushFrame({ t: f.t, faces: [f.face!], roi: f.roi, frameWidth: 640, frameHeight: 640 });
      const live = s.liveState();
      expect(live.metrics.spo2).toBe('unavailable');
      if (live.interimHeartRate !== null) sawInterim = true;
      if (live.interimHrv !== null) sawHrv = true;
      if (live.interimBreathingRate !== null) sawBreathing = true;
      if (s.shouldFinish()) {
        finished = true;
        break;
      }
    }
    expect(sawInterim).toBe(true);
    expect(sawHrv).toBe(true);
    expect(sawBreathing).toBe(true);
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

  it('does not treat face-detector box jitter at 30 fps as motion', () => {
    const truth = syntheticSession({ durationSec: 46, noise: 0.03, seed: 5 });
    const s = new ScanSession(45, 90);
    let i = 0;
    for (const f of truth.frames) {
      // ±3 px alternating jitter on a ~250 px face, like ML Kit's fast mode.
      const j = i++ % 2 ? 3 : -3;
      const face = { ...f.face!, x: f.face!.x + j, y: f.face!.y - j };
      const sample = s.pushFrame({
        t: f.t,
        faces: [face],
        roi: f.roi,
        frameWidth: 640,
        frameHeight: 640,
      });
      expect(sample.flags).not.toContain('motion_too_high');
    }
    expect(s.finish().outcome).toBe('completed');
  });

  it('bridges isolated missed detections instead of restarting the clean segment', () => {
    const truth = syntheticSession({ durationSec: 46, noise: 0.03, seed: 6 });
    const s = new ScanSession(45, 90);
    let i = 0;
    for (const f of truth.frames) {
      const missed = i++ % 25 === 0; // one missed face roughly every 0.8 s
      s.pushFrame({
        t: f.t,
        faces: missed ? [] : [f.face!],
        roi: missed ? null : f.roi,
        frameWidth: 640,
        frameHeight: 640,
      });
    }
    expect(s.liveState().usableSec).toBeGreaterThan(44);
  });

  it('exports a compact per-frame colour trace before finishing', () => {
    const truth = syntheticSession({ durationSec: 20, seed: 3 });
    const s = new ScanSession();
    for (const f of truth.frames)
      s.pushFrame({ t: f.t, faces: [f.face!], roi: f.roi, frameWidth: 640, frameHeight: 640 });
    const lines = s.exportTrace().split('\n');
    expect(lines[0]).toMatch(/^edgevitals-trace v2/);
    expect(lines).toHaveLength(truth.frames.length + 1);
    const [dt, r, g, b, u, skin] = lines[2]!.split(',').map(Number);
    expect(skin).toBe(2000);
    expect(dt).toBeGreaterThan(0);
    expect(r! * g! * b!).toBeGreaterThan(0);
    expect([0, 1]).toContain(u);
    const res = s.finish();
    const sig = res.diagnostics.signal!;
    expect(Math.abs(sig.greenPeakBpm! - truth.meanHrBpm)).toBeLessThan(3);
    expect(sig.bandAmplitudePct).toBeGreaterThan(0);
    expect(sig.intervalP90Ms).toBeGreaterThanOrEqual(sig.intervalP10Ms);
  });
});
