import { bandpass, hann } from './dsp';
import type { ProjectionStats } from './pos';

/**
 * Chrominance-based rPPG (CHROM).
 *
 * de Haan, G., & Jeanne, V. (2013). "Robust pulse rate from
 * chrominance-based rPPG". IEEE Trans. Biomed. Eng. 60(10), 2878-2886.
 *
 * Each channel is normalised by its local (window) mean, the two
 * chrominance signals X = 3R - 2G and Y = 1.5R + G - 1.5B are band-passed,
 * and within each window the pulse is S = X - αY with α = σ(X) / σ(Y), which
 * cancels the specular/intensity component under the standardised skin-tone
 * assumption. Windows are Hann-tapered and overlap-added with 50% hop, as in
 * the paper. Implemented independently from the published description; it
 * is an established, openly benchmarked method (e.g. rPPG-Toolbox, pyVHR).
 *
 * Guards: windows whose channel mean is ~0 or whose Y has zero variance are
 * skipped and counted in `stats`.
 */
export function chrom(
  r: number[],
  g: number[],
  b: number[],
  windowLen: number,
  fs: number,
  band: [number, number],
  stats?: ProjectionStats,
): number[] {
  const n = r.length;
  const out = new Array<number>(n).fill(0);
  if (n < windowLen || windowLen < 4) return out;
  // Normalise by a centred moving mean of one window length (local DC).
  const half = Math.floor(windowLen / 2);
  const norm = (x: number[]) => {
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + x[i]!;
    return x.map((v, i) => {
      const a = Math.max(0, i - half);
      const e = Math.min(n, i + half + 1);
      const m = (pre[e]! - pre[a]!) / (e - a);
      return m > 1e-3 ? v / m : NaN;
    });
  };
  const rn = norm(r);
  const gn = norm(g);
  const bn = norm(b);
  if (
    rn.some((v) => !Number.isFinite(v)) ||
    gn.some((v) => !Number.isFinite(v)) ||
    bn.some((v) => !Number.isFinite(v))
  ) {
    if (stats) stats.skipped++;
    return out;
  }
  const xs = rn.map((v, i) => 3 * v - 2 * gn[i]!);
  const ys = rn.map((v, i) => 1.5 * v + gn[i]! - 1.5 * bn[i]!);
  const xf = bandpass(xs, band[0], band[1], fs);
  const yf = bandpass(ys, band[0], band[1], fs);
  const win = hann(windowLen);
  const hop = Math.max(1, Math.floor(windowLen / 2));
  for (let s = 0; s + windowLen <= n; s += hop) {
    if (stats) stats.windows++;
    let mx = 0,
      my = 0;
    for (let i = s; i < s + windowLen; i++) {
      mx += xf[i]!;
      my += yf[i]!;
    }
    mx /= windowLen;
    my /= windowLen;
    let vx = 0,
      vy = 0;
    for (let i = s; i < s + windowLen; i++) {
      vx += (xf[i]! - mx) ** 2;
      vy += (yf[i]! - my) ** 2;
    }
    const sx = Math.sqrt(vx / windowLen);
    const sy = Math.sqrt(vy / windowLen);
    if (!(sy > 1e-12)) {
      if (stats) stats.skipped++;
      continue;
    }
    const alpha = sx / sy;
    let m = 0;
    for (let i = s; i < s + windowLen; i++) m += xf[i]! - alpha * yf[i]!;
    m /= windowLen;
    for (let i = 0; i < windowLen; i++)
      out[s + i] = out[s + i]! + win[i]! * (xf[s + i]! - alpha * yf[s + i]! - m);
  }
  return out;
}
