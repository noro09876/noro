import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_RULE } from '../../../shared/automation';
import { isPlatformId, PLATFORM_IDS, PLATFORMS, type PlatformId } from '../../../shared/platforms';
import { db, schema } from '../../db/client';
import { mask } from '../../lib/crypto';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { adapter, ADAPTERS } from '../../integrations/registry';
import { audit } from '../../services/audit';
import { accountCtx, chooseTarget, checkAccount, connectWithToken, finishOAuth, getApp, publicAccount, saveApp, startOAuth } from '../../services/accounts';
import { rulesOverview, runRule, saveRule } from '../../services/automation';
import { publicHttpsOrigin } from '../../services/media';
import { cancelPost, getPost, listPosts, markManualDone, publishNow, schedulePost, updatePost } from '../../services/posts';
import { idParam, parse, requireUser, requireWs } from '../context';

const POST_STATUSES = ['draft', 'ready', 'scheduled', 'publishing', 'published', 'failed', 'manual_pending', 'manual_done', 'cancelled'] as const;

async function wsAccount(wsId: string, id: string) {
  const [row] = await db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.id, id), eq(schema.socialAccounts.workspaceId, wsId)));
  if (!row) throw notFound('Аккаунт');
  return row;
}

export async function publishingRoutes(app: FastifyInstance) {
  /* ---------------- Platforms & accounts ---------------- */

  app.get('/api/platforms', async (req) => {
    requireUser(req);
    return PLATFORM_IDS.map((id) => {
      const a = ADAPTERS[id];
      return { ...PLATFORMS[id], connect: a.connect, fields: a.fields ?? [], appFields: a.appFields ?? [], setupSteps: a.setupSteps, multiTarget: !!a.listTargets, hasMetrics: !!a.metrics };
    });
  });

  app.get('/api/ws/:ws/accounts', async (req) => {
    const { ws } = await requireWs(req);
    const rows = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.workspaceId, ws.id)).orderBy(schema.socialAccounts.createdAt);
    const apps = await db.select().from(schema.integrationApps).where(eq(schema.integrationApps.workspaceId, ws.id));
    const appStatus: Record<string, { configured: boolean; clientId?: string; secretHint?: string | null; fromEnv?: boolean }> = {};
    for (const id of PLATFORM_IDS) {
      if (ADAPTERS[id].connect !== 'oauth') continue;
      const own = apps.find((a) => a.platform === id);
      if (own) appStatus[id] = { configured: true, clientId: own.clientId, secretHint: own.secretHint };
      else appStatus[id] = { configured: !!(await getApp(ws.id, id)), fromEnv: !!process.env[`${id.toUpperCase()}_CLIENT_ID`] };
    }
    return { accounts: rows.map(publicAccount), apps: appStatus, publicHttps: !!publicHttpsOrigin(), redirectBase: `${process.env.PUBLIC_URL ?? ''}` };
  });

  app.put('/api/ws/:ws/integrations/:platform', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const platform = (req.params as { platform: string }).platform;
    if (!isPlatformId(platform) || ADAPTERS[platform].connect !== 'oauth') throw badRequest('Для этой площадки приложение не нужно');
    const body = parse(z.object({ clientId: z.string().trim().min(2).max(200), clientSecret: z.string().trim().min(2).max(400) }), req.body);
    await saveApp(ws.id, platform, body.clientId, body.clientSecret);
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'integration.saved', message: `${PLATFORMS[platform].name}: данные приложения сохранены (секрет ${mask(body.clientSecret)})` });
    return { ok: true };
  });

  app.post('/api/ws/:ws/accounts/token', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const body = parse(z.object({ platform: z.enum(PLATFORM_IDS), fields: z.record(z.string(), z.string().max(500)), test: z.boolean().optional() }), req.body);
    const row = await connectWithToken(ws.id, user.id, body.platform, body.fields, { test: body.test });
    return publicAccount(row);
  });

  app.post('/api/ws/:ws/accounts/oauth', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const body = parse(z.object({ platform: z.enum(PLATFORM_IDS), test: z.boolean().optional() }), req.body);
    return { url: await startOAuth(ws.id, user.id, body.platform, { test: body.test }) };
  });

  /** OAuth redirect target. The session must belong to the user who started the flow. */
  app.get('/api/oauth/callback/:platform', async (req, reply) => {
    const platform = (req.params as { platform: string }).platform;
    const q = req.query as Record<string, string>;
    try {
      const user = requireUser(req);
      const [st] = await db.select({ userId: schema.oauthStates.userId }).from(schema.oauthStates).where(eq(schema.oauthStates.state, q.state ?? ''));
      if (st && st.userId !== user.id) throw new AppError(403, 'wrong_user', 'Подключение начато другим пользователем');
      const row = await finishOAuth(platform, q);
      return reply.redirect(`/w/${row.workspaceId}/accounts?connected=${row.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка подключения';
      return reply.redirect(`/accounts?error=${encodeURIComponent(msg)}`);
    }
  });

  app.get('/api/ws/:ws/accounts/:id/targets', async (req) => {
    const { ws } = await requireWs(req, 'admin');
    const row = await wsAccount(ws.id, idParam(req));
    const a = adapter(row.platform as PlatformId);
    if (!a.listTargets) return [];
    return a.listTargets(accountCtx(row).creds);
  });

  app.post('/api/ws/:ws/accounts/:id/target', async (req) => {
    const { ws } = await requireWs(req, 'admin');
    const row = await wsAccount(ws.id, idParam(req));
    const { targetId } = parse(z.object({ targetId: z.string().regex(/^\d+$/) }), req.body);
    return publicAccount(await chooseTarget(row, targetId));
  });

  app.patch('/api/ws/:ws/accounts/:id', async (req) => {
    const { ws } = await requireWs(req, 'admin');
    const row = await wsAccount(ws.id, idParam(req));
    const body = parse(z.object({ privacy: z.enum(['public', 'unlisted', 'private', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).optional(), chatId: z.string().max(100).optional(), test: z.boolean().optional() }), req.body);
    const [up] = await db.update(schema.socialAccounts).set({ meta: { ...row.meta, ...body } }).where(eq(schema.socialAccounts.id, row.id)).returning();
    return publicAccount(up!);
  });

  app.post('/api/ws/:ws/accounts/:id/check', async (req) => {
    const { ws } = await requireWs(req, 'admin');
    return publicAccount(await checkAccount(await wsAccount(ws.id, idParam(req))));
  });

  app.delete('/api/ws/:ws/accounts/:id', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const row = await wsAccount(ws.id, idParam(req));
    const [live] = await db.select({ id: schema.platformPosts.id }).from(schema.platformPosts).where(and(eq(schema.platformPosts.accountId, row.id), inArray(schema.platformPosts.status, ['scheduled', 'publishing']))).limit(1);
    if (live) throw new AppError(409, 'has_scheduled', 'У аккаунта есть запланированные публикации — сначала отмените или перенесите их');
    await db.delete(schema.socialAccounts).where(eq(schema.socialAccounts.id, row.id));
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'account.deleted', message: `${row.displayName}: аккаунт отключён, токены удалены` });
    return { ok: true };
  });

  /* ---------------- Posts / calendar ---------------- */

  app.get('/api/ws/:ws/posts', async (req) => {
    const { ws } = await requireWs(req);
    const q = req.query as { from?: string; to?: string; campaignId?: string; status?: string };
    const status = q.status?.split(',').filter((s): s is (typeof POST_STATUSES)[number] => (POST_STATUSES as readonly string[]).includes(s));
    const posts = await listPosts(ws.id, { from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, campaignId: q.campaignId, status });
    const itemIds = [...new Set(posts.map((p) => p.itemId))];
    const items = itemIds.length ? await db.select({ id: schema.contentItems.id, title: schema.contentItems.title, kind: schema.contentItems.kind, status: schema.contentItems.status }).from(schema.contentItems).where(inArray(schema.contentItems.id, itemIds)) : [];
    return posts.map((p) => ({ ...p, item: items.find((i) => i.id === p.itemId) ?? null }));
  });

  app.get('/api/ws/:ws/posts/:id', async (req) => {
    const { ws } = await requireWs(req);
    const post = await getPost(idParam(req), ws.id);
    const attempts = await db.select().from(schema.publishAttempts).where(eq(schema.publishAttempts.postId, post.id)).orderBy(desc(schema.publishAttempts.startedAt));
    const metrics = await db.select().from(schema.postMetrics).where(eq(schema.postMetrics.postId, post.id)).orderBy(desc(schema.postMetrics.collectedAt)).limit(20);
    return { post, attempts, metrics };
  });

  app.patch('/api/ws/:ws/posts/:id', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const body = parse(z.object({ text: z.string().max(70000).optional(), title: z.string().max(200).nullable().optional(), accountId: z.string().uuid().nullable().optional() }), req.body);
    return updatePost(ws.id, idParam(req), body, user.id);
  });

  app.post('/api/ws/:ws/posts/:id/schedule', async (req) => {
    const { ws, user } = await requireWs(req, 'publish');
    const body = parse(z.object({ at: z.string().optional(), date: z.string().optional(), time: z.string().optional(), timezone: z.string().optional(), force: z.boolean().optional() }), req.body);
    return schedulePost(ws.id, idParam(req), body, user.id);
  });

  app.post('/api/ws/:ws/posts/:id/publish', async (req) => {
    const { ws, user } = await requireWs(req, 'publish');
    const body = parse(z.object({ confirmNotPublished: z.boolean().optional() }), req.body ?? {});
    return publishNow(ws.id, idParam(req), user.id, body);
  });

  app.post('/api/ws/:ws/posts/:id/cancel', async (req) => {
    const { ws, user } = await requireWs(req, 'publish');
    return cancelPost(ws.id, idParam(req), user.id);
  });

  app.post('/api/ws/:ws/posts/:id/manual-done', async (req) => {
    const { ws, user } = await requireWs(req, 'publish');
    const { url } = parse(z.object({ url: z.string().max(1000) }), req.body);
    return markManualDone(ws.id, idParam(req), url, user.id);
  });

  /* ---------------- Automation ---------------- */

  app.get('/api/ws/:ws/rules', async (req) => {
    const { ws } = await requireWs(req);
    return { rules: await rulesOverview(ws.id), defaults: DEFAULT_RULE };
  });

  const ruleBody = z.object({ brandId: z.string().uuid(), name: z.string().max(120), enabled: z.boolean(), config: z.record(z.string(), z.unknown()), confirmed: z.boolean().optional() });

  app.post('/api/ws/:ws/rules', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const body = parse(ruleBody, req.body);
    return saveRule(ws.id, user.id, { ...body, config: body.config as never });
  });

  app.put('/api/ws/:ws/rules/:id', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const body = parse(ruleBody, req.body);
    return saveRule(ws.id, user.id, { ...body, id: idParam(req), config: body.config as never });
  });

  app.post('/api/ws/:ws/rules/:id/run', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const [rule] = await db.select().from(schema.automationRules).where(and(eq(schema.automationRules.id, idParam(req)), eq(schema.automationRules.workspaceId, ws.id)));
    if (!rule) throw notFound('Правило');
    const camp = await runRule(rule, { manual: true, userId: user.id });
    if (!camp) throw new AppError(429, 'rule_limit', 'Дневной лимит правила исчерпан — запуск не выполнен');
    return camp;
  });

  app.delete('/api/ws/:ws/rules/:id', async (req) => {
    const { ws } = await requireWs(req, 'admin');
    await db.delete(schema.automationRules).where(and(eq(schema.automationRules.id, idParam(req)), eq(schema.automationRules.workspaceId, ws.id)));
    return { ok: true };
  });

  /* ---------------- Dashboard & analytics ---------------- */

  app.get('/api/ws/:ws/dashboard', async (req) => {
    const { ws } = await requireWs(req);
    const itemCounts = await db.select({ status: schema.contentItems.status, n: sql<number>`count(*)::int` }).from(schema.contentItems).where(eq(schema.contentItems.workspaceId, ws.id)).groupBy(schema.contentItems.status);
    const postCounts = await db.select({ status: schema.platformPosts.status, n: sql<number>`count(*)::int` }).from(schema.platformPosts).where(eq(schema.platformPosts.workspaceId, ws.id)).groupBy(schema.platformPosts.status);
    const now = new Date();
    const upcoming = await listPosts(ws.id, { from: now, to: new Date(now.getTime() + 7 * 86400_000), status: ['scheduled', 'manual_pending'] });
    const problems = await db.select().from(schema.platformPosts).where(and(eq(schema.platformPosts.workspaceId, ws.id), eq(schema.platformPosts.status, 'failed'))).orderBy(desc(schema.platformPosts.updatedAt)).limit(10);
    const review = await db.select({ id: schema.contentItems.id, title: schema.contentItems.title, kind: schema.contentItems.kind, campaignId: schema.contentItems.campaignId }).from(schema.contentItems).where(and(eq(schema.contentItems.workspaceId, ws.id), eq(schema.contentItems.status, 'in_review'))).limit(10);
    const failedItems = await db.select({ id: schema.contentItems.id, title: schema.contentItems.title, lastError: schema.contentItems.lastError }).from(schema.contentItems).where(and(eq(schema.contentItems.workspaceId, ws.id), eq(schema.contentItems.status, 'failed'))).limit(10);
    const accounts = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.workspaceId, ws.id));
    const providers = await db.select({ kind: schema.providerConfigs.kind, status: schema.providerConfigs.status, label: schema.providerConfigs.label }).from(schema.providerConfigs).where(eq(schema.providerConfigs.workspaceId, ws.id));
    const campaigns = await db.select({ id: schema.campaigns.id, title: schema.campaigns.title, createdAt: schema.campaigns.createdAt }).from(schema.campaigns).where(eq(schema.campaigns.workspaceId, ws.id)).orderBy(desc(schema.campaigns.createdAt)).limit(5);
    const journal = await db.select().from(schema.auditLog).where(eq(schema.auditLog.workspaceId, ws.id)).orderBy(desc(schema.auditLog.createdAt)).limit(12);
    return {
      items: Object.fromEntries(itemCounts.map((c) => [c.status, c.n])),
      posts: Object.fromEntries(postCounts.map((c) => [c.status, c.n])),
      upcoming,
      problems,
      review,
      failedItems,
      accounts: accounts.map(publicAccount),
      providers,
      campaigns,
      journal,
    };
  });

  /**
   * Analytics: only numbers returned by platform APIs for real, confirmed, non-test posts.
   * Everything else is listed as unavailable with the reason.
   */
  app.get('/api/ws/:ws/analytics', async (req) => {
    const { ws } = await requireWs(req);
    const since = new Date(Date.now() - 90 * 86400_000);
    const posts = await db.select().from(schema.platformPosts).where(and(eq(schema.platformPosts.workspaceId, ws.id), inArray(schema.platformPosts.status, ['published', 'manual_done']), gte(schema.platformPosts.publishedAt, since))).orderBy(desc(schema.platformPosts.publishedAt));
    const ids = posts.map((p) => p.id);
    const metrics = ids.length
      ? await db.execute<{ post_id: string; values: Record<string, number>; unavailable: Record<string, string>; collected_at: string }>(sql`select distinct on (post_id) post_id, values, unavailable, collected_at from post_metrics where post_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) order by post_id, collected_at desc`)
      : [];
    const byPost = new Map([...metrics].map((m) => [m.post_id, m]));
    const perPlatform: Record<string, { posts: number; withData: number; totals: Record<string, number> }> = {};
    for (const p of posts) {
      if (p.testMode || p.isDemo) continue;
      const agg = (perPlatform[p.platform] ??= { posts: 0, withData: 0, totals: {} });
      agg.posts++;
      const m = byPost.get(p.id);
      if (m && Object.keys(m.values).length) {
        agg.withData++;
        for (const [k, v] of Object.entries(m.values)) agg.totals[k] = (agg.totals[k] ?? 0) + v;
      }
    }
    return {
      posts: posts.map((p) => ({ id: p.id, platform: p.platform, title: p.title, text: p.text.slice(0, 160), externalUrl: p.externalUrl, publishedAt: p.publishedAt, status: p.status, testMode: p.testMode, isDemo: p.isDemo, metrics: byPost.get(p.id) ?? null })),
      perPlatform,
      capabilities: Object.fromEntries(PLATFORM_IDS.map((id) => [id, PLATFORMS[id].analytics])),
    };
  });
}
