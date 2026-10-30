import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { request, retryAfter } from './http.ts';
import { type Ctx, type Integration, IntegrationError } from './types.ts';

interface XCreds {
  clientId: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export const X_SCOPES = 'tweet.read tweet.write users.read media.write offline.access';

function classify(status: number, data: unknown, headers: Headers): IntegrationError {
  const d = data as { title?: string; detail?: string; errors?: { message?: string }[]; reason?: string } | null;
  const msg = d?.detail ?? d?.title ?? d?.errors?.[0]?.message ?? `HTTP ${status}`;
  if (status === 401) return new IntegrationError('auth', `X: авторизация недействительна (${msg}) — подключите аккаунт заново`, { code: 401 });
  if (status === 402 || /credits|billing|enroll|client-not-enrolled|payment/i.test(`${msg} ${d?.reason ?? ''}`)) {
    return new IntegrationError('payment', `X: для публикации через API нужен оплаченный доступ (кредиты pay-per-use) — ${msg}`, { code: status });
  }
  if (status === 429) return new IntegrationError('rate_limit', 'X: превышен лимит запросов', { retryAfterSec: retryAfter(headers, 900), code: 429 });
  if (status === 403) return new IntegrationError('permission', `X: действие запрещено (${msg})`, { code: 403 });
  if (status >= 500) return new IntegrationError('transient', `X: ошибка сервера (${msg})`, { code: status });
  return new IntegrationError('invalid', `X: ${msg}`, { code: status });
}

function basicAuth(c: XCreds): Record<string, string> {
  return c.clientSecret ? { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}` } : {};
}

export function pkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: X_SCOPES, state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  return `https://x.com/i/oauth2/authorize?${q}`;
}

async function tokenRequest(ctx: Ctx, params: Record<string, string>): Promise<XCreds> {
  const c = ctx.credentials as unknown as XCreds;
  const res = await request(`${ctx.apiBase}/2/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...basicAuth(c) },
    body: new URLSearchParams({ ...params, client_id: c.clientId }),
    fetch: ctx.fetch,
  });
  const d = res.data as { access_token?: string; refresh_token?: string; expires_in?: number } | null;
  if (res.status !== 200 || !d?.access_token) throw classify(res.status, res.data, res.headers);
  return { ...c, accessToken: d.access_token, refreshToken: d.refresh_token ?? c.refreshToken, expiresAt: Date.now() + (d.expires_in ?? 7200) * 1000 };
}

export async function exchangeCode(ctx: Ctx, code: string, verifier: string, redirectUri: string): Promise<XCreds> {
  return tokenRequest(ctx, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
}

async function token(ctx: Ctx): Promise<string> {
  const c = ctx.credentials as unknown as XCreds;
  if (!c.accessToken) throw new IntegrationError('auth', 'X: аккаунт ещё не авторизован — нажмите «Авторизоваться в X»');
  if (c.expiresAt && c.expiresAt - Date.now() < 120000) {
    if (!c.refreshToken) throw new IntegrationError('auth', 'X: срок токена истёк — авторизуйтесь снова');
    const next = await tokenRequest(ctx, { grant_type: 'refresh_token', refresh_token: c.refreshToken });
    ctx.saveCredentials(next as unknown as Record<string, string>);
    Object.assign(ctx.credentials, next);
    return next.accessToken as string;
  }
  return c.accessToken;
}

async function api<T>(ctx: Ctx, method: string, pathname: string, body?: unknown, commit = false): Promise<T> {
  const t = await token(ctx);
  const isForm = body instanceof FormData;
  const res = await request(`${ctx.apiBase}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${t}`, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    commit,
    timeoutMs: 60000,
    fetch: ctx.fetch,
  });
  if (res.status < 200 || res.status >= 300) throw classify(res.status, res.data, res.headers);
  return res.data as T;
}

export const x: Integration = {
  platform: 'x',
  label: 'X (Twitter)',
  cost: 'Платно: с 2026 года X API работает по модели pay-per-use, бесплатного уровня для новых проектов нет. Без пополнения баланса публикация вернёт ошибку оплаты',
  requirements: [
    'Аккаунт разработчика на developer.x.com и проект с приложением.',
    'В настройках приложения включите OAuth 2.0 (тип Web App или Native App), права Read and write.',
    'Callback URL: <адрес NORO>/api/oauth/x/callback (например, http://127.0.0.1:8787/api/oauth/x/callback).',
    'Пополните баланс кредитов X API — без этого запись запрещена. NORO не включает оплату сам.',
    'Текст поста — до 280 символов, до 4 изображений.',
  ],
  metricsNote: 'Публичные метрики доступны через GET /2/tweets, но каждое чтение тарифицируется X — по умолчанию сбор выключен.',
  oauth: true,
  credentialFields: [
    { key: 'clientId', label: 'OAuth 2.0 Client ID', secret: false, required: true },
    { key: 'clientSecret', label: 'Client Secret (для Web App)', secret: true, required: false },
  ],
  configFields: [],

  async check(ctx) {
    const me = await api<{ data?: { id: string; username: string; name: string } }>(ctx, 'GET', '/2/users/me');
    return { ok: Boolean(me.data), remoteName: me.data ? `@${me.data.username}` : null, message: me.data ? 'Авторизация действительна. Публикация требует кредитов X API' : 'Пользователь не найден', details: { userId: me.data?.id } };
  },

  async publish(ctx, post) {
    const mediaIds: string[] = [];
    for (const img of post.images.slice(0, 4)) {
      const form = new FormData();
      form.set('media', new Blob([fs.readFileSync(img.path)], { type: img.mime }), path.basename(img.path));
      form.set('media_category', 'tweet_image');
      form.set('media_type', img.mime);
      const up = await api<{ data?: { id: string } }>(ctx, 'POST', '/2/media/upload', form);
      if (!up.data?.id) throw new IntegrationError('transient', 'X: загрузка изображения не вернула id');
      mediaIds.push(up.data.id);
    }
    const res = await api<{ data: { id: string } }>(ctx, 'POST', '/2/tweets', { text: post.text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }, true);
    return { externalId: res.data.id, url: `https://x.com/i/web/status/${res.data.id}`, warnings: [] };
  },

  async metrics(ctx, externalId) {
    if (ctx.config.fetchMetrics !== 'true') return null;
    const r = await api<{ data?: { public_metrics?: { impression_count?: number; like_count?: number; reply_count?: number; retweet_count?: number; bookmark_count?: number } } }>(
      ctx, 'GET', `/2/tweets/${externalId}?tweet.fields=public_metrics`,
    );
    const m = r.data?.public_metrics;
    if (!m) return null;
    return { views: m.impression_count ?? null, reach: null, likes: m.like_count ?? null, comments: m.reply_count ?? null, shares: m.retweet_count ?? null, saves: m.bookmark_count ?? null };
  },
};
