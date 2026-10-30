import type { Db } from './db.ts';
import { json, now } from './db.ts';
import type { SettingsStore } from './settings.ts';
import type { AppConfig } from './config.ts';
import { hashPassword } from './crypto.ts';

export const NORO_TOPICS: [string, string][] = [
  ['Искусственный интеллект', 'Как ИИ меняет работу и бизнес: без хайпа, с практикой'],
  ['Автоматизация бизнеса', 'Процессы, которые можно автоматизировать, и как это сделать'],
  ['ИИ-агенты', 'Агенты: устройство, сценарии, ограничения, внедрение'],
  ['Программирование и разработка', 'Практика разработки, инструменты и подходы'],
  ['No-code и low-code', 'Сервисы и связки без программирования'],
  ['Полезные инструменты', 'Инструменты, которые экономят время, с честной оценкой'],
  ['Сценарии применения технологий', 'Реальные сценарии использования ИИ и автоматизации'],
  ['Разборы бизнес-процессов', 'Кейсы и разборы процессов: что было, что изменили, чему научились'],
];

/** First start: brand NORO with its topics and default settings. Idempotent. */
export function seed(db: Db, settings: SettingsStore, cfg: AppConfig) {
  if (!db.get('SELECT id FROM brands LIMIT 1')) {
    const t = now();
    const brandId = db.insert('brands', {
      name: 'NORO', handle: '', audience: 'Предприниматели, руководители и специалисты, которые внедряют ИИ и автоматизацию в работу',
      voice: 'Спокойный эксперт-практик: объясняет просто, показывает шаги, честно говорит об ограничениях',
      accent: '#c9f45f', background: '#0b0c0d', default_hashtags: json(['NORO', 'ИИ', 'автоматизация']),
      default_cta: 'Сохраните, чтобы не потерять, и напишите в комментариях, что разобрать дальше.',
      banned_words: json([]), is_default: 1, created_at: t, updated_at: t,
    });
    for (const [name, description] of NORO_TOPICS) db.insert('topics', { brand_id: brandId, name, description, enabled: 1, weight: 1, created_at: t });
    settings.update({ agent: { brandId } });
  }
  if (cfg.adminPassword && !db.get('SELECT id FROM users LIMIT 1')) {
    db.insert('users', { username: 'admin', password_hash: hashPassword(cfg.adminPassword), created_at: now() });
  }
}
