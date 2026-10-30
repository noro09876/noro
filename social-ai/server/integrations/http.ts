import { IntegrationError } from './types.ts';

const SAFE_NETWORK = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  timeoutMs?: number;
  /** When true, a timeout or dropped connection is reported as "ambiguous" (the post may already exist). */
  commit?: boolean;
  fetch: typeof fetch;
}

/**
 * fetch with timeout and error classification. Never puts the URL into error messages
 * (Telegram keeps the token in the path).
 */
export async function request(url: string, opts: RequestOpts): Promise<{ status: number; data: unknown; headers: Headers }> {
  let res: Response;
  try {
    res = await opts.fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body ?? undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
    });
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    const code = err.cause?.code ?? err.name ?? 'NETWORK';
    if (SAFE_NETWORK.has(code)) throw new IntegrationError('transient', `Сервер площадки недоступен (${code})`, { code });
    if (opts.commit) {
      throw new IntegrationError('ambiguous', `Соединение прервано во время публикации (${code}). Пост мог выйти — проверьте вручную`, { code });
    }
    throw new IntegrationError('transient', `Сетевая ошибка (${code})`, { code });
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, data, headers: res.headers };
}

export function retryAfter(headers: Headers, fallback = 60): number {
  const h = headers.get('retry-after');
  const n = h ? Number(h) : NaN;
  if (Number.isFinite(n)) return n;
  const reset = headers.get('x-rate-limit-reset');
  if (reset) return Math.max(5, Number(reset) - Math.floor(Date.now() / 1000));
  return fallback;
}
