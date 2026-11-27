/**
 * Baseline, scores, trends, insights, streak and report rules
 * (docs/spec/09_BASELINE_AND_ANALYTICS.md, docs/adr/0005).
 *
 * Pure functions over a user's assessment history so the API and the app
 * compute the same answer. Inputs exclude nothing implicitly: every
 * function filters out non-valid, simulated and demo data itself.
 */
import type {
  AssessmentKind,
  AssessmentStatus,
  CheckIn,
  Metric,
  MeasurementStatus,
  TrendMetric,
  TrendPeriod,
} from './schemas';
import { PERIOD_DAYS } from './schemas';

export const ANALYTICS_VERSION = 'analytics-v0.1.0';
/** Score formulas are a DRAFT pending product approval (ADR 0005). */
export const SCORE_FORMULA_VERSION = 'scores-v0-draft';

export const BASELINE_POLICY = {
  /** Calendar days from the first assessment day (inclusive). */
  days: 14,
  /** Minimum valid samples for a metric's baseline to be ready. */
  minSamples: 7,
  /** Minimum distinct days contributing valid samples. */
  minDistinctDays: 5,
  /** Rolling window used once the baseline exists. */
  windowDays: 28,
  /** Range = median ± k × 1.4826 × MAD (≈ ±1 SD for normal data). */
  rangeK: 1,
} as const;

export interface MeasurementRecord {
  metric: Metric;
  status: MeasurementStatus;
  value: number | null;
  /** Diastolic blood pressure; null for every other metric. */
  valueSecondary?: number | null;
  /** camera_rppg, finger_ppg (ADR 0010), demo_fixture, licensed_sdk (ADR 0007) or camera_experimental. */
  method?: string;
  /** Vendor id for licensed_sdk readings, e.g. "sdk-binah". */
  algorithm?: string;
  /** Why a value is missing (UnavailableReason), null when valid. */
  reason?: string | null;
}

export interface AssessmentRecord {
  id: string;
  kind: AssessmentKind;
  status: AssessmentStatus;
  /** UTC ISO timestamp the assessment started. */
  startedAt: string;
  /** IANA zone the user was in. */
  timezone: string;
  demo: boolean;
  checkIn: CheckIn | null;
  measurements: MeasurementRecord[];
}

