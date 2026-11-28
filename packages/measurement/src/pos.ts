import { mean } from './dsp';

/**
 * Plane-Orthogonal-to-Skin (POS) rPPG projection.
 *
 * Wang, W., den Brinker, A. C., Stuijk, S., & de Haan, G. (2017).
 * "Algorithmic Principles of Remote PPG". IEEE Trans. Biomed. Eng. 64(7).
 *
 * Input: uniformly sampled mean skin RGB traces. Output: a pulse signal
 * built by overlap-adding projections computed over sliding windows of
 * `windowLen` samples. Assumptions (documented in docs/adr/0004):
 *  - the ROI is predominantly skin and tracked consistently;
 *  - illumination is roughly constant in spectrum within each window;
 *  - the camera's auto-exposure/white balance changes slowly relative to
 *    the window (temporal normalisation absorbs slow changes).
 */
export function pos(r: number[], g: number[], b: number[], windowLen: number): number[] {
  const n = r.length;
  const h = new Array<number>(n).fill(0);
  if (n < windowLen || windowLen < 2) return h;
  for (let start = 0; start + windowLen <= n; start++) {
    const end = start + windowLen;
    const mr = mean(r.slice(start, end));
    const mg = mean(g.slice(start, end));
    const mb = mean(b.slice(start, end));
    if (mr <= 0 || mg <= 0 || mb <= 0) continue;
    const s1 = new Array<number>(windowLen);
    const s2 = new Array<number>(windowLen);
    for (let i = 0; i < windowLen; i++) {
      const cr = r[start + i]! / mr;
      const cg = g[start + i]! / mg;
      const cb = b[start + i]! / mb;
      // Projection matrix P = [[0, 1, -1], [-2, 1, 1]]
      s1[i] = cg - cb;
      s2[i] = -2 * cr + cg + cb;
    }
    const sd1 = stdOf(s1);
    const sd2 = stdOf(s2);
    const alpha = sd2 > 0 ? sd1 / sd2 : 0;
    const seg = new Array<number>(windowLen);
    for (let i = 0; i < windowLen; i++) seg[i] = s1[i]! + alpha * s2[i]!;
    const m = mean(seg);
    for (let i = 0; i < windowLen; i++) h[start + i] = h[start + i]! + (seg[i]! - m);
  }
  return h;
}

function stdOf(x: number[]): number {
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return Math.sqrt(s / x.length);
}

/** Channel means at or below this (8-bit units) are treated as no signal. */
const MIN_CHANNEL_MEAN = 1e-3;
/** Projection SDs below this are treated as zero variance. */
const MIN_SD = 1e-9;

export interface ProjectionStats {
  /** Windows processed. */
  windows: number;
  /** Windows skipped because a channel mean was ~0 or a projection had zero variance. */
  skipped: number;
}

/**
 * POS, revised implementation (`pos_v2`). Same projection as `pos` (kept
 * unchanged for comparison), with:
 *  - a Hann taper on each window before overlap-add (the original adds
 *    rectangular windows, which puts a step at every window edge);
 *  - explicit zero-mean and zero-variance guards, with skipped windows counted
 *    instead of silently contributing nothing;
 *  - running channel sums, O(n) per window instead of re-slicing.
 * Detrending and band-pass filtering are applied by the caller (rppg.ts) so
 * they are configurable and identical for every method.
 */
export function posV2(
  r: number[],
  g: number[],
  b: number[],
  windowLen: number,
  stats?: ProjectionStats,
): number[] {
  const n = r.length;
  const h = new Array<number>(n).fill(0);
  if (n < windowLen || windowLen < 4) return h;
  const win = hannWindow(windowLen);
  const hop = Math.max(1, Math.floor(windowLen / 4));
  const s1 = new Float64Array(windowLen);
  const s2 = new Float64Array(windowLen);
  for (let start = 0; start + windowLen <= n; start += hop) {
    if (stats) stats.windows++;
    let mr = 0,
      mg = 0,
      mb = 0;
    for (let i = start; i < start + windowLen; i++) {
      mr += r[i]!;
      mg += g[i]!;
      mb += b[i]!;
    }
    mr /= windowLen;
    mg /= windowLen;
    mb /= windowLen;
    if (!(mr > MIN_CHANNEL_MEAN && mg > MIN_CHANNEL_MEAN && mb > MIN_CHANNEL_MEAN)) {
      if (stats) stats.skipped++;
      continue;
    }
    let m1 = 0,
      m2 = 0;
    for (let i = 0; i < windowLen; i++) {
      const cr = r[start + i]! / mr;
      const cg = g[start + i]! / mg;
      const cb = b[start + i]! / mb;
      s1[i] = cg - cb;
      s2[i] = -2 * cr + cg + cb;
      m1 += s1[i]!;
      m2 += s2[i]!;
    }
    m1 /= windowLen;
    m2 /= windowLen;
    let v1 = 0,
      v2 = 0;
    for (let i = 0; i < windowLen; i++) {
      v1 += (s1[i]! - m1) ** 2;
      v2 += (s2[i]! - m2) ** 2;
    }
    const sd1 = Math.sqrt(v1 / windowLen);
    const sd2 = Math.sqrt(v2 / windowLen);
    if (sd1 < MIN_SD && sd2 < MIN_SD) {
      if (stats) stats.skipped++;
      continue;
    }
    const alpha = sd2 >= MIN_SD ? sd1 / sd2 : 0;
    let m = 0;
    for (let i = 0; i < windowLen; i++) m += s1[i]! + alpha * s2[i]!;
    m /= windowLen;
    for (let i = 0; i < windowLen; i++)
      h[start + i] = h[start + i]! + win[i]! * (s1[i]! + alpha * s2[i]! - m);
  }
  return h;
}

function hannWindow(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
}
