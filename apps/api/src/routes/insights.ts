import {
  ANALYTICS_VERSION,
  SCORE_FORMULA_VERSION,
  computeBaseline,
  computeDailyScores,
  computeInsights,
  computeReportProgress,
  computeStreak,
  computeTrend,
  groupByDay,
  localDate,
  median,
  realCompleted,
  relativeToBaseline,
  trendsQuerySchema,
  validSamples,
  PERIOD_DAYS,
  type AssessmentRecord,
  type BaselineProgress,
} from '@edgevitals/domain';
import type { FastifyInstance } from 'fastify';
import { loadRecords, userTimezone } from '../records';
import { parse } from '../validate';

function vitals(r: AssessmentRecord | undefined, baseline: BaselineProgress) {
  if (!r) return null;
  return {
    assessment_id: r.id,
    kind: r.kind,
    started_at: r.startedAt,
    status: r.status,
    metrics: r.measurements.map((m) => ({
      metric: m.metric,
      status: m.status,
      value: m.status === 'valid' ? m.value : null,
      value_secondary: m.status === 'valid' ? (m.valueSecondary ?? null) : null,
      method: m.method ?? null,
      reason: m.status === 'valid' ? null : (m.reason ?? null),
      /** Shown labelled "Low confidence"; never used for baselines or scores. */
      low_confidence: m.status === 'valid' && !!m.lowConfidence,
      relative: relativeToBaseline(
        m.status === 'valid' ? m.value : null,
        baseline.metrics.find((b) => b.metric === m.metric),
      ),
    })),
  };
}

/**
 * Most recent valid blood pressure in the period. Only a licensed SDK can
 * produce one (ADR 0007); without it this stays "unavailable".
 */
function latestSdkBloodPressure(records: AssessmentRecord[], now: Date, days: number) {
  const since = now.getTime() - days * 86_400_000;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]!;
    if (r.demo || new Date(r.startedAt).getTime() < since) continue;
    const m = r.measurements.find(
      (x) => x.metric === 'blood_pressure' && x.status === 'valid' && x.method === 'licensed_sdk',
    );
    if (m && m.value !== null && m.valueSecondary != null)
      return {
        value: m.value,
        value_secondary: m.valueSecondary,
        measured_at: r.startedAt,
        source: m.algorithm ?? null,
        relative: 'unavailable' as const,
        reason: null,
      };
  }
  return {
    value: null,
    value_secondary: null,
    measured_at: null,
    source: null,
    relative: 'unavailable' as const,
    reason: 'unsupported_method',
  };
}

/** First-vs-recent change once 14+ valid morning samples exist (PDF "61 → 57 bpm"). */
function change(records: AssessmentRecord[], metric: 'heart_rate' | 'hrv') {
  const s = validSamples(records, metric, 'morning');
  if (s.length < 14) return null;
  const first = median(s.slice(0, 7).map((x) => x.value));
  const recent = median(s.slice(-7).map((x) => x.value));
  return { first: Math.round(first), recent: Math.round(recent), sample_count: s.length };
}

