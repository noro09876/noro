import { smartTrim } from '../../shared/quality';
import { ExternalError } from '../lib/errors';
import { readJson, xfetch } from '../lib/http';
import { apiBase, fileBlob } from './base';
import type { AccountCtx, Credentials, PlatformAdapter, PublishInput } from './types';

/**
 * Telegram Bot API. The bot must be an administrator of the channel/group with the
 * right to post. Docs: https://core.telegram.org/bots/api
 */
const SERVICE = 'Telegram';
const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;
const UPLOAD_MAX = 50 * 1024 * 1024;

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}
interface TgMessage {
  message_id: number;
  chat: { id: number; username?: string; title?: string };
}

const base = () => apiBase('telegram', 'https://api.telegram.org');

async function call<T>(token: string, method: string, body: Record<string, unknown> | FormData, timeoutMs = 60_000): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await xfetch(`${base()}/bot${token}/${method}`, {
    service: SERVICE,
    timeoutMs,
    method: 'POST',
    headers: isForm ? undefined : { 'content-type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
  });
  const data = await readJson<TgResponse<T>>(res);
  if (data?.ok && data.result !== undefined) return data.result;
  const code = data?.error_code ?? res.status;
  const desc = data?.description ?? `HTTP ${res.status}`;
  if (code === 429) throw new ExternalError(SERVICE, 'rate_limit', `Telegram ограничил частоту: повтор через ${data?.parameters?.retry_after ?? 30} с`, true, data?.parameters?.retry_after ?? 30, 429);
  if (code === 401) throw new ExternalError(SERVICE, 'auth', 'Токен бота недействителен. Выпустите новый в @BotFather и переподключите канал.', false, undefined, 401);
  if (code === 403) throw new ExternalError(SERVICE, 'forbidden', `Бот не может писать в этот чат: ${desc}. Добавьте бота администратором с правом публикации.`, false, undefined, 403);
  if (code === 400 && /chat not found/i.test(desc)) throw new ExternalError(SERVICE, 'chat_not_found', 'Канал не найден. Проверьте @username или числовой ID и что бот добавлен в канал.', false, undefined, 400);
  if (code === 413 || /too big/i.test(desc)) throw new ExternalError(SERVICE, 'too_large', 'Файл слишком большой для Bot API (лимит 50 МБ)', false, undefined, 413);
  if (code >= 500) throw new ExternalError(SERVICE, `http_${code}`, `Telegram временно недоступен: ${desc}`, true, undefined, code);
  throw new ExternalError(SERVICE, 'bad_request', `Telegram отклонил запрос: ${desc}`, false, undefined, code);
}

function tokenOf(c: Credentials) {
  if (!c.botToken) throw new ExternalError(SERVICE, 'not_connected', 'Не задан токен бота', false);
  return c.botToken;
}

function linkFor(chatUsername: string | undefined, chatId: string | number, messageId: number) {
  if (chatUsername) return `https://t.me/${chatUsername}/${messageId}`;
  const id = String(chatId);
  return id.startsWith('-100') ? `https://t.me/c/${id.slice(4)}/${messageId}` : null;
}

