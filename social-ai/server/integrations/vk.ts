import fs from 'node:fs';
import path from 'node:path';
import { request } from './http.ts';
import { type Ctx, type Integration, IntegrationError } from './types.ts';

const V = '5.199';

function classify(code: number, msg: string): IntegrationError {
  if (code === 5 || code === 1116) return new IntegrationError('auth', 'ВКонтакте: токен недействителен или истёк — получите новый', { code });
  if (code === 6) return new IntegrationError('rate_limit', 'ВКонтакте: слишком много запросов в секунду', { retryAfterSec: 2, code });
  if (code === 9) return new IntegrationError('rate_limit', 'ВКонтакте: контроль флуда (лимит публикаций) — пауза', { retryAfterSec: 3600, code });
  if (code === 29) return new IntegrationError('rate_limit', 'ВКонтакте: достигнут суточный лимит метода', { retryAfterSec: 6 * 3600, code });
  if (code === 1 || code === 10) return new IntegrationError('transient', `ВКонтакте: внутренняя ошибка сервера (${msg})`, { code });
  if ([7, 15, 27, 203, 214, 219, 220, 222].includes(code)) {
    const hint = code === 27 ? ' Ключ сообщества не подходит для публикации на стене — нужен пользовательский токен администратора.' : '';
    return new IntegrationError('permission', `ВКонтакте: нет прав на публикацию (${code}: ${msg}).${hint}`, { code });
  }
  return new IntegrationError('invalid', `ВКонтакте: ${msg} (${code})`, { code });
}

async function call<T>(ctx: Ctx, method: string, params: Record<string, string | number>, commit = false): Promise<T> {
  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), access_token: ctx.credentials.accessToken, v: V });
  const res = await request(`${ctx.apiBase}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    commit,
    fetch: ctx.fetch,
  });
  if (res.status >= 500) throw new IntegrationError('transient', `ВКонтакте: HTTP ${res.status}`);
  const data = res.data as { response?: T; error?: { error_code: number; error_msg: string } } | null;
  if (data?.error) throw classify(data.error.error_code, data.error.error_msg);
  if (!data || data.response === undefined) throw new IntegrationError('transient', 'ВКонтакте: пустой ответ');
  return data.response;
}

const groupId = (ctx: Ctx) => String(ctx.config.groupId ?? '').replace(/^-/, '').replace(/^(club|public)/, '');

export const vk: Integration = {
  platform: 'vk',
  label: 'ВКонтакте',
  cost: 'Бесплатно (VK API). Лимит ВКонтакте — до 50 постов на стене в сутки',
  requirements: [
    'Вы администратор или редактор сообщества.',
    'Создайте приложение в VK ID (id.vk.com → «Мои приложения»), включите доступы wall, photos, groups, offline.',
    'Получите пользовательский ключ доступа через авторизацию VK ID этого приложения и вставьте его сюда. Пароль от ВКонтакте не нужен и не запрашивается.',
    'Укажите числовой ID сообщества (без минуса).',
  ],
  metricsNote: 'Просмотры, лайки, репосты и комментарии берутся из wall.getById.',
  oauth: false,
  credentialFields: [
    { key: 'accessToken', label: 'Ключ доступа пользователя', secret: true, required: true, placeholder: 'vk1.a.…', help: 'Права: wall, photos, groups, offline' },
  ],
  configFields: [
    { key: 'groupId', label: 'ID сообщества', secret: false, required: true, placeholder: '123456789' },
  ],

  async check(ctx) {
    const gid = groupId(ctx);
    if (!/^\d+$/.test(gid)) return { ok: false, remoteName: null, message: 'ID сообщества должен быть числом', details: {} };
    const users = await call<{ id: number; first_name: string; last_name: string }[]>(ctx, 'users.get', {});
    const res = await call<{ groups?: { id: number; name: string; is_admin?: number; admin_level?: number }[] } | { id: number; name: string; is_admin?: number; admin_level?: number }[]>(
      ctx, 'groups.getById', { group_id: gid, fields: 'is_admin,admin_level' },
    );
    const group = Array.isArray(res) ? res[0] : res.groups?.[0];
    if (!group) return { ok: false, remoteName: null, message: 'Сообщество не найдено', details: {} };
    const canPost = Boolean(group.is_admin) && (group.admin_level ?? 0) >= 2;
    const user = users[0];
    return {
      ok: canPost,
      remoteName: group.name,
      message: canPost ? `Публикация от имени сообщества доступна (${user?.first_name ?? ''} ${user?.last_name ?? ''})` : 'Пользователь токена не является редактором или администратором сообщества',
      details: { adminLevel: group.admin_level ?? 0 },
    };
  },

  async publish(ctx, post) {
    const gid = groupId(ctx);
    const attachments: string[] = [];
    for (const img of post.images.slice(0, 10)) {
      const server = await call<{ upload_url: string }>(ctx, 'photos.getWallUploadServer', { group_id: gid });
      const form = new FormData();
      form.set('photo', new Blob([fs.readFileSync(img.path)], { type: img.mime }), path.basename(img.path));
      const up = await request(server.upload_url, { method: 'POST', body: form, timeoutMs: 120000, fetch: ctx.fetch });
      const u = up.data as { server?: number; photo?: string; hash?: string } | null;
      if (up.status !== 200 || !u?.photo || u.photo === '[]') throw new IntegrationError('transient', 'ВКонтакте: не удалось загрузить изображение');
      const saved = await call<{ id: number; owner_id: number }[]>(ctx, 'photos.saveWallPhoto', { group_id: gid, server: u.server ?? 0, photo: u.photo, hash: u.hash ?? '' });
      attachments.push(`photo${saved[0].owner_id}_${saved[0].id}`);
    }
    // guid makes wall.post idempotent on VK's side, so a retry after a dropped connection cannot create a second post.
    const res = await call<{ post_id: number }>(ctx, 'wall.post', {
      owner_id: `-${gid}`, from_group: 1, message: post.text, guid: `noro-pub-${post.publicationId}`,
      ...(attachments.length ? { attachments: attachments.join(',') } : {}),
    });
    return { externalId: String(res.post_id), url: `https://vk.com/wall-${gid}_${res.post_id}`, warnings: [] };
  },

  async metrics(ctx, externalId) {
    const gid = groupId(ctx);
    const res = await call<{ items?: VkPost[] } | VkPost[]>(ctx, 'wall.getById', { posts: `-${gid}_${externalId}` });
    const p = Array.isArray(res) ? res[0] : res.items?.[0];
    if (!p) return null;
    return { views: p.views?.count ?? null, reach: null, likes: p.likes?.count ?? null, comments: p.comments?.count ?? null, shares: p.reposts?.count ?? null, saves: null };
  },
};

interface VkPost {
  views?: { count: number };
  likes?: { count: number };
  comments?: { count: number };
  reposts?: { count: number };
}
