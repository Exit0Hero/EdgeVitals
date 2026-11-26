import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

const config = loadConfig();
const db = createPool(config.databaseUrl);
// Migrations take an advisory lock, so concurrent replicas are safe. Production
// deployments should still run them as a separate release step
// (`node dist/migrate.js`) and set MIGRATE_ON_START=false; see docs/deployment.md.
if (config.migrateOnStart) await migrate(config.databaseUrl, (m) => console.log(m));
const app = await buildApp(config, db, { logger: true });
await app.listen({ port: config.port, host: config.host });

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    app.log.info({ sig }, 'shutting down');
    // Stop accepting connections and let in-flight requests finish.
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      await db.end();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  });
}
