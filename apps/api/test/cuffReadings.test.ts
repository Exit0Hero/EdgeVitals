import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard, registerUser, setupApp, teardown, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe('cuff blood-pressure readings', () => {
  it('logs, lists, shows in trends and deletes a reading', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const post = (payload: Record<string, unknown>) =>
      ctx.app.inject({ method: 'POST', url: '/api/v1/blood-pressure', headers: u.auth, payload });
    const created = await post({
      systolic: 121,
      diastolic: 79,
      pulse_bpm: 64,
      measured_at: minutesAgo(5),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const list = (await ctx.app.inject({ url: '/api/v1/blood-pressure', headers: u.auth })).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ systolic: 121, diastolic: 79, pulse_bpm: 64 });

    const t = (
      await ctx.app.inject({ url: '/api/v1/trends?metric=hrv&period=7d', headers: u.auth })
    ).json();
    expect(t.summaries.blood_pressure).toMatchObject({
      value: 121,
      value_secondary: 79,
      source: 'cuff',
    });

    const exp = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/blood-pressure/${id}`,
      headers: u.auth,
    });
    expect(exp.statusCode).toBe(204);
    const after = (
      await ctx.app.inject({ url: '/api/v1/trends?metric=hrv&period=7d', headers: u.auth })
    ).json();
    expect(after.summaries.blood_pressure.value).toBeNull();
  });

  it('rejects impossible readings and other users cannot see or delete them', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const post = (payload: Record<string, unknown>) =>
      ctx.app.inject({ method: 'POST', url: '/api/v1/blood-pressure', headers: u.auth, payload });
    for (const bad of [
      { systolic: 80, diastolic: 90, measured_at: minutesAgo(1) },
      { systolic: 300, diastolic: 90, measured_at: minutesAgo(1) },
      { systolic: 120, diastolic: 80, measured_at: minutesAgo(-60) },
    ])
      expect((await post(bad)).statusCode).toBe(422);
    // Fractional mmHg is a malformed request.
    expect(
      (await post({ systolic: 120.5, diastolic: 80, measured_at: minutesAgo(1) })).statusCode,
    ).toBe(400);

    const id = (await post({ systolic: 118, diastolic: 76, measured_at: minutesAgo(1) })).json().id;
    const other = await registerUser(ctx.app);
    await onboard(ctx.app, other);
    expect(
      (await ctx.app.inject({ url: '/api/v1/blood-pressure', headers: other.auth })).json().items,
    ).toHaveLength(0);
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: `/api/v1/blood-pressure/${id}`,
          headers: other.auth,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('requires consent and authentication', async () => {
    const u = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/blood-pressure',
      headers: u.auth,
      payload: { systolic: 120, diastolic: 80, measured_at: minutesAgo(1) },
    });
    expect(res.statusCode).toBe(403);
    expect((await ctx.app.inject({ url: '/api/v1/blood-pressure' })).statusCode).toBe(401);
  });
});
