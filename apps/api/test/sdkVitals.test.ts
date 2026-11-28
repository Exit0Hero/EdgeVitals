import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { measurement, onboard, registerUser, setupApp, teardown, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

const sdk = { method: 'licensed_sdk', algorithm_name: 'sdk-binah', algorithm_version: '5.2.0' };
const spo2 = (v: number) => ({ ...measurement('spo2', v), ...sdk });
const bp = (sys: number, dia: number) => ({
  ...measurement('blood_pressure', sys),
  value_secondary: dia,
  ...sdk,
});

async function submit(u: Awaited<ReturnType<typeof registerUser>>, measurements: unknown[]) {
  const id = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: u.auth,
      payload: { kind: 'morning', scheduled_for: new Date().toISOString(), timezone: 'UTC' },
    })
  ).json().id;
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/assessments/${id}/measurements`,
    headers: u.auth,
    payload: { outcome: 'completed', measurements },
  });
}

describe('licensed SDK vitals (ADR 0007)', () => {
  it('stores SDK SpO2 and BP with provenance and shows them on the dashboard and trends', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const res = await submit(u, [
      measurement('heart_rate', 61),
      measurement('hrv', null),
      measurement('breathing_rate', null),
      spo2(97),
      bp(118, 76),
    ]);
    expect(res.statusCode).toBe(201);
    const a = res.json();
    // SDK values never turn a scan with missing pipeline metrics into "completed".
    expect(a.status).toBe('partial');
    expect(
      a.measurements.find((m: { metric: string }) => m.metric === 'blood_pressure'),
    ).toMatchObject({
      value: 118,
      value_secondary: 76,
      method: 'licensed_sdk',
      algorithm_name: 'sdk-binah',
      validation: 'unvalidated',
    });

    const d = (await ctx.app.inject({ url: '/api/v1/dashboard/today', headers: u.auth })).json();
    expect(
      d.last_assessment.metrics.find((m: { metric: string }) => m.metric === 'blood_pressure'),
    ).toMatchObject({ value: 118, value_secondary: 76, method: 'licensed_sdk' });

    const t = (
      await ctx.app.inject({ url: '/api/v1/trends?metric=hrv&period=7d', headers: u.auth })
    ).json();
    expect(t.summaries.blood_pressure).toMatchObject({
      value: 118,
      value_secondary: 76,
      source: 'sdk-binah',
    });
  });

  it('rejects SpO2/BP from the camera pipeline, pipeline metrics from an SDK, and bad BP pairs', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    for (const bad of [
      [measurement('spo2', 97)],
      [{ ...measurement('blood_pressure', 120), value_secondary: 80 }],
      [{ ...measurement('heart_rate', 60), ...sdk }],
      [bp(80, 90)],
      [{ ...measurement('blood_pressure', 120), ...sdk }],
    ]) {
      expect((await submit(u, bad)).statusCode).toBe(422);
    }
  });

  it('stores experimental camera SpO2 (ADR 0008) without changing the outcome', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const res = await submit(u, [
      measurement('heart_rate', 61),
      measurement('hrv', null),
      measurement('breathing_rate', null),
      {
        ...measurement('spo2', 97),
        method: 'camera_experimental',
        algorithm_name: 'bal2015-ror-red-blue',
        quality_flags: ['experimental'],
      },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('partial');
    const d = (await ctx.app.inject({ url: '/api/v1/dashboard/today', headers: u.auth })).json();
    expect(
      d.last_assessment.metrics.find((m: { metric: string }) => m.metric === 'spo2'),
    ).toMatchObject({ value: 97, method: 'camera_experimental' });
    // A missing value carries its reason so Today can say why.
    expect(
      d.last_assessment.metrics.find((m: { metric: string }) => m.metric === 'hrv'),
    ).toMatchObject({ value: null, reason: 'low_signal_quality' });
    // Trends shows the newest experimental SpO2, labelled by its source.
    const t = (
      await ctx.app.inject({
        url: '/api/v1/trends?metric=breathing_rate&period=7d',
        headers: u.auth,
      })
    ).json();
    expect(t.unit).toBe('/min');
    expect(t.summaries.spo2).toMatchObject({
      value: 97,
      source: 'camera_experimental',
      source_detail: null,
    });
  });

  it('enforces the same rules in the database', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const res = await submit(u, [measurement('heart_rate', 60)]);
    const id = res.json().id;
    const insert = (
      metric: string,
      unit: string,
      value: number,
      secondary: number | null,
      method: string,
    ) =>
      ctx.db.query(
        `INSERT INTO measurements (assessment_id, metric, value_numeric, value_secondary, unit, status, quality_flags,
           method, algorithm_name, algorithm_version, config_version, validation, measured_at)
         VALUES ($1,$2,$3,$4,$5,'valid','[]',$6,'x','1.0.0','c','unvalidated',now())`,
        [id, metric, value, secondary, unit, method],
      );
    await expect(insert('spo2', '%', 97, null, 'camera_rppg')).rejects.toThrow(/check/);
    await expect(insert('hrv', 'ms', 40, null, 'licensed_sdk')).rejects.toThrow(/check/);
    await expect(insert('blood_pressure', 'mmHg', 120, null, 'licensed_sdk')).rejects.toThrow(
      /check/,
    );
    await expect(insert('blood_pressure', 'mmHg', 120, 80, 'camera_experimental')).rejects.toThrow(
      /check/,
    );
    await expect(insert('hrv', 'ms', 40, null, 'camera_experimental')).rejects.toThrow(/check/);
    await expect(insert('spo2', '%', 97, null, 'licensed_sdk')).resolves.toBeDefined();
  });
});
