let csrf: string | null = null;

export function setCsrf(token: string | null) {
  csrf = token;
}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown> | null;
  constructor(status: number, message: string, data: Record<string, unknown> | null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let onUnauthorized: (() => void) | null = null;
export function handleUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Сервер NORO недоступен. Проверьте, что он запущен', null);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();
    const d = data as Record<string, unknown> | null;
    throw new ApiError(res.status, (d?.error as string) ?? `Ошибка ${res.status}`, d);
  }
  return data as T;
}

export const get = <T>(p: string) => api<T>(p);
export const post = <T>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const del = <T>(p: string) => api<T>(p, { method: 'DELETE' });
