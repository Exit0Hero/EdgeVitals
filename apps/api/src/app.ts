import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { TokenService } from './auth/tokens';
import type { AppConfig } from './config';
import type { Db } from './db';
import { ApiError, unauthorized } from './errors';
import { pendingMigrations } from './migrate';
import { assessmentRoutes } from './routes/assessments';
import { authRoutes } from './routes/auth';
import { insightRoutes } from './routes/insights';
import { meRoutes } from './routes/me';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
    tokens: TokenService;
    authenticate: (req: FastifyRequest) => Promise<string>;
  }
}

export async function buildApp(
  config: AppConfig,
  db: Db,
  opts: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? {
          // Never log credentials or request/response bodies (health data).
          redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.body'],
        }
      : false,
    bodyLimit: 256 * 1024,
    genReqId: () => crypto.randomUUID(),
    trustProxy: config.isProduction,
  });

  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('tokens', new TokenService(db, config));

  await app.register(helmet);
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    // @fastify/cors defaults to GET,HEAD,POST only; the API also uses PATCH/PUT/DELETE.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  /** Resolve the authenticated, active user. Old tokens of deleted users stop working. */
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw unauthorized();
    const userId = await app.tokens.verifyAccess(h.slice(7));
    const { rows } = await db.query("SELECT 1 FROM users WHERE id = $1 AND status = 'active'", [
      userId,
    ]);
    if (!rows.length) throw unauthorized('Account not active');
    req.userId = userId;
    return userId;
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          request_id: req.id,
          ...(err.details ? { details: err.details } : {}),
        },
      });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Too many requests', request_id: req.id },
      });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({
        error: {
          code: 'malformed_request',
          message: e.message ?? 'Bad request',
          request_id: req.id,
        },
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'internal', message: 'Unexpected server error', request_id: req.id },
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'not_found', message: 'Route not found', request_id: req.id } }),
  );

  // Liveness: the process is up. Readiness: it can also reach the database.
  app.get('/health', async () => ({ ok: true }));
  // Once the schema is confirmed current it stays current for this process
  // (migrations only run before a release), so later probes only ping the DB.
  let schemaCurrent = false;
  app.get('/ready', async (_req, reply) => {
    let pending: string[] = [];
    try {
      await db.query('SELECT 1');
      if (!schemaCurrent) pending = await pendingMigrations(db);
    } catch {
      return reply.status(503).send({ ok: false, error: { code: 'db_unavailable' } });
    }
    if (pending.length) {
      return reply
        .status(503)
        .send({ ok: false, error: { code: 'migrations_pending', pending: pending.length } });
    }
    schemaCurrent = true;
    return { ok: true };
  });
  app.get('/api/v1/config', async () => ({
    hosting_region: config.hostingRegion,
    demo_mode_enabled: config.demoModeEnabled,
  }));

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(meRoutes, { prefix: '/api/v1/me' });
  await app.register(assessmentRoutes, { prefix: '/api/v1/assessments' });
  await app.register(insightRoutes, { prefix: '/api/v1' });
  return app;
}
