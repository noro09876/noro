import { ExternalError } from './errors';
import { scrub } from './logger';

export interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  service: string;
}

/**
 * fetch with a hard timeout and normalised network errors. Never logs request bodies.
 * Callers interpret HTTP statuses themselves (each API has its own error envelope).
 */
export async function xfetch(url: string, opts: FetchOpts): Promise<Response> {
  const { timeoutMs = 30_000, service, ...init } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    const err = e as Error;
    const timedOut = err.name === 'AbortError';
    throw new ExternalError(service, timedOut ? 'timeout' : 'network', timedOut ? `${service}: превышено время ожидания (${Math.round(timeoutMs / 1000)} с)` : `${service}: сетевая ошибка — ${scrub(err.message)}`, true);
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Maps generic HTTP statuses to retryable/non-retryable errors. */
export function httpError(service: string, res: Response, message: string, code?: string): ExternalError {
  const ra = Number(res.headers.get('retry-after'));
  const retryable = res.status === 429 || res.status >= 500;
  return new ExternalError(service, code ?? `http_${res.status}`, scrub(message), retryable, Number.isFinite(ra) && ra > 0 ? ra : undefined, res.status);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
