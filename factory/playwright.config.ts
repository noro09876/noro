import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the real API + worker + built web app on a clean e2e database.
 * Build the web app first: npm run build && npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 8899);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  webServer: {
    command: `npx tsx scripts/e2e-server.ts`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      TEST_DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://noro:noro@localhost:5432/noro_factory_e2e',
      PUBLIC_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
