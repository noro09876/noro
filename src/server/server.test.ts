import { describe, expect, it, vi } from 'vitest';
import { handleLead } from './lead';
import { buildPrompt, handleAi, parseAiPayload } from './ai';

const goodLead = { name: 'Анна', contact: '@anna_test', task: 'Нужна обработка заявок с сайта', consent: true, product: 'support', website: '' };
const post = (url: string, body: unknown) => new Request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('lead function', () => {
  it('returns 503 when no delivery channel is configured', async () => {
    const res = await handleLead(post('https://x/api/lead', goodLead), {});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
  });
  it('validates input and rejects bad JSON', async () => {
    expect((await handleLead(post('https://x/api/lead', '{bad'), {})).status).toBe(400);
    const res = await handleLead(post('https://x/api/lead', { ...goodLead, name: '' }), { LEAD_WEBHOOK_URL: 'https://hook' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { fields: Record<string, string> }).fields.name).toBeTruthy();
    expect((await handleLead(new Request('https://x/api/lead'), {})).status).toBe(405);
  });
  it('drops honeypot submissions silently', async () => {
    const f = vi.fn();
    const res = await handleLead(post('https://x/api/lead', { ...goodLead, website: 'spam' }), { LEAD_WEBHOOK_URL: 'https://hook' }, f);
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
  it('delivers to Telegram and reports failures honestly', async () => {
    const ok = vi.fn(async () => new Response('{}', { status: 200 }));
    const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' };
    const res = await handleLead(post('https://x/api/lead', goodLead), env, ok);
    expect(res.status).toBe(200);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/bott/sendMessage');
    expect(String(init.body)).toContain('Support');
    const fail = vi.fn(async () => new Response('', { status: 500 }));
    expect((await handleLead(post('https://x/api/lead', goodLead), env, fail)).status).toBe(502);
  });
});

describe('ai function', () => {
  const payload = { task: 'support-answer', instructions: 'Вежливо', input: 'Сколько идёт доставка?', context: ['Доставка: 2–4 дня'] };

  it('reports status without exposing the key', async () => {
    const off = await (await handleAi(new Request('https://x/api/ai/status'), {})).json();
    expect(off).toMatchObject({ available: false });
    const on = await (await handleAi(new Request('https://x/api/ai/status'), { ANTHROPIC_API_KEY: 'sk-secret' })).text();
    expect(on).toContain('"available":true');
    expect(on).not.toContain('sk-secret');
  });
  it('validates payload limits', () => {
    expect(parseAiPayload({ ...payload, task: 'other' })).toBeTypeOf('string');
    expect(parseAiPayload({ ...payload, input: 'x'.repeat(1001) })).toBeTypeOf('string');
    expect(parseAiPayload({ ...payload, context: [] })).toBeTypeOf('string');
    expect(parseAiPayload(payload)).toMatchObject({ input: 'Сколько идёт доставка?' });
  });
  it('wraps sources and question as data', () => {
    const { system, user } = buildPrompt(parseAiPayload(payload) as never);
    expect(system).toContain('Используй только сведения');
    expect(user).toContain('<source id="1">');
    expect(user).toContain('<question>');
  });
  it('returns 503 without a key and calls the model with grounded prompt', async () => {
    expect((await handleAi(post('https://x/api/ai', payload), {})).status).toBe(503);
    const create = vi.fn(async () => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Доставка занимает 2–4 дня.' }] }));
    const res = await handleAi(post('https://x/api/ai', payload), { ANTHROPIC_API_KEY: 'k' }, () => ({ beta: { messages: { create } } }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: 'Доставка занимает 2–4 дня.' });
    const args = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args.model).toBe('claude-opus-5-5');
    expect(args).not.toHaveProperty('thinking');
    expect(args).not.toHaveProperty('temperature');
  });
  it('maps refusals to an honest error', async () => {
    const create = vi.fn(async () => ({ stop_reason: 'refusal', model: 'm', content: [] }));
    const res = await handleAi(post('https://x/api/ai', payload), { ANTHROPIC_API_KEY: 'k' }, () => ({ beta: { messages: { create } } }) as never);
    expect(res.status).toBe(422);
  });
});
