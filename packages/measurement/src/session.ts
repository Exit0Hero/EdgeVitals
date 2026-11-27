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
  /** Pulse SNR (dB) of the signal so far, updated every 2 s after 15 s; null before. */
  interimSnrDb: number | null;
  /** Past the target length with no heart rate yet: scanning on to extendedUsableSec. */
  extended: boolean;
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
  private interimSnr: number | null = null;
  private done = false;

  constructor(
    private readonly targetUsableSec: number = PIPELINE_CONFIG.targetUsableSec,
    private readonly maxScanSec: number = PIPELINE_CONFIG.maxScanSec,
    /** Opt-in experimental estimators (ADR 0008). */
    private readonly experimental: { spo2?: boolean } = {},
    private readonly extendedUsableSec: number = PIPELINE_CONFIG.extendedUsableSec,
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
      this.interimSnr = res.diagnostics.hrSnrDb;
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
      interimSnrDb: this.interimSnr,
      extended: this.interimHr === null && usableSec >= this.targetUsableSec,
    };
  }

  /**
   * True when enough clean signal is captured or the hard time limit is hit.
   * When the heart rate has not passed its gates by targetUsableSec, the
   * scan keeps going up to extendedUsableSec: a weak but real pulse gets
   * more windows to agree on (simulated weak pulses: 53% pass at 45 s, 73%
   * by 75 s; pulseless captures checked at every interim step up to 75 s:
   * none passed). See docs/adr/0004.
   */
  shouldFinish(): boolean {
    const s = this.liveStateLite();
    if (s.elapsedSec >= this.maxScanSec) return true;
    if (s.usableSec < this.targetUsableSec) return false;
    return this.interimHr !== null || s.usableSec >= this.extendedUsableSec;
  }

  private liveStateLite(): { usableSec: number; elapsedSec: number } {
    const last = this.frames[this.frames.length - 1];
    return {
      usableSec: this.usableSec(),
      elapsedSec: last && this.startT !== null ? (last.t - this.startT) / 1000 : 0,
    };
  }

  /**
   * Compact text trace of the per-frame mean skin colour, for sharing from a
   * test phone to debug a failed scan. Aggregates only (three numbers per
   * frame), never pixels. Must be called before finish()/cancel().
   *
   * Format (v3): header line, then one line per frame: dt = ms since the
   * previous frame, r/g/b = mean skin colour x100, usable (1/0), skin pixels
   * averaged, mean ROI luma x10, face box width in px, then r/g/b x100 for the
   * forehead, left cheek and right cheek. Missing values are 0.
   */
  exportTrace(): string {
    const lines = [
      'edgevitals-trace v3 dt_ms,r100,g100,b100,usable,skin_px,luma10,face_w,' +
        'fh_r,fh_g,fh_b,lc_r,lc_g,lc_b,rc_r,rc_g,rc_b',
    ];
    const x100 = (v: number | undefined) => Math.round((v ?? 0) * 100);
    let prev: number | null = null;
    for (const f of this.frames) {
      const dt = prev === null ? 0 : Math.round(f.t - prev);
      prev = f.t;
      const c = f.roi;
      const cols = [
        dt,
        x100(c?.r),
        x100(c?.g),
        x100(c?.b),
        f.usable ? 1 : 0,
        c?.skinPixels ?? 0,
        Math.round((c?.luma ?? 0) * 10),
        Math.round(f.face?.width ?? 0),
      ];
      for (let k = 0; k < 3; k++) {
        const reg = c?.regions?.[k];
        cols.push(x100(reg?.r), x100(reg?.g), x100(reg?.b));
      }
      lines.push(cols.join(','));
    }
    return lines.join('\n');
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
    this.interimSnr = null;
  }
}
