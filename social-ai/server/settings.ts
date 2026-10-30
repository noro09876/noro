import { z } from 'zod';
import type { Db } from './db.ts';
import { now } from './db.ts';

export const FORMATS = ['carousel', 'post', 'article'] as const;
export const PLATFORMS = ['telegram', 'vk', 'instagram', 'x'] as const;
export type Platform = (typeof PLATFORMS)[number];
export type Format = (typeof FORMATS)[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const settingsSchema = z.object({
  ai: z.object({
    provider: z.enum(['ollama', 'openai', 'offline']).default('ollama'),
    baseUrl: z.string().default('http://127.0.0.1:11434'),
    model: z.string().default(''),
    temperature: z.number().min(0).max(1.5).default(0.7),
    timeoutMs: z.number().int().min(5000).max(600000).default(180000),
    /** Explicit acknowledgement before any non-local (possibly paid) endpoint is used. */
    allowRemote: z.boolean().default(false),
  }).prefault({}),
  agent: z.object({
    enabled: z.boolean().default(false),
    brandId: z.number().int().nullable().default(null),
    planDays: z.number().int().min(1).max(30).default(7),
    postsPerDay: z.number().int().min(1).max(5).default(1),
    postTimes: z.array(time).min(1).max(5).default(['10:00', '18:30']),
    formats: z.array(z.enum(FORMATS)).min(1).default(['carousel', 'post', 'article']),
    platforms: z.array(z.enum(PLATFORMS)).default(['telegram', 'vk']),
    tone: z.string().max(300).default('экспертный, спокойный, без хайпа и канцелярита'),
    style: z.string().max(500).default('короткие абзацы, конкретные шаги и примеры, без воды'),
    constraints: z.string().max(1500).default('Не придумывай статистику, исследования, цитаты и результаты компаний. Не обещай гарантированный доход. Не упоминай конкурентов негативно.'),
    autoApprove: z.boolean().default(false),
    leadHours: z.number().int().min(1).max(168).default(24),
    maxGenerationsPerDay: z.number().int().min(1).max(100).default(12),
    maxAttemptsPerItem: z.number().int().min(1).max(5).default(2),
    maxConsecutiveFailures: z.number().int().min(1).max(20).default(4),
  }).prefault({}),
  images: z.object({
    size: z.enum(['1080x1350', '1080x1080']).default('1080x1350'),
    maxSlides: z.number().int().min(3).max(10).default(8),
    showCounter: z.boolean().default(true),
    jpegQuality: z.number().int().min(60).max(100).default(92),
  }).prefault({}),
  limits: z.object({
    maxPostsPerDayPerAccount: z.number().int().min(1).max(50).default(3),
    maxPublishAttempts: z.number().int().min(1).max(8).default(4),
    duplicateWindowDays: z.number().int().min(1).max(365).default(90),
  }).prefault({}),
  schedule: z.object({
    timezone: z.string().default('Europe/Moscow'),
  }).prefault({}),
  backup: z.object({
    enabled: z.boolean().default(true),
    hourLocal: z.number().int().min(0).max(23).default(4),
    keep: z.number().int().min(1).max(90).default(14),
  }).prefault({}),
  security: z.object({
    sessionHours: z.number().int().min(1).max(720).default(72),
  }).prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> };

export class SettingsStore {
  private readonly db: Db;

  constructor(
    db: Db,
  ) {
    this.db = db;
  }

  get(): Settings {
    const raw: Record<string, unknown> = {};
    for (const row of this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
      if (row.key.startsWith('secret:')) continue;
      try {
        raw[row.key] = JSON.parse(row.value);
      } catch {
        /* ignore corrupt value — defaults apply */
      }
    }
    const parsed = settingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : settingsSchema.parse({});
  }

  update(patch: SettingsPatch): Settings {
    const current = this.get();
    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object') merged[k] = { ...(current as Record<string, object>)[k], ...v };
    }
    const next = settingsSchema.parse(merged);
    this.db.tx(() => {
      for (const [k, v] of Object.entries(next)) {
        this.db.run(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
          k, JSON.stringify(v), now(),
        );
      }
    });
    return next;
  }

  /** Encrypted values (e.g. API key of an OpenAI-compatible server) live in the same table under "secret:". */
  getSecret(name: string): string | null {
    return this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', `secret:${name}`)?.value ?? null;
  }
  setSecret(name: string, value: string | null) {
    if (value === null) this.db.run('DELETE FROM settings WHERE key = ?', `secret:${name}`);
    else
      this.db.run(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        `secret:${name}`, value, now(),
      );
  }
}
