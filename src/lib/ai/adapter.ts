import { fetchWithTimeout } from '../net';

/**
 * Pluggable model adapter.
 *
 * Every product works with a local, deterministic engine by default.
 * A remote language model is only used when BOTH are true:
 *  1. the site owner deployed the `/api/ai` Netlify Function with a provider key
 *     (server-side env var, never in the browser bundle), and
 *  2. the visitor explicitly enabled it in the product UI.
 */
export type AiTask = 'support-answer';

export interface AiRequest {
  task: AiTask;
  /** Instructions configured by the user (tone, rules). */
  instructions: string;
  /** The user input (question, source text…). */
  input: string;
  /** Grounding passages; the model must answer only from them. */
  context?: string[];
}

export interface AiStatus {
  available: boolean;
  provider?: string;
  reason: string;
}

let cachedStatus: Promise<AiStatus> | null = null;

export function getAiStatus(force = false): Promise<AiStatus> {
  if (cachedStatus && !force) return cachedStatus;
  cachedStatus = (async () => {
    try {
      const res = await fetchWithTimeout('/api/ai/status', { headers: { accept: 'application/json' } }, 4000);
      if (!res.ok) return { available: false, reason: 'Серверная функция ИИ не развёрнута на этом сайте.' };
      const data = (await res.json()) as Partial<AiStatus>;
      return {
        available: Boolean(data.available),
        provider: data.provider,
        reason: data.reason ?? (data.available ? 'Модель подключена через сервер.' : 'Ключ провайдера не настроен на сервере.'),
      };
    } catch {
      return { available: false, reason: 'Серверная функция ИИ недоступна (локальный режим или нет сети).' };
    }
  })();
  return cachedStatus;
}

export async function generateRemote(req: AiRequest, signal?: AbortSignal): Promise<string> {
  const res = await fetchWithTimeout(
    '/api/ai',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal },
    45000,
  );
  if (!res.ok) {
    let message = `Модель вернула ошибку ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const data = (await res.json()) as { text?: string };
  if (!data.text) throw new Error('Модель вернула пустой ответ');
  return data.text;
}
