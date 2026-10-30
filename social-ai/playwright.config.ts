import { defineConfig, devices } from '@playwright/test';

const port = 4400;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, locale: 'ru-RU', timezoneId: 'Europe/Moscow', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run build && node --disable-warning=ExperimentalWarning e2e/server.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_PORT: String(port) },
  },
});
