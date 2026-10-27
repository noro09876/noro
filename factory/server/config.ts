import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime configuration. Everything comes from the environment; nothing secret
 * has a default. Provider keys are NOT read from here: they are stored encrypted
 * per workspace (Settings → Providers). Env keys only seed defaults when present.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

export const config = {
  isProd,
  isTest,
  port: Number(env('PORT', '8787')),
  host: env('HOST', '127.0.0.1'),
  /** Public URL of this app — OAuth redirects and public media links for Meta/TikTok. */
  publicUrl: env('PUBLIC_URL', 'http://localhost:8787').replace(/\/$/, ''),
  databaseUrl: isTest ? env('TEST_DATABASE_URL', 'postgres://noro:noro@localhost:5432/noro_factory_test') : env('DATABASE_URL', 'postgres://noro:noro@localhost:5432/noro_factory'),
  /** 32-byte key (base64 or hex) used for AES-256-GCM encryption of tokens and API keys. */
  masterKey: env('MASTER_KEY', isProd ? undefined : 'dev-only-insecure-master-key-change-me-0000000000'),
  sessionSecret: env('SESSION_SECRET', isProd ? undefined : 'dev-only-session-secret'),
  dataDir: path.resolve(ROOT, env('DATA_DIR', '.data')),
  storage: {
    driver: env('STORAGE_DRIVER', 'local') as 'local' | 's3',
    s3: {
      bucket: process.env.S3_BUCKET ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || undefined,
    },
  },
  piper: {
    bin: env('PIPER_BIN', path.join(ROOT, '.data/piper/venv/bin/piper')),
    voicesDir: env('PIPER_VOICES_DIR', path.join(ROOT, '.data/piper')),
  },
  chromium: process.env.REMOTION_CHROME_EXECUTABLE || undefined,
  /** Allows the clearly-labelled deterministic test provider. Never enable in production. */
  allowTestProviders: process.env.ALLOW_TEST_PROVIDERS === '1' || isTest,
  /** Run the job worker inside the API process (single-process deployments, dev). */
  inlineWorker: env('INLINE_WORKER', '1') === '1',
  signupOpen: env('SIGNUP_OPEN', '1') === '1',
  logLevel: env('LOG_LEVEL', isTest ? 'silent' : 'info'),
};

export type Config = typeof config;
