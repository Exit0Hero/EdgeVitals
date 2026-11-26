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
      relative: relativeToBaseline(
        m.status === 'valid' ? m.value : null,
        baseline.metrics.find((b) => b.metric === m.metric),
      ),
    })),
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
        blood_pressure: { value: null, relative: 'unavailable', reason: 'unsupported_method' },
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
