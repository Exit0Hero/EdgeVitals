/**
 * Agreement statistics for method comparison (Bland & Altman, Lancet 1986).
 * Pure functions; no data of their own.
 */
export interface AgreementStats {
  /** Paired (estimate, reference) values. */
  n: number;
  mae: number | null;
  rmse: number | null;
  /** Mean of estimate - reference. */
  bias: number | null;
  /** SD of estimate - reference (n - 1). */
  sd: number | null;
  /** Bland-Altman 95% limits of agreement: bias ± 1.96 SD. */
  loaLower: number | null;
  loaUpper: number | null;
}

export function agreement(pairs: { estimate: number; reference: number }[]): AgreementStats {
  const n = pairs.length;
  if (!n) return { n, mae: null, rmse: null, bias: null, sd: null, loaLower: null, loaUpper: null };
  const d = pairs.map((p) => p.estimate - p.reference);
  const bias = d.reduce((a, b) => a + b, 0) / n;
  const mae = d.reduce((a, b) => a + Math.abs(b), 0) / n;
  const rmse = Math.sqrt(d.reduce((a, b) => a + b * b, 0) / n);
  const sd = n > 1 ? Math.sqrt(d.reduce((a, b) => a + (b - bias) ** 2, 0) / (n - 1)) : null;
  return {
    n,
    mae,
    rmse,
    bias,
    sd,
    loaLower: sd === null ? null : bias - 1.96 * sd,
    loaUpper: sd === null ? null : bias + 1.96 * sd,
  };
}

export interface CoverageStats {
  /** Recordings attempted. */
  attempted: number;
  /** Recordings for which a value was reported. */
  reported: number;
  /** reported / attempted. */
  coverage: number | null;
  /** 1 - coverage. */
  rejectionRate: number | null;
}

export function coverage(attempted: number, reported: number): CoverageStats {
  return {
    attempted,
    reported,
    coverage: attempted ? reported / attempted : null,
    rejectionRate: attempted ? 1 - reported / attempted : null,
  };
}

export function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function rmssdMs(ibisSec: number[]): number | null {
  if (ibisSec.length < 2) return null;
  let s = 0;
  for (let i = 1; i < ibisSec.length; i++) s += (ibisSec[i]! - ibisSec[i - 1]!) ** 2;
  return 1000 * Math.sqrt(s / (ibisSec.length - 1));
}
