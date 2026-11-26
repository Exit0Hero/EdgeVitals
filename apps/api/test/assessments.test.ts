import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fullScan,
  measurement,
  onboard,
  registerUser,
  runAssessment,
  setupApp,
  teardown,
  type Ctx,
} from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

const create = (c: Ctx, auth: Record<string, string>, payload: Record<string, unknown> = {}) =>
  c.app.inject({
    method: 'POST',
    url: '/api/v1/assessments',
    headers: auth,
    payload: {
      kind: 'morning',
      scheduled_for: '2026-11-26T07:15:00+05:30',
      timezone: 'Asia/Kolkata',
      ...payload,
    },
  });

describe('assessments', () => {
  it('requires required consent before an assessment can start', async () => {
    const u = await registerUser(ctx.app);
    const res = await create(ctx, u.auth);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('consent_required');
  });

  it('stops new assessments when required consent is withdrawn', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const rec = (await ctx.app.inject({ url: '/api/v1/me/consents', headers: u.auth })).json()
      .current.processing.record_id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/me/consents/${rec}/withdraw`,
      headers: u.auth,
    });
    expect((await create(ctx, u.auth)).statusCode).toBe(403);
  });

  it('is idempotent with an Idempotency-Key and numbers retries as new attempts', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const a1 = await create(ctx, { ...u.auth, 'idempotency-key': 'k1' });
    const a1b = await create(ctx, { ...u.auth, 'idempotency-key': 'k1' });
    expect(a1.statusCode).toBe(201);
    expect(a1b.statusCode).toBe(200);
    expect(a1b.json().id).toBe(a1.json().id);
    const a2 = await create(ctx, { ...u.auth, 'idempotency-key': 'k2' });
    expect(a2.json().attempt_number).toBe(2);
  });

  it('isolates assessments between users', async () => {
    const a = await registerUser(ctx.app);
    const b = await registerUser(ctx.app);
    await onboard(ctx.app, a);
    await onboard(ctx.app, b);
    const id = (await create(ctx, a.auth)).json().id;
    expect(
      (await ctx.app.inject({ url: `/api/v1/assessments/${id}`, headers: b.auth })).statusCode,
    ).toBe(404);
    const write = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: b.auth,
      payload: { outcome: 'completed', measurements: fullScan(60, 40, 14) },
    });
    expect(write.statusCode).toBe(404);
    const list = (await ctx.app.inject({ url: '/api/v1/assessments', headers: b.auth })).json();
    expect(list.items).toHaveLength(0);
  });

  it('validates check-in ratings and kind, and allows edits before submission', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const id = (await create(ctx, u.auth)).json().id;
    const url = `/api/v1/assessments/${id}/check-in`;
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url,
          headers: u.auth,
          payload: {
            kind: 'morning',
            sleep_quality: 6,
            energy_rating: 3,
            alcohol_previous_evening: false,
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url,
          headers: u.auth,
          payload: { kind: 'evening', stress_rating: 2, energy_rating: 3 },
        })
      ).statusCode,
    ).toBe(422);
    const first = await ctx.app.inject({
      method: 'POST',
      url,
      headers: u.auth,
      payload: {
        kind: 'morning',
        sleep_quality: 4,
        energy_rating: 3,
        alcohol_previous_evening: false,
      },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().status).toBe('check_in_complete');
    const edit = await ctx.app.inject({
      method: 'POST',
      url,
      headers: u.auth,
      payload: {
        kind: 'morning',
        sleep_quality: 5,
        energy_rating: 3,
        alcohol_previous_evening: true,
      },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().check_in).toMatchObject({
      sleep_quality: 5,
      alcohol_previous_evening: true,
    });
  });

  it('stores a complete scan with provenance and derives the outcome server-side', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const { res } = await runAssessment(ctx.app, u, { hr: 62, hrv: 48, br: 14 });
    expect(res.statusCode).toBe(201);
    const a = res.json();
    expect(a.status).toBe('completed');
    const hr = a.measurements.find((m: { metric: string }) => m.metric === 'heart_rate');
    expect(hr).toMatchObject({
      value: 62,
      unit: 'bpm',
      algorithm_name: 'pos-welch',
      algorithm_version: '0.1.0',
      validation: 'unvalidated',
    });
    expect(a.measurements.find((m: { metric: string }) => m.metric === 'spo2').value).toBeNull();
  });

  it('marks partial results and failed scans honestly', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    expect(
      (await runAssessment(ctx.app, u, { hr: 62, hrv: null, br: null })).res.json().status,
    ).toBe('partial');
    expect(
      (await runAssessment(ctx.app, u, { hr: null, hrv: null, br: null })).res.json().status,
    ).toBe('failed');
  });

  it('rejects resubmission, simulated values, SpO2/BP values and unit mismatches', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const { id } = await runAssessment(ctx.app, u);
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: u.auth,
      payload: { outcome: 'completed', measurements: fullScan(60, 40, 14) },
    });
    expect(again.statusCode).toBe(409);

    const fresh = (await create(ctx, u.auth)).json().id;
    const post = (measurements: unknown[]) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/v1/assessments/${fresh}/measurements`,
        headers: u.auth,
        payload: { outcome: 'completed', measurements },
      });
    const sim = await post([
      measurement('heart_rate', 60, { status: 'simulated', method: 'demo_fixture' }),
    ]);
    expect(sim.statusCode).toBe(422);
    expect(sim.json().error.code).toBe('simulated_rejected');
    expect((await post([measurement('spo2', 98)])).statusCode).toBe(422);
    expect((await post([measurement('heart_rate', 60, { unit: 'ms' })])).statusCode).toBe(422);
    expect((await post([measurement('heart_rate', null, { status: 'valid' })])).statusCode).toBe(
      422,
    );
  });

  it('a cancelled scan creates no readings', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const id = (await create(ctx, u.auth)).json().id;
    const bad = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: u.auth,
      payload: { outcome: 'cancelled', measurements: fullScan(60, null, null) },
    });
    expect(bad.statusCode).toBe(422);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: u.auth,
      payload: { outcome: 'cancelled', measurements: fullScan(null, null, null) },
    });
    expect(ok.json().status).toBe('cancelled');
  });

  it('enforces the status state machine', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const id = (await create(ctx, u.auth)).json().id;
    const patch = (status: string) =>
      ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/assessments/${id}/status`,
        headers: u.auth,
        payload: { status },
      });
    expect((await patch('capturing')).statusCode).toBe(200);
    expect((await patch('completed')).statusCode).toBe(409);
    expect((await patch('cancelled')).statusCode).toBe(200);
    expect((await patch('capturing')).statusCode).toBe(409);
  });

  it('rejects demo assessments unless demo mode is enabled', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    expect((await create(ctx, u.auth, { demo: true })).statusCode).toBe(403);
  });

  it('paginates with a cursor', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    for (let i = 0; i < 5; i++) await create(ctx, u.auth);
    const p1 = (
      await ctx.app.inject({ url: '/api/v1/assessments?limit=2', headers: u.auth })
    ).json();
    expect(p1.items).toHaveLength(2);
    const p2 = (
      await ctx.app.inject({
        url: `/api/v1/assessments?limit=2&cursor=${p1.next_cursor}`,
        headers: u.auth,
      })
    ).json();
    const p3 = (
      await ctx.app.inject({
        url: `/api/v1/assessments?limit=2&cursor=${p2.next_cursor}`,
        headers: u.auth,
      })
    ).json();
    const ids = [...p1.items, ...p2.items, ...p3.items].map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.next_cursor).toBeNull();
  });
});

describe('demo mode', () => {
  let demo: Ctx;
  beforeAll(async () => {
    demo = await setupApp({ DEMO_MODE_ENABLED: 'true' });
  });
  afterAll(() => teardown(demo));

  it('accepts only simulated fixtures in demo assessments and keeps them out of the baseline', async () => {
    const u = await registerUser(demo.app);
    await onboard(demo.app, u);
    const id = (await create(demo, u.auth, { demo: true })).json().id;
    const real = await demo.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: u.auth,
      payload: { outcome: 'completed', measurements: fullScan(60, 40, 14) },
    });
    expect(real.statusCode).toBe(422);
    const sim = await demo.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: u.auth,
      payload: {
        outcome: 'completed',
        measurements: [
          measurement('heart_rate', 60, {
            status: 'simulated',
            method: 'demo_fixture',
            algorithm_name: 'demo-fixture',
          }),
        ],
      },
    });
    expect(sim.statusCode).toBe(201);
    const base = (await demo.app.inject({ url: '/api/v1/baseline', headers: u.auth })).json();
    expect(base.day).toBe(0);
    expect(base.metrics.every((m: { sampleCount: number }) => m.sampleCount === 0)).toBe(true);
  });
});