export async function insightRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    await app.authenticate(req);
  });

  const context = async (userId: string) => {
    const [records, tz] = await Promise.all([
      loadRecords(app.db, userId),
      userTimezone(app.db, userId),
    ]);
    return { records, tz, now: new Date() };
  };

  app.get('/dashboard/today', async (req) => {
    const { records, tz, now } = await context(req.userId!);
    const today = localDate(now, tz);
    const baseline = computeBaseline(records, now, tz);
    const day = groupByDay(records, tz).get(today);
    const scores = computeDailyScores(day?.morning, day?.evening, baseline);
    const real = realCompleted(records);
    const last = real[real.length - 1];
    const recoveryTrend = computeTrend(records, 'recovery', '30d', now, tz);
    const insights = computeInsights(records, tz);
    // "vs usual" for score cards: median of the previous 30 days' scores, excluding today.
    const usual = (m: 'recovery' | 'stress' | 'energy') => {
      if (!baseline.ready) return null;
      const t = m === 'recovery' ? recoveryTrend : computeTrend(records, m, '30d', now, tz);
      const vals = t.points
        .filter((p) => p.date !== today && p.value !== null)
        .map((p) => p.value!);
      return vals.length >= 3 ? Math.round(median(vals)) : null;
    };
    return {
      date: today,
      timezone: tz,
      generated_at: now.toISOString(),
      version: `${ANALYTICS_VERSION}/${SCORE_FORMULA_VERSION}`,
      streak: computeStreak(records, now, tz),
      baseline,
      today: {
        morning: day?.morning
          ? { assessment_id: day.morning.id, status: day.morning.status }
          : null,
        evening: day?.evening
          ? { assessment_id: day.evening.id, status: day.evening.status }
          : null,
      },
      scores,
      score_usual: {
        recovery: usual('recovery'),
        stress: usual('stress'),
        energy: usual('energy'),
      },
      last_assessment: vitals(last, baseline),
      morning_vitals: vitals(day?.morning, baseline),
      progress: {
        recovery: baseline.ready ? recoveryTrend : null,
        resting_heart_rate: change(records, 'heart_rate'),
        hrv: change(records, 'hrv'),
      },
      insight: insights[0] ?? null,
      report: computeReportProgress(records, now, tz),
    };
  });

  /** Newest reading copied from Health Connect / Apple Health (ADR 0009), within the period. */
  const latestSynced = async (
    userId: string,
    metric: 'spo2' | 'blood_pressure',
    now: Date,
    days: number,
  ) => {
    const { rows } = await app.db.query(
      `SELECT value::float8 AS value, value_secondary, measured_at, platform, source_app, source_name,
              device_manufacturer, device_model
         FROM health_sync_readings
        WHERE user_id = $1 AND metric = $2
          AND measured_at > $3::timestamptz - ($4::int * interval '1 day')
          AND measured_at <= $3::timestamptz + interval '5 minutes'
        ORDER BY measured_at DESC LIMIT 1`,
      [userId, metric, now.toISOString(), days],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      value: r.value as number,
      value_secondary: (r.value_secondary as number | null) ?? null,
      measured_at: new Date(r.measured_at).toISOString(),
      source: r.platform as 'health_connect' | 'apple_health',
      source_detail: {
        platform: r.platform as 'health_connect' | 'apple_health',
        source_app: r.source_app as string,
        source_name: (r.source_name as string | null) ?? null,
        device_manufacturer: (r.device_manufacturer as string | null) ?? null,
        device_model: (r.device_model as string | null) ?? null,
      },
      relative: 'unavailable' as const,
      reason: null,
    };
  };

  /**
   * Newest of: the user's own cuff readings, readings synced from their health
   * app, and licensed-SDK readings, within the period. `source` says which.
   */
  const latestBloodPressure = async (
    userId: string,
    records: AssessmentRecord[],
    now: Date,
    days: number,
  ) => {
    const sdk = { ...latestSdkBloodPressure(records, now, days), source_detail: null };
    const { rows } = await app.db.query(
      `SELECT systolic, diastolic, measured_at FROM cuff_bp_readings
        WHERE user_id = $1 AND measured_at > $2::timestamptz - ($3::int * interval '1 day')
        ORDER BY measured_at DESC LIMIT 1`,
      [userId, now.toISOString(), days],
    );
    const cuffRow = rows[0];
    const cuff = cuffRow
      ? {
          value: cuffRow.systolic as number,
          value_secondary: cuffRow.diastolic as number,
          measured_at: new Date(cuffRow.measured_at).toISOString(),
          source: 'cuff',
          source_detail: null,
          relative: 'unavailable' as const,
          reason: null,
        }
      : null;
    const synced = await latestSynced(userId, 'blood_pressure', now, days);
    const candidates = [sdk.measured_at ? sdk : null, cuff, synced].filter(
      (x): x is NonNullable<typeof x> => !!x,
    );
    if (!candidates.length) return sdk;
    return candidates.reduce((a, b) => (b.measured_at! > a.measured_at! ? b : a));
  };

  /**
   * Newest SpO2 in the period: synced from the user's own devices (ADR 0009)
   * or, when they opted in, the experimental face-scan estimate (ADR 0008),
   * labelled by `source`. Null when there is neither.
   */
  const latestSpo2 = async (
    userId: string,
    records: AssessmentRecord[],
    now: Date,
    days: number,
  ) => {
    const synced = await latestSynced(userId, 'spo2', now, days);
    const since = now.getTime() - days * 86_400_000;
    let camera = null;
    for (let i = records.length - 1; i >= 0 && !camera; i--) {
      const r = records[i]!;
      if (r.demo || new Date(r.startedAt).getTime() < since) continue;
      const m = r.measurements.find(
        (x) => x.metric === 'spo2' && x.status === 'valid' && x.method === 'camera_experimental',
      );
      if (m && m.value !== null)
        camera = {
          value: m.value,
          value_secondary: null,
          measured_at: r.startedAt,
          source: 'camera_experimental' as const,
          source_detail: null,
          relative: 'unavailable' as const,
          reason: null,
        };
    }
    if (!synced) return camera;
    if (!camera) return synced;
    return camera.measured_at > synced.measured_at ? camera : synced;
  };

  app.get('/trends', async (req) => {
    const q = parse(trendsQuerySchema, req.query);
    const { records, tz, now } = await context(req.userId!);
    const baseline = computeBaseline(records, now, tz);
    const hr = validSamples(records, 'heart_rate', 'morning').slice(-7);
    const restingHr = hr.length ? Math.round(median(hr.map((s) => s.value))) : null;
    const insights = computeInsights(records, tz).filter((i) =>
      q.metric === 'hrv'
        ? i.id.endsWith('hrv')
        : q.metric === 'recovery'
          ? i.id.endsWith('recovery')
          : false,
    );
    return {
      ...computeTrend(records, q.metric, q.period, now, tz),
      insight: insights[0] ?? null,
      summaries: {
        resting_heart_rate: {
          value: restingHr,
          relative: relativeToBaseline(
            restingHr,
            baseline.metrics.find((m) => m.metric === 'heart_rate'),
          ),
          sample_count: hr.length,
        },
        blood_pressure: await latestBloodPressure(req.userId!, records, now, PERIOD_DAYS[q.period]),
        spo2: await latestSpo2(req.userId!, records, now, PERIOD_DAYS[q.period]),
      },
    };
  });

  app.get('/baseline', async (req) => {
    const { records, tz, now } = await context(req.userId!);
    return computeBaseline(records, now, tz);
  });

  app.get('/insights', async (req) => {
    const { records, tz } = await context(req.userId!);
    return { items: computeInsights(records, tz) };
  });

  app.get('/reports/monthly', async (req) => {
    const { records, tz, now } = await context(req.userId!);
    const progress = computeReportProgress(records, now, tz);
    if (!progress.unlocked) return { progress, report: null };
    const metrics = ['recovery', 'stress', 'energy', 'hrv', 'heart_rate'] as const;
    return {
      progress,
      report: Object.fromEntries(
        metrics.map((m) => {
          const t = computeTrend(records, m, '30d', now, tz);
          return [
            m,
            {
              average: t.average,
              sample_count: t.sampleCount,
              first_half: t.firstHalfAverage,
              second_half: t.secondHalfAverage,
            },
          ];
        }),
      ),
      insights: computeInsights(records, tz),
    };
  });
}
