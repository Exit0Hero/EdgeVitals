import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { registerUser, setupApp, teardown, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp({ AUTH_RATE_LIMIT_PER_MIN: '10', CORS_ORIGINS: 'http://localhost:8081' });
});
afterAll(() => teardown(ctx));

describe('security controls', () => {
  it('requires authentication on user resources', async () => {
    for (const url of [
      '/api/v1/me',
      '/api/v1/assessments',
      '/api/v1/dashboard/today',
      '/api/v1/trends?metric=hrv&period=7d',
    ]) {
      const res = await ctx.app.inject({ url });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthenticated');
    }
  });

  it('rejects tokens signed with another key or algorithm', async () => {
    const u = await registerUser(ctx.app);
    const sub = (await ctx.db.query('SELECT id FROM users WHERE email = $1', [u.email])).rows[0].id;
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('edgevitals-api')
      .setAudience('edgevitals-app')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('attacker-secret-attacker-secret-attacker'));
    const res = await ctx.app.inject({
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.statusCode).toBe(401);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.`;
    expect(
      (await ctx.app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${none}` } }))
        .statusCode,
    ).toBe(401);
  });

  it('sets security headers', async () => {
    const res = await ctx.app.inject({ url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('allows the web app origin to use every API method, and no other origin', async () => {
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const res = await ctx.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/me/profile',
        headers: {
          origin: 'http://localhost:8081',
          'access-control-request-method': method,
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
      expect(String(res.headers['access-control-allow-methods'])).toContain(method);
    }
    const evil = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/me/profile',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PATCH' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate-limits login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'rl@x.test', password: 'whatever 1' },
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });

  it('returns the documented error envelope for unknown routes and malformed JSON', async () => {
    const nf = await ctx.app.inject({ url: '/api/v1/nope' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error).toMatchObject({ code: 'not_found' });
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.request_id).toBeTruthy();
  });

  it('refuses unsafe production configuration', () => {
    const base = {
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 'x'.repeat(40),
      NODE_ENV: 'production',
      HOSTING_REGION: 'EU (Frankfurt)',
    };
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, DEMO_MODE_ENABLED: 'true' })).toThrow(/DEMO_MODE/);
    expect(() => loadConfig({ ...base, HOSTING_REGION: '' })).toThrow(/HOSTING_REGION/);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: 'http://app.example' })).toThrow(
      /CORS_ORIGINS/,
    );
    expect(loadConfig({ ...base, CORS_ORIGINS: 'https://app.example' }).corsOrigins).toEqual([
      'https://app.example',
    ]);
    expect(loadConfig(base).isProduction).toBe(true);
  });
});
