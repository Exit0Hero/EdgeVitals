// Standalone migration entry point: `npm run migrate` in development, and
// `node dist/migrate.js` as the release / pre-deploy job in production.
import { migrate } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL must be set');
  process.exit(1);
}
try {
  const ran = await migrate(url, console.log);
  console.log(ran.length ? `applied ${ran.length} migration(s)` : 'schema up to date');
} catch (err) {
  console.error('migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
