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