export const telegram: PlatformAdapter = {
  id: 'telegram',
  connect: 'token',
  fields: [
    { key: 'botToken', label: 'Токен бота', placeholder: '123456789:AA…', secret: true, help: 'Выдаёт @BotFather командой /newbot' },
    { key: 'chatId', label: 'Канал или группа', placeholder: '@my_channel или -1001234567890' },
  ],
  setupSteps: [
    'Откройте @BotFather в Telegram, отправьте /newbot и сохраните токен.',
    'Добавьте бота в канал администратором и включите право «Публикация сообщений».',
    'Укажите @username публичного канала или числовой ID приватного (начинается с -100).',
    'Для тестов создайте отдельный приватный канал и отметьте подключение как тестовое.',
  ],

  async verify(creds, meta) {
    const token = tokenOf(creds);
    const chatId = String(meta.chatId ?? '').trim();
    if (!chatId) throw new ExternalError(SERVICE, 'no_chat', 'Укажите канал или группу', false);
    const me = await call<{ id: number; username: string; first_name: string }>(token, 'getMe', {});
    const chat = await call<{ id: number; title?: string; username?: string; type: string }>(token, 'getChat', { chat_id: chatId });
    const member = await call<{ status: string; can_post_messages?: boolean }>(token, 'getChatMember', { chat_id: chat.id, user_id: me.id });
    const warnings: string[] = [];
    const isAdmin = member.status === 'administrator' || member.status === 'creator';
    if (chat.type === 'channel' && (!isAdmin || member.can_post_messages === false)) {
      throw new ExternalError(SERVICE, 'no_rights', `Бот @${me.username} не может публиковать в «${chat.title}». Сделайте его администратором с правом «Публикация сообщений».`, false);
    }
    if (chat.type !== 'channel' && !isAdmin) warnings.push('Бот не администратор группы: публикация возможна, но закрепление и удаление недоступны.');
    return {
      displayName: chat.title ?? chat.username ?? String(chat.id),
      externalId: String(chat.id),
      scopes: ['send_messages', 'send_media'],
      expiresAt: null,
      meta: { chatId: String(chat.id), chatUsername: chat.username ?? null, chatType: chat.type, bot: me.username },
      warnings,
    };
  },

  async publish(account: AccountCtx, input: PublishInput) {
    const token = tokenOf(account.creds);
    const chatId = String(account.meta.chatId);
    const username = (account.meta.chatUsername as string | undefined) ?? undefined;
    const progress = { ...(input.progress as { messageIds?: number[]; step?: number }) };
    const ids = [...(progress.messageIds ?? [])];
    let step = progress.step ?? 0;
    const save = async () => input.saveProgress({ messageIds: ids, step });

    const images = input.media.filter((m) => m.kind === 'image');
    const video = input.media.find((m) => m.kind === 'video');
    const text = input.text.trim();
    const fitsCaption = text.length <= CAPTION_MAX;
    for (const m of input.media) if (m.bytes > UPLOAD_MAX) throw new ExternalError(SERVICE, 'too_large', `Файл ${Math.round(m.bytes / 1048576)} МБ больше лимита Bot API 50 МБ`, false);

    // Step 1: media (or text-only message)
    if (step < 1) {
      if (video) {
        const fd = new FormData();
        fd.set('chat_id', chatId);
        fd.set('video', fileBlob(video.path, video.mime), 'video.mp4');
        fd.set('supports_streaming', 'true');
        if (video.width) fd.set('width', String(video.width));
        if (video.height) fd.set('height', String(video.height));
        if (video.durationMs) fd.set('duration', String(Math.round(video.durationMs / 1000)));
        if (video.cover) fd.set('thumbnail', fileBlob(video.cover.path, 'image/jpeg'), 'cover.jpg');
        if (fitsCaption && text) fd.set('caption', text);
        const msg = await call<TgMessage>(token, 'sendVideo', fd, 300_000);
        ids.push(msg.message_id);
      } else if (images.length > 1) {
        const fd = new FormData();
        fd.set('chat_id', chatId);
        const group = images.slice(0, 10).map((m, i) => {
          fd.set(`f${i}`, fileBlob(m.path, m.mime), `slide-${i + 1}.jpg`);
          return { type: 'photo', media: `attach://f${i}`, ...(i === 0 && fitsCaption && text ? { caption: text } : {}) };
        });
        fd.set('media', JSON.stringify(group));
        const msgs = await call<TgMessage[]>(token, 'sendMediaGroup', fd, 180_000);
        ids.push(...msgs.map((m) => m.message_id));
      } else if (images.length === 1) {
        const fd = new FormData();
        fd.set('chat_id', chatId);
        fd.set('photo', fileBlob(images[0]!.path, images[0]!.mime), 'image.jpg');
        if (fitsCaption && text) fd.set('caption', text);
        const msg = await call<TgMessage>(token, 'sendPhoto', fd, 120_000);
        ids.push(msg.message_id);
      } else {
        if (!text) throw new ExternalError(SERVICE, 'empty', 'Пустая публикация', false);
        const msg = await call<TgMessage>(token, 'sendMessage', { chat_id: chatId, text: smartTrim(text, TEXT_MAX).text, link_preview_options: { is_disabled: false } });
        ids.push(msg.message_id);
      }
      step = 1;
      await save();
    }

    // Step 2: long text after media
    if (step < 2 && input.media.length && !fitsCaption && text) {
      const msg = await call<TgMessage>(token, 'sendMessage', { chat_id: chatId, text: smartTrim(text, TEXT_MAX).text, reply_parameters: { message_id: ids[0], allow_sending_without_reply: true } });
      ids.push(msg.message_id);
      step = 2;
      await save();
    }

    const first = ids[0]!;
    return { externalId: String(first), url: linkFor(username, chatId, first), meta: { messageIds: ids } };
  },

  async metrics() {
    return {
      values: {},
      unavailable: {
        views: 'Bot API не отдаёт просмотры постов канала',
        reactions: 'Bot API не отдаёт реакции на посты канала без обработки обновлений',
      },
    };
  },
};
