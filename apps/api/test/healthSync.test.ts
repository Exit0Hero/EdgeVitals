import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard, registerUser, setupApp, teardown, type Ctx, type User } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const grantSync = (u: User) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/me/consents',
    headers: u.auth,
    payload: {
      consent_type: 'health_sync',
      granted: true,
      policy_version: '2026-11-26.1',
      source: 'test',
    },
  });

const upload = (u: User, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'POST', url: '/api/v1/health-sync/readings', headers: u.auth, payload });

const oximeter = (id: string, value: number, at: string) => ({
  metric: 'spo2',
  value,
  measured_at: at,
  external_id: id,
  source_app: 'com.sec.android.app.shealth',
  device_manufacturer: 'Samsung',
  device_model: 'Galaxy Watch6',
});
const cuff = (id: string, sys: number, dia: number, at: string) => ({
  metric: 'blood_pressure',
  value: sys,
  value_secondary: dia,
  measured_at: at,
  external_id: id,
  source_app: 'jp.co.omron.healthcare.omron_connect',
  source_name: 'OMRON connect',
});

describe('health app sync (Health Connect / Apple Health)', () => {
  it('needs the health_sync consent before accepting readings', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const r = await upload(u, {
      platform: 'health_connect',
      readings: [oximeter('a', 97, minutesAgo(10))],
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('health_sync_consent_required');
  });

  it('imports idempotently, keeps the source, and shows in trends without touching baselines', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    expect((await grantSync(u)).statusCode).toBe(201);
    const me = (await ctx.app.inject({ url: '/api/v1/me', headers: u.auth })).json();
    expect(me.consents.health_sync.active).toBe(true);

    const batch = {
      platform: 'health_connect',
      readings: [
        oximeter('ox-1', 96, minutesAgo(120)),
        oximeter('ox-2', 97.5, minutesAgo(30)),
        cuff('bp-1', 124, 81, minutesAgo(20)),
      ],
    };
    const first = await upload(u, batch);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ received: 3, inserted: 3, updated: 0 });
    // Same records again: nothing new, nothing changed.
    expect((await upload(u, batch)).json()).toMatchObject({ inserted: 0, updated: 0 });
    // A record the health app edited is updated in place.
    const edited = await upload(u, {
      platform: 'health_connect',
      readings: [cuff('bp-1', 126, 82, minutesAgo(20))],
    });
    expect(edited.json()).toMatchObject({ inserted: 0, updated: 1 });

    const list = (
      await ctx.app.inject({ url: '/api/v1/health-sync/readings', headers: u.auth })
    ).json();
    expect(list.items).toHaveLength(3);
    expect(list.items[0]).toMatchObject({
      metric: 'blood_pressure',
      value: 126,
      value_secondary: 82,
      platform: 'health_connect',
      source_name: 'OMRON connect',
    });

    const t = (
      await ctx.app.inject({ url: '/api/v1/trends?metric=hrv&period=7d', headers: u.auth })
    ).json();
    expect(t.summaries.blood_pressure).toMatchObject({
      value: 126,
      value_secondary: 82,
      source: 'health_connect',
      source_detail: { source_app: 'jp.co.omron.healthcare.omron_connect' },
    });
    expect(t.summaries.spo2).toMatchObject({
      value: 97.5,
      source: 'health_connect',
      source_detail: { device_model: 'Galaxy Watch6' },
    });

    // A newer cuff entry typed in by hand wins the blood-pressure summary.
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/blood-pressure',
      headers: u.auth,
      payload: { systolic: 118, diastolic: 76, measured_at: minutesAgo(1) },
    });
    const t2 = (
      await ctx.app.inject({ url: '/api/v1/trends?metric=hrv&period=7d', headers: u.auth })
    ).json();
    expect(t2.summaries.blood_pressure).toMatchObject({ value: 118, source: 'cuff' });

    // Synced readings never become baseline samples.
    const baseline = (await ctx.app.inject({ url: '/api/v1/baseline', headers: u.auth })).json();
    expect(JSON.stringify(baseline)).not.toContain('spo2');

    const exp = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/export',
      headers: u.auth,
    });
    const dl = (
      await ctx.app.inject({
        url: `/api/v1/me/export/${exp.json().id}/download`,
        headers: u.auth,
      })
    ).json();
    expect(dl.health_app_readings).toHaveLength(3);
  });

  it('rejects impossible or malformed readings', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    await grantSync(u);
    for (const bad of [
      oximeter('x', 45, minutesAgo(1)),
      oximeter('x', 101, minutesAgo(1)),
      { ...oximeter('x', 97, minutesAgo(1)), value_secondary: 3 },
      cuff('x', 80, 90, minutesAgo(1)),
      cuff('x', 120.5, 80, minutesAgo(1)),
      { ...cuff('x', 120, 80, minutesAgo(1)), value_secondary: null },
      cuff('x', 120, 80, minutesAgo(-60)),
    ]) {
      const r = await upload(u, { platform: 'health_connect', readings: [bad] });
      expect(r.statusCode, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
    }
    const tooMany = Array.from({ length: 501 }, (_, i) => oximeter(`o${i}`, 97, minutesAgo(5)));
    expect(
      (await upload(u, { platform: 'health_connect', readings: tooMany })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await upload(u, { platform: 'fitbit', readings: [] })).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });

  it('keeps users apart and deletes synced copies on request', async () => {
    const a = await registerUser(ctx.app);
    const b = await registerUser(ctx.app);
    for (const u of [a, b]) {
      await onboard(ctx.app, u);
      await grantSync(u);
    }
    // Same external id from two users does not collide.
    await upload(a, { platform: 'apple_health', readings: [oximeter('same', 98, minutesAgo(5))] });
    await upload(b, { platform: 'apple_health', readings: [oximeter('same', 95, minutesAgo(5))] });
    const listB = (
      await ctx.app.inject({ url: '/api/v1/health-sync/readings', headers: b.auth })
    ).json();
    expect(listB.items).toHaveLength(1);
    expect(listB.items[0].value).toBe(95);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/health-sync/readings',
      headers: a.auth,
    });
    expect(del.json()).toEqual({ deleted: 1 });
    const listA = (
      await ctx.app.inject({ url: '/api/v1/health-sync/readings', headers: a.auth })
    ).json();
    expect(listA.items).toHaveLength(0);
    expect(
      (await ctx.app.inject({ url: '/api/v1/health-sync/readings', headers: b.auth })).json().items,
    ).toHaveLength(1);
  });

  it('stops accepting uploads once the consent is withdrawn', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const g = (await grantSync(u)).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/me/consents/${g.id}/withdraw`,
      headers: u.auth,
    });
    const r = await upload(u, {
      platform: 'health_connect',
      readings: [oximeter('a', 97, minutesAgo(10))],
    });
    expect(r.statusCode).toBe(403);
  });
});
