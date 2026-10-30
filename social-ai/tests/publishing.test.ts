import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MockApis } from './mock-apis.ts';
import { servicesFor, TG_TOKEN, tempDir } from './helpers.ts';
import type { Services } from '../server/app.ts';
import { DEMO_CONTENT } from '../server/demo.ts';

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
  for (const s of open.splice(0)) s.db.close();
});

function setup(extra = {}) {
  const s = servicesFor(mock, tempDir(), extra);
  open.push(s);
  return s;
}

function readyCarousel(s: Services, i = 0) {
  const c = s.content.create({ brandId: s.agent.brandId(), ...DEMO_CONTENT[0], title: `${DEMO_CONTENT[0].title} ${i}`, slides: DEMO_CONTENT[0].slides!.map((sl) => ({ ...sl, title: `${sl.title}` })) });
  const review = s.agent.review(c.id);
  expect(review.errors).toEqual([]);
  s.content.update(c.id, { status: 'ready' });
  return s.content.get(c.id)!;
}

async function telegramAccount(s: Services) {
  const a = s.accounts.create({ brandId: s.agent.brandId(), platform: 'telegram', name: 'TG', credentials: { botToken: TG_TOKEN }, config: { chatId: '@noro_test' } });
  const r = await s.accounts.check(a.id);
  expect(r.ok).toBe(true);
  return s.accounts.get(a.id)!;
}

