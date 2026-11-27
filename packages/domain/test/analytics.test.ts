import { describe, expect, it } from 'vitest';
import {
  computeBaseline,
  computeDailyScores,
  computeInsights,
  computeReportProgress,
  computeStreak,
  computeTrend,
  localDate,
  relativeToBaseline,
} from '../src/analytics';
import { day, evening, morning } from './helpers';

const at = (d: string, t = '12:00:00') => new Date(`${d}T${t}Z`);

function history(
  days: number,
  f: (i: number) => [number | null, number | null] = (i) => [60 + (i % 5), 45 + (i % 7)],
) {
  return Array.from({ length: days }, (_, i) => morning(day(i), ...f(i)));
}

describe('dates', () => {
  it('uses the user time zone for the local date', () => {
    expect(localDate('2026-11-26T20:00:00Z', 'Asia/Kolkata')).toBe('2026-11-27');
    expect(localDate('2026-11-26T20:00:00Z', 'America/New_York')).toBe('2026-11-26');
  });
});

describe('baseline', () => {
  it('shows day progress and stays collecting before day 14', () => {
    const b = computeBaseline(history(4), at(day(3)), 'UTC');
    expect(b.day).toBe(4);
    expect(b.daysRemaining).toBe(10);
    expect(b.ready).toBe(false);
    expect(b.metrics.find((m) => m.metric === 'hrv')!.status).toBe('collecting');
  });

  it('becomes ready at day 14 with enough valid samples', () => {
    const b = computeBaseline(history(14), at(day(13)), 'UTC');
    expect(b.ready).toBe(true);
    const hr = b.metrics.find((m) => m.metric === 'heart_rate')!;
    expect(hr.center).toBe(62);
    expect(hr.lower!).toBeLessThan(62);
    expect(hr.upper!).toBeGreaterThan(62);
  });

  it('is insufficient when readings were mostly unavailable', () => {
    const recs = history(14, (i) => (i < 4 ? [60, 45] : [null, null]));
    const b = computeBaseline(recs, at(day(13)), 'UTC');
    expect(b.periodComplete).toBe(true);
    expect(b.ready).toBe(false);
    expect(b.metrics.find((m) => m.metric === 'heart_rate')!.status).toBe('insufficient');
  });

  it('ignores demo, failed and cancelled assessments', () => {
    const recs = [
      ...history(14).map((r) => ({ ...r, demo: true })),
      morning(day(0), 60, 40, { status: 'failed' }),
      morning(day(1), 60, 40, { status: 'cancelled' }),
    ];
    const b = computeBaseline(recs, at(day(13)), 'UTC');
    expect(b.day).toBe(0);
    expect(b.metrics.every((m) => m.sampleCount === 0)).toBe(true);
  });

  it('labels values relative to the personal range only when ready', () => {
    const ready = computeBaseline(history(14), at(day(13)), 'UTC');
    const hr = ready.metrics.find((m) => m.metric === 'heart_rate');
    expect(relativeToBaseline(62, hr)).toBe('typical');
    expect(relativeToBaseline(80, hr)).toBe('higher');
    expect(relativeToBaseline(40, hr)).toBe('lower');
    expect(relativeToBaseline(null, hr)).toBe('unavailable');
    const early = computeBaseline(history(3), at(day(2)), 'UTC').metrics.find(
      (m) => m.metric === 'heart_rate',
    );
    expect(relativeToBaseline(62, early)).toBe('no_baseline');
  });
});

describe('scores', () => {
  const recs = history(14);
  const base = computeBaseline(recs, at(day(13)), 'UTC');

  it('withholds all scores before the baseline is ready', () => {
    const s = computeDailyScores(
      recs[2],
      undefined,
      computeBaseline(recs.slice(0, 3), at(day(2)), 'UTC'),
    );
    expect(s.recovery).toBeNull();
    expect(s.withheld.recovery).toMatch(/baseline/);
  });

  it('gives higher recovery for higher HRV and lower HR than usual', () => {
    const good = computeDailyScores(morning(day(14), 55, 60), undefined, base);
    const poor = computeDailyScores(morning(day(14), 70, 35), undefined, base);
    expect(good.recovery!.value).toBeGreaterThan(70);
    expect(good.recovery!.label).toBe('Good');
    expect(poor.recovery!.value).toBeLessThan(40);
  });

  it('withholds recovery when HRV was not measured', () => {
    const s = computeDailyScores(morning(day(14), 60, null), undefined, base);
    expect(s.recovery).toBeNull();
    expect(s.energy).toBeNull();
    expect(s.withheld.recovery).toBeDefined();
  });

  it('includes evening stress rating in the stress score', () => {
    const m = morning(day(14), 62, 48);
    const calm = computeDailyScores(m, evening(day(14), 62, 48, 1), base).stress!.value;
    const tense = computeDailyScores(m, evening(day(14), 62, 48, 5), base).stress!.value;
    expect(tense - calm).toBe(32);
  });

  it('keeps scores in 0-100', () => {
    const s = computeDailyScores(morning(day(14), 30, 250), undefined, base);
    expect(s.recovery!.value).toBe(100);
  });
});

