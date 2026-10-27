import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, schema } from '../../server/db/client';
import { buildApp } from '../../server/http/app';
import { stopBoss } from '../../server/jobs/queue';
import { runChecks, runGenerate, runStrategy } from '../../server/pipeline/run';
import { addVersion } from '../../server/services/content';
import { preparePosts } from '../../server/services/posts';
import { publishPost, recoverStuck } from '../../server/services/publisher';
import { decide } from '../../server/services/review';
import { BRAND, BRIEF, Client, fakeTelegram, resetDb } from './helpers';

const BOT_TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijklmn';

let app: FastifyInstance;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
let owner: Client;
let ws: string;
let campaignId: string;
let accountId: string;

/** A fresh approved text item in the test campaign with a Telegram post prepared for it. */
async function approvedTelegramPost(text: string) {
  const [item] = await db.insert(schema.contentItems).values({ campaignId, workspaceId: ws, kind: 'post', title: text.slice(0, 40), platforms: ['telegram'], status: 'draft' }).returning();
  await addVersion(item!, { data: { headline: text, body: `${text}. Текст для проверки публикации.`, cta: 'Пишите в комментариях', hashtags: [] }, source: 'manual' });
  await runChecks(item!.id);
  await decide(ws, item!.id, 'approved', null, { userId: null });
  const [res] = await preparePosts({ workspaceId: ws, itemId: item!.id, platforms: ['telegram'] });
  return res!.post!;
}
const postRow = async (id: string) => (await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.id, id)))[0]!;
const sends = () => tg.calls.filter((c) => c.method.startsWith('send')).length;

beforeAll(async () => {
  tg = await fakeTelegram();
  process.env.NORO_API_BASE_TELEGRAM = tg.url;
  await resetDb();
  app = await buildApp();
  owner = new Client(app);
});

afterAll(async () => {
  await app?.close();
  await tg?.close();
  await stopBoss().catch(() => undefined);
  await closeDb();
});

