export class TimeoutError extends Error {
  constructor() {
    super('Сервис не ответил вовремя');
    this.name = 'TimeoutError';
  }
}

/** fetch with a hard timeout so optional integrations never hang the UI. */
export async function fetchWithTimeout(input: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const outer = init.signal;
  if (outer) outer.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted && !outer?.aborted) throw new TimeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
