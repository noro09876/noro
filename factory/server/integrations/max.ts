import { ExternalError } from '../lib/errors';
import { readJson, sleep, xfetch } from '../lib/http';
import { apiBase, fileBlob } from './base';
import type { AccountCtx, Credentials, PlatformAdapter, PublishInput } from './types';

/**
 * MAX Bot API (https://dev.max.ru/docs-api). Host platform-api2.max.ru, token only in the
 * Authorization header. Bots are created by verified Russian legal entities.
 */
const SERVICE = 'MAX';
const base = () => apiBase('max', 'https://platform-api2.max.ru');

function token(c: Credentials) {
  if (!c.botToken) throw new ExternalError(SERVICE, 'not_connected', 'Не задан токен бота MAX', false);
  return c.botToken;
}

async function call<T>(tok: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await xfetch(`${base()}${path}`, {
    service: SERVICE,
    timeoutMs: 30_000,
    method,
    headers: { authorization: tok, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await readJson<T & { code?: string; message?: string }>(res);
  if (res.ok && data) return data;
  const code = data?.code ?? `http_${res.status}`;
  const msg = data?.message ?? `HTTP ${res.status}`;
  if (res.status === 401) throw new ExternalError(SERVICE, 'auth', 'Токен бота MAX недействителен', false, undefined, 401);
  if (res.status === 403) throw new ExternalError(SERVICE, 'forbidden', `Бот не может писать в этот чат: ${msg}`, false, undefined, 403);
  if (res.status === 404) throw new ExternalError(SERVICE, 'not_found', `MAX: ${msg}`, false, undefined, 404);
  if (res.status === 429) throw new ExternalError(SERVICE, 'rate_limit', 'MAX ограничил частоту запросов', true, 5, 429);
  if (code === 'attachment.not.ready') throw new ExternalError(SERVICE, 'attachment_not_ready', 'Файл ещё обрабатывается', true, 3, res.status);
  throw new ExternalError(SERVICE, code, `MAX: ${msg}`, res.status >= 500, undefined, res.status);
}

async function uploadFile(tok: string, kind: 'image' | 'video', path: string, mime: string): Promise<Record<string, unknown>> {
  const slot = await call<{ url: string; token?: string }>(tok, 'POST', `/uploads?type=${kind}`);
  const fd = new FormData();
  fd.set('data', fileBlob(path, mime), kind === 'image' ? 'image.jpg' : 'video.mp4');
  const res = await xfetch(slot.url, { service: SERVICE, timeoutMs: 600_000, method: 'POST', headers: { authorization: tok }, body: fd });
  const data = (await readJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) throw new ExternalError(SERVICE, 'upload_failed', `MAX не принял файл (HTTP ${res.status})`, res.status >= 500);
  // Images: the upload response carries the token (photos map); videos: token from the slot.
  if (kind === 'video') return { token: slot.token ?? data.token };
  if (data.token) return { token: data.token };
  if (data.photos && typeof data.photos === 'object') return { photos: data.photos };
  throw new ExternalError(SERVICE, 'upload_failed', 'MAX не вернул токен загруженного изображения', true);
}

export const max: PlatformAdapter = {
  id: 'max',
  connect: 'token',
  fields: [
    { key: 'botToken', label: 'Токен бота MAX', secret: true, help: 'Выдаётся на платформе MAX для партнёров после верификации организации' },
    { key: 'chatId', label: 'ID канала или чата', placeholder: '-7012345678' },
  ],
  setupSteps: [
    'Зарегистрируйте организацию на платформе MAX для партнёров (business.max.ru) и пройдите верификацию — с августа 2025 ботов создают только юрлица РФ.',
    'Создайте бота и скопируйте токен.',
    'Добавьте бота администратором в канал. ID канала придёт в событии bot_added (или возьмите его из ссылки канала).',
    'Вставьте токен и ID канала здесь — фабрика проверит доступ.',
  ],

  async verify(creds, meta) {
    const tok = token(creds);
    const chatId = String(meta.chatId ?? '').trim();
    if (!chatId) throw new ExternalError(SERVICE, 'no_chat', 'Укажите ID канала или чата', false);
    const me = await call<{ user_id: number; name?: string; username?: string }>(tok, 'GET', '/me');
    const chat = await call<{ chat_id: number; title?: string; type?: string; link?: string }>(tok, 'GET', `/chats/${encodeURIComponent(chatId)}`);
    return { displayName: chat.title ?? chatId, externalId: String(chat.chat_id), scopes: ['messages'], meta: { chatId: String(chat.chat_id), link: chat.link ?? null, bot: me.username ?? me.name } };
  },

  async publish(account: AccountCtx, input: PublishInput) {
    const tok = token(account.creds);
    const chatId = String(account.meta.chatId);
    const progress = { ...(input.progress as { attachments?: Record<string, unknown>[] }) };
    const attachments = [...(progress.attachments ?? [])];
    const media = input.media.slice(0, 10);
    for (let i = attachments.length; i < media.length; i++) {
      const m = media[i]!;
      const payload = await uploadFile(tok, m.kind, m.path, m.mime);
      attachments.push({ type: m.kind, payload });
      await input.saveProgress({ attachments });
    }
    const body = { text: input.text.slice(0, 4000), attachments: attachments.length ? attachments : undefined };
    // Uploaded media is processed asynchronously: retry attachment.not.ready with growing pauses.
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await call<{ message: { body: { mid: string }; url?: string } }>(tok, 'POST', `/messages?chat_id=${encodeURIComponent(chatId)}`, body);
        return { externalId: r.message.body.mid, url: r.message.url ?? null, meta: {} };
      } catch (e) {
        if (e instanceof ExternalError && e.code === 'attachment_not_ready' && attempt < 6) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
  },

  async metrics() {
    return { values: {}, unavailable: { views: 'MAX Bot API не отдаёт статистику просмотров' } };
  },
};
