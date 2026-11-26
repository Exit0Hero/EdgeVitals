export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  host: string;
  corsOrigins: string[];
  demoModeEnabled: boolean;
  hostingRegion: string | null;
  isProduction: boolean;
  accessTokenTtlSec: number;
  refreshTokenTtlDays: number;
  /** Per-IP requests per minute on auth endpoints. */
  authRateLimitPerMin: number;
  /** Apply pending migrations when the server starts (default true). */
  migrateOnStart: boolean;
}

/** Read configuration from the environment and fail fast on unsafe values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL must be set');
  const demoModeEnabled = env.DEMO_MODE_ENABLED === 'true';
  if (isProduction && demoModeEnabled)
    throw new Error('DEMO_MODE_ENABLED must be false in production');
  const hostingRegion = env.HOSTING_REGION?.trim() || null;
  if (isProduction && !hostingRegion) throw new Error('HOSTING_REGION must be set in production');
  return {
    databaseUrl: env.DATABASE_URL,
    jwtSecret,
    port: Number(env.PORT ?? 4000),
    host: env.HOST ?? '0.0.0.0',
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    demoModeEnabled,
    hostingRegion,
    isProduction,
    accessTokenTtlSec: 15 * 60,
    refreshTokenTtlDays: 30,
    authRateLimitPerMin: Number(env.AUTH_RATE_LIMIT_PER_MIN ?? 10),
    migrateOnStart: env.MIGRATE_ON_START !== 'false',
  };
}
