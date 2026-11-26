import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

const config = loadConfig();
const db = createPool(config.databaseUrl);
await migrate(config.databaseUrl, (m) => console.log(m));
const app = await buildApp(config, db, { logger: true });
await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
