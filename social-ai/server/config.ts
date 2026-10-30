import path from 'node:path';
import fs from 'node:fs';

/** Reads a simple KEY=VALUE .env file without overriding real environment variables. */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const root = path.resolve(import.meta.dirname, '..');
loadDotEnv(path.join(root, '.env'));

export interface AppConfig {
  root: string;
  dataDir: string;
  mediaDir: string;
  backupDir: string;
  host: string;
  port: number;
  /** Public https URL of this server. Needed for Instagram (it downloads images by URL) and OAuth callbacks. */
  publicBaseUrl: string | null;
  masterKey: string | null;
  adminPassword: string | null;
  schedulerEnabled: boolean;
  tickMs: number;
  /** Overrides for official API hosts — used only by tests with local mock servers. */
  apiBase: { telegram: string; vk: string; instagram: string; facebook: string; x: string };
  isTest: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = overrides.dataDir ?? path.resolve(root, process.env.NORO_DATA_DIR ?? 'data');
  const cfg: AppConfig = {
    root,
    dataDir,
    mediaDir: path.join(dataDir, 'media'),
    backupDir: path.join(dataDir, 'backups'),
    host: process.env.NORO_HOST ?? '127.0.0.1',
    port: Number(process.env.NORO_PORT ?? 8787),
    publicBaseUrl: (process.env.NORO_PUBLIC_URL ?? '').replace(/\/$/, '') || null,
    masterKey: process.env.NORO_MASTER_KEY || null,
    adminPassword: process.env.NORO_ADMIN_PASSWORD || null,
    schedulerEnabled: process.env.NORO_SCHEDULER !== 'off',
    tickMs: Number(process.env.NORO_TICK_MS ?? 20_000),
    apiBase: {
      telegram: process.env.NORO_TELEGRAM_API ?? 'https://api.telegram.org',
      vk: process.env.NORO_VK_API ?? 'https://api.vk.com/method',
      instagram: process.env.NORO_INSTAGRAM_API ?? 'https://graph.instagram.com/v23.0',
      facebook: process.env.NORO_FACEBOOK_API ?? 'https://graph.facebook.com/v23.0',
      x: process.env.NORO_X_API ?? 'https://api.x.com',
    },
    isTest: process.env.NODE_ENV === 'test',
    ...overrides,
  };
  cfg.mediaDir = overrides.mediaDir ?? path.join(cfg.dataDir, 'media');
  cfg.backupDir = overrides.backupDir ?? path.join(cfg.dataDir, 'backups');
  return cfg;
}
