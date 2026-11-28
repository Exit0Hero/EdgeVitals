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
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
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

/**
 * Butterworth band-pass of configurable order (an even number: `order / 2`
 * high-pass and `order / 2` low-pass 2nd-order sections), zero-phase. Order
 * 2 equals `bandpass`. Cascading identical biquads is not an exact
 * higher-order Butterworth (the corner sags by 3 dB per extra section), which
 * is acceptable here because the band edges sit well outside the cardiac
 * peak; the point is steeper roll-off of breathing and drift.
 */
export function bandpassOrder(
  x: ArrayLike<number>,
  lowHz: number,
  highHz: number,
  fs: number,
  order: 2 | 4 | 6 = 2,
): number[] {
  const sections: Biquad[] = [];
  for (let i = 0; i < order / 2; i++) sections.push(butterHighpass(lowHz, fs));
  for (let i = 0; i < order / 2; i++) sections.push(butterLowpass(highHz, fs));
  return filtfilt(x, sections);
}

/**
 * Smoothness-priors detrending (Tarvainen, Ranta-aho & Karjalainen, IEEE
 * TBME 2002). Removes the slow trend z_trend = (I + λ² D2ᵀD2)⁻¹ z, where D2 is
 * the second-difference operator, and returns z - z_trend. It acts as a
 * time-varying high-pass filter whose half-power frequency is about
 * `cutoffHz`; λ is derived from it as 1 / (2 - 2 cos(2π fc / fs)). Solved in
 * O(n) with a symmetric pentadiagonal LDLᵀ factorisation.
 */
export function detrendSmoothnessPriors(
  x: ArrayLike<number>,
  fs: number,
  cutoffHz: number,
): number[] {
  const n = x.length;
  if (n < 5) return Array.from(x, (v) => v - mean(x));
  const lambda = 1 / (2 - 2 * Math.cos((2 * Math.PI * cutoffHz) / fs));
  const l2 = lambda * lambda;
  // Bands of A = I + λ² D2ᵀ D2: diagonal d0, first and second off-diagonals d1, d2.
  const d0 = new Float64Array(n).fill(1);
  const d1 = new Float64Array(n);
  const d2 = new Float64Array(n);
  const c = [1, -2, 1];
  for (let j = 0; j < n - 2; j++) {
    for (let a = 0; a < 3; a++) {
      d0[j + a] = d0[j + a]! + l2 * c[a]! * c[a]!;
      if (a < 2) d1[j + a] = d1[j + a]! + l2 * c[a]! * c[a + 1]!;
      if (a < 1) d2[j + a] = d2[j + a]! + l2 * c[a]! * c[a + 2]!;
    }
  }
  // LDLᵀ for a symmetric pentadiagonal matrix: L has unit diagonal and two sub-diagonals.
  const D = new Float64Array(n);
  const L1 = new Float64Array(n); // L[i+1][i]
  const L2 = new Float64Array(n); // L[i+2][i]
  for (let i = 0; i < n; i++) {
    let di = d0[i]!;
    if (i >= 1) di -= L1[i - 1]! * L1[i - 1]! * D[i - 1]!;
    if (i >= 2) di -= L2[i - 2]! * L2[i - 2]! * D[i - 2]!;
    D[i] = di;
    if (i + 1 < n) {
      let v = d1[i]!;
      if (i >= 1) v -= L2[i - 1]! * L1[i - 1]! * D[i - 1]!;
      L1[i] = v / di;
    }
    if (i + 2 < n) L2[i] = d2[i]! / di;
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = x[i]!;
    if (i >= 1) v -= L1[i - 1]! * y[i - 1]!;
    if (i >= 2) v -= L2[i - 2]! * y[i - 2]!;
    y[i] = v;
  }
  for (let i = 0; i < n; i++) y[i] = y[i]! / D[i]!;
  const trend = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let v = y[i]!;
    if (i + 1 < n) v -= L1[i]! * trend[i + 1]!;
    if (i + 2 < n) v -= L2[i]! * trend[i + 2]!;
    trend[i] = v;
  }
  return Array.from(x, (v, i) => v - trend[i]!);
}

