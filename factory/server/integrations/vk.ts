import { ExternalError } from '../lib/errors';
import { readJson, xfetch } from '../lib/http';
import { apiBase, fileBlob, needToken } from './base';
import type { AccountCtx, Credentials, OAuthApp, PlatformAdapter, PublishInput, TokenSet } from './types';

/**
 * VK: VK ID (OAuth 2.1 + PKCE) for the user token, VK API for posting to a community wall.
 * Photo uploads to a community wall require a user token — a community key is not enough.
 */
const SERVICE = 'ВКонтакте';
const V = '5.199';
const SCOPES = ['wall', 'photos', 'video', 'groups'];

const idBase = () => apiBase('vkid', 'https://id.vk.com');
const apiHost = () => apiBase('vk', 'https://api.vk.com');

interface VkError {
  error_code: number;
  error_msg: string;
}

function mapError(e: VkError): ExternalError {
  const c = e.error_code;
  if (c === 5) return new ExternalError(SERVICE, 'auth', 'Ключ доступа VK истёк или отозван — переподключите аккаунт', false);
  if (c === 6 || c === 9 || c === 29) return new ExternalError(SERVICE, 'rate_limit', `VK ограничил частоту запросов (${e.error_msg})`, true, c === 9 ? 3600 : 5);
  if (c === 10) return new ExternalError(SERVICE, 'server', 'Внутренняя ошибка VK', true);
  if (c === 15 || c === 7) return new ExternalError(SERVICE, 'permission', `Нет прав: ${e.error_msg}. Проверьте, что вы администратор или редактор сообщества и выдали права wall/photos/video.`, false);
  if (c === 214) return new ExternalError(SERVICE, 'wall_closed', 'Публикация на стене сообщества запрещена его настройками', false);
  if (c === 220) return new ExternalError(SERVICE, 'too_many_recipients', e.error_msg, false);
  return new ExternalError(SERVICE, `vk_${c}`, `VK: ${e.error_msg}`, false);
}

async function api<T>(method: string, token: string, params: Record<string, string | number>): Promise<T> {
  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), access_token: token, v: V });
  const res = await xfetch(`${apiHost()}/method/${method}`, { service: SERVICE, timeoutMs: 30_000, method: 'POST', body });
  const data = await readJson<{ response?: T; error?: VkError }>(res);
  if (data?.error) throw mapError(data.error);
  if (!res.ok || data?.response === undefined) throw new ExternalError(SERVICE, `http_${res.status}`, `VK вернул HTTP ${res.status}`, res.status >= 500);
  return data.response;
}

async function upload(url: string, field: string, path: string, mime: string, name: string, timeoutMs: number) {
  const fd = new FormData();
  fd.set(field, fileBlob(path, mime), name);
  const res = await xfetch(url, { service: SERVICE, timeoutMs, method: 'POST', body: fd });
  const data = await readJson<Record<string, unknown>>(res);
  if (!res.ok || !data) throw new ExternalError(SERVICE, 'upload_failed', `Не удалось загрузить файл в VK (HTTP ${res.status})`, res.status >= 500);
  if (data.error) throw new ExternalError(SERVICE, 'upload_failed', `VK отклонил файл: ${JSON.stringify(data.error).slice(0, 200)}`, false);
  return data;
}

function tokens(t: { access_token?: string; refresh_token?: string; expires_in?: number; user_id?: number | string; scope?: string; error?: string; error_description?: string }): TokenSet {
  if (!t.access_token) throw new ExternalError(SERVICE, 'oauth', `VK ID не выдал токен: ${t.error_description ?? t.error ?? 'неизвестная ошибка'}`, false);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    userId: t.user_id ? String(t.user_id) : undefined,
    scopes: t.scope ? t.scope.split(/[ ,]+/) : SCOPES,
  };
}

