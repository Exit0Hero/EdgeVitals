import { defineConfig } from 'vitest/config';

// Unit tests only; Playwright specs in e2e/ run separately (`npm run e2e`).
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
