import type { Db } from './db.ts';
import { now } from './db.ts';

export type Level = 'info' | 'warn' | 'error';

const SECRET_KEY = /token|secret|password|authorization|cookie|api[_-]?key|verifier|code_challenge|client_secret/i;
const SECRET_PATTERNS: RegExp[] = [
  /bot\d{5,}:[A-Za-z0-9_-]{20,}/g, // Telegram bot token inside URLs
  /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, // bare Telegram token
  /vk1\.a\.[A-Za-z0-9_-]{20,}/g, // VK ID tokens
  /\b(IG|EA)[A-Za-z0-9]{40,}\b/g, // Meta tokens
  /(access_token|token|key)=([^&\s"']+)/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
];

/** Removes anything that looks like a credential. Used on every log line and every error shown in the UI. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]';
  if (typeof value === 'string') {
    let s = value;
    for (const re of SECRET_PATTERNS) {
      s = s.replace(re, (m, k) => (typeof k === 'string' && m.includes('=') ? `${k}=[скрыто]` : '[скрыто]'));
    }
    return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[скрыто]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

export interface EventRefs {
  contentId?: number | null;
  accountId?: number | null;
  publicationId?: number | null;
}

export class EventLog {
  private readonly db: Db;
  private readonly quiet: boolean;

  constructor(db: Db, quiet = false) {
    this.db = db;
    this.quiet = quiet;
  }

  write(level: Level, scope: string, message: string, data?: unknown, refs: EventRefs = {}) {
    const safeMessage = redact(message) as string;
    const safeData = data === undefined ? null : JSON.stringify(redact(data));
    this.db.insert('events', {
      ts: now(),
      level,
      scope,
      message: safeMessage,
      data: safeData,
      content_id: refs.contentId ?? null,
      account_id: refs.accountId ?? null,
      publication_id: refs.publicationId ?? null,
    });
    if (!this.quiet) {
      const line = `[${level}] ${scope}: ${safeMessage}`;
      if (level === 'error') console.error(line);
      else console.log(line);
    }
  }
  info(scope: string, message: string, data?: unknown, refs?: EventRefs) {
    this.write('info', scope, message, data, refs);
  }
  warn(scope: string, message: string, data?: unknown, refs?: EventRefs) {
    this.write('warn', scope, message, data, refs);
  }
  error(scope: string, message: string, data?: unknown, refs?: EventRefs) {
    this.write('error', scope, message, data, refs);
  }
}
