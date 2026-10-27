import { ExternalError } from '../../lib/errors';
import { httpError, readJson, xfetch } from '../../lib/http';
import type { LlmProvider, ProviderRuntime } from '../types';
import { parseModelJson } from './json';

/**
 * OpenAI Chat Completions with JSON-schema constrained output. The same adapter
 * serves any OpenAI-compatible endpoint (OpenRouter, a local Ollama or LM Studio, vLLM)
 * through the `openai_compatible` provider with a custom base URL.
 */

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
}

function make(id: 'openai' | 'openai_compatible'): LlmProvider {
  const service = id === 'openai' ? 'OpenAI' : 'OpenAI-совместимый API';
  const base = (rt: ProviderRuntime) => (id === 'openai' ? 'https://api.openai.com/v1' : (rt.settings.baseUrl || '').replace(/\/$/, ''));

  function headers(rt: ProviderRuntime): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (rt.apiKey) h.authorization = `Bearer ${rt.apiKey}`;
    return h;
  }

  return {
    info:
      id === 'openai'
        ? {
            id,
            kind: 'llm',
            name: 'OpenAI',
            setup: 'Ключ создаётся на platform.openai.com → API keys. Подписка ChatGPT Plus не включает доступ к API.',
            docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
            defaultModel: 'gpt-5.1',
            needsKey: true,
            fields: [{ key: 'apiKey', label: 'API-ключ', placeholder: 'sk-…', secret: true, required: true }],
          }
        : {
            id,
            kind: 'llm',
            name: 'OpenAI-совместимый (Ollama, LM Studio, OpenRouter, vLLM)',
            setup: 'Укажите базовый адрес API, например http://localhost:11434/v1 для Ollama или https://openrouter.ai/api/v1. Ключ нужен, если его требует сервер.',
            defaultModel: 'qwen3:14b',
            needsKey: false,
            local: true,
            fields: [
              { key: 'baseUrl', label: 'Базовый URL', placeholder: 'http://localhost:11434/v1', required: true },
              { key: 'apiKey', label: 'API-ключ (если нужен)', secret: true },
            ],
          },

    async generate(rt, req) {
      if (id === 'openai' && !rt.apiKey) throw new ExternalError(service, 'no_key', 'Не задан API-ключ OpenAI', false);
      if (!base(rt)) throw new ExternalError(service, 'no_url', 'Не задан базовый URL', false);
      const res = await xfetch(`${base(rt)}/chat/completions`, {
        service,
        timeoutMs: 180_000,
        method: 'POST',
        headers: headers(rt),
        body: JSON.stringify({
          model: rt.model,
          max_completion_tokens: req.maxTokens ?? 12000,
          response_format: { type: 'json_schema', json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: false } },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
        }),
      });
      const body = await readJson<ChatResponse>(res);
      if (!res.ok) {
        if (res.status === 401) throw new ExternalError(service, 'auth', 'Ключ недействителен', false, undefined, 401);
        throw httpError(service, res, `${service}: ${body?.error?.message ?? res.statusText}`);
      }
      const choice = body?.choices?.[0];
      if (choice?.message?.refusal) throw new ExternalError(service, 'refusal', 'Модель отказалась выполнять запрос', false);
      if (choice?.finish_reason === 'length') throw new ExternalError(service, 'truncated', 'Ответ обрезан по лимиту токенов', true);
      const data = parseModelJson(choice?.message?.content ?? '', req.schema, service);
      return { data, model: body?.model ?? rt.model, usage: { inputTokens: body?.usage?.prompt_tokens, outputTokens: body?.usage?.completion_tokens } };
    },

    async check(rt) {
      const res = await xfetch(`${base(rt)}/models`, { service, timeoutMs: 15_000, headers: headers(rt) });
      if (res.status === 401) throw new ExternalError(service, 'auth', 'Ключ недействителен', false, undefined, 401);
      if (!res.ok) throw httpError(service, res, `${service}: HTTP ${res.status}`);
      const body = await readJson<{ data?: { id: string }[] }>(res);
      const ids = body?.data?.map((m) => m.id) ?? [];
      if (ids.length && !ids.includes(rt.model)) return `Подключение работает, но модели ${rt.model} нет в списке (${ids.slice(0, 5).join(', ')}…)`;
      return `Подключение работает, модель ${rt.model} доступна`;
    },
  };
}

export const openaiLlm = make('openai');
export const openaiCompatibleLlm = make('openai_compatible');
