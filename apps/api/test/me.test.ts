import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard, registerUser, runAssessment, setupApp, teardown, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

describe('profile, consent and schedule', () => {
  it('starts not onboarded and becomes onboarded after consent, profile and schedule', async () => {
    const u = await registerUser(ctx.app);
    let me = (await ctx.app.inject({ url: '/api/v1/me', headers: u.auth })).json();
    expect(me.onboarding_complete).toBe(false);
    expect(me.consents.anonymous_improvement.active).toBe(false);
    await onboard(ctx.app, u, 'Asia/Kolkata');
    me = (await ctx.app.inject({ url: '/api/v1/me', headers: u.auth })).json();
    expect(me.onboarding_complete).toBe(true);
    expect(me.profile).toMatchObject({
      birth_year: 1985,
      sex_at_birth: 'female',
      height_cm: 175,
      weight_kg: 70,
    });
    expect(me.schedule).toMatchObject({
      morning_time: '07:15',
      evening_time: '21:00',
      timezone: 'Asia/Kolkata',
      heart_rate_affecting_substance: 'no',
    });
  });

  it('requires a complete first profile, then allows partial edits', async () => {
    const u = await registerUser(ctx.app);
    const partial = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: u.auth,
      payload: { height_cm: 180 },
    });
    expect(partial.statusCode).toBeGreaterThanOrEqual(400);
    await onboard(ctx.app, u);
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: u.auth,
      payload: { weight_kg: 72.5 },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ weight_kg: 72.5, height_cm: 175 });
    const bad = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: u.auth,
      payload: { weight_kg: 5 },
    });
    expect(bad.statusCode).toBe(422);
  });

  it('records optional consent independently and allows withdrawal', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const g = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/consents',
      headers: u.auth,
      payload: {
        consent_type: 'anonymous_improvement',
        granted: true,
        policy_version: '2026-11-26.1',
        source: 'test',
      },
    });
    expect(g.statusCode).toBe(201);
    const w = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/me/consents/${g.json().id}/withdraw`,
      headers: u.auth,
    });
    expect(w.statusCode).toBe(200);
    const c = (await ctx.app.inject({ url: '/api/v1/me/consents', headers: u.auth })).json();
    expect(c.current.anonymous_improvement.active).toBe(false);
    expect(c.required_consents_granted).toBe(true);
    expect(c.records.length).toBe(3);
  });

  it('cannot withdraw another user’s consent', async () => {
    const a = await registerUser(ctx.app);
    const b = await registerUser(ctx.app);
    await onboard(ctx.app, a);
    const rec = (await ctx.app.inject({ url: '/api/v1/me/consents', headers: a.auth })).json()
      .records[0];
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/me/consents/${rec.id}/withdraw`,
      headers: b.auth,
    });
    expect(res.statusCode).toBe(404);
  });

  it('validates schedule times and time zones', async () => {
    const u = await registerUser(ctx.app);
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/me/schedule',
      headers: u.auth,
      payload: {
        morning_time: '25:00',
        evening_time: '21:00',
        timezone: 'UTC',
        reminders_enabled: true,
      },
    });
    expect(bad.statusCode).toBe(422);
  });
});

describe('export and deletion', () => {
  it('exports all user data idempotently and only to the owner', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    await runAssessment(ctx.app, u);
    const h = { ...u.auth, 'idempotency-key': 'exp-1' };
    const e1 = await ctx.app.inject({ method: 'POST', url: '/api/v1/me/export', headers: h });
    const e2 = await ctx.app.inject({ method: 'POST', url: '/api/v1/me/export', headers: h });
    expect(e1.statusCode).toBe(202);
    expect(e2.json().id).toBe(e1.json().id);
    const dl = await ctx.app.inject({
      url: `/api/v1/me/export/${e1.json().id}/download`,
      headers: u.auth,
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['cache-control']).toBe('no-store');
    const data = dl.json();
    expect(data.account.email).toBe(u.email);
    expect(data.assessments).toHaveLength(1);
    expect(data.assessments[0].measurements).toHaveLength(5);
    expect(data.consents.length).toBe(2);
    expect(JSON.stringify(data)).not.toContain('password');
    const other = await registerUser(ctx.app);
    expect(
      (
        await ctx.app.inject({
          url: `/api/v1/me/export/${e1.json().id}/download`,
          headers: other.auth,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('deletes the account and all health data, and old tokens stop working', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const { id: aid } = await runAssessment(ctx.app, u);
    const uid = (await ctx.db.query('SELECT id FROM users WHERE email = $1', [u.email])).rows[0].id;
    const noConfirm = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/deletion-request',
      headers: u.auth,
      payload: {},
    });
    expect(noConfirm.statusCode).toBeGreaterThanOrEqual(400);
    const del = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/deletion-request',
      headers: u.auth,
      payload: { confirm: 'DELETE' },
    });
    expect(del.statusCode).toBe(202);
    expect(del.json().status).toBe('completed');
    for (const [table, col, val] of [
      ['users', 'id', uid],
      ['profiles', 'user_id', uid],
      ['consent_records', 'user_id', uid],
      ['assessments', 'user_id', uid],
      ['measurements', 'assessment_id', aid],
      ['refresh_tokens', 'user_id', uid],
    ] as const) {
      const { rows } = await ctx.db.query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${col} = $1`,
        [val],
      );
      expect(rows[0].n, table).toBe(0);
    }
    expect((await ctx.app.inject({ url: '/api/v1/me', headers: u.auth })).statusCode).toBe(401);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          payload: { refresh_token: u.refresh },
        })
      ).statusCode,
    ).toBe(401);
    const status = await ctx.app.inject({ url: `/api/v1/me/deletion-request/${del.json().id}` });
    expect(status.json().status).toBe('completed');
    const audit = await ctx.db.query(
      "SELECT event_type FROM audit_events WHERE user_id = $1 AND event_type LIKE 'deletion.%'",
      [uid],
    );
    expect(audit.rows.map((r) => r.event_type)).toEqual([
      'deletion.requested',
      'deletion.completed',
    ]);
  });
});
