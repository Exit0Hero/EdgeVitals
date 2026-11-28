/**
 * Acquisition quality for the face scan: frame timing, missing data,
 * illumination, ROI tracking and per-region exposure.
 *
 * Everything here works on the per-frame aggregates the camera adapters
 * already produce (timestamps, face boxes, mean skin colour per region); no
 * pixels are involved. Thresholds are engineering defaults (see ACQUISITION
 * below); none has been validated against reference recordings.
 */
import { mean, median } from './dsp';
import type { FrameSample, RoiRegionSample } from './types';

export const ACQUISITION = {
  /** Below this median frame rate pulse timing and the 3 Hz band are compromised. */
  minFps: 15,
  /** Coefficient of variation of the frame interval above which the rate is unstable. */
  maxIntervalCv: 0.25,
  /** An interval longer than this multiple of the median means frames were dropped. */
  dropFactor: 1.5,
  /** Estimated share of missing frames above which the capture is flagged. */
  maxDroppedFraction: 0.1,
  /**
   * Share of the analysed (resampled) signal that may fall inside a frame gap
   * and is therefore interpolated. Above it, the analysis abstains instead of
   * analysing mostly invented samples.
   */
  maxInterpolatedFraction: 0.1,
  /** Frame-to-frame change of mean skin intensity that marks a sudden lighting/RGB change. */
  suddenChangeFraction: 0.01,
  /** Range of the 1 s smoothed intensity inside one analysis window that marks unstable lighting. */
  windowLightingRangeFraction: 0.04,
  /** Face-centre displacement within one window, in face widths, that marks motion. */
  windowMotionFraction: 0.08,
  /** Face-size change within one window (fraction) that marks motion toward/away from the camera. */
  windowScaleFraction: 0.08,
  /** Region skin-pixel count change between frames that marks an ROI re-anchor. */
  roiCountChangeFraction: 0.2,
  /** Per-region exposure and information limits. */
  region: {
    minPixels: 40,
    minLuma: 40,
    maxLuma: 230,
    maxClippedFraction: 0.1,
    /** Share of segment frames a region must pass to be analysed on its own. */
    minUsableFraction: 0.97,
  },
} as const;

export type AcquisitionFlag =
  | 'low_frame_rate'
  | 'unstable_frame_rate'
  | 'frames_dropped'
  | 'timestamp_irregular'
  | 'excessive_interpolation'
  | 'sudden_lighting_change'
  | 'lighting_unstable'
  | 'face_motion'
  | 'roi_unstable';

export interface FrameTimingReport {
  frameCount: number;
  durationSec: number;
  /** Frames delivered per second over the capture: (n - 1) / duration. */
  measuredFps: number;
  /** 1000 / median frame interval. */
  medianFps: number;
  medianIntervalMs: number;
  intervalP10Ms: number;
  intervalP90Ms: number;
  /** SD / mean of the intervals that are not drops. */
  intervalCv: number;
  /** Frames estimated missing from intervals longer than dropFactor x median. */
  missingFrames: number;
  /** missingFrames / (frames delivered + missingFrames). */
  droppedFrameFraction: number;
  longestGapMs: number;
  /** Timestamps equal to or earlier than their predecessor (removed before analysis). */
  nonMonotonic: number;
  flags: AcquisitionFlag[];
}

