import fs from 'node:fs';
import { ExternalError } from '../lib/errors';
import { readJson, sleep, xfetch } from '../lib/http';
import { apiBase, needToken, requireMedia } from './base';
import type { Credentials, OAuthApp, PlatformAdapter, TokenSet } from './types';

/**
 * TikTok Content Posting API — Direct Post with FILE_UPLOAD.
 * Unaudited apps can only post with privacy SELF_ONLY (visible to the author);
 * the adapter respects the privacy options returned by creator_info.
 */
const SERVICE = 'TikTok';
const SCOPES = ['user.info.basic', 'video.publish'];
const api = () => apiBase('tiktok', 'https://open.tiktokapis.com');
const MAX_CHUNK = 64 * 1024 * 1024;

interface TtEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

function ttError(res: Response, err: TtEnvelope<unknown>['error']): ExternalError {
  const code = err?.code ?? `http_${res.status}`;
  const msg = err?.message ?? `HTTP ${res.status}`;
  if (code === 'access_token_invalid' || res.status === 401) return new ExternalError(SERVICE, 'auth', 'Токен TikTok истёк — переподключите аккаунт', false, undefined, 401);
  if (code === 'scope_not_authorized') return new ExternalError(SERVICE, 'permission', 'Пользователь не выдал разрешение video.publish', false);
  if (code === 'rate_limit_exceeded' || res.status === 429) return new ExternalError(SERVICE, 'rate_limit', 'TikTok ограничил частоту (6 запросов в минуту)', true, 60, 429);
  if (code === 'spam_risk_too_many_posts') return new ExternalError(SERVICE, 'daily_cap', 'TikTok: достигнут дневной лимит публикаций для этого аккаунта', false);
  if (code === 'unaudited_client_can_only_post_to_private_accounts') return new ExternalError(SERVICE, 'unaudited', 'Приложение не прошло аудит TikTok: публикация возможна только в приватный аккаунт. Сделайте аккаунт приватным для теста или пройдите аудит.', false);
  if (code === 'privacy_level_option_mismatch') return new ExternalError(SERVICE, 'privacy', 'Выбранный уровень приватности недоступен для этого аккаунта', false);
  if (res.status >= 500) return new ExternalError(SERVICE, 'transient', `TikTok временно недоступен: ${msg}`, true, 60, res.status);
  return new ExternalError(SERVICE, code, `TikTok: ${msg}`, false, undefined, res.status);
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await xfetch(`${api()}${path}`, { service: SERVICE, timeoutMs: 30_000, method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body) });
  const b = await readJson<TtEnvelope<T>>(res);
  if (!res.ok || (b?.error?.code && b.error.code !== 'ok')) throw ttError(res, b?.error);
  return b!.data as T;
}

