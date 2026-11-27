import { PIPELINE_CONFIG } from './config';
import { FLAG_GUIDANCE, assessFrame } from './frameQuality';
import { analyzeSession, longestUsableSegment, SUPPORTED_METRICS } from './pipeline';
import type {
  FaceBox,
  FrameQualityFlag,
  FrameSample,
  MetricId,
  RoiSample,
  SessionResult,
} from './types';

export type LiveMetricState = 'pending' | 'measuring' | 'available' | 'unavailable';

export interface LiveScanState {
  /** Dominant quality status over the last ~10 frames, or 'ready'. */
  quality: FrameQualityFlag | 'ready' | 'starting';
  guidance: string;
  elapsedSec: number;
  usableSec: number;
  /** Real progress: usable contiguous signal over target, 0-1. */
  progress: number;
  metrics: Record<MetricId, LiveMetricState>;
  /** Interim heart rate once enough clean signal exists; null otherwise. */
  interimHeartRate: number | null;
  /** Interim HRV estimate passing the full quality gates, if any. */
  interimHrv: number | null;
  /** Interim breathing estimate passing the full quality gates, if any. */
  interimBreathingRate: number | null;
}

export interface FrameInput {
  /** Monotonic timestamp, ms. */
  t: number;
  faces: FaceBox[];
  roi: RoiSample | null;
  frameWidth: number;
  frameHeight: number;
}

/**
 * Stateful scan orchestrator. Holds only per-frame aggregate statistics
 * (mean ROI colour, face box, flags); never raw frames. Buffers are cleared
 * on finish() and cancel().
 */
export class ScanSession {
  private frames: FrameSample[] = [];
  private startT: number | null = null;
  private lastInterimAt = 0;
  private interimHr: number | null = null;
  private interimHrv: number | null = null;
  private interimBreathing: number | null = null;
  private done = false;

  constructor(
    private readonly targetUsableSec: number = PIPELINE_CONFIG.targetUsableSec,
    private readonly maxScanSec: number = PIPELINE_CONFIG.maxScanSec,
    /** Opt-in experimental estimators (ADR 0008). */
    private readonly experimental: { spo2?: boolean } = {},
  ) {}

  get frameCount(): number {
    return this.frames.length;
  }

  pushFrame(input: FrameInput): FrameSample {
    if (this.done) throw new Error('ScanSession already finished');
    if (this.startT === null) this.startT = input.t;
    // Motion baseline: the latest face seen at least motionBaselineSec earlier.
    const baselineT = input.t - PIPELINE_CONFIG.frame.motionBaselineSec * 1000;
    let prev: FrameSample | undefined;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i]!;
      if (f.t > baselineT) continue;
      if (input.t - f.t >= 1000) break;
      if (f.face) {
        prev = f;
        break;
      }
    }
    const flags = assessFrame({
      ...input,
      previous: prev?.face ? { t: prev.t, face: prev.face } : null,
    });
    const sample: FrameSample = {
      t: input.t,
      roi: input.roi,
      face: input.faces[0] ?? null,
      faceCount: input.faces.length,
      frameWidth: input.frameWidth,
      frameHeight: input.frameHeight,
      flags,
      usable: flags.length === 0 && !!input.roi,
    };
    this.frames.push(sample);
    return sample;
  }

  private usableSec(): number {
    const seg = longestUsableSegment(this.frames);
    return seg.length > 1 ? (seg[seg.length - 1]!.t - seg[0]!.t) / 1000 : 0;
  }

  liveState(): LiveScanState {
    const last = this.frames[this.frames.length - 1];
    const elapsedSec = last && this.startT !== null ? (last.t - this.startT) / 1000 : 0;
    const usableSec = this.usableSec();

    let quality: LiveScanState['quality'] = 'starting';
    const recent = this.frames.slice(-10);
    if (recent.length) {
      const usable = recent.filter((f) => f.usable).length;
      if (usable / recent.length >= 0.7) quality = 'ready';
      else {
        const counts = new Map<FrameQualityFlag, number>();
        for (const f of recent) for (const fl of f.flags) counts.set(fl, (counts.get(fl) ?? 0) + 1);
        quality =
          [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'signal_insufficient';
      }
    }

    // Interim HR, recomputed at most every 2 s once 15 s of clean signal exists.
    if (
      usableSec >= PIPELINE_CONFIG.minHrDurationSec &&
      last &&
      last.t - this.lastInterimAt > 2000
    ) {
      this.lastInterimAt = last.t;
      const res = analyzeSession(this.frames);
      const currentValue = (metric: MetricId) => {
        const result = res.metrics.find((m) => m.metric === metric);
        return result?.status === 'valid' ? result.value : null;
      };
      this.interimHr = currentValue('heart_rate');
      this.interimHrv = currentValue('hrv');
      this.interimBreathing = currentValue('breathing_rate');
    }

    const metrics = {} as Record<MetricId, LiveMetricState>;
    for (const m of SUPPORTED_METRICS) metrics[m] = usableSec > 0 ? 'measuring' : 'pending';
    if (this.interimHr !== null) metrics.heart_rate = 'available';
    if (this.interimHrv !== null) metrics.hrv = 'available';
    if (this.interimBreathing !== null) metrics.breathing_rate = 'available';
    metrics.spo2 = this.experimental.spo2
      ? usableSec > 0
        ? 'measuring'
        : 'pending'
      : 'unavailable';
    metrics.blood_pressure = 'unavailable';

    return {
      quality,
      guidance: quality === 'starting' ? 'Starting camera…' : FLAG_GUIDANCE[quality],
      elapsedSec,
      usableSec,
      progress: Math.min(1, usableSec / this.targetUsableSec),
      metrics,
      interimHeartRate: this.interimHr,
      interimHrv: this.interimHrv,
      interimBreathingRate: this.interimBreathing,
    };
  }

  /** True when enough clean signal is captured or the hard time limit is hit. */
  shouldFinish(): boolean {
    const s = this.liveStateLite();
    return s.usableSec >= this.targetUsableSec || s.elapsedSec >= this.maxScanSec;
  }

  private liveStateLite(): { usableSec: number; elapsedSec: number } {
    const last = this.frames[this.frames.length - 1];
    return {
      usableSec: this.usableSec(),
      elapsedSec: last && this.startT !== null ? (last.t - this.startT) / 1000 : 0,
    };
  }

  finish(): SessionResult {
    const result = analyzeSession(this.frames, { experimentalSpo2: !!this.experimental.spo2 });
    this.clear();
    return result;
  }

  cancel(): SessionResult {
    const result = analyzeSession(this.frames, { cancelled: true });
    this.clear();
    return result;
  }

  private clear(): void {
    this.frames = [];
    this.done = true;
    this.interimHr = null;
    this.interimHrv = null;
    this.interimBreathing = null;
  }
}
