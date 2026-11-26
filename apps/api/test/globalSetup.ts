import pg from 'pg';
import { migrate } from '../src/migrate';

export const TEST_DB =
  process.env.DATABASE_URL ?? 'postgres://edgevitals:edgevitals@localhost:5432/edgevitals_test';

/** Reset the test database schema and apply migrations once per run. */
export default async function setup() {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await migrate(TEST_DB);
}
