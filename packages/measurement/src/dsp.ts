/**
 * Dependency-free digital signal processing primitives used by the rPPG
 * pipeline. All functions are pure and operate on plain number arrays so
 * they run identically in Node (tests), the browser and React Native.
 */

export function mean(x: ArrayLike<number>): number {
  if (x.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return s / x.length;
}

export function std(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 2) return 0;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i]! - m;
    s += d * d;
  }
  return Math.sqrt(s / n);
}

export function median(x: ArrayLike<number>): number {
  if (x.length === 0) return NaN;
  const a = Array.from(x).sort((p, q) => p - q);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

/** Median absolute deviation (unscaled). */
export function mad(x: ArrayLike<number>): number {
  const m = median(x);
  return median(Array.from(x, (v) => Math.abs(v - m)));
}

/**
 * Linearly resample irregularly timed samples onto a uniform grid.
 * `t` in seconds (ascending), returns values at t0, t0 + 1/fs, ...
 */
export function resampleUniform(t: number[], v: number[], fs: number): number[] {
  if (t.length !== v.length) throw new Error('resampleUniform: length mismatch');
  if (t.length < 2) return v.slice();
  const t0 = t[0]!;
  const n = Math.floor((t[t.length - 1]! - t0) * fs) + 1;
  const out = new Array<number>(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = t0 + i / fs;
    while (j < t.length - 2 && t[j + 1]! < ti) j++;
    const ta = t[j]!;
    const tb = t[j + 1]!;
    const w = tb === ta ? 0 : (ti - ta) / (tb - ta);
    out[i] = v[j]! + Math.min(1, Math.max(0, w)) * (v[j + 1]! - v[j]!);
  }
  return out;
}

/** Biquad coefficients (normalised so a0 = 1). */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** 2nd-order Butterworth low-pass (RBJ cookbook, Q = 1/sqrt(2)). */
export function butterLowpass(fc: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** 2nd-order Butterworth high-pass (RBJ cookbook, Q = 1/sqrt(2)). */
export function butterHighpass(fc: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function biquadFilter(x: ArrayLike<number>, f: Biquad): number[] {
  const y = new Array<number>(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  // Initialise state to the first sample's steady state to reduce start-up transients.
  const x0 = x.length ? x[0]! : 0;
  const dcGain = (f.b0 + f.b1 + f.b2) / (1 + f.a1 + f.a2);
  x1 = x2 = x0;
  y1 = y2 = x0 * dcGain;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Zero-phase forward-backward filtering through a cascade of biquads. */
export function filtfilt(x: ArrayLike<number>, sections: Biquad[]): number[] {
  // Reflect-pad to reduce edge transients (like scipy's odd padding).
  const pad = Math.min(x.length - 1, 3 * 2 * sections.length * 3);
  const arr = Array.from(x);
  const head: number[] = [];
  const tail: number[] = [];
  for (let i = pad; i >= 1; i--) head.push(2 * arr[0]! - arr[i]!);
  for (let i = arr.length - 2; i >= arr.length - 1 - pad; i--)
    tail.push(2 * arr[arr.length - 1]! - arr[i]!);
  let y = head.concat(arr, tail);
  for (const s of sections) y = biquadFilter(y, s);
  y.reverse();
  for (const s of sections) y = biquadFilter(y, s);
  y.reverse();
  return y.slice(pad, pad + arr.length);
}

/** Butterworth band-pass (2nd-order HP + 2nd-order LP), zero-phase. */
export function bandpass(
  x: ArrayLike<number>,
  lowHz: number,
  highHz: number,
  fs: number,
): number[] {
  return filtfilt(x, [butterHighpass(lowHz, fs), butterLowpass(highHz, fs)]);
}

export function hann(n: number): number[] {
  if (n === 1) return [1];
  return Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place iterative radix-2 FFT. `re` and `im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k]!,
          ai = im[i + k]!;
        const br = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const bi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface Spectrum {
  freqs: number[];
  power: number[];
}

/**
 * Welch power spectral density estimate with Hann windows and 50% overlap.
 * Segments are zero-padded to `nfft` (rounded up to a power of two).
 */
export function welch(x: ArrayLike<number>, fs: number, segmentSec: number, nfft = 4096): Spectrum {
  const n = x.length;
  const segLen = Math.min(n, Math.max(8, Math.round(segmentSec * fs)));
  const step = Math.max(1, Math.floor(segLen / 2));
  const size = nextPow2(Math.max(nfft, segLen));
  const win = hann(segLen);
  const half = size / 2 + 1;
  const acc = new Float64Array(half);
  let segments = 0;
  for (let start = 0; start + segLen <= n; start += step) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let m = 0;
    for (let i = 0; i < segLen; i++) m += x[start + i]!;
    m /= segLen;
    for (let i = 0; i < segLen; i++) re[i] = (x[start + i]! - m) * win[i]!;
    fft(re, im);
    for (let k = 0; k < half; k++) acc[k] = acc[k]! + re[k]! * re[k]! + im[k]! * im[k]!;
    segments++;
  }
  const freqs = Array.from({ length: half }, (_, k) => (k * fs) / size);
  const power = Array.from(acc, (p) => (segments ? p / segments : 0));
  return { freqs, power };
}

/** Frequency of the highest power bin within [lo, hi], refined by parabolic interpolation. */
export function peakFrequency(
  spec: Spectrum,
  lo: number,
  hi: number,
): { freq: number; index: number } | null {
  let best = -1;
  let bestP = -Infinity;
  for (let k = 0; k < spec.freqs.length; k++) {
    const f = spec.freqs[k]!;
    if (f < lo || f > hi) continue;
    if (spec.power[k]! > bestP) {
      bestP = spec.power[k]!;
      best = k;
    }
  }
  if (best < 0 || bestP <= 0) return null;
  const df = spec.freqs[1]! - spec.freqs[0]!;
  let freq = spec.freqs[best]!;
  if (best > 0 && best < spec.power.length - 1) {
    const a = spec.power[best - 1]!,
      b = spec.power[best]!,
      c = spec.power[best + 1]!;
    const denom = a - 2 * b + c;
    if (denom !== 0) freq += (0.5 * (a - c) * df) / denom;
  }
  return { freq, index: best };
}

/** Sum of spectral power in [lo, hi]. */
export function bandPower(spec: Spectrum, lo: number, hi: number): number {
  let s = 0;
  for (let k = 0; k < spec.freqs.length; k++) {
    const f = spec.freqs[k]!;
    if (f >= lo && f <= hi) s += spec.power[k]!;
  }
  return s;
}

/**
 * Local-maximum peak detection with a minimum spacing (in samples).
 * Larger peaks win when two are closer than `minDistance`.
 * Returns sub-sample peak positions refined by parabolic interpolation.
 */
export function findPeaks(x: ArrayLike<number>, minDistance: number): number[] {
  const cands: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i]! > x[i - 1]! && x[i]! >= x[i + 1]!) cands.push(i);
  }
  cands.sort((a, b) => x[b]! - x[a]!);
  const taken = new Uint8Array(x.length);
  const kept: number[] = [];
  for (const i of cands) {
    let ok = true;
    const lo = Math.max(0, Math.ceil(i - minDistance + 1));
    const hi = Math.min(x.length - 1, Math.floor(i + minDistance - 1));
    for (let j = lo; j <= hi; j++) {
      if (taken[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      taken[i] = 1;
      kept.push(i);
    }
  }
  kept.sort((a, b) => a - b);
  return kept.map((i) => {
    const a = x[i - 1]!,
      b = x[i]!,
      c = x[i + 1]!;
    const denom = a - 2 * b + c;
    return denom === 0 ? i : i + (0.5 * (a - c)) / denom;
  });
}
