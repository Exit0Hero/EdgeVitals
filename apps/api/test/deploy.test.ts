import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool } from '../src/db';
import { setupApp, teardown } from './helpers';

const env = {
  DATABASE_URL: 'postgres://x:y@127.0.0.1:1/none',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
};

describe('deployment probes and config', () => {
  it('reports ready when the database answers', async () => {
    const ctx = await setupApp();
    try {
      const live = await ctx.app.inject({ method: 'GET', url: '/health' });
      const ready = await ctx.app.inject({ method: 'GET', url: '/ready' });
      expect(live.statusCode).toBe(200);
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual({ ok: true });
    } finally {
      await teardown(ctx);
    }
  });

  it('reports not ready (503) but stays live when the database is unreachable', async () => {
    const config = loadConfig({ ...env, NODE_ENV: 'test' });
    const db = createPool(config.databaseUrl);
    const app = await buildApp(config, db);
    try {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      const ready = await app.inject({ method: 'GET', url: '/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({ ok: false, error: { code: 'db_unavailable' } });
    } finally {
      await app.close();
      await db.end();
    }
  });

  it('migrates on start unless MIGRATE_ON_START=false', () => {
    expect(loadConfig(env).migrateOnStart).toBe(true);
    expect(loadConfig({ ...env, MIGRATE_ON_START: 'false' }).migrateOnStart).toBe(false);
  });
});
