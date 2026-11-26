import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the exported web build and a local API.
// Start both first (see e2e/README.md), or set E2E_BASE_URL.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8081',
    trace: 'off',
    permissions: ['camera'],
    timezoneId: 'UTC',
    launchOptions: {
      // Chromium's synthetic camera: a moving test pattern with no face in it.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
});
