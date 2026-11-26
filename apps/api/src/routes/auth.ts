import { loginSchema, refreshSchema, registerSchema } from '@edgevitals/domain';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { dummyHash, hashPassword, verifyPassword } from '../auth/passwords';
import { withTransaction } from '../db';
import { ApiError, conflict, unauthorized } from '../errors';
import { parse } from '../validate';

export const LOCKOUT = {
  failures: 10,
  windowMinutes: 15,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
} as const;

export async function authRoutes(app: FastifyInstance) {
  const recentFailures = async (userId: string) => {
    const { rows } = await app.db.query(
      `SELECT COUNT(*)::int AS n FROM audit_events
        WHERE user_id = $1 AND event_type = 'auth.login_failed'
          AND created_at > now() - make_interval(mins => $2)
          AND created_at > COALESCE((SELECT max(created_at) FROM audit_events
                                      WHERE user_id = $1 AND event_type = 'auth.login'), '-infinity')`,
      [userId, LOCKOUT.windowMinutes],
    );
    return rows[0].n as number;
  };

  const strict = {
    config: { rateLimit: { max: app.config.authRateLimitPerMin, timeWindow: '1 minute' } },
  };

  app.post('/register', strict, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const passwordHash = await hashPassword(body.password);
    const tokens = await withTransaction(app.db, async (c) => {
      const existing = await c.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
      if (existing.rows.length)
        throw conflict('email_taken', 'An account with this email already exists');
      // ON CONFLICT covers two concurrent registrations for the same email.
      const { rows } = await c.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id',
        [body.email, passwordHash],
      );
      if (!rows.length) throw conflict('email_taken', 'An account with this email already exists');
      await audit(c, rows[0].id, 'account.created');
      return app.tokens.issue(rows[0].id, c);
    });
    return reply.status(201).send(tokens);
  });

  app.post('/login', strict, async (req) => {
    const body = parse(loginSchema, req.body);
    const { rows } = await app.db.query(
      "SELECT id, password_hash FROM users WHERE email = $1 AND status = 'active'",
      [body.email],
    );
    const user = rows[0];
    // Per-account throttle on top of the per-IP limit: stops slow password
    // guessing spread across many IPs.
    if (user && (await recentFailures(user.id)) >= LOCKOUT.failures)
      throw new ApiError(429, 'too_many_attempts', LOCKOUT.message);
    // Verify against a dummy hash when the user does not exist to avoid timing-based enumeration.
    const ok = await verifyPassword(user?.password_hash ?? (await dummyHash()), body.password);
    if (user && !ok) await audit(app.db, user.id, 'auth.login_failed');
    if (!user || !ok) throw unauthorized('Email or password is incorrect');
    await audit(app.db, user.id, 'auth.login');
    return app.tokens.issue(user.id);
  });

  app.post('/refresh', strict, async (req) => {
    const body = parse(refreshSchema, req.body);
    return app.tokens.rotate(body.refresh_token);
  });

  app.post('/logout', async (req, reply) => {
    const body = parse(refreshSchema, req.body);
    await app.tokens.revokeFamilyOf(body.refresh_token);
    return reply.status(204).send();
  });
}
