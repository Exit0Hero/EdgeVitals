import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  onboard,
  registerUser,
  runAssessment,
  setupApp,
  teardown,
  type Ctx,
  type User,
} from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

/** Create a completed morning assessment and backdate it `daysAgo` days. */
async function morningDaysAgo(u: User, daysAgo: number, hr: number, hrv: number, sleep = 4) {
  const { id } = await runAssessment(ctx.app, u, { hr, hrv, br: 14 });
  await ctx.db.query(
    `UPDATE assessments SET started_at = date_trunc('day', now()) - ($2::int * interval '1 day') + interval '7 hours',
       scheduled_for = date_trunc('day', now()) - ($2::int * interval '1 day') + interval '7 hours', timezone = 'UTC' WHERE id = $1`,
    [id, daysAgo],
  );
  await ctx.db.query('UPDATE check_ins SET sleep_quality = $2 WHERE assessment_id = $1', [
    id,
    sleep,
  ]);
}

describe('dashboard and trends', () => {
  it('shows an empty state for a new user', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const d = (await ctx.app.inject({ url: '/api/v1/dashboard/today', headers: u.auth })).json();
    expect(d.baseline.day).toBe(0);
    expect(d.last_assessment).toBeNull();
    expect(d.streak).toBe(0);
    expect(d.scores.recovery).toBeNull();
  });

  it('tracks baseline progress and withholds scores before day 14', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    for (let i = 3; i >= 0; i--) await morningDaysAgo(u, i, 60 + i, 45 + i);
    const d = (await ctx.app.inject({ url: '/api/v1/dashboard/today', headers: u.auth })).json();
    expect(d.baseline.day).toBe(4);
    expect(d.baseline.daysRemaining).toBe(10);
    expect(d.streak).toBe(4);
    expect(d.today.morning.status).toBe('completed');
    expect(d.scores.recovery).toBeNull();
    expect(d.score_usual).toEqual({ recovery: null, stress: null, energy: null });
    expect(
      d.last_assessment.metrics.find((m: { metric: string }) => m.metric === 'heart_rate').relative,
    ).toBe('no_baseline');
  });

  it('unlocks scores, usual range and insights with a mature history', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    for (let i = 21; i >= 0; i--) {
      const good = i % 2 === 0;
      await morningDaysAgo(u, i, good ? 58 : 64, good ? 54 : 42, good ? 5 : 2);
    }
    const d = (await ctx.app.inject({ url: '/api/v1/dashboard/today', headers: u.auth })).json();
    expect(d.baseline.ready).toBe(true);
    expect(d.streak).toBe(22);
    expect(d.scores.recovery.value).toBeGreaterThanOrEqual(0);
    expect(['Good', 'Fair', 'Low']).toContain(d.scores.recovery.label);
    expect(typeof d.score_usual.recovery).toBe('number');
    expect(d.progress.hrv).not.toBeNull();
    expect(d.report).toMatchObject({ unlocked: false, daysToGo: 8 });
    expect(d.insight.body).toMatch(/not proof of cause/);

    const t7 = (
      await ctx.app.inject({ url: '/api/v1/trends?metric=hrv&period=7d', headers: u.auth })
    ).json();
    const t30 = (
      await ctx.app.inject({ url: '/api/v1/trends?metric=hrv&period=30d', headers: u.auth })
    ).json();
    expect(t7.points).toHaveLength(7);
    expect(t30.points).toHaveLength(30);
    expect(t30.sampleCount).toBe(22);
    expect(t30.missingDays).toBe(8);
    expect(t30.usualRange).not.toBeNull();
    expect(t30.summaries.blood_pressure.value).toBeNull();
    expect(
      (await ctx.app.inject({ url: '/api/v1/trends?metric=bp&period=7d', headers: u.auth }))
        .statusCode,
    ).toBeGreaterThanOrEqual(400);
  });
});
