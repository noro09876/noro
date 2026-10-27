import { ExternalError } from '../../lib/errors';
import { httpError, readJson, xfetch } from '../../lib/http';
import type { ImageProvider } from '../types';

/**
 * OpenAI image generation. Optional: the factory's own layout engine renders
 * carousels and graphics without any image model. This provider adds AI-made
 * background illustrations when a key is configured.
 */
export const openaiImage: ImageProvider = {
  info: {
    id: 'openai_image',
    kind: 'image',
    name: 'OpenAI Images',
    setup: 'Нужен API-ключ OpenAI. Для моделей gpt-image организация должна пройти верификацию в настройках OpenAI.',
    docsUrl: 'https://platform.openai.com/docs/api-reference/images/create',
    defaultModel: 'gpt-image-1',
    needsKey: true,
    fields: [{ key: 'apiKey', label: 'API-ключ', secret: true, required: true }],
  },
  async check(rt) {
    const res = await xfetch('https://api.openai.com/v1/models', { service: 'OpenAI', timeoutMs: 15_000, headers: { authorization: `Bearer ${rt.apiKey}` } });
    if (res.status === 401) throw new ExternalError('OpenAI', 'auth', 'Ключ OpenAI недействителен', false, undefined, 401);
    if (!res.ok) throw httpError('OpenAI', res, `OpenAI: HTTP ${res.status}`);
    return 'Ключ работает';
  },
  async generate(rt, req) {
    if (!rt.apiKey) throw new ExternalError('OpenAI Images', 'no_key', 'Не задан API-ключ OpenAI', false);
    const res = await xfetch('https://api.openai.com/v1/images/generations', {
      service: 'OpenAI Images',
      timeoutMs: 180_000,
      method: 'POST',
      headers: { authorization: `Bearer ${rt.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: rt.model, prompt: req.prompt, size: req.size, n: 1 }),
    });
    const body = await readJson<{ data?: { b64_json?: string }[]; error?: { message?: string; code?: string } }>(res);
    if (!res.ok) {
      if (body?.error?.code === 'moderation_blocked') throw new ExternalError('OpenAI Images', 'moderation', 'Запрос отклонён модерацией OpenAI', false);
      throw httpError('OpenAI Images', res, `OpenAI Images: ${body?.error?.message ?? res.statusText}`);
    }
    const b64 = body?.data?.[0]?.b64_json;
    if (!b64) throw new ExternalError('OpenAI Images', 'empty', 'OpenAI не вернул изображение', true);
    return { data: Buffer.from(b64, 'base64'), mime: 'image/png', model: rt.model };
  },
};
