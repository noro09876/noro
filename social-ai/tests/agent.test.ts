import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { anglesAnswer, carouselAnswer, MockApis } from './mock-apis.ts';
import { servicesFor, TG_TOKEN, tempDir, useOllama } from './helpers.ts';
import type { Services } from '../server/app.ts';

let mock: MockApis;
const open: Services[] = [];
beforeAll(async () => {
  mock = await new MockApis().start();
});
afterAll(async () => {
  await mock.stop();
});
afterEach(() => {
  mock.reset();
  mock.ollamaAnswer = () => ({});
  for (const s of open.splice(0)) {
    s.scheduler.stop();
    s.db.close();
  }
});

let n = 0;
function smartOllama(body: Record<string, unknown>) {
  const user = (body.messages as { content: string }[])[1].content;
  if (user.startsWith('Составь контент-план')) return anglesAnswer(body);
  const a = carouselAnswer((++n % 2) + 1);
  if (user.includes('Формат: пост') || user.includes('Формат: статья')) return { ...a, slides: [], body: `${a.body}\n\n${'Дополнительный абзац с практическим советом номер '.concat(String(n))}.` };
  return a;
}

async function withTelegram(s: Services) {
  const a = s.accounts.create({ brandId: s.agent.brandId(), platform: 'telegram', name: 'TG', credentials: { botToken: TG_TOKEN }, config: { chatId: '@noro_test' } });
  await s.accounts.check(a.id);
  return a;
}

