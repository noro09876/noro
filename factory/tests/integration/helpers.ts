import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../server/db/client';
import { runMigrations } from '../../server/db/migrate';

/** Clean test database: schema migrated, every app table emptied. */
export async function resetDb() {
  await runMigrations();
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

/** A tiny client over fastify.inject that keeps the session cookie and sends the CSRF header. */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}
  async req<T = any>(method: string, url: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.csrf !== false) headers['x-requested-with'] = 'noro';
    const res = await this.app.inject({ method: method as 'GET', url, payload: body as object, headers });
    const set = res.headers['set-cookie'];
    const first = Array.isArray(set) ? set[0] : set;
    if (first?.startsWith('noro_session=')) this.cookie = first.split(';')[0]!;
    let json: T | undefined;
    try {
      json = res.json() as T;
    } catch {
      json = undefined;
    }
    return { status: res.statusCode, body: json as T, raw: res.body, headers: res.headers };
  }
  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, body: unknown = {}, opts?: { csrf?: boolean }) {
    return this.req<T>('POST', url, body, opts);
  }
  put<T = any>(url: string, body: unknown) {
    return this.req<T>('PUT', url, body);
  }
}

export interface FakeCall {
  method: string;
  path: string;
  body: string;
}

/**
 * Fake Telegram Bot API. `mode` switches behaviour between calls:
 * ok | error500 | rate429 | auth401.
 */
export async function fakeTelegram() {
  const calls: FakeCall[] = [];
  const state = { mode: 'ok' as 'ok' | 'error500' | 'rate429' | 'auth401', nextId: 100 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const method = (req.url ?? '').split('/').pop() ?? '';
      calls.push({ method, path: req.url ?? '', body });
      const send = (code: number, payload: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (method === 'getMe') return send(200, { ok: true, result: { id: 42, username: 'noro_test_bot', first_name: 'Bot' } });
      if (method === 'getChat') return send(200, { ok: true, result: { id: -1001234567890, title: 'Тестовый канал', username: 'noro_test', type: 'channel' } });
      if (method === 'getChatMember') return send(200, { ok: true, result: { status: 'administrator', can_post_messages: true } });
      if (state.mode === 'error500') return send(502, { ok: false, error_code: 502, description: 'Bad Gateway' });
      if (state.mode === 'rate429') return send(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 120 } });
      if (state.mode === 'auth401') return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      return send(200, { ok: true, result: { message_id: state.nextId++, chat: { id: -1001234567890, username: 'noro_test' } } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export const BRAND = {
  name: 'Тестовый бренд',
  description: 'Сервис для проверки фабрики',
  tone: 'Спокойный, по делу',
  forbidden: ['гарантируем рост'],
  visual: { colors: { primary: '#c9f45f', accent: '#7aa2ff', background: '#0b0d10', text: '#f3f5f7' }, fonts: { display: 'Unbounded', body: 'Onest' }, style: 'Тёмный минимализм' },
};

export const BRIEF = {
  task: 'Рассказать о новом отчёте и привести на демо-доступ',
  audience: 'Селлеры маркетплейсов',
  goal: 'Заявки на демо',
  platforms: ['telegram'],
  formats: ['post'],
  frequency: 2,
  constraints: '',
  startDate: '2030-01-07',
  weeks: 1,
  timezone: 'Europe/Moscow',
};
