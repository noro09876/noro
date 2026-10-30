import fs from 'node:fs';
import path from 'node:path';
import { request } from './http.ts';
import { type Ctx, type Integration, IntegrationError, type OutgoingImage } from './types.ts';

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

function classify(status: number, body: TgResponse<unknown> | null): IntegrationError {
  const desc = body?.description ?? `HTTP ${status}`;
  if (status === 429) return new IntegrationError('rate_limit', `Telegram: слишком много запросов (${desc})`, { retryAfterSec: body?.parameters?.retry_after ?? 30, code: 429 });
  if (status === 401 || status === 404) return new IntegrationError('auth', 'Telegram: токен бота недействителен — создайте новый у @BotFather', { code: status });
  if (status === 403) return new IntegrationError('permission', `Telegram: бот не может писать в этот чат (${desc}). Добавьте бота администратором с правом публикации`, { code: 403 });
  if (status >= 500) return new IntegrationError('transient', `Telegram: временная ошибка сервера (${desc})`, { code: status });
  if (/chat not found/i.test(desc)) return new IntegrationError('invalid', 'Telegram: канал или чат не найден — проверьте ID или @username', { code: status });
  if (/not enough rights|need administrator/i.test(desc)) return new IntegrationError('permission', `Telegram: у бота нет прав на публикацию (${desc})`, { code: status });
  return new IntegrationError('invalid', `Telegram: ${desc}`, { code: status });
}

async function call<T>(ctx: Ctx, method: string, body: Record<string, unknown> | FormData, commit = false): Promise<T> {
  const url = `${ctx.apiBase}/bot${ctx.credentials.botToken}/${method}`;
  const isForm = body instanceof FormData;
  const res = await request(url, {
    method: 'POST',
    headers: isForm ? undefined : { 'content-type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
    timeoutMs: isForm ? 120000 : 30000,
    commit,
    fetch: ctx.fetch,
  });
  const data = (typeof res.data === 'object' ? res.data : null) as TgResponse<T> | null;
  if (res.status !== 200 || !data?.ok) throw classify(res.status, data);
  return data.result as T;
}

function fileBlob(img: OutgoingImage): Blob {
  return new Blob([fs.readFileSync(img.path)], { type: img.mime });
}

interface TgMessage {
  message_id: number;
  chat: { id: number; username?: string };
}

const linkFor = (m: TgMessage) => (m.chat.username ? `https://t.me/${m.chat.username}/${m.message_id}` : null);

export const telegram: Integration = {
  platform: 'telegram',
  label: 'Telegram',
  cost: 'Бесплатно (Telegram Bot API)',
  requirements: [
    'Создайте бота у @BotFather и скопируйте токен.',
    'Добавьте бота в канал администратором с правом «Публикация сообщений».',
    'Укажите @username публичного канала или числовой ID (например, -1001234567890).',
  ],
  metricsNote: 'Bot API не отдаёт просмотры и реакции постов канала — статистика Telegram в NORO недоступна.',
  oauth: false,
  credentialFields: [
    { key: 'botToken', label: 'Токен бота', secret: true, required: true, placeholder: '123456789:AA…', help: 'Выдаёт @BotFather командой /newbot' },
  ],
  configFields: [
    { key: 'chatId', label: 'Канал или чат', secret: false, required: true, placeholder: '@noro_channel или -100…' },
  ],

  async check(ctx) {
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(ctx.credentials.botToken ?? '')) {
      return { ok: false, remoteName: null, message: 'Неверный формат токена бота', details: {} };
    }
    const me = await call<{ id: number; username: string }>(ctx, 'getMe', {});
    const chatId = ctx.config.chatId;
    if (!chatId) return { ok: false, remoteName: null, message: 'Не указан канал', details: { bot: me.username } };
    const chat = await call<{ id: number; title?: string; type: string; username?: string }>(ctx, 'getChat', { chat_id: chatId });
    const member = await call<{ status: string; can_post_messages?: boolean }>(ctx, 'getChatMember', { chat_id: chatId, user_id: me.id });
    const isAdmin = member.status === 'administrator' || member.status === 'creator';
    const canPost = chat.type === 'channel' ? isAdmin && member.can_post_messages !== false : ['administrator', 'creator', 'member'].includes(member.status);
    return {
      ok: canPost,
      remoteName: chat.title ?? chat.username ?? String(chat.id),
      message: canPost ? `Бот @${me.username} может публиковать` : `Бот @${me.username} не имеет права публикации в «${chat.title ?? chatId}»`,
      details: { bot: me.username, chatType: chat.type, memberStatus: member.status },
    };
  },

  async publish(ctx, post) {
    const chatId = ctx.config.chatId;
    const parse = post.html ? { parse_mode: 'HTML' } : {};
    const warnings: string[] = [];
    let first: TgMessage;

    if (!post.images.length) {
      first = await call<TgMessage>(ctx, 'sendMessage', { chat_id: chatId, text: post.text, ...parse, link_preview_options: { is_disabled: true } }, true);
    } else if (post.images.length === 1) {
      const form = new FormData();
      form.set('chat_id', chatId);
      if (post.text) form.set('caption', post.text);
      if (post.html) form.set('parse_mode', 'HTML');
      form.set('photo', fileBlob(post.images[0]), path.basename(post.images[0].path));
      first = await call<TgMessage>(ctx, 'sendPhoto', form, true);
    } else {
      const form = new FormData();
      form.set('chat_id', chatId);
      const media = post.images.slice(0, 10).map((img, i) => {
        form.set(`file${i}`, fileBlob(img), path.basename(img.path));
        return { type: 'photo', media: `attach://file${i}`, ...(i === 0 && post.text ? { caption: post.text, ...parse } : {}) };
      });
      form.set('media', JSON.stringify(media));
      const msgs = await call<TgMessage[]>(ctx, 'sendMediaGroup', form, true);
      first = msgs[0];
    }

    // Once the first message exists the post is live: follow-up failures become warnings, never a retry of the whole post.
    for (const [i, text] of post.followUps.entries()) {
      try {
        await call<TgMessage>(ctx, 'sendMessage', { chat_id: chatId, text, ...parse, link_preview_options: { is_disabled: true } }, true);
      } catch (e) {
        warnings.push(`Часть текста ${i + 1} не отправлена: ${(e as Error).message}`);
        break;
      }
    }
    return { externalId: String(first.message_id), url: linkFor(first), warnings };
  },

  async metrics() {
    return null;
  },
};