describe('agent', () => {
  it('plans N days with rotating topics and formats, using model ideas', async () => {
    const s = servicesFor(mock, tempDir());
    open.push(s);
    useOllama(s, mock);
    mock.ollamaAnswer = smartOllama;
    s.settings.update({ agent: { planDays: 5, postsPerDay: 2, postTimes: ['09:00', '19:00'], formats: ['carousel', 'post'] } });
    const items = await s.agent.plan();
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < items.length; i++) expect(items[i].topic).not.toBe(items[i - 1].topic);
    expect(new Set(items.map((i) => i.format)).size).toBe(2);
    expect(items[0].angle).toMatch(/Идея \d/);
    // idempotent: a second call does not duplicate slots
    expect(await s.agent.plan()).toHaveLength(0);
  });

  it('runs the full autonomous loop: plan → generate → check → schedule → publish', async () => {
    const s = servicesFor(mock, tempDir());
    open.push(s);
    useOllama(s, mock);
    mock.ollamaAnswer = smartOllama;
    const acc = await withTelegram(s);
    s.settings.update({ agent: { enabled: true, autoApprove: true, planDays: 3, postsPerDay: 1, formats: ['carousel'], platforms: ['telegram'], leadHours: 96 } });
    const r = await s.agent.cycle(true);
    expect(r.summary).toMatch(/создан/);
    const generated = s.db.all<{ id: number; status: string; model: string }>("SELECT id, status, model FROM content WHERE source = 'agent'");
    expect(generated.length).toBe(2); // two items per cycle at most
    expect(generated.every((g) => g.status === 'scheduled' && g.model === 'ollama:qwen2.5:7b')).toBe(true);
    const pubs = s.db.all<{ id: number; account_id: number; scheduled_at: string }>('SELECT * FROM publications');
    expect(pubs).toHaveLength(2);
    expect(pubs.every((p) => p.account_id === acc.id)).toBe(true);
    // time passes: publications become due and the scheduler publishes them
    s.db.run('UPDATE publications SET scheduled_at = ?', new Date(Date.now() - 1000).toISOString());
    await s.scheduler.tick();
    const statuses = s.db.all<{ status: string }>('SELECT status FROM publications').map((x) => x.status);
    expect(statuses).toEqual(['published', 'published']);
    expect(mock.count('sendMediaGroup')).toBe(2);
  });

  it('without auto-approval leaves drafts waiting for the user', async () => {
    const s = servicesFor(mock, tempDir());
    open.push(s);
    useOllama(s, mock);
    mock.ollamaAnswer = smartOllama;
    await withTelegram(s);
    s.settings.update({ agent: { enabled: true, autoApprove: false, planDays: 2, formats: ['post'], leadHours: 72 } });
    await s.agent.cycle(true);
    expect(s.db.all("SELECT * FROM content WHERE status = 'draft' AND source = 'agent'").length).toBeGreaterThan(0);
    expect(s.db.all('SELECT * FROM publications')).toHaveLength(0);
  });

  it('asks the model to fix validation errors once, then stops', async () => {
    const s = servicesFor(mock, tempDir());
    open.push(s);
    useOllama(s, mock);
    let calls = 0;
    mock.ollamaAnswer = (body) => {
      const user = (body.messages as { content: string }[])[1].content;
      if (user.startsWith('Составь')) return anglesAnswer(body);
      calls++;
      const a = carouselAnswer(10 + calls);
      // first answer has a placeholder, the fix-up answer is clean
      return user.includes('не прошла проверку') ? a : { ...a, body: `${a.body} [вставьте ссылку]` };
    };
    const c = await s.agent.generate({ brandId: 1, topic: 'ИИ-агенты', angle: 'тест', format: 'carousel', platforms: ['telegram'], manual: true });
    expect(calls).toBe(2);
    expect(c.review!.errors).toEqual([]);
    expect(c.generationCount).toBe(2);
  });

  it('pauses itself after repeated model failures (circuit breaker)', async () => {
    const s = servicesFor(mock, tempDir());
    open.push(s);
    useOllama(s, mock);
    mock.on('/ollama/api/chat', () => ({ status: 500, json: { error: 'model not found' } }));
    s.settings.update({ agent: { enabled: true, planDays: 7, leadHours: 168, maxConsecutiveFailures: 3, maxAttemptsPerItem: 5 } });
    for (let i = 0; i < 4; i++) {
      s.db.run("UPDATE settings SET value = json_set(value, '$.lastCycleAt', NULL) WHERE key = 'state:agent'");
      await s.agent.cycle();
    }
    expect(s.agent.state().pausedReason).toMatch(/3 ошибок подряд/);
    const before = mock.count('/ollama/api/chat');
    await s.agent.cycle();
    expect(mock.count('/ollama/api/chat')).toBe(before); // paused: no more calls
    s.agent.resume();
    expect(s.agent.state().pausedReason).toBeNull();
  });

  it('respects the daily generation limit', async () => {
    const s = servicesFor(mock, tempDir());
    open.push(s);
    useOllama(s, mock);
    mock.ollamaAnswer = smartOllama;
    s.settings.update({ agent: { maxGenerationsPerDay: 2 } });
    await s.agent.generate({ brandId: 1, topic: 'ИИ', angle: 'a', format: 'carousel', platforms: ['telegram'], manual: true });
    await s.agent.generate({ brandId: 1, topic: 'ИИ', angle: 'b', format: 'carousel', platforms: ['telegram'], manual: true });
    await expect(s.agent.generate({ brandId: 1, topic: 'ИИ', angle: 'c', format: 'carousel', platforms: ['telegram'], manual: true })).rejects.toThrow(/дневной лимит/);
  });

  it('without a model creates a draft that cannot pass checks (never auto-published)', async () => {
    const s = servicesFor(mock, tempDir());
    open.push(s);
    s.settings.update({ ai: { provider: 'offline' }, agent: { autoApprove: true } });
    const c = await s.agent.generate({ brandId: 1, topic: 'ИИ', angle: 'Чек-лист', format: 'carousel', platforms: ['telegram'] });
    expect(c.model).toBeNull();
    expect(c.review!.errors.join(' ')).toMatch(/заглушка/);
  });

  it('refuses a non-local model URL unless explicitly allowed (possible paid API)', async () => {
    const s = servicesFor(mock, tempDir());
    open.push(s);
    s.settings.update({ ai: { provider: 'openai', baseUrl: 'https://api.example.com/v1', model: 'gpt' } });
    expect(() => s.agent.llm()).toThrow(/платными/);
  });
});

describe('restart', () => {
  it('keeps schedule and settings after a restart and publishes due posts', async () => {
    const dir = tempDir();
    const s1 = servicesFor(mock, dir);
    const acc = await withTelegram(s1);
    s1.settings.update({ agent: { postsPerDay: 2 } });
    const c = s1.content.create({ brandId: 1, title: 'Пост после перезапуска', body: 'Текст поста, который должен выйти после перезапуска сервера.', format: 'post' });
    s1.agent.review(c.id);
    s1.content.update(c.id, { status: 'ready' });
    s1.publisher.schedule(c.id, [acc.id], new Date(Date.now() + 500));
    s1.db.close();

    await new Promise((r) => setTimeout(r, 600));
    const s2 = servicesFor(mock, dir);
    open.push(s2);
    expect(s2.settings.get().agent.postsPerDay).toBe(2);
    expect(s2.accounts.credentials(acc.id)!.botToken).toBe(TG_TOKEN); // same master key decrypts
    await s2.scheduler.tick();
    expect(s2.db.get<{ status: string }>('SELECT status FROM publications')!.status).toBe('published');
  });
});
