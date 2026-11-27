import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

// Static checks on the Render staging Blueprint (render.yaml at the repo root).
// They catch drift between the Blueprint and what the API actually needs; they
// do not replace Render's own validation when the Blueprint is created.
const root = join(import.meta.dirname, '..', '..', '..');

interface EnvVar {
  key: string;
  value?: string;
  generateValue?: boolean;
  sync?: boolean;
  fromDatabase?: { name: string; property: string };
}
interface Blueprint {
  databases: {
    name: string;
    plan: string;
    region: string;
    postgresMajorVersion: string;
    ipAllowList?: unknown[];
  }[];
  services: {
    type: string;
    name: string;
    plan: string;
    region: string;
    runtime: string;
    dockerfilePath: string;
    dockerContext: string;
    healthCheckPath: string;
    preDeployCommand?: string;
    envVars: EnvVar[];
  }[];
}

const bp = load(readFileSync(join(root, 'render.yaml'), 'utf8')) as Blueprint;
const api = bp.services.find((s) => s.name === 'edgevitals-staging-api')!;
const db = bp.databases[0]!;
const env = (key: string) => api.envVars.find((e) => e.key === key);

describe('render.yaml (staging Blueprint)', () => {
  it('uses only free plans in Singapore with Postgres 16', () => {
    expect(bp.databases).toHaveLength(1);
    expect(bp.services).toHaveLength(1);
    expect(db).toMatchObject({ plan: 'free', region: 'singapore', postgresMajorVersion: '16' });
    expect(api).toMatchObject({
      type: 'web',
      plan: 'free',
      region: 'singapore',
      runtime: 'docker',
    });
    // Pre-deploy commands are paid-only on Render; the free service must not rely on one.
    expect(api.preDeployCommand).toBeUndefined();
  });

  it('builds the API image from the repository root', () => {
    expect(api.dockerContext).toBe('.');
    expect(existsSync(join(root, api.dockerfilePath))).toBe(true);
    expect(api.dockerfilePath).toBe('./apps/api/Dockerfile');
  });

  it('health-checks the readiness probe', () => {
    expect(api.healthCheckPath).toBe('/ready');
  });

  it('references the database and generates the JWT secret instead of hardcoding them', () => {
    expect(env('DATABASE_URL')).toEqual({
      key: 'DATABASE_URL',
      fromDatabase: { name: db.name, property: 'connectionString' },
    });
    expect(env('JWT_SECRET')).toEqual({ key: 'JWT_SECRET', generateValue: true });
  });

  it('keeps the database closed to external connections by default', () => {
    expect(db.ipAllowList).toEqual([]);
  });

  it('sets production values that the API config accepts', () => {
    expect(env('NODE_ENV')?.value).toBe('production');
    expect(env('DEMO_MODE_ENABLED')?.value).toBe('false');
    expect(env('MIGRATE_ON_START')?.value).toBe('true');
    expect(env('HOSTING_REGION')?.value).toBe('Singapore');
    expect(env('PORT')?.value).toBe('10000');

    // Build the runtime environment Render would provide, with stand-ins for
    // the two values Render supplies (a 256-bit base64 secret is 44 chars).
    const runtime: Record<string, string> = {};
    for (const e of api.envVars) if (e.value !== undefined) runtime[e.key] = e.value;
    runtime.DATABASE_URL = 'postgres://u:p@dpg-standin:5432/edgevitals';
    runtime.JWT_SECRET = Buffer.alloc(32, 7).toString('base64');
    const config = loadConfig(runtime);
    expect(config).toMatchObject({
      isProduction: true,
      demoModeEnabled: false,
      migrateOnStart: true,
      hostingRegion: 'Singapore',
      port: 10000,
      corsOrigins: [],
    });
  });
});