describe('streak', () => {
  it('counts consecutive days ending today or yesterday', () => {
    const recs = [morning(day(0), 60, 40), morning(day(1), 60, 40), morning(day(2), 60, 40)];
    expect(computeStreak(recs, at(day(2)), 'UTC')).toBe(3);
    expect(computeStreak(recs, at(day(3)), 'UTC')).toBe(3);
    expect(computeStreak(recs, at(day(4)), 'UTC')).toBe(0);
  });
  it('breaks on a missed day and ignores failed scans', () => {
    const recs = [
      morning(day(0), 60, 40),
      morning(day(2), 60, 40),
      morning(day(3), null, null, { status: 'failed' }),
    ];
    expect(computeStreak(recs, at(day(3)), 'UTC')).toBe(1);
  });
  it('uses the user time zone for day boundaries', () => {
    // 20:00 UTC on day 0 and day 1 are day 1 and day 2 in Kolkata.
    const recs = [
      morning(day(0), 60, 40, { time: '20:00:00' }),
      morning(day(1), 60, 40, { time: '20:00:00' }),
    ];
    expect(computeStreak(recs, at(day(2), '06:00:00'), 'Asia/Kolkata')).toBe(2);
  });
});

describe('trends', () => {
  it('returns one point per day with nulls for missing days', () => {
    const recs = history(10).filter((_, i) => i !== 5);
    const t = computeTrend(recs, 'hrv', '7d', at(day(9)), 'UTC');
    expect(t.points).toHaveLength(7);
    expect(t.points.find((p) => p.date === day(5))!.value).toBeNull();
    expect(t.sampleCount).toBe(6);
    expect(t.missingDays).toBe(1);
    expect(t.usualRange).toBeNull();
  });

  it('shows a usual range once the baseline is ready and changes with period', () => {
    const recs = history(40);
    const t7 = computeTrend(recs, 'heart_rate', '7d', at(day(39)), 'UTC');
    const t30 = computeTrend(recs, 'heart_rate', '30d', at(day(39)), 'UTC');
    expect(t7.usualRange).not.toBeNull();
    expect(t30.points).toHaveLength(30);
    expect(t30.sampleCount).toBe(30);
  });

  it('trends breathing rate from morning scans, with a usual range once ready', () => {
    const recs = history(40).map((r, i) => ({
      ...r,
      measurements: [
        ...r.measurements,
        { metric: 'breathing_rate' as const, status: 'valid' as const, value: 14 + (i % 3) },
      ],
    }));
    const t = computeTrend(recs, 'breathing_rate', '7d', at(day(39)), 'UTC');
    expect(t.unit).toBe('/min');
    expect(t.sampleCount).toBe(7);
    expect(t.points.at(-1)!.value).toBe(14 + (39 % 3));
    expect(t.usualRange).not.toBeNull();
    // Without breathing readings the trend is empty, never filled in.
    expect(computeTrend(history(40), 'breathing_rate', '7d', at(day(39)), 'UTC').sampleCount).toBe(
      0,
    );
  });

  it('has no recovery points before day 14', () => {
    const t = computeTrend(history(20), 'recovery', '30d', at(day(19)), 'UTC');
    const withValues = t.points.filter((p) => p.value !== null).map((p) => p.date);
    expect(withValues.every((d) => d >= day(13))).toBe(true);
    expect(withValues.length).toBeGreaterThan(0);
  });
});

describe('insights', () => {
  it('finds a sleep association with enough evidence and uses non-causal wording', () => {
    const recs = Array.from({ length: 30 }, (_, i) => {
      const goodSleep = i % 2 === 0;
      return morning(day(i), goodSleep ? 58 : 66, goodSleep ? 55 : 40, {
        sleep: goodSleep ? 5 : 2,
      });
    });
    const ins = computeInsights(recs, 'UTC');
    const sleep = ins.find((x) => x.id === 'sleep-hrv')!;
    expect(sleep).toBeDefined();
    expect(sleep.body).toMatch(/lower/);
    expect(sleep.body).toMatch(/not proof of cause/);
    expect(sleep.groupA.n).toBeGreaterThanOrEqual(5);
  });

  it('suppresses insights with too few samples or no difference', () => {
    expect(computeInsights(history(6), 'UTC')).toEqual([]);
    const flat = Array.from({ length: 30 }, (_, i) =>
      morning(day(i), 60, 45, { sleep: i % 2 ? 5 : 2 }),
    );
    expect(computeInsights(flat, 'UTC').find((x) => x.id === 'sleep-hrv')).toBeUndefined();
  });
});

describe('30-day report', () => {
  it('needs 30 days and 20 assessment days', () => {
    const p = computeReportProgress(history(22), at(day(21)), 'UTC');
    expect(p.unlocked).toBe(false);
    expect(p.daysToGo).toBe(8);
    const sparse = history(30).filter((_, i) => i % 2 === 0);
    const q = computeReportProgress(sparse, at(day(29)), 'UTC');
    expect(q.unlocked).toBe(false);
    expect(q.daysToGo).toBe(5);
    expect(computeReportProgress(history(30), at(day(29)), 'UTC').unlocked).toBe(true);
  });
});
