import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the production build served by scripts/serve-dist.mjs,
 * which mirrors Netlify: per-route HTML, real 404 status, netlify.toml headers
 * (including the CSP) and /api/* answering as an unconfigured deployment.
 * Build first: npm run build && npm run test:e2e
 */
const PORT = 4300;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `node scripts/serve-dist.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
  },
});
