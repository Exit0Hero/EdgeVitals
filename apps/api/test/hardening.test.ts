import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCKOUT } from '../src/routes/auth';
import { fullScan, onboard, registerUser, setupApp, teardown, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

const login = (email: string, password: string) =>
  ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });

describe('security hardening', () => {
  it('locks an account after repeated wrong passwords, even across IPs', async () => {
    const u = await registerUser(ctx.app);
    for (let i = 0; i < LOCKOUT.failures; i++)
      expect((await login(u.email, `wrong password ${i}`)).statusCode).toBe(401);
    const locked = await login(u.email, 'correct horse 42');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('too_many_attempts');
    // The lock lifts once the window has passed.
    await ctx.db.query(
      "UPDATE audit_events SET created_at = created_at - interval '20 minutes' WHERE event_type = 'auth.login_failed'",
    );
    expect((await login(u.email, 'correct horse 42')).statusCode).toBe(200);
  });

  it('a successful sign-in resets the failure count', async () => {
    const u = await registerUser(ctx.app);
    for (let i = 0; i < LOCKOUT.failures - 1; i++) await login(u.email, `wrong password ${i}`);
    expect((await login(u.email, 'correct horse 42')).statusCode).toBe(200);
    for (let i = 0; i < LOCKOUT.failures - 1; i++) await login(u.email, `wrong again ${i}`);
    expect((await login(u.email, 'correct horse 42')).statusCode).toBe(200);
  });

  it('withdrawing consent stops new health data, even for an assessment already started', async () => {
    const u = await registerUser(ctx.app);
    await onboard(ctx.app, u);
    const a = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: u.auth,
      payload: { kind: 'morning', scheduled_for: new Date().toISOString(), timezone: 'UTC' },
    });
    const id = a.json().id;
    const consents = (await ctx.app.inject({ url: '/api/v1/me/consents', headers: u.auth })).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/me/consents/${consents.current.processing.record_id}/withdraw`,
      headers: u.auth,
    });
    const ci = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/check-in`,
      headers: u.auth,
      payload: {
        kind: 'morning',
        sleep_quality: 4,
        energy_rating: 3,
        alcohol_previous_evening: false,
      },
    });
    expect(ci.statusCode).toBe(403);
    const m = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${id}/measurements`,
      headers: u.auth,
      payload: { outcome: 'completed', measurements: fullScan(60, 45, 14) },
    });
    expect(m.statusCode).toBe(403);
    expect(m.json().error.code).toBe('consent_required');
  });

  it('two simultaneous registrations for one email give one account and a clean 409', async () => {
    const email = `race-${Date.now()}@example.test`;
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: { email, password: 'correct horse 42' },
        }),
      ),
    );
    expect([a!.statusCode, b!.statusCode].sort()).toEqual([201, 409]);
  });
});