describe('Telegram', () => {
  it('connects, publishes a carousel as an album and records the message id', async () => {
    const s = setup();
    const acc = await telegramAccount(s);
    expect(acc.status).toBe('connected');
    expect(acc.remoteName).toBe('NORO Test');
    const c = readyCarousel(s);
    const [p] = s.publisher.schedule(c.id, [acc.id], new Date());
    const res = await s.publisher.publishOne(p.id);
    expect(res.status).toBe('published');
    expect(res.externalUrl).toMatch(/^https:\/\/t\.me\/noro_test\/\d+$/);
    expect(mock.count('sendMediaGroup')).toBe(1);
    expect(s.content.get(c.id)!.status).toBe('published');
    // the album carried 7 JPEG files
    const body = mock.calls.find((x) => x.path.endsWith('sendMediaGroup'))!.body;
    expect((body.match(/image\/jpeg/g) ?? []).length).toBe(7);
  });

  it('refuses to publish the same material twice to the same account', async () => {
    const s = setup();
    const acc = await telegramAccount(s);
    const c = readyCarousel(s);
    const [p] = s.publisher.schedule(c.id, [acc.id], new Date());
    await s.publisher.publishOne(p.id);
    expect(() => s.publisher.schedule(c.id, [acc.id], new Date())).toThrow(/повторная публикация запрещена/);
    // A second publishOne on an already published row does nothing
    await s.publisher.publishOne(p.id);
    expect(mock.count('sendMediaGroup')).toBe(1);
  });

  it('blocks a near-duplicate of an already published material', async () => {
    const s = setup();
    const acc = await telegramAccount(s);
    const c1 = readyCarousel(s, 1);
    await s.publisher.publishOne(s.publisher.schedule(c1.id, [acc.id], new Date())[0].id);
    const c2 = readyCarousel(s, 1);
    const res = await s.publisher.publishOne(s.publisher.schedule(c2.id, [acc.id], new Date())[0].id);
    expect(res.status).toBe('blocked');
    expect(res.lastError).toMatch(/повтор/i);
    expect(mock.count('sendMediaGroup')).toBe(1);
  });

  it('retries after 429 with the platform pause and then succeeds', async () => {
    const s = setup();
    const acc = await telegramAccount(s);
    const c = readyCarousel(s);
    mock.on('sendMediaGroup', () => ({ status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } } }), 1);
    const [p] = s.publisher.schedule(c.id, [acc.id], new Date());
    const first = await s.publisher.publishOne(p.id);
    expect(first.status).toBe('retrying');
    expect(Date.parse(first.nextAttemptAt!) - Date.now()).toBeGreaterThan(50_000); // max(retry_after, 60s backoff)
    expect(s.publisher.dueIds()).not.toContain(p.id);
    s.db.run('UPDATE publications SET next_attempt_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), p.id);
    await s.publisher.processDue();
    expect(s.publisher.get(p.id)!.status).toBe('published');
    expect(s.publisher.get(p.id)!.attempts).toBe(2);
  });

  it('stops retrying after the attempt limit — no infinite loops', async () => {
    const s = setup();
    s.settings.update({ limits: { maxPublishAttempts: 3 } });
    const acc = await telegramAccount(s);
    const c = readyCarousel(s);
    mock.on('sendMediaGroup', () => ({ status: 502, json: { ok: false, description: 'Bad Gateway' } }));
    const [p] = s.publisher.schedule(c.id, [acc.id], new Date());
    for (let i = 0; i < 6; i++) {
      s.db.run('UPDATE publications SET next_attempt_at = ? WHERE id = ? AND status = ?', new Date(Date.now() - 1000).toISOString(), p.id, 'retrying');
      await s.publisher.processDue();
    }
    const final = s.publisher.get(p.id)!;
    expect(final.status).toBe('failed');
    expect(final.attempts).toBe(3);
    expect(mock.count('sendMediaGroup')).toBe(3);
    expect(final.lastError).toMatch(/исчерпано попыток/);
  });

  it('marks the account as needing auth on 401 and does not retry', async () => {
    const s = setup();
    const acc = await telegramAccount(s);
    const c = readyCarousel(s);
    mock.on('sendMediaGroup', () => ({ status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } }));
    const res = await s.publisher.publishOne(s.publisher.schedule(c.id, [acc.id], new Date())[0].id);
    expect(res.status).toBe('failed');
    expect(s.accounts.get(acc.id)!.status).toBe('needs_auth');
  });

  it('treats a dropped connection during posting as "needs check", never as a blind retry', async () => {
    const s = setup();
    const acc = await telegramAccount(s);
    const c = readyCarousel(s);
    mock.on('sendMediaGroup', () => ({ destroy: true }));
    const res = await s.publisher.publishOne(s.publisher.schedule(c.id, [acc.id], new Date())[0].id);
    expect(res.status).toBe('needs_check');
    expect(s.publisher.dueIds()).toHaveLength(0);
    s.publisher.resolveCheck(res.id, true);
    expect(s.publisher.get(res.id)!.status).toBe('published');
  });

  it('reports a real reason when the bot is not an admin', async () => {
    const s = setup();
    mock.on('getChatMember', () => ({ json: { ok: true, result: { status: 'member' } } }));
    const a = s.accounts.create({ brandId: s.agent.brandId(), platform: 'telegram', name: 'TG', credentials: { botToken: TG_TOKEN }, config: { chatId: '@noro_test' } });
    const r = await s.accounts.check(a.id);
    expect(r.ok).toBe(false);
    expect(s.accounts.get(a.id)!.status).toBe('no_permission');
  });

  it('never writes the bot token to the event log', async () => {
    const s = setup();
    mock.on('getMe', () => ({ status: 500, json: { ok: false, description: `boom ${TG_TOKEN}` } }));
    const a = s.accounts.create({ brandId: s.agent.brandId(), platform: 'telegram', name: 'TG', credentials: { botToken: TG_TOKEN }, config: { chatId: '@x' } });
    await s.accounts.check(a.id);
    const dump = JSON.stringify(s.db.all('SELECT * FROM events')) + JSON.stringify(s.db.all('SELECT name, config, last_error FROM accounts'));
    expect(dump).not.toContain(TG_TOKEN.split(':')[1]);
    expect(JSON.stringify(s.db.all('SELECT credentials_enc FROM accounts'))).not.toContain('AAFake');
  });

  it('blocks drafts, empty texts and posts over the daily account limit', async () => {
    const s = setup();
    const acc = await telegramAccount(s);
    const draft = s.content.create({ brandId: 1, title: 'Черновик', body: 'Текст', format: 'post' });
    expect(() => s.publisher.schedule(draft.id, [acc.id], new Date())).toThrow(/подтвердите/);
    s.accounts.update(acc.id, { settings: { maxPerDay: 1 } });
    const a = readyCarousel(s, 1);
    await s.publisher.publishOne(s.publisher.schedule(a.id, [acc.id], new Date())[0].id);
    const b = s.content.create({ brandId: 1, title: 'Совсем другой материал о программировании', body: 'Отдельный текст о том, как писать тесты для интеграций.', format: 'post' });
    s.agent.review(b.id);
    s.content.update(b.id, { status: 'ready' });
    const res = await s.publisher.publishOne(s.publisher.schedule(b.id, [acc.id], new Date())[0].id);
    expect(res.status).toBe('blocked');
    expect(res.lastError).toMatch(/лимит 1/);
  });
});

