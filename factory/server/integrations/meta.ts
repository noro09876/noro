import { ExternalError } from '../lib/errors';
import { readJson, sleep, xfetch } from '../lib/http';
import { apiBase, needToken, requireMedia, requirePublicUrl } from './base';
import type { AccountCtx, Credentials, OAuthApp, PlatformAdapter, PublishInput, TokenSet } from './types';

/**
 * Instagram API with Instagram Login and Threads API. Both use Meta's two-step
 * container flow: create a media container from a public URL → wait for FINISHED →
 * publish. Docs: developers.facebook.com/docs/instagram-platform/content-publishing,
 * developers.facebook.com/docs/threads
 */

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string; is_transient?: boolean };
}

function graphError(service: string, res: Response, body: GraphError | null): ExternalError {
  const e = body?.error;
  const code = e?.code;
  const msg = e?.message ?? `HTTP ${res.status}`;
  if (code === 190) return new ExternalError(service, 'auth', `${service}: токен истёк или отозван — переподключите аккаунт`, false, undefined, res.status);
  if (code === 10 || code === 200 || (code ?? 0) >= 200 && (code ?? 0) < 300) return new ExternalError(service, 'permission', `${service}: нет разрешения (${msg}). Проверьте, что приложение прошло App Review или аккаунт добавлен в тестировщики.`, false, undefined, res.status);
  if (code === 4 || code === 17 || code === 32 || code === 613 || res.status === 429) return new ExternalError(service, 'rate_limit', `${service}: превышен лимит запросов`, true, 300, res.status);
  if (code === 9 || e?.error_subcode === 2207042) return new ExternalError(service, 'publish_limit', `${service}: исчерпан суточный лимит публикаций через API`, false, undefined, res.status);
  if (e?.is_transient || res.status >= 500) return new ExternalError(service, 'transient', `${service}: временная ошибка — ${msg}`, true, 60, res.status);
  return new ExternalError(service, `graph_${code ?? res.status}`, `${service}: ${msg}`, false, undefined, res.status);
}

function makeGraph(service: string, host: () => string) {
  return async function graph<T>(method: 'GET' | 'POST', path: string, token: string, params: Record<string, string> = {}): Promise<T> {
    const q = new URLSearchParams({ ...params, access_token: token });
    const url = method === 'GET' ? `${host()}${path}?${q}` : `${host()}${path}`;
    const res = await xfetch(url, { service, timeoutMs: 60_000, method, body: method === 'POST' ? q : undefined });
    const body = await readJson<T & GraphError>(res);
    if (!res.ok || body?.error) throw graphError(service, res, body);
    return body as T;
  };
}

function longLived(service: string, t: { access_token?: string; expires_in?: number; user_id?: string | number; error?: { message?: string } } | null): TokenSet {
  if (!t?.access_token) throw new ExternalError(service, 'oauth', `${service}: не удалось получить токен (${t?.error?.message ?? 'нет ответа'})`, false);
  return { accessToken: t.access_token, expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null, userId: t.user_id ? String(t.user_id) : undefined };
}

async function waitContainer(service: string, check: () => Promise<{ status?: string; status_code?: string; error_message?: string }>, maxMs: number) {
  const started = Date.now();
  for (let i = 0; ; i++) {
    const s = await check();
    const st = s.status_code ?? s.status;
    if (st === 'FINISHED' || st === 'PUBLISHED') return;
    if (st === 'ERROR' || st === 'EXPIRED') throw new ExternalError(service, 'container_error', `${service}: медиа не обработано (${s.error_message ?? st})`, false);
    if (Date.now() - started > maxMs) throw new ExternalError(service, 'container_timeout', `${service}: обработка медиа заняла слишком много времени, повторим позже`, true, 120);
    await sleep(Math.min(15_000, 3_000 * (i + 1)));
  }
}

/* ---------------- Instagram ---------------- */

const IG = 'Instagram';
const igHost = () => apiBase('instagram', `https://graph.instagram.com/${process.env.IG_GRAPH_VERSION || 'v24.0'}`);
const igGraph = makeGraph(IG, igHost);
const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'];

