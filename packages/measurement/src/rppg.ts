/**
 * rPPG pulse extraction for every (method, region) combination.
 *
 * Methods (each independently testable):
 *  - `pos`: the original POS implementation (pos.ts), kept unchanged so the
 *    validation harness can compare it with the revision;
 *  - `pos_v2`: POS with Hann overlap-add and zero-variance guards;
 *  - `chrom`: CHROM (de Haan & Jeanne 2013);
 *  - `pbv`: PBV (de Haan & van Leest 2014).
 * Regions: the pooled forehead+cheeks average (`combined`) and each region on
 * its own when its exposure and pixel count pass (acquisition.ts).
 *
 * Post-processing is shared and configurable: smoothness-priors detrending
 * then a zero-phase Butterworth band-pass. `pos` keeps the legacy 2nd-order
 * band-pass with no detrending so it reproduces the v0.3 signal exactly.
 */
import { regionUsable } from './acquisition';
import { bandpass, bandpassOrder, detrendSmoothnessPriors } from './dsp';
import { chrom } from './chrom';
import { pbv } from './pbv';
import { pos, posV2, type ProjectionStats } from './pos';
import { PIPELINE_CONFIG } from './config';
import { ROI_REGION_IDS, type FrameSample, type RoiRegionId } from './types';

export type RppgMethod = 'pos' | 'pos_v2' | 'chrom' | 'pbv';
export const RPPG_METHODS: readonly RppgMethod[] = ['pos', 'pos_v2', 'chrom', 'pbv'];
export type SignalRegion = 'combined' | RoiRegionId;

export const RPPG_CONFIG = {
  posWindowSec: PIPELINE_CONFIG.posWindowSec,
  chromWindowSec: 1.6,
  pbvWindowSec: PIPELINE_CONFIG.hrPbvWindowSec,
  band: PIPELINE_CONFIG.hrBandHz,
  /**
   * Pass band of the post-filter, wider than the 0.7-3 Hz search band so a
   * 42 bpm (0.7 Hz) pulse is not attenuated by the filter's own roll-off.
   */
  filterBandHz: [0.55, 3.5] as [number, number],
  /** Smoothness-priors detrending half-power frequency (well below the 0.7 Hz band edge). */
  detrendCutoffHz: 0.3,
  /** Band-pass order for pos_v2, chrom and pbv. */
  filterOrder: 2 as 2 | 4 | 6,
} as const;

export interface RgbSeries {
  r: number[];
  g: number[];
  b: number[];
}

export interface PulseCandidate {
  method: RppgMethod;
  region: SignalRegion;
  pulse: number[];
  stats: ProjectionStats;
}

/** Extract one band-passed pulse signal from uniformly sampled RGB. */
export function extractPulse(
  method: RppgMethod,
  rgb: RgbSeries,
  fs: number,
  conf: typeof RPPG_CONFIG = RPPG_CONFIG,
): { pulse: number[]; stats: ProjectionStats } {
  const stats: ProjectionStats = { windows: 0, skipped: 0 };
  const { r, g, b } = rgb;
  if (method === 'pos') {
    const h = pos(r, g, b, Math.round(conf.posWindowSec * fs));
    return { pulse: bandpass(h, conf.band[0], conf.band[1], fs), stats };
  }
  let raw: number[];
  if (method === 'pos_v2') raw = posV2(r, g, b, Math.round(conf.posWindowSec * fs), stats);
  else if (method === 'chrom')
    raw = chrom(r, g, b, Math.round(conf.chromWindowSec * fs), fs, conf.filterBandHz, stats);
  else raw = pbv(r, g, b, Math.round(conf.pbvWindowSec * fs), fs, conf.filterBandHz);
  const detrended = detrendSmoothnessPriors(raw, fs, conf.detrendCutoffHz);
  return {
    pulse: bandpassOrder(
      detrended,
      conf.filterBandHz[0],
      conf.filterBandHz[1],
      fs,
      conf.filterOrder,
    ),
    stats,
  };
}

/** Linear interpolation of (t, v) onto the grid t0 + i / fs, i < len. */
export function resampleOnGrid(
  t: number[],
  v: number[],
  t0: number,
  fs: number,
  len: number,
): number[] {
  const out = new Array<number>(len);
  let j = 0;
  for (let i = 0; i < len; i++) {
    const ti = t0 + i / fs;
    while (j < t.length - 2 && t[j + 1]! < ti) j++;
    const ta = t[j]!;
    const tb = t[j + 1] ?? ta;
    const w = tb === ta ? 0 : Math.min(1, Math.max(0, (ti - ta) / (tb - ta)));
    out[i] = v[j]! + w * ((v[j + 1] ?? v[j]!) - v[j]!);
  }
  return out;
}

/**
 * Uniform RGB series for each region that is usable in this segment
 * (`usable[k]`). Frames where a region fails its exposure/pixel check are
 * left out and bridged by interpolation; acquisition.ts only marks a region
 * usable when that is at most 3% of frames.
 */
export function regionSeries(
  seg: FrameSample[],
  usable: boolean[],
  t0: number,
  fs: number,
  len: number,
): { region: RoiRegionId; rgb: RgbSeries }[] {
  const out: { region: RoiRegionId; rgb: RgbSeries }[] = [];
  for (let k = 0; k < usable.length && k < ROI_REGION_IDS.length; k++) {
    if (!usable[k]) continue;
    const ok = seg.filter((f) => regionUsable(f.roi?.regions?.[k]));
    if (ok.length < 2) continue;
    const t = ok.map((f) => f.t / 1000);
    const ch = (c: 'r' | 'g' | 'b') =>
      resampleOnGrid(
        t,
        ok.map((f) => f.roi!.regions![k]![c]),
        t0,
        fs,
        len,
      );
    out.push({ region: ROI_REGION_IDS[k]!, rgb: { r: ch('r'), g: ch('g'), b: ch('b') } });
  }
  return out;
}

/** Every (method, region) pulse candidate for the given series. */
export function buildCandidates(
  combined: RgbSeries,
  regions: { region: RoiRegionId; rgb: RgbSeries }[],
  fs: number,
  methods: readonly RppgMethod[],
): PulseCandidate[] {
  const out: PulseCandidate[] = [];
  const sources: { region: SignalRegion; rgb: RgbSeries }[] = [
    { region: 'combined', rgb: combined },
    ...regions,
  ];
  for (const src of sources)
    for (const method of methods) {
      const { pulse, stats } = extractPulse(method, src.rgb, fs);
      out.push({ method, region: src.region, pulse, stats });
    }
  return out;
}