describe('auth and protection', () => {
  it('rejects state-changing requests without the CSRF header', async () => {
    const r = await owner.post('/api/auth/signup', { email: 'x@example.com', password: '1234567890', name: 'X' }, { csrf: false });
    expect(r.status).toBe(403);
  });

  it('signs up and creates an owned workspace', async () => {
    const r = await owner.post('/api/auth/signup', { email: 'owner@example.com', password: 'owner-pass-123', name: 'Владелец' });
    expect(r.status).toBe(200);
    expect(owner.cookie).toMatch(/^noro_session=/);
    ws = r.body.workspaces.find((w: { role: string }) => w.role === 'owner').id;
    const sess = await db.select().from(schema.sessions);
    expect(sess[0]!.id).not.toBe(owner.cookie.split('=')[1]); // only the hash is stored
  });

  it('does not reveal whether an email exists', async () => {
    const anon = new Client(app);
    const a = await anon.post('/api/auth/login', { email: 'owner@example.com', password: 'wrong-password' });
    const b = await anon.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('requires a session for workspace APIs', async () => {
    const r = await new Client(app).get(`/api/ws/${ws}/brands`);
    expect(r.status).toBe(401);
  });

  it('sets security headers', async () => {
    const r = await owner.get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
  });
});

describe('without AI keys', () => {
  it('fails strategy honestly instead of inventing content', async () => {
    const b = await owner.post(`/api/ws/${ws}/brands`, BRAND);
    expect(b.status).toBe(200);
    const c = await owner.post(`/api/ws/${ws}/campaigns`, { brandId: b.body.id, title: 'Без ключей', brief: BRIEF });
    expect(c.status).toBe(200);
    await runStrategy(c.body.id).catch(() => undefined);
    const st = await owner.get(`/api/ws/${ws}/campaigns/${c.body.id}`);
    const strategy = st.body.stages.find((s: { stage: string }) => s.stage === 'strategy');
    expect(strategy.status).toBe('failed');
    expect(strategy.error).toMatch(/модел|ключ|провайдер/i);
    expect(st.body.items).toHaveLength(0);
  });
});

describe('content pipeline with the labelled test provider', () => {
  it('builds strategy → items → checks', async () => {
    const p = await owner.post(`/api/ws/${ws}/providers`, { kind: 'llm', provider: 'test', isDefault: true });
    expect(p.status).toBe(200);
    const brands = await owner.get(`/api/ws/${ws}/brands`);
    const c = await owner.post(`/api/ws/${ws}/campaigns`, { brandId: brands.body[0].id, title: 'Тестовая кампания', brief: BRIEF });
    campaignId = c.body.id;
    await runStrategy(campaignId);
    const items = await db.select().from(schema.contentItems).where(eq(schema.contentItems.campaignId, campaignId));
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(BRIEF.frequency * BRIEF.weeks);
    for (const i of items) await runGenerate(i.id);
    const detail = await owner.get(`/api/ws/${ws}/campaigns/${campaignId}`);
    for (const i of detail.body.items) {
      expect(i.status).toBe('ready');
      expect(i.version.source).toBe('test'); // never presented as real model output
    }
  });
});

describe('Telegram publishing against a fake Bot API', () => {
  it('connects a channel and never returns or stores the token in clear text', async () => {
    const r = await owner.post(`/api/ws/${ws}/accounts/token`, { platform: 'telegram', fields: { botToken: BOT_TOKEN, chatId: '@noro_test' } });
    expect(r.status).toBe(200);
    expect(r.raw).not.toContain(BOT_TOKEN);
    accountId = r.body.id;
    const list = await owner.get(`/api/ws/${ws}/accounts`);
    expect(list.raw).not.toContain(BOT_TOKEN);
    const [row] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountId));
    expect(row!.credentialsEnc).not.toContain('AAFakeToken');
    const audit = await db.select().from(schema.auditLog);
    expect(JSON.stringify(audit)).not.toContain(BOT_TOKEN);
  });

  it('refuses to publish an item that is not approved', async () => {
    const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.campaignId, campaignId));
    const prep = await owner.post(`/api/ws/${ws}/items/${item!.id}/posts`, { platforms: ['telegram'] });
    expect(prep.status).toBe(200);
    expect(prep.body[0].post.status).toBe('draft');
    const pub = await owner.post(`/api/ws/${ws}/posts/${prep.body[0].post.id}/publish`, {});
    expect(pub.status).toBeGreaterThanOrEqual(400);
    expect(sends()).toBe(0);
  });

  it('review → approve → publish, then never sends the same post twice', async () => {
    const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.campaignId, campaignId));
    expect((await owner.post(`/api/ws/${ws}/items/${item!.id}/review`)).status).toBe(200);
    const rej = await owner.post(`/api/ws/${ws}/items/${item!.id}/decision`, { decision: 'rejected' });
    expect(rej.status).toBe(400); // a rejection needs a comment
    expect((await owner.post(`/api/ws/${ws}/items/${item!.id}/decision`, { decision: 'approved' })).status).toBe(200);
    const [post] = await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.itemId, item!.id));
    expect(post!.status).toBe('ready');

    expect((await owner.post(`/api/ws/${ws}/posts/${post!.id}/publish`, {})).status).toBe(200);
    const done = await publishPost(post!.id);
    expect(done.status).toBe('published');
    expect(done.externalId).toBe('100');
    expect(done.externalUrl).toBe('https://t.me/noro_test/100');
    expect(sends()).toBe(1);

    // A duplicate job (retry, double click, second worker) does not reach the platform.
    await publishPost(post!.id);
    expect(sends()).toBe(1);
    const again = await owner.post(`/api/ws/${ws}/posts/${post!.id}/publish`, {});
    expect(again.status).toBe(409);
    const attempts = await db.select().from(schema.publishAttempts).where(eq(schema.publishAttempts.postId, post!.id));
    expect(attempts.map((a) => a.outcome).sort()).toEqual(['skipped_duplicate', 'success']);
  });

  it('re-preparing the same version does not create a duplicate post', async () => {
    const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.campaignId, campaignId));
    await owner.post(`/api/ws/${ws}/items/${item!.id}/posts`, { platforms: ['telegram'] });
    const rows = await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.itemId, item!.id));
    expect(rows).toHaveLength(1);
  });

  it('retries temporary errors with exponential backoff', async () => {
    const post = await approvedTelegramPost('Повтор при сбое');
    await owner.post(`/api/ws/${ws}/posts/${post.id}/publish`, {});
    tg.state.mode = 'error500';
    const t0 = Date.now();
    const r1 = await publishPost(post.id);
    expect(r1.status).toBe('scheduled');
    expect(r1.attempts).toBe(1);
    expect(r1.nextAttemptAt!.getTime() - t0).toBeGreaterThanOrEqual(59_000);
    expect(r1.lastError).toMatch(/временно недоступен/);
    // Second failure waits longer.
    const r2 = await publishPost(post.id);
    expect(r2.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThanOrEqual(230_000);
    tg.state.mode = 'ok';
    const r3 = await publishPost(post.id);
    expect(r3.status).toBe('published');
  });

  it('honours Telegram retry_after on 429', async () => {
    const post = await approvedTelegramPost('Ограничение частоты');
    await owner.post(`/api/ws/${ws}/posts/${post.id}/publish`, {});
    tg.state.mode = 'rate429';
    const r = await publishPost(post.id);
    tg.state.mode = 'ok';
    expect(r.status).toBe('scheduled');
    expect(r.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThanOrEqual(115_000);
  });

  it('stops on a revoked token without retrying', async () => {
    const post = await approvedTelegramPost('Отозванный токен');
    await owner.post(`/api/ws/${ws}/posts/${post.id}/publish`, {});
    tg.state.mode = 'auth401';
    const r = await publishPost(post.id);
    tg.state.mode = 'ok';
    expect(r.status).toBe('failed');
    expect(r.nextAttemptAt).toBeNull();
    expect(r.lastError).toMatch(/BotFather/);
  });

  it('marks an interrupted publication as unknown outcome and requires confirmation', async () => {
    const post = await approvedTelegramPost('Прерванная отправка');
    await db.update(schema.platformPosts).set({ status: 'publishing', lockedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(schema.platformPosts.id, post.id));
    expect(await recoverStuck()).toBe(1);
    const row = await postRow(post.id);
    expect(row.status).toBe('failed');
    expect(row.lastErrorCode).toBe('unknown_outcome');
    const blind = await owner.post(`/api/ws/${ws}/posts/${post.id}/publish`, {});
    expect(blind.status).toBe(409);
    expect(blind.body.error.code).toBe('unknown_outcome');
    const confirmed = await owner.post(`/api/ws/${ws}/posts/${post.id}/publish`, { confirmNotPublished: true });
    expect(confirmed.status).toBe(200);
  });

  it('warns about schedule conflicts on the same account', async () => {
    const a = await approvedTelegramPost('Слот А');
    const b = await approvedTelegramPost('Слот Б');
    const at = new Date(Date.now() + 3 * 86400_000).toISOString();
    expect((await owner.post(`/api/ws/${ws}/posts/${a.id}/schedule`, { at })).status).toBe(200);
    const clash = await owner.post(`/api/ws/${ws}/posts/${b.id}/schedule`, { at: new Date(Date.parse(at) + 20 * 60_000).toISOString() });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('schedule_conflict');
    const forced = await owner.post(`/api/ws/${ws}/posts/${b.id}/schedule`, { at: new Date(Date.parse(at) + 20 * 60_000).toISOString(), force: true });
    expect(forced.status).toBe(200);
    const past = await owner.post(`/api/ws/${ws}/posts/${b.id}/schedule`, { at: '2020-01-01T10:00:00Z' });
    expect(past.status).toBe(400);
  });

  it('manual platforms are never marked published without a real link', async () => {
    const post = await approvedTelegramPost('Ручная площадка');
    const [dz] = await preparePosts({ workspaceId: ws, itemId: post.itemId, platforms: ['dzen'] });
    expect(dz!.post!.accountId).toBeNull();
    const pub = await publishPost(dz!.post!.id);
    expect(pub.status).toBe('manual_pending');
    const wrongHost = await owner.post(`/api/ws/${ws}/posts/${dz!.post!.id}/manual-done`, { url: 'https://example.com/post' });
    expect(wrongHost.status).toBe(400);
    const ok = await owner.post(`/api/ws/${ws}/posts/${dz!.post!.id}/manual-done`, { url: 'https://dzen.ru/a/abc' });
    expect(ok.status).toBe(200);
    expect((await postRow(dz!.post!.id)).status).toBe('manual_done');
  });
});

describe('roles', () => {
  it('enforces the role matrix', async () => {
    const viewer = new Client(app);
    await viewer.post('/api/auth/signup', { email: 'viewer@example.com', password: 'viewer-pass-123', name: 'Зритель' });
    const approver = new Client(app);
    await approver.post('/api/auth/signup', { email: 'approver@example.com', password: 'approver-pass-1', name: 'Согласующий' });

    expect((await viewer.get(`/api/ws/${ws}/brands`)).status).toBe(404); // not a member: the workspace is not revealed
    await owner.post(`/api/ws/${ws}/members`, { email: 'viewer@example.com', role: 'viewer' });
    await owner.post(`/api/ws/${ws}/members`, { email: 'approver@example.com', role: 'approver' });

    expect((await viewer.get(`/api/ws/${ws}/brands`)).status).toBe(200);
    expect((await viewer.post(`/api/ws/${ws}/brands`, BRAND)).status).toBe(403);
    expect((await approver.post(`/api/ws/${ws}/brands`, BRAND)).status).toBe(403);
    expect((await approver.post(`/api/ws/${ws}/accounts/token`, { platform: 'telegram', fields: { botToken: BOT_TOKEN, chatId: '@x' } })).status).toBe(403);

    const post = await approvedTelegramPost('Права');
    await db.update(schema.contentItems).set({ status: 'ready' }).where(eq(schema.contentItems.id, post.itemId));
    await db.delete(schema.approvals).where(eq(schema.approvals.itemId, post.itemId));
    expect((await approver.post(`/api/ws/${ws}/items/${post.itemId}/decision`, { decision: 'approved' })).status).toBe(200);
    expect((await approver.post(`/api/ws/${ws}/posts/${post.id}/publish`, {})).status).toBe(403);
    expect((await viewer.post(`/api/ws/${ws}/items/${post.itemId}/decision`, { decision: 'approved' })).status).toBe(403);
  });

  it('keeps the demo workspace read-only even for its members', async () => {
    const [demo] = await db.insert(schema.workspaces).values({ name: 'Демо', isDemo: true }).returning();
    const [me] = await db.select().from(schema.users).where(eq(schema.users.email, 'owner@example.com'));
    await db.insert(schema.memberships).values({ workspaceId: demo!.id, userId: me!.id, role: 'owner' });
    expect((await owner.get(`/api/ws/${demo!.id}/brands`)).status).toBe(200);
    expect((await owner.post(`/api/ws/${demo!.id}/brands`, BRAND)).status).toBe(403);
  });
});

describe('automation safety', () => {
  it('asks for confirmation before enabling a rule without human approval', async () => {
    const rules = await owner.get(`/api/ws/${ws}/rules`);
    const brands = await owner.get(`/api/ws/${ws}/brands`);
    const config = { ...rules.body.defaults, approval: { required: false, approverIds: [] } };
    const body = { name: 'Без согласования', brandId: brands.body[0].id, enabled: true, config };
    const r = await owner.post(`/api/ws/${ws}/rules`, body);
    expect(r.status).toBe(428);
    expect(r.body.error.code).toBe('confirm_required');
    expect((await owner.post(`/api/ws/${ws}/rules`, { ...body, confirmed: true })).status).toBe(200);
  });

  it('rejects mass generation settings', async () => {
    const rules = await owner.get(`/api/ws/${ws}/rules`);
    const brands = await owner.get(`/api/ws/${ws}/brands`);
    const config = { ...rules.body.defaults, generate: { ...rules.body.defaults.generate, itemsPerRun: 500 } };
    const r = await owner.post(`/api/ws/${ws}/rules`, { name: 'Массовое', brandId: brands.body[0].id, enabled: true, config, confirmed: true });
    expect(r.status).toBe(400);
  });
});