export const instagram: PlatformAdapter = {
  id: 'instagram',
  connect: 'oauth',
  appFields: [
    { key: 'clientId', label: 'Instagram App ID' },
    { key: 'clientSecret', label: 'Instagram App Secret', secret: true },
  ],
  setupSteps: [
    'Переведите Instagram-аккаунт в профессиональный (бизнес или автор).',
    'В Meta for Developers создайте приложение типа Business и добавьте продукт «Instagram API with Instagram Login».',
    'Добавьте Redirect URL {PUBLIC_URL}/api/oauth/callback/instagram. PUBLIC_URL должен быть HTTPS-доменом — Meta скачивает медиа по ссылке.',
    'До App Review добавьте свой аккаунт в роли Instagram Tester; для клиентов пройдите App Review с разрешениями instagram_business_basic и instagram_business_content_publish.',
    'Вставьте App ID и App Secret в «Настройки → Интеграции → Instagram» и нажмите «Подключить».',
  ],
  authorizeUrl(app, state) {
    const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectUri, response_type: 'code', scope: IG_SCOPES.join(','), state, enable_fb_login: '0' });
    return `${apiBase('instagram_auth', 'https://www.instagram.com')}/oauth/authorize?${q}`;
  },
  async exchangeCode(app, code) {
    const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'authorization_code', redirect_uri: app.redirectUri, code });
    const res = await xfetch(`${apiBase('instagram_token', 'https://api.instagram.com')}/oauth/access_token`, { service: IG, timeoutMs: 20_000, method: 'POST', body });
    const short = await readJson<{ access_token?: string; user_id?: number; error_message?: string }>(res);
    if (!short?.access_token) throw new ExternalError(IG, 'oauth', `Instagram не выдал токен: ${short?.error_message ?? res.status}`, false);
    const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: app.clientSecret, access_token: short.access_token });
    const lres = await xfetch(`${apiBase('instagram', 'https://graph.instagram.com')}/access_token?${q}`, { service: IG, timeoutMs: 20_000 });
    return { ...longLived(IG, await readJson(lres)), userId: String(short.user_id), scopes: IG_SCOPES };
  },
  async refresh(_app: OAuthApp, creds: Credentials) {
    const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: needToken(creds, IG) });
    const res = await xfetch(`${apiBase('instagram', 'https://graph.instagram.com')}/refresh_access_token?${q}`, { service: IG, timeoutMs: 20_000 });
    return { ...longLived(IG, await readJson(res)), userId: creds.userId };
  },
  async verify(creds) {
    const token = needToken(creds, IG);
    const me = await igGraph<{ user_id?: string; id: string; username: string; account_type?: string }>('GET', '/me', token, { fields: 'user_id,username,account_type' });
    const warnings: string[] = [];
    if (me.account_type && !['BUSINESS', 'MEDIA_CREATOR'].includes(me.account_type)) throw new ExternalError(IG, 'not_professional', 'Публикация через API доступна только профессиональным аккаунтам', false);
    let quota: { quota_usage?: number; config?: { quota_total?: number } } | undefined;
    try {
      const r = await igGraph<{ data: { quota_usage?: number; config?: { quota_total?: number } }[] }>('GET', `/${me.user_id ?? me.id}/content_publishing_limit`, token, { fields: 'quota_usage,config' });
      quota = r.data[0];
    } catch {
      warnings.push('Не удалось получить лимит публикаций');
    }
    return { displayName: `@${me.username}`, externalId: String(me.user_id ?? me.id), scopes: IG_SCOPES, meta: { username: me.username, accountType: me.account_type ?? null, quotaUsage: quota?.quota_usage ?? null, quotaTotal: quota?.config?.quota_total ?? null }, warnings };
  },
  async publish(account: AccountCtx, input: PublishInput) {
    const token = needToken(account.creds, IG);
    const uid = account.externalId ?? account.creds.userId;
    const images = input.media.filter((m) => m.kind === 'image');
    const video = input.media.find((m) => m.kind === 'video');
    requireMedia(IG, !!video || images.length > 0, 'Instagram не публикует посты без изображения или видео');
    const progress = { ...(input.progress as { container?: string; children?: string[] }) };
    let container = progress.container;
    if (!container) {
      if (video) {
        const c = await igGraph<{ id: string }>('POST', `/${uid}/media`, token, { media_type: 'REELS', video_url: requirePublicUrl(IG, video.url), caption: input.text, share_to_feed: 'true', ...(video.cover?.url ? { cover_url: video.cover.url } : {}) });
        container = c.id;
      } else if (images.length > 1) {
        const children = [...(progress.children ?? [])];
        for (let i = children.length; i < Math.min(images.length, 20); i++) {
          const c = await igGraph<{ id: string }>('POST', `/${uid}/media`, token, { image_url: requirePublicUrl(IG, images[i]!.url), is_carousel_item: 'true' });
          children.push(c.id);
          await input.saveProgress({ children });
        }
        const c = await igGraph<{ id: string }>('POST', `/${uid}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: input.text });
        container = c.id;
      } else {
        const c = await igGraph<{ id: string }>('POST', `/${uid}/media`, token, { image_url: requirePublicUrl(IG, images[0]!.url), caption: input.text });
        container = c.id;
      }
      await input.saveProgress({ container });
    }
    await waitContainer(IG, () => igGraph('GET', `/${container}`, token, { fields: 'status_code' }), video ? 5 * 60_000 : 90_000);
    const pub = await igGraph<{ id: string }>('POST', `/${uid}/media_publish`, token, { creation_id: container! });
    let url: string | null = null;
    try {
      url = (await igGraph<{ permalink?: string }>('GET', `/${pub.id}`, token, { fields: 'permalink' })).permalink ?? null;
    } catch {
      /* permalink is optional */
    }
    return { externalId: pub.id, url, meta: { container } };
  },
  async metrics(account, externalId) {
    const token = needToken(account.creds, IG);
    const values: Record<string, number> = {};
    const unavailable: Record<string, string> = {};
    try {
      const r = await igGraph<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>('GET', `/${externalId}/insights`, token, { metric: 'views,reach,likes,comments,shares,saved' });
      for (const m of r.data) values[m.name] = m.total_value?.value ?? m.values?.[0]?.value ?? 0;
    } catch (e) {
      unavailable.insights = e instanceof ExternalError ? e.message : 'Insights недоступны';
    }
    return { values, unavailable };
  },
};

/* ---------------- Threads ---------------- */

const TH = 'Threads';
const thHost = () => apiBase('threads', 'https://graph.threads.net/v1.0');
const thGraph = makeGraph(TH, thHost);
const TH_SCOPES = ['threads_basic', 'threads_content_publish', 'threads_manage_insights'];

export const threads: PlatformAdapter = {
  id: 'threads',
  connect: 'oauth',
  appFields: [
    { key: 'clientId', label: 'Threads App ID' },
    { key: 'clientSecret', label: 'Threads App Secret', secret: true },
  ],
  setupSteps: [
    'В Meta for Developers создайте приложение с продуктом «Threads API».',
    'Добавьте Redirect URL {PUBLIC_URL}/api/oauth/callback/threads (HTTPS).',
    'До App Review добавьте свой профиль в тестировщики Threads и примите приглашение в настройках Threads.',
    'Вставьте App ID и App Secret в «Настройки → Интеграции → Threads» и нажмите «Подключить».',
  ],
  authorizeUrl(app, state) {
    const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectUri, scope: TH_SCOPES.join(','), response_type: 'code', state });
    return `${apiBase('threads_auth', 'https://threads.net')}/oauth/authorize?${q}`;
  },
  async exchangeCode(app, code) {
    const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'authorization_code', redirect_uri: app.redirectUri, code });
    const res = await xfetch(`${apiBase('threads', 'https://graph.threads.net')}/oauth/access_token`, { service: TH, timeoutMs: 20_000, method: 'POST', body });
    const short = await readJson<{ access_token?: string; user_id?: number; error?: { message?: string } }>(res);
    if (!short?.access_token) throw new ExternalError(TH, 'oauth', `Threads не выдал токен: ${short?.error?.message ?? res.status}`, false);
    const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: app.clientSecret, access_token: short.access_token });
    const lres = await xfetch(`${apiBase('threads', 'https://graph.threads.net')}/access_token?${q}`, { service: TH, timeoutMs: 20_000 });
    return { ...longLived(TH, await readJson(lres)), userId: String(short.user_id), scopes: TH_SCOPES };
  },
  async refresh(_app, creds) {
    const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: needToken(creds, TH) });
    const res = await xfetch(`${apiBase('threads', 'https://graph.threads.net')}/refresh_access_token?${q}`, { service: TH, timeoutMs: 20_000 });
    return { ...longLived(TH, await readJson(res)), userId: creds.userId };
  },
  async verify(creds) {
    const token = needToken(creds, TH);
    const me = await thGraph<{ id: string; username: string }>('GET', '/me', token, { fields: 'id,username' });
    let quota: number | null = null;
    try {
      const r = await thGraph<{ data: { quota_usage?: number }[] }>('GET', `/${me.id}/threads_publishing_limit`, token, { fields: 'quota_usage,config' });
      quota = r.data[0]?.quota_usage ?? null;
    } catch {
      /* optional */
    }
    return { displayName: `@${me.username}`, externalId: me.id, scopes: TH_SCOPES, meta: { username: me.username, quotaUsage: quota } };
  },
  async publish(account, input) {
    const token = needToken(account.creds, TH);
    const uid = account.externalId ?? account.creds.userId;
    const images = input.media.filter((m) => m.kind === 'image');
    const video = input.media.find((m) => m.kind === 'video');
    const progress = { ...(input.progress as { container?: string; children?: string[] }) };
    let container = progress.container;
    const text = input.text.slice(0, 500);
    if (!container) {
      if (video) {
        container = (await thGraph<{ id: string }>('POST', `/${uid}/threads`, token, { media_type: 'VIDEO', video_url: requirePublicUrl(TH, video.url), text })).id;
      } else if (images.length > 1) {
        const children = [...(progress.children ?? [])];
        for (let i = children.length; i < Math.min(images.length, 20); i++) {
          children.push((await thGraph<{ id: string }>('POST', `/${uid}/threads`, token, { media_type: 'IMAGE', image_url: requirePublicUrl(TH, images[i]!.url), is_carousel_item: 'true' })).id);
          await input.saveProgress({ children });
        }
        container = (await thGraph<{ id: string }>('POST', `/${uid}/threads`, token, { media_type: 'CAROUSEL', children: children.join(','), text })).id;
      } else if (images.length === 1) {
        container = (await thGraph<{ id: string }>('POST', `/${uid}/threads`, token, { media_type: 'IMAGE', image_url: requirePublicUrl(TH, images[0]!.url), text })).id;
      } else {
        container = (await thGraph<{ id: string }>('POST', `/${uid}/threads`, token, { media_type: 'TEXT', text })).id;
      }
      await input.saveProgress({ container });
    }
    if (input.media.length) await waitContainer(TH, () => thGraph('GET', `/${container}`, token, { fields: 'status,error_message' }), video ? 5 * 60_000 : 90_000);
    const pub = await thGraph<{ id: string }>('POST', `/${uid}/threads_publish`, token, { creation_id: container! });
    let url: string | null = null;
    try {
      url = (await thGraph<{ permalink?: string }>('GET', `/${pub.id}`, token, { fields: 'permalink' })).permalink ?? null;
    } catch {
      /* optional */
    }
    return { externalId: pub.id, url, meta: { container } };
  },
  async metrics(account, externalId) {
    const token = needToken(account.creds, TH);
    const values: Record<string, number> = {};
    const unavailable: Record<string, string> = {};
    try {
      const r = await thGraph<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>('GET', `/${externalId}/insights`, token, { metric: 'views,likes,replies,reposts,quotes' });
      for (const m of r.data) values[m.name] = m.total_value?.value ?? m.values?.[0]?.value ?? 0;
    } catch (e) {
      unavailable.insights = e instanceof ExternalError ? e.message : 'Insights недоступны';
    }
    return { values, unavailable };
  },
};
