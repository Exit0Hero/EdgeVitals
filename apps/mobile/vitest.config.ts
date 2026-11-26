import { defineConfig } from 'vitest/config';

// Unit tests only; Playwright specs in e2e/ run separately (`npm run e2e`).
// A fixed zone with daylight saving makes date tests deterministic.
process.env.TZ = 'Europe/London';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
