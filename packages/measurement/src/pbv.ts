import { bandpass, hann, mean } from './dsp';

/**
 * Blood-volume-pulse signature (PBV) rPPG projection.
 *
 * de Haan, G., & van Leest, A. (2014). "Improved motion robustness of
 * remote-PPG by using the blood volume pulse signature". Physiol. Meas.
 * 35(9), 1913-1926.
 *
 * Within each window the normalised, band-passed RGB traces C (3 x N) give a
 * covariance Q = C C^T. The pulse is the projection w = Pbv^T Q^-1 C: the
 * minimum-variance combination of channels that still passes a signal with
 * the skin's pulse colour signature Pbv. Unlike a fixed projection (POS,
 * CHROM), it down-weights whichever channel is noisiest on the device at
 * hand, e.g. the blue channel of a phone camera's subsampled chroma.
 * Windows are Hann-weighted and overlap-added (50% hop).
 */
export const PBV_SIGNATURE: readonly [number, number, number] = [0.33, 0.77, 0.53];

export function pbv(
  r: number[],
  g: number[],
  b: number[],
  windowLen: number,
  fs: number,
  band: [number, number],
  signature: readonly [number, number, number] = PBV_SIGNATURE,
): number[] {
  const n = r.length;
  const out = new Array<number>(n).fill(0);
  if (n < windowLen || windowLen < 8) return out;
  const norm = (x: number[]) => {
    const m = mean(x);
    return m > 0
      ? bandpass(
          x.map((v) => v / m - 1),
          band[0],
          band[1],
          fs,
        )
      : x.map(() => 0);
  };
  const ch = [norm(r), norm(g), norm(b)];
  const win = hann(windowLen);
  const hop = Math.max(1, Math.floor(windowLen / 2));
  for (let s = 0; s + windowLen <= n; s += hop) {
    // Q = C C^T over the window.
    const q = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = s; i < s + windowLen; i++) {
      const v = [ch[0]![i]!, ch[1]![i]!, ch[2]![i]!];
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) q[a * 3 + c]! += v[a]! * v[c]!;
    }
    const w = solve3(q, signature);
    if (!w) continue;
    const seg = new Array<number>(windowLen);
    for (let i = 0; i < windowLen; i++)
      seg[i] = w[0] * ch[0]![s + i]! + w[1] * ch[1]![s + i]! + w[2] * ch[2]![s + i]!;
    const m = mean(seg);
    let sd = 0;
    for (const v of seg) sd += (v - m) * (v - m);
    sd = Math.sqrt(sd / windowLen);
    if (!(sd > 0)) continue;
    for (let i = 0; i < windowLen; i++) out[s + i]! += (win[i]! * (seg[i]! - m)) / sd;
  }
  return out;
}

/** Solve the 3x3 system Q w = p (Cramer's rule); null when singular. */
function solve3(q: number[], p: readonly number[]): [number, number, number] | null {
  const [a, b, c, d, e, f, g, h, i] = q as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null;
  const [x, y, z] = p as [number, number, number];
  return [
    (x * (e * i - f * h) - b * (y * i - f * z) + c * (y * h - e * z)) / det,
    (a * (y * i - f * z) - x * (d * i - f * g) + c * (d * z - y * g)) / det,
    (a * (e * z - y * h) - b * (d * z - y * g) + x * (d * h - e * g)) / det,
  ];
}