describe('VK', () => {
  it('uploads photos, posts with an idempotency guid and reads metrics', async () => {
    const s = setup();
    const a = s.accounts.create({ brandId: 1, platform: 'vk', name: 'VK', credentials: { accessToken: 'vk1.a.testtokentesttokentesttoken' }, config: { groupId: '777' } });
    expect((await s.accounts.check(a.id)).ok).toBe(true);
    const c = readyCarousel(s);
    const res = await s.publisher.publishOne(s.publisher.schedule(c.id, [a.id], new Date())[0].id);
    expect(res.status).toBe('published');
    expect(res.externalUrl).toMatch(/^https:\/\/vk\.com\/wall-777_\d+$/);
    expect(mock.count('photos.saveWallPhoto')).toBe(7);
    const post = mock.calls.find((x) => x.path.endsWith('wall.post'))!;
    const params = new URLSearchParams(post.body);
    expect(params.get('guid')).toBe(`noro-pub-${res.id}`);
    expect(params.get('owner_id')).toBe('-777');
    expect(params.get('attachments')!.split(',')).toHaveLength(7);
    expect(await s.publisher.collectMetrics()).toBe(1);
    expect(s.db.get<{ views: number }>('SELECT views FROM metrics')!.views).toBe(120);
  });

  it('explains that a community token cannot post to the wall', async () => {
    const s = setup();
    mock.on('wall.post', () => ({ json: { error: { error_code: 27, error_msg: 'Group authorization failed: method is unavailable with group auth.' } } }));
    const a = s.accounts.create({ brandId: 1, platform: 'vk', name: 'VK', credentials: { accessToken: 'vk1.a.testtokentesttokentesttoken' }, config: { groupId: '777' } });
    await s.accounts.check(a.id);
    const c = readyCarousel(s);
    const res = await s.publisher.publishOne(s.publisher.schedule(c.id, [a.id], new Date())[0].id);
    expect(res.status).toBe('failed');
    expect(res.lastError).toMatch(/пользовательский токен/);
    expect(s.accounts.get(a.id)!.status).toBe('no_permission');
  });

  it('after a crash mid-publish, VK is retried safely (guid) while Telegram waits for a manual check', async () => {
    const s = setup();
    const vk = s.accounts.create({ brandId: 1, platform: 'vk', name: 'VK', credentials: { accessToken: 'vk1.a.testtokentesttokentesttoken' }, config: { groupId: '777' } });
    await s.accounts.check(vk.id);
    const tg = await telegramAccount(s);
    const c = readyCarousel(s);
    const pubs = s.publisher.schedule(c.id, [vk.id, tg.id], new Date());
    s.db.run("UPDATE publications SET status = 'publishing', locked_until = ?", new Date(Date.now() - 1000).toISOString());
    s.publisher.recoverStale();
    expect(s.publisher.get(pubs[0].id)!.status).toBe('retrying');
    expect(s.publisher.get(pubs[1].id)!.status).toBe('needs_check');
  });
});

