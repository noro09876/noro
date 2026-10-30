import type { Settings } from '../settings.ts';

export class LlmError extends Error {}

export interface Llm {
  id: string;
  model: string;
  chatJson(system: string, user: string, schema: object): Promise<unknown>;
}

/** Local / LAN addresses are free. Anything else may be a paid cloud API and needs explicit permission. */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return (
      h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === 'host.docker.internal' || h === 'ollama' ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local')
    );
  } catch {
    return false;
  }
}

/** Pulls the first JSON object out of a model answer (models sometimes wrap JSON in prose or ``` fences). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new LlmError('Модель вернула не JSON');
  }
}

async function post(url: string, body: unknown, timeoutMs: number, headers: Record<string, string>, fetchImpl: typeof fetch) {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    if (err.name === 'TimeoutError') throw new LlmError(`Модель не ответила за ${Math.round(timeoutMs / 1000)} с`);
    throw new LlmError(`Сервер модели недоступен (${err.cause?.code ?? err.name ?? 'сеть'}) — запущен ли он?`);
  }
  const text = await res.text();
  if (!res.ok) throw new LlmError(`Сервер модели ответил ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export function createLlm(s: Settings['ai'], apiKey: string | null, fetchImpl: typeof fetch = fetch): Llm | null {
  if (s.provider === 'offline' || !s.model) return null;
  if (!isLocalUrl(s.baseUrl) && !s.allowRemote) {
    throw new LlmError('Адрес модели не локальный. Внешние API могут быть платными — разрешите их явно в настройках');
  }
  const base = s.baseUrl.replace(/\/$/, '');
  if (s.provider === 'ollama') {
    return {
      id: 'ollama',
      model: s.model,
      async chatJson(system, user, schema) {
        const data = await post(`${base}/api/chat`, {
          model: s.model, stream: false, format: schema, options: { temperature: s.temperature, num_ctx: 8192 },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }, s.timeoutMs, {}, fetchImpl);
        const content = (data.message as { content?: string } | undefined)?.content;
        if (!content) throw new LlmError('Пустой ответ модели');
        return extractJson(content);
      },
    };
  }
  return {
    id: 'openai',
    model: s.model,
    async chatJson(system, user) {
      const data = await post(`${base}/chat/completions`, {
        model: s.model, temperature: s.temperature, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }, s.timeoutMs, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, fetchImpl);
      const content = (data.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content;
      if (!content) throw new LlmError('Пустой ответ модели');
      return extractJson(content);
    },
  };
}

/** Lists models available on the configured server (Ollama /api/tags or OpenAI-compatible /models). */
export async function listModels(s: Settings['ai'], apiKey: string | null, fetchImpl: typeof fetch = fetch): Promise<{ name: string; size: number | null }[]> {
  if (s.provider === 'offline') return [];
  if (!isLocalUrl(s.baseUrl) && !s.allowRemote) throw new LlmError('Внешний адрес не разрешён в настройках');
  const base = s.baseUrl.replace(/\/$/, '');
  const url = s.provider === 'ollama' ? `${base}/api/tags` : `${base}/models`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: apiKey && s.provider === 'openai' ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new LlmError(`Сервер модели недоступен по адресу ${base} (${(e as { cause?: { code?: string } }).cause?.code ?? 'нет соединения'})`);
  }
  if (!res.ok) throw new LlmError(`Сервер модели ответил ${res.status}`);
  const data = (await res.json()) as { models?: { name: string; size?: number }[]; data?: { id: string }[] };
  if (data.models) return data.models.map((m) => ({ name: m.name, size: m.size ?? null }));
  return (data.data ?? []).map((m) => ({ name: m.id, size: null }));
}