/**
 * Normalised autocorrelation of a (zero-meaned) signal for lags
 * `minLag..maxLag` samples. r[k] = Σ x[i] x[i+k] / Σ x[i]², so r[0] = 1.
 * Returns zeros for a zero-variance signal.
 */
export function autocorrelation(x: ArrayLike<number>, maxLag: number): number[] {
  const n = x.length;
  const m = mean(x);
  let e = 0;
  for (let i = 0; i < n; i++) e += (x[i]! - m) ** 2;
  const out = new Array<number>(Math.min(maxLag, n - 1) + 1).fill(0);
  if (!(e > 0)) return out;
  for (let k = 0; k < out.length; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += (x[i]! - m) * (x[i + k]! - m);
    out[k] = s / e;
  }
  return out;
}

/**
 * Pulse rate from the autocorrelation of a pulse signal: the first local
 * maximum in the lag range for `bandHz` whose height reaches 85% of the
 * highest maximum in that range (so a beat period wins over its multiples),
 * refined by parabolic interpolation. `strength` is that autocorrelation
 * value (−1..1); weak peaks mean the signal is not periodic.
 */
export function autocorrelationRate(
  x: ArrayLike<number>,
  fs: number,
  bandHz: [number, number],
): { bpm: number; strength: number } | null {
  const minLag = Math.max(1, Math.floor(fs / bandHz[1]));
  const maxLag = Math.ceil(fs / bandHz[0]);
  const r = autocorrelation(x, maxLag + 1);
  return acfPeak(r, fs, minLag, maxLag);
}

/** Pick the beat-period peak of an autocorrelation sequence (see autocorrelationRate). */
export function acfPeak(
  r: ArrayLike<number>,
  fs: number,
  minLag: number,
  maxLag: number,
): { bpm: number; strength: number } | null {
  const peaks: number[] = [];
  for (let k = Math.max(1, minLag); k <= Math.min(maxLag, r.length - 2); k++) {
    if (r[k]! > r[k - 1]! && r[k]! >= r[k + 1]!) peaks.push(k);
  }
  if (!peaks.length) return null;
  const top = Math.max(...peaks.map((k) => r[k]!));
  if (!(top > 0)) return null;
  const k = peaks.find((p) => r[p]! >= 0.85 * top)!;
  const a = r[k - 1]!,
    b = r[k]!,
    c = r[k + 1]!;
  const denom = a - 2 * b + c;
  const lag = denom === 0 ? k : k + (0.5 * (a - c)) / denom;
  return { bpm: (60 * fs) / lag, strength: b };
}

/**
 * Reusable Welch estimator for many spectra of the same segment length and
 * FFT size (the heart-rate fusion computes hundreds per scan). Same result
 * as `welch` (Hann window, 50% overlap, per-segment mean removal), with the
 * window, frequency axis and FFT buffers allocated once.
 */
export interface WelchPlan {
  segLen: number;
  size: number;
  fs: number;
  freqs: number[];
  /** Power spectrum of x[start, end), averaged over 50%-overlapping segments. */
  run(x: ArrayLike<number>, start?: number, end?: number): Float64Array;
}

export function createWelchPlan(fs: number, segLen: number, nfft: number): WelchPlan {
  const size = nextPow2(Math.max(nfft, segLen));
  const win = hann(segLen);
  const half = size / 2 + 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const freqs = Array.from({ length: half }, (_, k) => (k * fs) / size);
  const step = Math.max(1, Math.floor(segLen / 2));
  return {
    segLen,
    size,
    fs,
    freqs,
    run(x, start = 0, end = x.length) {
      const acc = new Float64Array(half);
      let segments = 0;
      for (let s = start; s + segLen <= end; s += step) {
        let m = 0;
        for (let i = 0; i < segLen; i++) m += x[s + i]!;
        m /= segLen;
        re.fill(0);
        im.fill(0);
        for (let i = 0; i < segLen; i++) re[i] = (x[s + i]! - m) * win[i]!;
        fft(re, im);
        for (let k = 0; k < half; k++) acc[k] = acc[k]! + re[k]! * re[k]! + im[k]! * im[k]!;
        segments++;
      }
      if (segments > 1) for (let k = 0; k < half; k++) acc[k] = acc[k]! / segments;
      return acc;
    },
  };
}