export const vk: PlatformAdapter = {
  id: 'vk',
  connect: 'oauth',
  appFields: [
    { key: 'clientId', label: 'ID приложения VK ID' },
    { key: 'clientSecret', label: 'Защищённый ключ', secret: true },
  ],
  setupSteps: [
    'Создайте приложение типа «Веб» в кабинете VK ID (id.vk.com/about/business/go).',
    'В настройках приложения добавьте доверенный Redirect URL: {PUBLIC_URL}/api/oauth/callback/vk и базовый домен.',
    'Скопируйте ID приложения и защищённый ключ в «Настройки → Интеграции → ВКонтакте».',
    'Нажмите «Подключить», войдите как администратор сообщества и выберите сообщество для публикаций.',
  ],

  authorizeUrl(app, state, challenge) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: SCOPES.join(' '),
    });
    return `${idBase()}/authorize?${q}`;
  },

  async exchangeCode(app, code, verifier, extra) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: app.clientId,
      device_id: extra.device_id ?? '',
      redirect_uri: app.redirectUri,
      state: extra.state ?? '',
    });
    const res = await xfetch(`${idBase()}/oauth2/auth`, { service: SERVICE, timeoutMs: 20_000, method: 'POST', body });
    const t = await readJson<Parameters<typeof tokens>[0]>(res);
    return { ...tokens(t ?? {}), deviceId: extra.device_id };
  },

  async refresh(app: OAuthApp, creds: Credentials) {
    if (!creds.refreshToken) throw new ExternalError(SERVICE, 'no_refresh', 'Нет refresh-токена — переподключите аккаунт', false);
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: app.clientId, device_id: creds.deviceId ?? '', state: 'refresh' });
    const res = await xfetch(`${idBase()}/oauth2/auth`, { service: SERVICE, timeoutMs: 20_000, method: 'POST', body });
    return { ...tokens((await readJson(res)) ?? {}), deviceId: creds.deviceId };
  },

  async listTargets(creds) {
    const token = needToken(creds, SERVICE);
    const r = await api<{ items: { id: number; name: string }[] }>('groups.get', token, { filter: 'admin,editor', extended: 1, count: 100 });
    return r.items.map((g) => ({ id: String(g.id), name: g.name }));
  },

  async verify(creds, meta) {
    const token = needToken(creds, SERVICE);
    const groupId = String(meta.groupId ?? '').replace(/^-/, '');
    if (!groupId) throw new ExternalError(SERVICE, 'no_group', 'Выберите сообщество для публикаций', false);
    const groups = await api<{ groups?: { id: number; name: string; screen_name: string; is_admin?: number; admin_level?: number }[] } | { id: number; name: string; screen_name: string; is_admin?: number; admin_level?: number }[]>('groups.getById', token, { group_id: groupId, fields: 'can_post' });
    const g = Array.isArray(groups) ? groups[0] : groups.groups?.[0];
    if (!g) throw new ExternalError(SERVICE, 'group_not_found', 'Сообщество не найдено', false);
    if (!g.is_admin || (g.admin_level ?? 0) < 2) throw new ExternalError(SERVICE, 'not_editor', `Вы не редактор и не администратор «${g.name}» — VK не разрешит публикацию`, false);
    return { displayName: g.name, externalId: String(g.id), scopes: SCOPES, meta: { groupId: String(g.id), screenName: g.screen_name } };
  },

  async publish(account: AccountCtx, input: PublishInput) {
    const token = needToken(account.creds, SERVICE);
    const groupId = String(account.meta.groupId);
    const progress = { ...(input.progress as { attachments?: string[]; uploaded?: number }) };
    const attachments = [...(progress.attachments ?? [])];

    // Upload media one by one, saving progress so a retry doesn't re-upload.
    const media = input.media.slice(0, 10);
    for (let i = attachments.length; i < media.length; i++) {
      const m = media[i]!;
      if (m.kind === 'image') {
        const srv = await api<{ upload_url: string }>('photos.getWallUploadServer', token, { group_id: groupId });
        const up = await upload(srv.upload_url, 'photo', m.path, m.mime, `photo-${i + 1}.jpg`, 120_000);
        const saved = await api<{ id: number; owner_id: number }[]>('photos.saveWallPhoto', token, { group_id: groupId, photo: String(up.photo), server: String(up.server), hash: String(up.hash) });
        attachments.push(`photo${saved[0]!.owner_id}_${saved[0]!.id}`);
      } else {
        const srv = await api<{ upload_url: string; video_id: number; owner_id: number }>('video.save', token, { group_id: groupId, name: (input.title || input.text.split('\n')[0] || 'Видео').slice(0, 120), description: input.text.slice(0, 5000), wallpost: 0 });
        await upload(srv.upload_url, 'video_file', m.path, m.mime, 'video.mp4', 600_000);
        attachments.push(`video${srv.owner_id}_${srv.video_id}`);
      }
      await input.saveProgress({ attachments });
    }

    const r = await api<{ post_id: number }>('wall.post', token, { owner_id: `-${groupId}`, from_group: 1, message: input.text, ...(attachments.length ? { attachments: attachments.join(',') } : {}) });
    return { externalId: String(r.post_id), url: `https://vk.com/wall-${groupId}_${r.post_id}`, meta: { attachments } };
  },

  async metrics(account, externalId) {
    const token = needToken(account.creds, SERVICE);
    const r = await api<{ items?: { likes?: { count: number }; reposts?: { count: number }; comments?: { count: number }; views?: { count: number } }[] }>('wall.getById', token, { posts: `-${account.meta.groupId}_${externalId}`, extended: 0 });
    const p = Array.isArray(r) ? (r as never[])[0] : r.items?.[0];
    const post = p as { likes?: { count: number }; reposts?: { count: number }; comments?: { count: number }; views?: { count: number } } | undefined;
    const values: Record<string, number> = {};
    if (post?.views) values.views = post.views.count;
    if (post?.likes) values.likes = post.likes.count;
    if (post?.reposts) values.reposts = post.reposts.count;
    if (post?.comments) values.comments = post.comments.count;
    const unavailable: Record<string, string> = {};
    if (!post?.views) unavailable.views = 'VK не вернул просмотры для этой записи';
    return { values, unavailable };
  },
};