// ───────────────────────────── dates ─────────────────────────────

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(iso: string | Date, timeZone: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// ───────────────────────────── stats ─────────────────────────────

export function median(xs: number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function robustSpread(xs: number[]): number {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

const COMPLETED: readonly AssessmentStatus[] = ['completed', 'partial'];

/** Real (non-demo) assessments that produced at least one result. */
export function realCompleted(records: AssessmentRecord[]): AssessmentRecord[] {
  return records.filter((r) => !r.demo && COMPLETED.includes(r.status));
}

/** Valid, non-simulated values of one metric with their timestamps. */
export function validSamples(
  records: AssessmentRecord[],
  metric: Metric,
  kind?: AssessmentKind,
): { at: string; tz: string; value: number }[] {
  const out: { at: string; tz: string; value: number }[] = [];
  for (const r of realCompleted(records)) {
    if (kind && r.kind !== kind) continue;
    for (const m of r.measurements) {
      if (m.metric === metric && m.status === 'valid' && m.value !== null) {
        out.push({ at: r.startedAt, tz: r.timezone, value: m.value });
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ──────────────────────────── baseline ───────────────────────────

export type BaselineStatus = 'collecting' | 'ready' | 'insufficient';

export interface MetricBaseline {
  metric: Metric;
  status: BaselineStatus;
  sampleCount: number;
  distinctDays: number;
  center: number | null;
  lower: number | null;
  upper: number | null;
}

export interface BaselineProgress {
  /** Day number of today since first assessment (1-based), 0 when none. */
  day: number;
  totalDays: number;
  daysRemaining: number;
  firstDate: string | null;
  /** True once the calendar period has elapsed. */
  periodComplete: boolean;
  /** Whether personal scores/trends may unlock (period done + HR & HRV ready). */
  ready: boolean;
  metrics: MetricBaseline[];
}

/** Baselines are computed from morning scans (resting state, per PDF). */
export const BASELINE_METRICS: readonly Metric[] = ['heart_rate', 'hrv', 'breathing_rate'];

export function computeBaseline(
  records: AssessmentRecord[],
  now: Date,
  timeZone: string,
): BaselineProgress {
  const real = realCompleted(records);
  const firstDate = real.length
    ? real.map((r) => localDate(r.startedAt, timeZone)).sort()[0]!
    : null;
  const today = localDate(now, timeZone);
  const day = firstDate ? daysBetween(firstDate, today) + 1 : 0;
  const periodComplete = day >= BASELINE_POLICY.days;
  const windowStart = addDays(today, -BASELINE_POLICY.windowDays + 1);

  const metrics = BASELINE_METRICS.map((metric): MetricBaseline => {
    const samples = validSamples(records, metric, 'morning').filter(
      (s) => localDate(s.at, timeZone) >= windowStart,
    );
    const days = new Set(samples.map((s) => localDate(s.at, timeZone))).size;
    const enough =
      samples.length >= BASELINE_POLICY.minSamples && days >= BASELINE_POLICY.minDistinctDays;
    const status: BaselineStatus =
      enough && periodComplete ? 'ready' : periodComplete ? 'insufficient' : 'collecting';
    if (status !== 'ready') {
      return {
        metric,
        status,
        sampleCount: samples.length,
        distinctDays: days,
        center: null,
        lower: null,
        upper: null,
      };
    }
    const vals = samples.map((s) => s.value);
    const c = median(vals);
    const spread = Math.max(robustSpread(vals), metric === 'hrv' ? 3 : 1);
    return {
      metric,
      status,
      sampleCount: samples.length,
      distinctDays: days,
      center: c,
      lower: c - BASELINE_POLICY.rangeK * spread,
      upper: c + BASELINE_POLICY.rangeK * spread,
    };
  });
  const ready =
    periodComplete &&
    metrics.find((m) => m.metric === 'heart_rate')!.status === 'ready' &&
    metrics.find((m) => m.metric === 'hrv')!.status === 'ready';
  return {
    day,
    totalDays: BASELINE_POLICY.days,
    daysRemaining: Math.max(0, BASELINE_POLICY.days - day),
    firstDate,
    periodComplete,
    ready,
    metrics,
  };
}

export type RelativeStatus = 'typical' | 'higher' | 'lower' | 'no_baseline' | 'unavailable';

/** Compare a value to the personal range. Never a clinical threshold. */
export function relativeToBaseline(
  value: number | null,
  b: MetricBaseline | undefined,
): RelativeStatus {
  if (value === null) return 'unavailable';
  if (!b || b.status !== 'ready' || b.lower === null || b.upper === null) return 'no_baseline';
  if (value > b.upper) return 'higher';
  if (value < b.lower) return 'lower';
  return 'typical';
}

// ───────────────────────────── scores ────────────────────────────

export interface Score {
  value: number;
  label: string;
}
export interface DailyScores {
  recovery: Score | null;
  stress: Score | null;
  energy: Score | null;
  /** Why a score is withheld, when it is. */
  withheld: Partial<Record<'recovery' | 'stress' | 'energy', string>>;
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const z = (v: number, b: MetricBaseline) =>
  (v - b.center!) / Math.max(1e-6, (b.upper! - b.center!) / BASELINE_POLICY.rangeK);

export function recoveryLabel(v: number): string {
  return v >= 70 ? 'Good' : v >= 40 ? 'Fair' : 'Low';
}
export function stressLabel(v: number): string {
  return v < 34 ? 'Calm' : v < 67 ? 'Moderate' : 'High';
}
export function energyLabel(v: number): string {
  return v >= 67 ? 'Charged' : v >= 34 ? 'Steady' : 'Low';
}

function metricValue(r: AssessmentRecord | undefined, metric: Metric): number | null {
  const m = r?.measurements.find((x) => x.metric === metric && x.status === 'valid');
  return m?.value ?? null;
}

/**
 * DRAFT score formulas (ADR 0005), personal-baseline relative:
 *  Recovery = 50 + 15·z(HRV) − 10·z(resting HR)          from the morning scan
 *  Stress   = 50 − 12·z(HRV) + 8·z(HR) [+ 8·(stress rating − 3) in the evening]
 *  Energy   = ½·Recovery + ½·25·(energy rating − 1)        latest check-in
 * Each is withheld when the baseline is not ready or an input is missing.
 */
export function computeDailyScores(
  morning: AssessmentRecord | undefined,
  evening: AssessmentRecord | undefined,
  baseline: BaselineProgress,
): DailyScores {
  const withheld: DailyScores['withheld'] = {};
  const bHr = baseline.metrics.find((m) => m.metric === 'heart_rate');
  const bHrv = baseline.metrics.find((m) => m.metric === 'hrv');
  if (!baseline.ready || !bHr || !bHrv || bHr.status !== 'ready' || bHrv.status !== 'ready') {
    const why = 'Unlocks when your 14-day baseline is ready';
    return {
      recovery: null,
      stress: null,
      energy: null,
      withheld: { recovery: why, stress: why, energy: why },
    };
  }
  const hr = metricValue(morning, 'heart_rate');
  const hrv = metricValue(morning, 'hrv');
  let recovery: Score | null = null;
  if (hr === null || hrv === null)
    withheld.recovery = 'Needs heart rate and HRV from this morning’s scan';
  else {
    const v = clamp(50 + 15 * z(hrv, bHrv) - 10 * z(hr, bHr));
    recovery = { value: v, label: recoveryLabel(v) };
  }

  const latest = evening && metricValue(evening, 'hrv') !== null ? evening : morning;
  const sHr = metricValue(latest, 'heart_rate');
  const sHrv = metricValue(latest, 'hrv');
  let stress: Score | null = null;
  if (sHr === null || sHrv === null) withheld.stress = 'Needs heart rate and HRV from a scan today';
  else {
    let v = 50 - 12 * z(sHrv, bHrv) + 8 * z(sHr, bHr);
    if (latest === evening && evening?.checkIn?.kind === 'evening')
      v += 8 * (evening.checkIn.stress_rating - 3);
    v = clamp(v);
    stress = { value: v, label: stressLabel(v) };
  }

  const ci = (evening?.checkIn ?? morning?.checkIn) || null;
  let energy: Score | null = null;
  if (!recovery || !ci) withheld.energy = 'Needs a recovery score and an energy check-in today';
  else {
    const v = clamp(0.5 * recovery.value + 0.5 * 25 * (ci.energy_rating - 1));
    energy = { value: v, label: energyLabel(v) };
  }
  return { recovery, stress, energy, withheld };
}

// ───────────────────────────── per-day ───────────────────────────

export interface DayRecord {
  date: string;
  morning?: AssessmentRecord;
  evening?: AssessmentRecord;
}

/** Latest completed real morning/evening assessment per local day. */
export function groupByDay(records: AssessmentRecord[], timeZone: string): Map<string, DayRecord> {
  const map = new Map<string, DayRecord>();
  for (const r of realCompleted(records).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const date = localDate(r.startedAt, timeZone);
    const d = map.get(date) ?? { date };
    d[r.kind] = r;
    map.set(date, d);
  }
  return map;
}

// ───────────────────────────── streak ────────────────────────────

/**
 * Consecutive local days with at least one completed or partial real
 * assessment, ending today (or yesterday if today has none yet).
 */
export function computeStreak(records: AssessmentRecord[], now: Date, timeZone: string): number {
  const days = new Set(groupByDay(records, timeZone).keys());
  let cursor = localDate(now, timeZone);
  if (!days.has(cursor)) cursor = addDays(cursor, -1);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

// ───────────────────────────── trends ────────────────────────────

export interface TrendPoint {
  date: string;
  value: number | null;
}
export interface TrendSeries {
  metric: TrendMetric;
  period: TrendPeriod;
  unit: string;
  from: string;
  to: string;
  points: TrendPoint[];
  sampleCount: number;
  missingDays: number;
  average: number | null;
  /** Personal usual range; null until the baseline supports it. */
  usualRange: { lower: number; upper: number } | null;
  firstHalfAverage: number | null;
  secondHalfAverage: number | null;
  version: string;
}

const TREND_UNIT: Record<TrendMetric, string> = {
  recovery: '',
  stress: '',
  energy: '',
  hrv: 'ms',
  heart_rate: 'bpm',
  breathing_rate: '/min',
};

const isVitalTrend = (m: TrendMetric): m is 'hrv' | 'heart_rate' | 'breathing_rate' =>
  m === 'hrv' || m === 'heart_rate' || m === 'breathing_rate';

/** Rolling baseline as of a given date (uses only data up to that day). */
function baselineAsOf(records: AssessmentRecord[], date: string, tz: string): BaselineProgress {
  const cutoff = Date.parse(`${addDays(date, 1)}T00:00:00Z`) + 14 * 3_600_000; // generous end of local day
  const before = records.filter(
    (r) => localDate(r.startedAt, tz) <= date && Date.parse(r.startedAt) < cutoff,
  );
  return computeBaseline(before, new Date(`${date}T12:00:00Z`), tz);
}

export function computeTrend(
  records: AssessmentRecord[],
  metric: TrendMetric,
  period: TrendPeriod,
  now: Date,
  timeZone: string,
): TrendSeries {
  const n = PERIOD_DAYS[period];
  const to = localDate(now, timeZone);
  const from = addDays(to, -n + 1);
  const byDay = groupByDay(records, timeZone);
  const points: TrendPoint[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const d = byDay.get(date);
    let value: number | null = null;
    if (d) {
      if (isVitalTrend(metric)) value = metricValue(d.morning, metric);
      else {
        const s = computeDailyScores(d.morning, d.evening, baselineAsOf(records, date, timeZone));
        value = s[metric]?.value ?? null;
      }
    }
    points.push({ date, value });
  }
  const vals = points.filter((p) => p.value !== null).map((p) => p.value!);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const half = Math.floor(n / 2);
  const baseline = computeBaseline(records, now, timeZone);
  let usualRange: TrendSeries['usualRange'] = null;
  if (isVitalTrend(metric)) {
    const b = baseline.metrics.find((m) => m.metric === metric);
    if (b?.status === 'ready') usualRange = { lower: b.lower!, upper: b.upper! };
  }
  return {
    metric,
    period,
    unit: TREND_UNIT[metric],
    from,
    to,
    points,
    sampleCount: vals.length,
    missingDays: n - vals.length,
    average: avg(vals),
    usualRange,
    firstHalfAverage: avg(
      points
        .slice(0, half)
        .filter((p) => p.value !== null)
        .map((p) => p.value!),
    ),
    secondHalfAverage: avg(
      points
        .slice(half)
        .filter((p) => p.value !== null)
        .map((p) => p.value!),
    ),
    version: `${ANALYTICS_VERSION}/${SCORE_FORMULA_VERSION}`,
  };
}

// ───────────────────────────── insights ──────────────────────────

export const INSIGHT_RULES = {
  version: 'insights-v0.1.0',
  minPerGroup: 5,
  /** Minimum standardised mean difference (Cohen's d) to show an insight. */
  minEffectSize: 0.5,
} as const;

export interface Insight {
  id: string;
  title: string;
  body: string;
  groupA: { label: string; n: number; mean: number };
  groupB: { label: string; n: number; mean: number };
  effectSize: number;
  ruleVersion: string;
}

function cohensD(a: number[], b: number[]): number {
  const m = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const v = (x: number[], mu: number) =>
    x.reduce((s, y) => s + (y - mu) ** 2, 0) / Math.max(1, x.length - 1);
  const ma = m(a),
    mb = m(b);
  const sp = Math.sqrt(
    ((a.length - 1) * v(a, ma) + (b.length - 1) * v(b, mb)) / Math.max(1, a.length + b.length - 2),
  );
  if (sp > 0) return Math.max(-10, Math.min(10, (ma - mb) / sp));
  return ma === mb ? 0 : Math.sign(ma - mb) * 10;
}

/**
 * Deterministic association rules over the user's own records. Wording is
 * deliberately non-causal (doc 09 §6). Weak or under-sampled comparisons
 * are suppressed.
 */
export function computeInsights(records: AssessmentRecord[], timeZone: string): Insight[] {
  const days = [...groupByDay(records, timeZone).values()].filter(
    (d) => d.morning?.checkIn?.kind === 'morning',
  );
  const out: Insight[] = [];
  const compare = (
    id: string,
    metric: 'hrv' | 'recovery',
    split: (d: DayRecord) => boolean | null,
    labels: [string, string],
    phrase: (a: number, b: number, higher: boolean) => [string, string],
  ) => {
    const a: number[] = [];
    const b: number[] = [];
    for (const d of days) {
      const which = split(d);
      if (which === null) continue;
      const v =
        metric === 'hrv'
          ? metricValue(d.morning, 'hrv')
          : (computeDailyScores(d.morning, d.evening, baselineAsOf(records, d.date, timeZone))
              .recovery?.value ?? null);
      if (v === null) continue;
      (which ? a : b).push(v);
    }
    if (a.length < INSIGHT_RULES.minPerGroup || b.length < INSIGHT_RULES.minPerGroup) return;
    const d = cohensD(a, b);
    if (Math.abs(d) < INSIGHT_RULES.minEffectSize) return;
    const ma = a.reduce((s, v) => s + v, 0) / a.length;
    const mb = b.reduce((s, v) => s + v, 0) / b.length;
    const [title, body] = phrase(ma, mb, ma > mb);
    out.push({
      id,
      title,
      body: `${body} Based on ${a.length + b.length} mornings in your records; an observation, not proof of cause.`,
      groupA: { label: labels[0], n: a.length, mean: ma },
      groupB: { label: labels[1], n: b.length, mean: mb },
      effectSize: Math.round(d * 100) / 100,
      ruleVersion: INSIGHT_RULES.version,
    });
  };
  const sleep = (d: DayRecord) =>
    d.morning!.checkIn!.kind === 'morning' ? d.morning!.checkIn! : null;

  compare(
    'sleep-recovery',
    'recovery',
    (d) => {
      const s = sleep(d);
      return s ? s.sleep_quality >= 4 : null;
    },
    ['sleep 4–5', 'sleep 1–3'],
    (a, b, higher) => [
      higher ? 'Good sleep pays off' : 'Sleep and recovery',
      `After nights you rate 4 or 5, your recovery averages ${Math.round(a)}; after other nights, ${Math.round(b)}.`,
    ],
  );
  compare(
    'alcohol-recovery',
    'recovery',
    (d) => {
      const s = sleep(d);
      return s ? s.alcohol_previous_evening : null;
    },
    ['alcohol', 'no alcohol'],
    (a, b) => [
      'Alcohol and recovery',
      `On mornings after alcohol, your recovery averages ${Math.round(a)}; otherwise, ${Math.round(b)}.`,
    ],
  );
  compare(
    'sleep-hrv',
    'hrv',
    (d) => {
      const s = sleep(d);
      return s ? s.sleep_quality <= 2 : null;
    },
    ['sleep 1–2', 'sleep 3–5'],
    (a, b, higher) => [
      'Sleep and HRV',
      `Your HRV is usually ${higher ? 'higher' : 'lower'} the morning after you rate your sleep 1 or 2 (${Math.round(a)} vs ${Math.round(b)} ms).`,
    ],
  );
  return out.sort((x, y) => Math.abs(y.effectSize) - Math.abs(x.effectSize));
}

// ───────────────────────────── report ────────────────────────────

export const REPORT_POLICY = { days: 30, minAssessmentDays: 20 } as const;

export interface ReportProgress {
  unlocked: boolean;
  day: number;
  daysToGo: number;
  assessmentDays: number;
  assessmentDaysNeeded: number;
}

/** 30-day report: unlocks after 30 calendar days AND ≥20 days with an assessment. */
export function computeReportProgress(
  records: AssessmentRecord[],
  now: Date,
  timeZone: string,
): ReportProgress {
  const days = [...groupByDay(records, timeZone).keys()].sort();
  const first = days[0];
  const today = localDate(now, timeZone);
  const day = first ? daysBetween(first, today) + 1 : 0;
  const assessmentDays = days.length;
  const unlocked = day >= REPORT_POLICY.days && assessmentDays >= REPORT_POLICY.minAssessmentDays;
  return {
    unlocked,
    day,
    daysToGo: Math.max(
      REPORT_POLICY.days - day,
      REPORT_POLICY.minAssessmentDays - assessmentDays,
      0,
    ),
    assessmentDays,
    assessmentDaysNeeded: REPORT_POLICY.minAssessmentDays,
  };
}