async function tokenCall(body: URLSearchParams): Promise<TokenSet> {
  const res = await xfetch(`${api()}/v2/oauth/token/`, { service: SERVICE, timeoutMs: 20_000, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const t = await readJson<{ access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string; scope?: string; error?: string; error_description?: string }>(res);
  if (!t?.access_token) throw new ExternalError(SERVICE, 'oauth', `TikTok не выдал токен: ${t?.error_description ?? t?.error ?? res.status}`, false);
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null, userId: t.open_id, scopes: t.scope?.split(',') ?? SCOPES };
}

export function chunkPlan(size: number): { chunkSize: number; total: number } {
  if (size <= MAX_CHUNK) return { chunkSize: size, total: 1 };
  const chunkSize = 10 * 1024 * 1024;
  // The last chunk absorbs the remainder (TikTok allows it to be up to 128 MB).
  return { chunkSize, total: Math.max(1, Math.floor(size / chunkSize)) };
}

export const tiktok: PlatformAdapter = {
  id: 'tiktok',
  connect: 'oauth',
  appFields: [
    { key: 'clientId', label: 'Client key' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
  ],
  setupSteps: [
    'Зарегистрируйтесь на developers.tiktok.com и создайте приложение (Web).',
    'Добавьте продукты Login Kit и Content Posting API, включите Direct Post и scope video.publish.',
    'Укажите Redirect URI {PUBLIC_URL}/api/oauth/callback/tiktok.',
    'До аудита: публикация только в приватном режиме (SELF_ONLY) и только для приватных аккаунтов. Для публичных постов подайте приложение на аудит.',
    'Вставьте Client key и Client secret в «Настройки → Интеграции → TikTok» и нажмите «Подключить».',
  ],
  authorizeUrl(app, state) {
    const q = new URLSearchParams({ client_key: app.clientId, scope: SCOPES.join(','), response_type: 'code', redirect_uri: app.redirectUri, state });
    return `${apiBase('tiktok_auth', 'https://www.tiktok.com')}/v2/auth/authorize/?${q}`;
  },
  async exchangeCode(app, code) {
    return tokenCall(new URLSearchParams({ client_key: app.clientId, client_secret: app.clientSecret, code, grant_type: 'authorization_code', redirect_uri: app.redirectUri }));
  },
  async refresh(app: OAuthApp, creds: Credentials) {
    if (!creds.refreshToken) throw new ExternalError(SERVICE, 'no_refresh', 'Нет refresh-токена — переподключите аккаунт', false);
    return tokenCall(new URLSearchParams({ client_key: app.clientId, client_secret: app.clientSecret, grant_type: 'refresh_token', refresh_token: creds.refreshToken }));
  },
  async verify(creds) {
    const token = needToken(creds, SERVICE);
    const info = await post<{ creator_username: string; creator_nickname: string; privacy_level_options: string[]; max_video_post_duration_sec: number; comment_disabled?: boolean }>('/v2/post/publish/creator_info/query/', token, {});
    const warnings: string[] = [];
    if (!info.privacy_level_options.includes('PUBLIC_TO_EVERYONE')) warnings.push('Публичная публикация недоступна: приложение не прошло аудит TikTok или аккаунт приватный. Посты будут видны только автору.');
    return { displayName: `@${info.creator_username}`, externalId: creds.userId ?? info.creator_username, scopes: SCOPES, meta: { username: info.creator_username, privacyOptions: info.privacy_level_options, maxDurationSec: info.max_video_post_duration_sec, nickname: info.creator_nickname }, warnings };
  },
  async publish(account, input) {
    const token = needToken(account.creds, SERVICE);
    const video = input.media.find((m) => m.kind === 'video');
    requireMedia(SERVICE, !!video, 'Фабрика публикует в TikTok только видео');
    const progress = { ...(input.progress as { publishId?: string; uploaded?: boolean }) };
    let publishId = progress.publishId;
    let privacy = (account.meta.privacy as string) || '';
    if (!publishId) {
      // Required before every post: fresh creator info and privacy options.
      const info = await post<{ privacy_level_options: string[]; max_video_post_duration_sec: number }>('/v2/post/publish/creator_info/query/', token, {});
      if (!info.privacy_level_options.includes(privacy)) privacy = info.privacy_level_options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : info.privacy_level_options.includes('SELF_ONLY') ? 'SELF_ONLY' : info.privacy_level_options[0]!;
      if (video!.durationMs && video!.durationMs / 1000 > info.max_video_post_duration_sec) throw new ExternalError(SERVICE, 'too_long', `Ролик длиннее разрешённых для аккаунта ${info.max_video_post_duration_sec} с`, false);
      const { chunkSize, total } = chunkPlan(video!.bytes);
      const init = await post<{ publish_id: string; upload_url: string }>('/v2/post/publish/video/init/', token, {
        post_info: { title: input.text.slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000, is_aigc: true },
        source_info: { source: 'FILE_UPLOAD', video_size: video!.bytes, chunk_size: chunkSize, total_chunk_count: total },
      });
      publishId = init.publish_id;
      const buf = fs.readFileSync(video!.path);
      for (let i = 0; i < total; i++) {
        const start = i * chunkSize;
        const end = i === total - 1 ? buf.length - 1 : start + chunkSize - 1;
        const res = await xfetch(init.upload_url, { service: SERVICE, timeoutMs: 600_000, method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': String(end - start + 1) }, body: buf.subarray(start, end + 1) });
        if (!res.ok && res.status !== 201 && res.status !== 206) throw new ExternalError(SERVICE, 'upload_failed', `TikTok не принял часть файла (HTTP ${res.status})`, res.status >= 500);
      }
      await input.saveProgress({ publishId, privacy });
    }
    for (let i = 0; i < 40; i++) {
      const st = await post<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>('/v2/post/publish/status/fetch/', token, { publish_id: publishId });
      if (st.status === 'PUBLISH_COMPLETE') {
        const pid = st.publicaly_available_post_id?.[0];
        return { externalId: pid ? String(pid) : publishId!, url: pid && account.meta.username ? `https://www.tiktok.com/@${account.meta.username}/video/${pid}` : null, meta: { publishId, privacy, visibleOnlyToAuthor: privacy === 'SELF_ONLY' } };
      }
      if (st.status === 'FAILED') throw new ExternalError(SERVICE, 'publish_failed', `TikTok отклонил публикацию: ${st.fail_reason ?? 'причина не указана'}`, false);
      await sleep(Math.min(15_000, 3000 + i * 1000));
    }
    throw new ExternalError(SERVICE, 'processing', 'TikTok ещё обрабатывает видео — статус проверим при следующей попытке', true, 120);
  },
};