describe('Instagram', () => {
  it('blocks publishing without a public HTTPS address and says why', async () => {
    const s = setup();
    const a = s.accounts.create({ brandId: 1, platform: 'instagram', name: 'IG', credentials: { accessToken: 'IGAAtesttoken' }, config: {} });
    expect((await s.accounts.check(a.id)).ok).toBe(true);
    const c = readyCarousel(s);
    const res = await s.publisher.publishOne(s.publisher.schedule(c.id, [a.id], new Date())[0].id);
    expect(res.status).toBe('blocked');
    expect(res.lastError).toMatch(/NORO_PUBLIC_URL/);
    expect(mock.count('/media_publish')).toBe(0);
  });

  it('creates carousel containers from signed public URLs and publishes', async () => {
    const s = setup({ publicBaseUrl: 'https://noro.example.com' });
    const a = s.accounts.create({ brandId: 1, platform: 'instagram', name: 'IG', credentials: { accessToken: 'IGAAtesttoken' }, config: { pollMs: '1' } });
    await s.accounts.check(a.id);
    const c = readyCarousel(s);
    const res = await s.publisher.publishOne(s.publisher.schedule(c.id, [a.id], new Date())[0].id);
    expect(res.status).toBe('published');
    expect(res.externalUrl).toBe('https://www.instagram.com/p/TEST/');
    const items = mock.calls.filter((x) => x.path.endsWith('/media') && new URLSearchParams(x.body).get('is_carousel_item') === 'true');
    expect(items).toHaveLength(7);
    const url = new URLSearchParams(items[0].body).get('image_url')!;
    expect(url).toMatch(/^https:\/\/noro\.example\.com\/m\/\d+\/[A-Za-z0-9_-]+\.jpg$/);
    // signature check works and wrong signatures are rejected
    const [, , , id, file] = new URL(url).pathname.split('/');
    void file;
    const mediaId = Number(new URL(url).pathname.split('/')[2]);
    const sig = new URL(url).pathname.split('/')[3].replace('.jpg', '');
    expect(s.publisher.verifyMediaSignature(mediaId, sig)).not.toBeNull();
    expect(s.publisher.verifyMediaSignature(mediaId, 'x'.repeat(32))).toBeNull();
    void id;
  });
});

describe('X', () => {
  it('surfaces the paid-access requirement instead of pretending success', async () => {
    const s = setup();
    const a = s.accounts.create({ brandId: 1, platform: 'x', name: 'X', credentials: { clientId: 'cid' }, config: {} });
    s.accounts.saveCredentials(a.id, { clientId: 'cid', accessToken: 'xat', refreshToken: 'xrt', expiresAt: String(Date.now() + 3600e3) } as unknown as Record<string, string>);
    await s.accounts.check(a.id);
    mock.on('/x/2/tweets', () => ({ status: 402, json: { title: 'Payment Required', detail: 'Your enrolled account does not have any credits' } }));
    const c = s.content.create({ brandId: 1, title: 'Пост для X', body: 'Короткий текст', summary: 'Короткий текст для X без ссылок', format: 'post', platforms: ['x'] });
    s.agent.review(c.id);
    s.content.update(c.id, { status: 'ready' });
    const res = await s.publisher.publishOne(s.publisher.schedule(c.id, [a.id], new Date())[0].id);
    expect(res.status).toBe('failed');
    expect(res.lastError).toMatch(/оплаченный доступ/);
    expect(s.accounts.get(a.id)!.status).toBe('payment_required');
  });

  it('refreshes an expiring OAuth token before posting', async () => {
    const s = setup();
    const a = s.accounts.create({ brandId: 1, platform: 'x', name: 'X', credentials: { clientId: 'cid' }, config: {} });
    s.accounts.saveCredentials(a.id, { clientId: 'cid', accessToken: 'old', refreshToken: 'xrt', expiresAt: Date.now() + 1000 } as unknown as Record<string, string>);
    s.accounts.setStatus(a.id, 'connected', null);
    const c = s.content.create({ brandId: 1, title: 'Пост', body: 'Текст', summary: 'Текст для X про автоматизацию', format: 'post', platforms: ['x'] });
    s.agent.review(c.id);
    s.content.update(c.id, { status: 'ready' });
    const res = await s.publisher.publishOne(s.publisher.schedule(c.id, [a.id], new Date())[0].id);
    expect(res.status).toBe('published');
    expect(mock.count('/oauth2/token')).toBe(1);
    expect(mock.calls.find((x) => x.path === '/x/2/tweets')!.headers.authorization).toBe('Bearer xat-new');
    expect(s.accounts.credentials(a.id)!.accessToken).toBe('xat-new');
  });
});
