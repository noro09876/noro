import { ExternalError } from '../../lib/errors';
import { httpError, readJson, xfetch } from '../../lib/http';
import type { LlmProvider, ProviderRuntime } from '../types';
import { parseModelJson } from './json';

/**
 * YandexGPT via Yandex Cloud Foundation Models (text generation, synchronous mode).
 * Auth: service-account API key (header `Authorization: Api-Key …`) and a folder id.
 */
const SERVICE = 'YandexGPT';
const URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

interface YaResponse {
  result?: { alternatives?: { message?: { text?: string }; status?: string }[]; usage?: { inputTextTokens?: string; completionTokens?: string }; modelVersion?: string };
  error?: { message?: string };
  message?: string;
}

function modelUri(rt: ProviderRuntime) {
  const folder = rt.settings.folderId;
  if (!folder) throw new ExternalError(SERVICE, 'no_folder', 'Не указан идентификатор каталога Yandex Cloud', false);
  return rt.model.startsWith('gpt://') ? rt.model : `gpt://${folder}/${rt.model}`;
}

async function call(rt: ProviderRuntime, system: string, user: string, maxTokens: number, json: boolean) {
  if (!rt.apiKey) throw new ExternalError(SERVICE, 'no_key', 'Не задан API-ключ Yandex Cloud', false);
  const res = await xfetch(URL, {
    service: SERVICE,
    timeoutMs: 120_000,
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Api-Key ${rt.apiKey}`, 'x-folder-id': rt.settings.folderId ?? '' },
    body: JSON.stringify({
      modelUri: modelUri(rt),
      completionOptions: { stream: false, maxTokens: String(maxTokens) },
      ...(json ? { jsonObject: true } : {}),
      messages: [
        { role: 'system', text: system },
        { role: 'user', text: user },
      ],
    }),
  });
  const body = await readJson<YaResponse>(res);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new ExternalError(SERVICE, 'auth', 'Ключ Yandex Cloud недействителен или у сервисного аккаунта нет роли ai.languageModels.user', false, undefined, res.status);
    throw httpError(SERVICE, res, `${SERVICE}: ${body?.error?.message ?? body?.message ?? res.statusText}`);
  }
  return body;
}

export const yandexLlm: LlmProvider = {
  info: {
    id: 'yandexgpt',
    kind: 'llm',
    name: 'YandexGPT (Yandex Cloud)',
    setup: 'В Yandex Cloud создайте сервисный аккаунт с ролью ai.languageModels.user, выпустите для него API-ключ и скопируйте идентификатор каталога.',
    docsUrl: 'https://yandex.cloud/ru/docs/foundation-models/text-generation/api-ref/TextGeneration/completion',
    defaultModel: 'yandexgpt/latest',
    models: ['yandexgpt/latest', 'yandexgpt-lite/latest'],
    needsKey: true,
    fields: [
      { key: 'apiKey', label: 'API-ключ сервисного аккаунта', secret: true, required: true },
      { key: 'folderId', label: 'ID каталога', placeholder: 'b1g…', required: true },
    ],
  },
  async generate(rt, req) {
    const system = `${req.system}\n\nОтвечай строго одним JSON-объектом по этой JSON Schema:\n${JSON.stringify(req.jsonSchema)}`;
    const body = await call(rt, system, req.prompt, req.maxTokens ?? 8000, true);
    const text = body?.result?.alternatives?.[0]?.message?.text ?? '';
    const data = parseModelJson(text, req.schema, SERVICE);
    return {
      data,
      model: `${rt.model}${body?.result?.modelVersion ? ` (${body.result.modelVersion})` : ''}`,
      usage: { inputTokens: Number(body?.result?.usage?.inputTextTokens) || undefined, outputTokens: Number(body?.result?.usage?.completionTokens) || undefined },
    };
  },
  async check(rt) {
    await call(rt, 'Ответь одним словом.', 'Проверка связи', 10, false);
    return 'Ключ работает, модель отвечает';
  },
};
