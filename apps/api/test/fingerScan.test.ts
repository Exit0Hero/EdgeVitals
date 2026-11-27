import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { measurement, onboard, registerUser, setupApp, teardown, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

const finger = {
  method: 'finger_ppg',
  algorithm_name: 'finger-ppg-slope',
  quality_flags: ['finger_scan'],
};

describe('finger scan measurements (ADR 0010)', () => {
  it('stores finger HR, HRV (RMSSD with SDNN) and breathing with provenance', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const id = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/assessments',
        headers: u.auth,
        payload: { kind: 'morning', scheduled_for: new Date().toISOString(), timezone: 'UTC' },
      })
    ).json().id;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: u.auth,
      payload: {
        outcome: 'completed',
        measurements: [
          { ...measurement('heart_rate', 64), ...finger },
          { ...measurement('hrv', 48), value_secondary: 52, ...finger },
          { ...measurement('breathing_rate', 14), ...finger },
          { ...measurement('spo2', null), ...finger, reason: 'unsupported_method' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const hrv = res.json().measurements.find((m: { metric: string }) => m.metric === 'hrv');
    expect(hrv).toMatchObject({ value: 48, value_secondary: 52, method: 'finger_ppg' });
  });

  it('rejects SpO2 or blood pressure values from a finger scan, in the API and the database', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const id = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/assessments',
        headers: u.auth,
        payload: { kind: 'evening', scheduled_for: new Date().toISOString(), timezone: 'UTC' },
      })
    ).json().id;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: u.auth,
      payload: { outcome: 'partial', measurements: [{ ...measurement('spo2', 97), ...finger }] },
    });
    expect(res.statusCode).toBe(422);
    await expect(
      ctx.db.query(
        `INSERT INTO measurements (assessment_id, metric, value_numeric, unit, status, quality_flags,
           method, algorithm_name, algorithm_version, config_version, validation, measured_at)
         VALUES ($1,'spo2',97,'%','valid','[]','finger_ppg','x','1.0.0','c','unvalidated',now())`,
        [id],
      ),
    ).rejects.toThrow(/check/);
  });
});