/** Frame timing statistics from frame timestamps in milliseconds (arrival order). */
export function analyzeFrameTiming(tMs: number[]): FrameTimingReport {
  let nonMonotonic = 0;
  const kept: number[] = [];
  for (const t of tMs) {
    if (kept.length && t <= kept[kept.length - 1]!) nonMonotonic++;
    else kept.push(t);
  }
  const dts: number[] = [];
  for (let i = 1; i < kept.length; i++) dts.push(kept[i]! - kept[i - 1]!);
  const md = dts.length ? median(dts) : 0;
  let missing = 0;
  let longest = 0;
  const regular: number[] = [];
  for (const d of dts) {
    longest = Math.max(longest, d);
    if (md > 0 && d > ACQUISITION.dropFactor * md) missing += Math.max(1, Math.round(d / md) - 1);
    else regular.push(d);
  }
  const sorted = [...dts].sort((a, b) => a - b);
  const pct = (q: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0;
  const m = regular.length ? mean(regular) : 0;
  const cv =
    regular.length > 1 && m > 0 ? Math.sqrt(mean(regular.map((d) => (d - m) ** 2))) / m : 0;
  const durationSec = kept.length > 1 ? (kept[kept.length - 1]! - kept[0]!) / 1000 : 0;
  const report: FrameTimingReport = {
    frameCount: kept.length,
    durationSec,
    measuredFps: durationSec > 0 ? (kept.length - 1) / durationSec : 0,
    medianFps: md > 0 ? 1000 / md : 0,
    medianIntervalMs: md,
    intervalP10Ms: pct(0.1),
    intervalP90Ms: pct(0.9),
    intervalCv: cv,
    missingFrames: missing,
    droppedFrameFraction: kept.length ? missing / (kept.length + missing) : 0,
    longestGapMs: longest,
    nonMonotonic,
    flags: [],
  };
  if (kept.length > 1) {
    if (report.medianFps < ACQUISITION.minFps) report.flags.push('low_frame_rate');
    if (cv > ACQUISITION.maxIntervalCv) report.flags.push('unstable_frame_rate');
    if (report.droppedFrameFraction > ACQUISITION.maxDroppedFraction)
      report.flags.push('frames_dropped');
  }
  if (nonMonotonic > 0) report.flags.push('timestamp_irregular');
  return report;
}

/**
 * Keep frames whose timestamps strictly increase. Duplicate or out-of-order
 * timestamps (seen when a platform reports a stale timestamp) would otherwise
 * create zero-length intervals in resampling.
 */
export function monotonicFrames<T extends { t: number }>(frames: T[]): T[] {
  const out: T[] = [];
  for (const f of frames) if (!out.length || f.t > out[out.length - 1]!.t) out.push(f);
  return out;
}

export interface UniformSeries {
  /** Grid start, seconds. */
  t0: number;
  fs: number;
  /** One uniformly sampled series per input channel. */
  channels: number[][];
  /**
   * true where the grid point falls inside a gap longer than dropFactor x the
   * median interval and more than half an interval from both real frames, i.e.
   * where a frame was expected but missing.
   */
  interpolated: boolean[];
  interpolatedFraction: number;
}

/**
 * Linear resampling of several channels onto one uniform grid, marking every
 * grid point that lies inside a frame gap (so the caller can refuse to
 * analyse a signal that is mostly interpolation instead of doing it
 * silently). `tSec` must be strictly increasing.
 */
export function resampleWithMask(tSec: number[], channels: number[][], fs: number): UniformSeries {
  const n = tSec.length;
  const t0 = tSec[0] ?? 0;
  if (n < 2)
    return {
      t0,
      fs,
      channels: channels.map((c) => c.slice()),
      interpolated: [],
      interpolatedFraction: 0,
    };
  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(tSec[i]! - tSec[i - 1]!);
  const step = median(dts);
  const gapLimit = ACQUISITION.dropFactor * step;
  const halfStep = step / 2;
  const len = Math.floor((tSec[n - 1]! - t0) * fs) + 1;
  const out = channels.map(() => new Array<number>(len));
  const interpolated = new Array<boolean>(len).fill(false);
  let j = 0;
  let count = 0;
  for (let i = 0; i < len; i++) {
    const ti = t0 + i / fs;
    while (j < n - 2 && tSec[j + 1]! < ti) j++;
    const ta = tSec[j]!;
    const tb = tSec[j + 1]!;
    const w = tb === ta ? 0 : Math.min(1, Math.max(0, (ti - ta) / (tb - ta)));
    for (let c = 0; c < channels.length; c++) {
      const v = channels[c]!;
      out[c]![i] = v[j]! + w * (v[j + 1]! - v[j]!);
    }
    // Only the part of a gap where a frame was expected but none arrived is
    // invented: points more than half a median interval from both neighbours.
    if (tb - ta > gapLimit && ti - ta > halfStep && tb - ti > halfStep) {
      interpolated[i] = true;
      count++;
    }
  }
  return { t0, fs, channels: out, interpolated, interpolatedFraction: len ? count / len : 0 };
}

/** Whether one region of one frame is exposed well enough and has enough skin pixels. */
export function regionUsable(reg: RoiRegionSample | undefined): boolean {
  const c = ACQUISITION.region;
  if (!reg || reg.n < c.minPixels) return false;
  const luma = reg.luma ?? 0.299 * reg.r + 0.587 * reg.g + 0.114 * reg.b;
  if (luma < c.minLuma || luma > c.maxLuma) return false;
  if ((reg.clipped ?? 0) > c.maxClippedFraction) return false;
  return true;
}

export interface RegionExposureReport {
  /** Share of analysed frames in which each region (forehead, left cheek, right cheek) passed. */
  usableFraction: number[];
  /** Regions that passed in at least region.minUsableFraction of frames. */
  usable: boolean[];
  /** Per-region dominant problem, or null. */
  problem: (null | 'too_few_pixels' | 'underexposed' | 'overexposed')[];
}

export function analyzeRegionExposure(seg: FrameSample[]): RegionExposureReport | null {
  const k = seg[0]?.roi?.regions?.length ?? 0;
  if (!k) return null;
  const c = ACQUISITION.region;
  const usableFraction: number[] = [];
  const problem: RegionExposureReport['problem'] = [];
  for (let r = 0; r < k; r++) {
    let ok = 0;
    let few = 0;
    let dark = 0;
    let bright = 0;
    for (const f of seg) {
      const reg = f.roi?.regions?.[r];
      if (regionUsable(reg)) {
        ok++;
        continue;
      }
      if (!reg || reg.n < c.minPixels) few++;
      else {
        const luma = reg.luma ?? 0.299 * reg.r + 0.587 * reg.g + 0.114 * reg.b;
        if (luma < c.minLuma) dark++;
        else bright++;
      }
    }
    usableFraction.push(seg.length ? ok / seg.length : 0);
    const worst = Math.max(few, dark, bright);
    problem.push(
      worst === 0
        ? null
        : worst === few
          ? 'too_few_pixels'
          : worst === dark
            ? 'underexposed'
            : 'overexposed',
    );
  }
  return {
    usableFraction,
    usable: usableFraction.map((u) => u >= c.minUsableFraction),
    problem,
  };
}

export interface WindowArtefacts {
  /** Window start times relative to the segment start, seconds. */
  starts: number[];
  /** null when the window is clean, otherwise the first artefact found. */
  artefact: (
    | null
    | 'sudden_lighting_change'
    | 'lighting_unstable'
    | 'face_motion'
    | 'roi_unstable'
    | 'interpolated'
  )[];
}

/**
 * Per-window artefact detection over the analysed segment. A window is
 * rejected for heart-rate voting when it contains a sudden intensity change,
 * unstable lighting, face movement or scale change, an ROI re-anchor, or too
 * much interpolated signal. Each check uses the same frame aggregates the
 * live gates use; none needs pixels.
 */
export function detectWindowArtefacts(
  seg: FrameSample[],
  series: UniformSeries,
  windowSec: number,
  hopSec: number,
): WindowArtefacts {
  const A = ACQUISITION;
  const t0 = seg[0]!.t / 1000;
  const segDur = (seg[seg.length - 1]!.t - seg[0]!.t) / 1000;
  const intensity = seg.map((f) => (f.roi!.r + f.roi!.g + f.roi!.b) / 3);
  // Per-frame event marks.
  const sudden: number[] = [];
  const roiJump: number[] = [];
  for (let i = 1; i < seg.length; i++) {
    const a = intensity[i - 1]!;
    if (a > 0 && Math.abs(intensity[i]! - a) / a > A.suddenChangeFraction)
      sudden.push(seg[i]!.t / 1000 - t0);
    const ra = seg[i - 1]!.roi!.regions;
    const rb = seg[i]!.roi!.regions;
    if (ra && rb) {
      for (let k = 0; k < Math.min(ra.length, rb.length); k++) {
        const na = ra[k]!.n;
        const nb = rb[k]!.n;
        if (na > 0 && Math.abs(nb - na) / na > A.roiCountChangeFraction) {
          roiJump.push(seg[i]!.t / 1000 - t0);
          break;
        }
      }
    }
  }
  const starts: number[] = [];
  const artefact: WindowArtefacts['artefact'] = [];
  for (let s = 0; s + windowSec <= segDur + 1e-9; s += hopSec) {
    starts.push(s);
    const e = s + windowSec;
    const inWin = seg.filter((f) => f.t / 1000 - t0 >= s && f.t / 1000 - t0 < e);
    let a: WindowArtefacts['artefact'][number] = null;
    if (sudden.some((x) => x >= s && x < e)) a = 'sudden_lighting_change';
    if (!a && inWin.length > 2) {
      // Range of the 1 s moving average of intensity, relative to its mean.
      const vals = inWin.map((f) => (f.roi!.r + f.roi!.g + f.roi!.b) / 3);
      const k = Math.max(1, Math.round(vals.length / windowSec));
      const smooth: number[] = [];
      for (let i = 0; i + k <= vals.length; i++) smooth.push(mean(vals.slice(i, i + k)));
      const m = mean(vals);
      if (m > 0 && (Math.max(...smooth) - Math.min(...smooth)) / m > A.windowLightingRangeFraction)
        a = 'lighting_unstable';
    }
    if (!a && inWin.length > 2) {
      const faces = inWin.map((f) => f.face).filter((b): b is NonNullable<typeof b> => !!b);
      if (faces.length > 2) {
        const w = median(faces.map((b) => b.width));
        const cx = faces.map((b) => b.x + b.width / 2);
        const cy = faces.map((b) => b.y + b.height / 2);
        const mx = median(cx);
        const my = median(cy);
        const disp = Math.max(...cx.map((x, i) => Math.hypot(x - mx, cy[i]! - my)));
        const widths = faces.map((b) => b.width);
        const scale = (Math.max(...widths) - Math.min(...widths)) / w;
        if (w > 0 && disp / w > A.windowMotionFraction) a = 'face_motion';
        else if (w > 0 && scale > A.windowScaleFraction) a = 'face_motion';
      }
    }
    if (!a && roiJump.some((x) => x >= s && x < e)) a = 'roi_unstable';
    if (!a) {
      const i0 = Math.round(s * series.fs);
      const i1 = Math.min(series.interpolated.length, Math.round(e * series.fs));
      let c = 0;
      for (let i = i0; i < i1; i++) if (series.interpolated[i]) c++;
      if (i1 > i0 && c / (i1 - i0) > A.maxInterpolatedFraction) a = 'interpolated';
    }
    artefact.push(a);
  }
  return { starts, artefact };
}

export interface AcquisitionReport {
  timing: FrameTimingReport;
  /** Timing of the analysed segment only. */
  segmentTiming: FrameTimingReport | null;
  interpolatedFraction: number;
  /** Largest frame-to-frame change of mean skin intensity in the segment, %. */
  maxIntensityStepPct: number;
  /** SD of face-centre position in the segment, % of face width (tracking jitter plus motion). */
  faceJitterPct: number | null;
  regions: RegionExposureReport | null;
  /** Share of HR analysis windows rejected for each artefact. */
  windowArtefacts: Partial<Record<NonNullable<WindowArtefacts['artefact'][number]>, number>>;
  flags: AcquisitionFlag[];
}

/** Assemble the acquisition report for a capture and its analysed segment. */
export function acquisitionReport(
  frames: FrameSample[],
  seg: FrameSample[],
  series: UniformSeries | null,
  windows: WindowArtefacts | null,
): AcquisitionReport {
  const timing = analyzeFrameTiming(frames.map((f) => f.t));
  const segmentTiming = seg.length > 1 ? analyzeFrameTiming(seg.map((f) => f.t)) : null;
  let maxStep = 0;
  for (let i = 1; i < seg.length; i++) {
    const a = (seg[i - 1]!.roi!.r + seg[i - 1]!.roi!.g + seg[i - 1]!.roi!.b) / 3;
    const b = (seg[i]!.roi!.r + seg[i]!.roi!.g + seg[i]!.roi!.b) / 3;
    if (a > 0) maxStep = Math.max(maxStep, Math.abs(b - a) / a);
  }
  const faces = seg.map((f) => f.face).filter((b): b is NonNullable<typeof b> => !!b);
  let faceJitterPct: number | null = null;
  if (faces.length > 2) {
    const w = median(faces.map((b) => b.width));
    const cx = faces.map((b) => b.x + b.width / 2);
    const cy = faces.map((b) => b.y + b.height / 2);
    const mx = mean(cx);
    const my = mean(cy);
    const sd = Math.sqrt(mean(cx.map((x, i) => (x - mx) ** 2 + (cy[i]! - my) ** 2)));
    faceJitterPct = w > 0 ? (100 * sd) / w : null;
  }
  const windowArtefacts: AcquisitionReport['windowArtefacts'] = {};
  if (windows && windows.artefact.length) {
    for (const a of windows.artefact)
      if (a) windowArtefacts[a] = (windowArtefacts[a] ?? 0) + 1 / windows.artefact.length;
  }
  const flags = new Set<AcquisitionFlag>([...timing.flags, ...(segmentTiming?.flags ?? [])]);
  const interpolatedFraction = series?.interpolatedFraction ?? 0;
  if (interpolatedFraction > ACQUISITION.maxInterpolatedFraction)
    flags.add('excessive_interpolation');
  if ((windowArtefacts.sudden_lighting_change ?? 0) > 0) flags.add('sudden_lighting_change');
  if ((windowArtefacts.lighting_unstable ?? 0) > 0) flags.add('lighting_unstable');
  if ((windowArtefacts.face_motion ?? 0) > 0) flags.add('face_motion');
  if ((windowArtefacts.roi_unstable ?? 0) > 0) flags.add('roi_unstable');
  return {
    timing,
    segmentTiming,
    interpolatedFraction,
    maxIntensityStepPct: 100 * maxStep,
    faceJitterPct,
    regions: analyzeRegionExposure(seg),
    windowArtefacts,
    flags: [...flags],
  };
}
