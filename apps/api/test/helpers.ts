import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool, type Db } from '../src/db';
import { TEST_DB } from './globalSetup';

export interface Ctx {
  app: FastifyInstance;
  db: Db;
}

export async function setupApp(env: Record<string, string> = {}): Promise<Ctx> {
  const config = loadConfig({
    DATABASE_URL: TEST_DB,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    NODE_ENV: 'test',
    DEMO_MODE_ENABLED: 'false',
    AUTH_RATE_LIMIT_PER_MIN: '1000',
    ...env,
  });
  const db = createPool(TEST_DB);
  const app = await buildApp(config, db);
  return { app, db };
}

export async function teardown(ctx: Ctx) {
  await ctx.app.close();
  await ctx.db.end();
}

export interface User {
  email: string;
  access: string;
  refresh: string;
  auth: { authorization: string };
}

export async function registerUser(app: FastifyInstance): Promise<User> {
  const email = `u-${randomUUID()}@example.test`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'correct horse 42' },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const t = res.json();
  return {
    email,
    access: t.access_token,
    refresh: t.refresh_token,
    auth: { authorization: `Bearer ${t.access_token}` },
  };
}

export async function onboard(app: FastifyInstance, u: User, tz = 'UTC') {
  for (const consent_type of ['processing', 'wellness_acknowledgement']) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/me/consents',
      headers: u.auth,
      payload: { consent_type, granted: true, policy_version: '2026-11-26.1', source: 'test' },
    });
  }
  await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/profile',
    headers: u.auth,
    payload: { birth_year: 1985, sex_at_birth: 'female', height_cm: 175, weight_kg: 70 },
  });
  await app.inject({
    method: 'PUT',
    url: '/api/v1/me/schedule',
    headers: u.auth,
    payload: {
      morning_time: '07:15',
      evening_time: '21:00',
      timezone: tz,
      reminders_enabled: true,
      heart_rate_affecting_substance: 'no',
    },
  });
}

export const measurement = (
  metric: string,
  value: number | null,
  extra: Record<string, unknown> = {},
) => ({
  metric,
  status: value === null ? 'unavailable' : 'valid',
  value,
  unit: { heart_rate: 'bpm', hrv: 'ms', breathing_rate: '/min', spo2: '%', blood_pressure: 'mmHg' }[
    metric
  ],
  quality_score: value === null ? null : 0.8,
  quality_flags: [],
  reason: value === null ? 'low_signal_quality' : null,
  method: 'camera_rppg',
  algorithm_name: 'pos-welch',
  algorithm_version: '0.1.0',
  config_version: 'v0-engineering-defaults',
  validation: 'unvalidated',
  measured_at: new Date().toISOString(),
  ...extra,
});

export const fullScan = (hr: number | null, hrv: number | null, br: number | null) => [
  measurement('heart_rate', hr),
  measurement('hrv', hrv),
  measurement('breathing_rate', br),
  { ...measurement('spo2', null), reason: 'unsupported_method' },
  { ...measurement('blood_pressure', null), reason: 'unsupported_method' },
];

export async function runAssessment(
  app: FastifyInstance,
  u: User,
  opts: {
    kind?: 'morning' | 'evening';
    scheduledFor?: string;
    hr?: number | null;
    hrv?: number | null;
    br?: number | null;
  } = {},
) {
  const kind = opts.kind ?? 'morning';
  const a = await app.inject({
    method: 'POST',
    url: '/api/v1/assessments',
    headers: u.auth,
    payload: {
      kind,
      scheduled_for: opts.scheduledFor ?? new Date().toISOString(),
      timezone: 'UTC',
    },
  });
  const id = a.json().id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/assessments/${id}/check-in`,
    headers: u.auth,
    payload:
      kind === 'morning'
        ? { kind, sleep_quality: 4, energy_rating: 3, alcohol_previous_evening: false }
        : { kind, stress_rating: 2, energy_rating: 3 },
  });
  const m = await app.inject({
    method: 'POST',
    url: `/api/v1/assessments/${id}/measurements`,
    headers: u.auth,
    payload: {
      outcome: 'completed',
      measurements: fullScan(
        opts.hr === undefined ? 62 : opts.hr,
        opts.hrv === undefined ? 45 : opts.hrv,
        opts.br === undefined ? 14 : opts.br,
      ),
    },
  });
  return { id, res: m };
}
