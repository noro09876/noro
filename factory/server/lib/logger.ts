import pino from 'pino';
import { config } from '../config';

/** Structured JSON logs. Known secret-bearing fields are redacted at the source. */
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      '*.token', '*.accessToken', '*.refreshToken', '*.apiKey', '*.password', '*.secret',
      'req.headers.authorization', 'req.headers.cookie', '*.headers.Authorization', '*.headers.authorization',
    ],
    censor: '[скрыто]',
  },
  transport: !config.isProd && !config.isTest ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined,
});

/** Removes anything that looks like a credential from free text (API error bodies, URLs). */
export function scrub(text: string): string {
  return text
    .replace(/(bot)\d{6,}:[A-Za-z0-9_-]{20,}/g, '$1[скрыто]')
    .replace(/(access_token|refresh_token|client_secret|api_key|key)=([^&\s"]+)/gi, '$1=[скрыто]')
    .replace(/(Bearer|OAuth|Api-Key)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [скрыто]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[скрыто]');
}
