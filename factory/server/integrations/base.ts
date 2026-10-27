import fs from 'node:fs';
import { ExternalError } from '../lib/errors';

/**
 * API base URLs. Tests point adapters at a local fake server through
 * NORO_API_BASE_<PLATFORM>; production always uses the official hosts.
 */
export function apiBase(platform: string, official: string): string {
  const override = process.env[`NORO_API_BASE_${platform.toUpperCase()}`];
  return (override || official).replace(/\/$/, '');
}

export function fileBlob(path: string, mime: string): Blob {
  return new Blob([fs.readFileSync(path)], { type: mime });
}

export function needToken(creds: { accessToken?: string }, service: string): string {
  if (!creds.accessToken) throw new ExternalError(service, 'not_connected', `${service}: аккаунт не авторизован — подключите его заново`, false);
  return creds.accessToken;
}

export function requireMedia(service: string, ok: boolean, message: string) {
  if (!ok) throw new ExternalError(service, 'unsupported_media', message, false);
}

export function requirePublicUrl(service: string, url: string | null): string {
  if (!url) {
    throw new ExternalError(
      service,
      'no_public_url',
      `${service} скачивает медиа по публичной HTTPS-ссылке. Укажите PUBLIC_URL с HTTPS-доменом приложения или настройте S3 с S3_PUBLIC_BASE_URL.`,
      false,
    );
  }
  return url;
}
