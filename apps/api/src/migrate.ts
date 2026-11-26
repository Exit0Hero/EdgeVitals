import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Queryable } from './db';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Apply pending SQL migrations in filename order, each in its own
 * transaction. Applied files are checksummed; editing an applied migration
 * is an error (write a new one instead).
 */
export async function migrate(
  databaseUrl: string,
  log: (m: string) => void = () => {},
): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const applied = new Map<string, string>(
      (await client.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [
        r.name,
        r.checksum,
      ]),
    );
    const files = await migrationFiles();
    const ran: string[] = [];
    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const sum = createHash('sha256').update(sql).digest('hex');
      const prev = applied.get(file);
      if (prev) {
        if (prev !== sum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file,
          sum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      log(`applied ${file}`);
      ran.push(file);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    await client.end();
  }
}

/** Migration files shipped with this build, in apply order. */
export async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * Migrations in this build that the database has not applied yet. Used by the
 * readiness probe so an instance never takes traffic on an out-of-date schema
 * (for example when MIGRATE_ON_START=false and the release job has not run).
 */
export async function pendingMigrations(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  const files = await migrationFiles();
  if (!rows[0]?.exists) return files;
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );
  return files.filter((f) => !applied.has(f));
}
