import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser, setupApp, teardown, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

describe('auth', () => {
  it('registers, stores an argon2id hash and never returns it', async () => {
    const u = await registerUser(ctx.app);
    const { rows } = await ctx.db.query('SELECT password_hash FROM users WHERE email = $1', [
      u.email,
    ]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const me = await ctx.app.inject({ url: '/api/v1/me', headers: u.auth });
    expect(me.statusCode).toBe(200);
    expect(me.body).not.toContain('argon2');
  });

  it('rejects duplicate emails case-insensitively', async () => {
    const u = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: u.email.toUpperCase(), password: 'another pass 99' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('email_taken');
  });

  it('rejects weak passwords with 422', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'x@y.test', password: 'short' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.request_id).toBeTruthy();
  });

  it('logs in with the right password only, with the same error for unknown emails', async () => {
    const u = await registerUser(ctx.app);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: u.email, password: 'correct horse 42' },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: u.email, password: 'wrong horse 42' },
    });
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@x.test', password: 'wrong horse 42' },
    });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().error.message).toBe(unknown.json().error.message);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const u = await registerUser(ctx.app);
    const r1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token: u.refresh },
    });
    expect(r1.statusCode).toBe(200);
    const next = r1.json().refresh_token;
    expect(next).not.toBe(u.refresh);
    // Replaying the old token is treated as theft.
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token: u.refresh },
    });
    expect(replay.statusCode).toBe(401);
    // ...and the legitimately rotated token is now revoked too.
    const after = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token: next },
    });
    expect(after.statusCode).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const u = await registerUser(ctx.app);
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refresh_token: u.refresh },
    });
    expect(out.statusCode).toBe(204);
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token: u.refresh },
    });
    expect(r.statusCode).toBe(401);
  });
});
