import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import { ExternalError } from '../../lib/errors';
import { scrub } from '../../lib/logger';
import type { LlmProvider, ProviderRuntime } from '../types';
import { parseModelJson } from './json';

const SERVICE = 'Anthropic';

function client(rt: ProviderRuntime) {
  if (!rt.apiKey) throw new ExternalError(SERVICE, 'no_key', 'Не задан API-ключ Anthropic', false);
  return new Anthropic({ apiKey: rt.apiKey, maxRetries: 2, timeout: 180_000, baseURL: rt.settings.baseUrl || undefined });
}

function mapError(e: unknown): never {
  if (e instanceof Anthropic.AuthenticationError) throw new ExternalError(SERVICE, 'auth', 'Ключ Anthropic недействителен', false, undefined, 401);
  if (e instanceof Anthropic.PermissionDeniedError) throw new ExternalError(SERVICE, 'permission', 'У ключа нет доступа к выбранной модели', false, undefined, 403);
  if (e instanceof Anthropic.NotFoundError) throw new ExternalError(SERVICE, 'model_not_found', 'Модель не найдена — проверьте название модели', false, undefined, 404);
  if (e instanceof Anthropic.RateLimitError) throw new ExternalError(SERVICE, 'rate_limit', 'Anthropic ограничил частоту запросов', true, 30, 429);
  if (e instanceof Anthropic.BadRequestError) throw new ExternalError(SERVICE, 'bad_request', `Anthropic отклонил запрос: ${scrub(e.message)}`, false, undefined, 400);
  if (e instanceof Anthropic.APIConnectionError) throw new ExternalError(SERVICE, 'network', 'Нет соединения с Anthropic API', true);
  if (e instanceof Anthropic.APIError) throw new ExternalError(SERVICE, `http_${e.status}`, `Ошибка Anthropic ${e.status ?? ''}`.trim(), (e.status ?? 500) >= 500);
  throw e;
}

export const anthropicLlm: LlmProvider = {
  info: {
    id: 'anthropic',
    kind: 'llm',
    name: 'Anthropic Claude',
    setup: 'Создайте ключ в Claude Console (platform.claude.com → API Keys). Подписка Claude Pro/Max не даёт доступа к API — нужен отдельный ключ с оплатой по токенам.',
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    needsKey: true,
    fields: [
      { key: 'apiKey', label: 'API-ключ', placeholder: 'sk-ant-…', secret: true, required: true },
      { key: 'effort', label: 'Глубина рассуждений (effort)', placeholder: 'medium', help: 'low / medium / high — выше качество, дольше и дороже' },
    ],
    pricing: 'Opus 5.5: $4 / $20 за 1M токенов; Sonnet 5.5: $2 / $10; Haiku 5.5: $0.10 / $0.50',
  },

  async generate(rt, req) {
    const c = client(rt);
    const effort = (['low', 'medium', 'high'].includes(rt.settings.effort ?? '') ? rt.settings.effort : 'medium') as 'low' | 'medium' | 'high';
    let msg: Anthropic.Beta.BetaMessage;
    try {
      const stream = c.beta.messages.stream({
        model: rt.model,
        max_tokens: req.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort, // Constraints the API does not enforce are moved into descriptions; zod re-validates below.
          format: { type: 'json_schema', schema: transformJSONSchema(req.jsonSchema) } },
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
      });
      msg = await stream.finalMessage();
    } catch (e) {
      mapError(e);
    }
    if (msg.stop_reason === 'refusal') throw new ExternalError(SERVICE, 'refusal', 'Модель отказалась выполнять запрос. Измените формулировку задачи.', false);
    if (msg.stop_reason === 'max_tokens') throw new ExternalError(SERVICE, 'truncated', 'Ответ модели обрезан по лимиту токенов', true);
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const data = parseModelJson(text, req.schema, SERVICE);
    return { data, model: msg.model, usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens } };
  },

  async check(rt) {
    const c = client(rt);
    try {
      const m = await c.models.retrieve(rt.model);
      return `Ключ работает, модель ${m.display_name ?? m.id} доступна`;
    } catch (e) {
      mapError(e);
    }
  },
};
