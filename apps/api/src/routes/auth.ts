import { loginSchema, refreshSchema, registerSchema } from '@edgevitals/domain';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { dummyHash, hashPassword, verifyPassword } from '../auth/passwords';
import { withTransaction } from '../db';
import { conflict, unauthorized } from '../errors';
import { parse } from '../validate';

export async function authRoutes(app: FastifyInstance) {
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
      const { rows } = await c.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [body.email, passwordHash],
      );
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
    // Verify against a dummy hash when the user does not exist to avoid timing-based enumeration.
    const ok = await verifyPassword(user?.password_hash ?? (await dummyHash()), body.password);
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
