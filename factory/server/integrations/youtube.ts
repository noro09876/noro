import fs from 'node:fs';
import { ExternalError } from '../lib/errors';
import { readJson, xfetch } from '../lib/http';
import { apiBase, needToken, requireMedia } from './base';
import type { Credentials, OAuthApp, PlatformAdapter, TokenSet } from './types';

/**
 * YouTube Data API v3: OAuth 2.0 (offline access) + resumable upload via videos.insert.
 * A vertical video up to 3 minutes is treated as a Short by YouTube itself.
 */
const SERVICE = 'YouTube';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const api = () => apiBase('youtube', 'https://www.googleapis.com');
const oauth = () => apiBase('google_oauth', 'https://oauth2.googleapis.com');

function ytError(res: Response, body: { error?: { message?: string; errors?: { reason?: string }[] } } | null): ExternalError {
  const reason = body?.error?.errors?.[0]?.reason ?? '';
  const msg = body?.error?.message ?? `HTTP ${res.status}`;
  if (res.status === 401) return new ExternalError(SERVICE, 'auth', 'Доступ к YouTube истёк — переподключите канал', false, undefined, 401);
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') return new ExternalError(SERVICE, 'quota', `YouTube: исчерпана квота загрузок (${reason}). Повторите завтра или запросите увеличение квоты в Google Cloud.`, false, undefined, 403);
  if (res.status === 403) return new ExternalError(SERVICE, 'permission', `YouTube: нет доступа (${reason || msg})`, false, undefined, 403);
  if (res.status === 429 || res.status >= 500) return new ExternalError(SERVICE, 'transient', `YouTube временно недоступен: ${msg}`, true, 60, res.status);
  return new ExternalError(SERVICE, reason || `http_${res.status}`, `YouTube: ${msg}`, false, undefined, res.status);
}

async function tokenCall(body: URLSearchParams): Promise<TokenSet> {
  const res = await xfetch(`${oauth()}/token`, { service: SERVICE, timeoutMs: 20_000, method: 'POST', body });
  const t = await readJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }>(res);
  if (!t?.access_token) {
    if (t?.error === 'invalid_grant') throw new ExternalError(SERVICE, 'auth', 'Google отозвал доступ — переподключите канал', false);
    throw new ExternalError(SERVICE, 'oauth', `Google не выдал токен: ${t?.error_description ?? t?.error ?? res.status}`, false);
  }
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null, scopes: t.scope?.split(' ') ?? SCOPES };
}

export const youtube: PlatformAdapter = {
  id: 'youtube',
  connect: 'oauth',
  appFields: [
    { key: 'clientId', label: 'OAuth Client ID' },
    { key: 'clientSecret', label: 'OAuth Client Secret', secret: true },
  ],
  setupSteps: [
    'В Google Cloud Console создайте проект и включите YouTube Data API v3.',
    'Настройте экран согласия OAuth (External) и добавьте себя в тестовых пользователей; для клиентов пройдите верификацию приложения.',
    'Создайте OAuth Client ID типа «Web application» с Redirect URI {PUBLIC_URL}/api/oauth/callback/youtube.',
    'Вставьте Client ID и Secret в «Настройки → Интеграции → YouTube» и нажмите «Подключить».',
    'Квота загрузок по умолчанию — 100 видео в сутки на проект; увеличение запрашивается в Google.',
  ],
  authorizeUrl(app, state, challenge) {
    const q = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `${apiBase('google_auth', 'https://accounts.google.com')}/o/oauth2/v2/auth?${q}`;
  },
  async exchangeCode(app, code, verifier) {
    return tokenCall(new URLSearchParams({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri, grant_type: 'authorization_code', code_verifier: verifier }));
  },
  async refresh(app: OAuthApp, creds: Credentials) {
    if (!creds.refreshToken) throw new ExternalError(SERVICE, 'no_refresh', 'Нет refresh-токена — переподключите канал', false);
    const t = await tokenCall(new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: creds.refreshToken, grant_type: 'refresh_token' }));
    return { ...t, refreshToken: t.refreshToken ?? creds.refreshToken };
  },
  async verify(creds) {
    const token = needToken(creds, SERVICE);
    const res = await xfetch(`${api()}/youtube/v3/channels?part=snippet,status&mine=true`, { service: SERVICE, timeoutMs: 20_000, headers: { authorization: `Bearer ${token}` } });
    const body = await readJson<{ items?: { id: string; snippet: { title: string; customUrl?: string } }[] }>(res);
    if (!res.ok) throw ytError(res, body as never);
    const ch = body?.items?.[0];
    if (!ch) throw new ExternalError(SERVICE, 'no_channel', 'У этого аккаунта Google нет канала YouTube', false);
    return { displayName: ch.snippet.title, externalId: ch.id, scopes: SCOPES, meta: { customUrl: ch.snippet.customUrl ?? null, privacy: 'public' } };
  },
  async publish(account, input) {
    const token = needToken(account.creds, SERVICE);
    const video = input.media.find((m) => m.kind === 'video');
    requireMedia(SERVICE, !!video, 'YouTube Shorts принимает только видео');
    const privacy = (account.meta.privacy as string) || 'public';
    const progress = { ...(input.progress as { uploadUrl?: string }) };
    let uploadUrl = progress.uploadUrl;
    if (!uploadUrl) {
      const meta = {
        snippet: { title: (input.title || input.text.split('\n')[0] || 'Shorts').slice(0, 100), description: input.text.slice(0, 5000), categoryId: '28' },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      };
      const res = await xfetch(`${api()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
        service: SERVICE,
        timeoutMs: 30_000,
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(video!.bytes), 'x-upload-content-type': 'video/mp4' },
        body: JSON.stringify(meta),
      });
      if (!res.ok) throw ytError(res, await readJson(res));
      uploadUrl = res.headers.get('location') ?? undefined;
      if (!uploadUrl) throw new ExternalError(SERVICE, 'no_upload_url', 'YouTube не выдал адрес загрузки', true);
      await input.saveProgress({ uploadUrl });
    }
    const res = await xfetch(uploadUrl, { service: SERVICE, timeoutMs: 900_000, method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(video!.bytes) }, body: fs.readFileSync(video!.path) });
    const body = await readJson<{ id?: string; status?: { uploadStatus?: string; privacyStatus?: string } }>(res);
    if (!res.ok || !body?.id) {
      if (res.status === 404 || res.status === 410) await input.saveProgress({ uploadUrl: undefined });
      throw ytError(res, body as never);
    }
    return { externalId: body.id, url: `https://youtube.com/shorts/${body.id}`, meta: { privacy: body.status?.privacyStatus, uploadStatus: body.status?.uploadStatus, visibleOnlyToAuthor: body.status?.privacyStatus === 'private' } };
  },
  async metrics(account, externalId) {
    const token = needToken(account.creds, SERVICE);
    const res = await xfetch(`${api()}/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalId)}`, { service: SERVICE, timeoutMs: 20_000, headers: { authorization: `Bearer ${token}` } });
    const body = await readJson<{ items?: { statistics: Record<string, string> }[] }>(res);
    if (!res.ok) throw ytError(res, body as never);
    const s = body?.items?.[0]?.statistics ?? {};
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(s)) values[k.replace(/Count$/, '')] = Number(v);
    return { values, unavailable: { watchTime: 'Время просмотра доступно только через YouTube Analytics API (отдельное разрешение)' } };
  },
};
