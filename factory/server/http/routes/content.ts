import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isPlatformId, PLATFORM_IDS, PLATFORMS } from '../../../shared/platforms';
import { brandSchema, briefSchema, SCHEMA_BY_KIND, strategyOutputSchema } from '../../../shared/schemas';
import { isValidTimeZone } from '../../../shared/time';
import { CONTENT_KINDS, type VideoData, type VideoScriptData } from '../../../shared/types';
import { db, schema } from '../../db/client';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { enqueue, Q } from '../../jobs/queue';
import { afterContentChange, createItemsFromPlan, normalizePlan } from '../../pipeline/run';
import { computeStages, setStage } from '../../pipeline/stages';
import { catalog } from '../../providers/registry';
import { piperAvailable } from '../../providers/tts/piper';
import { audit } from '../../services/audit';
import { addVersion, getCampaign, getItem, ITEM_ORDER, itemAssetsByVersion, listVersions, type Asset, type Item } from '../../services/content';
import { approvalHistory, decide, requestReview } from '../../services/review';
import { checkProvider, publicProvider, saveProvider } from '../../services/providers';
import { listPosts, preparePosts } from '../../services/posts';
import { idParam, parse, requireWs } from '../context';

export function publicAsset(a: Asset) {
  return { id: a.id, kind: a.kind, role: a.role, mime: a.mime, bytes: a.bytes, width: a.width, height: a.height, durationMs: a.durationMs, source: a.source, meta: a.meta, isDemo: a.isDemo, url: `/api/assets/${a.id}`, versionId: a.versionId };
}

/** Item ownership check: the item must belong to the workspace in the URL. */
async function wsItem(wsId: string, itemId: string) {
  return getItem(itemId, wsId);
}

export async function contentRoutes(app: FastifyInstance) {
  /* ---------------- Brands ---------------- */

  app.get('/api/ws/:ws/brands', async (req) => {
    const { ws } = await requireWs(req);
    return db.select().from(schema.brands).where(eq(schema.brands.workspaceId, ws.id)).orderBy(schema.brands.createdAt);
  });

  app.post('/api/ws/:ws/brands', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const body = parse(brandSchema, req.body);
    const [row] = await db.insert(schema.brands).values({ ...body, workspaceId: ws.id }).returning();
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'brand.created', entityType: 'brand', entityId: row!.id, message: `Бренд «${row!.name}» создан` });
    return row;
  });

  app.put('/api/ws/:ws/brands/:id', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const body = parse(brandSchema, req.body);
    const [row] = await db.update(schema.brands).set({ ...body, updatedAt: new Date() }).where(and(eq(schema.brands.id, idParam(req)), eq(schema.brands.workspaceId, ws.id))).returning();
    if (!row) throw notFound('Бренд');
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'brand.updated', entityType: 'brand', entityId: row.id, message: `Бренд «${row.name}» обновлён` });
    return row;
  });

  app.delete('/api/ws/:ws/brands/:id', async (req) => {
    const { ws } = await requireWs(req, 'admin');
    const id = idParam(req);
    const [used] = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.brandId, id)).limit(1);
    if (used) throw conflict('У бренда есть кампании — сначала удалите их');
    await db.delete(schema.brands).where(and(eq(schema.brands.id, id), eq(schema.brands.workspaceId, ws.id)));
    return { ok: true };
  });

  /* ---------------- AI providers ---------------- */

  app.get('/api/ws/:ws/providers', async (req) => {
    const { ws } = await requireWs(req);
    const rows = await db.select().from(schema.providerConfigs).where(eq(schema.providerConfigs.workspaceId, ws.id)).orderBy(schema.providerConfigs.createdAt);
    return { catalog: catalog().map((c) => ({ ...c, available: c.id === 'piper' ? piperAvailable() : true })), configured: rows.map(publicProvider) };
  });

  app.post('/api/ws/:ws/providers', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const body = parse(
      z.object({ id: z.string().uuid().optional(), kind: z.enum(['llm', 'image', 'tts']), provider: z.string().max(40), label: z.string().max(80).optional(), model: z.string().max(120).optional(), settings: z.record(z.string(), z.string().max(400)).optional(), apiKey: z.string().max(400).optional(), isDefault: z.boolean().optional() }),
      req.body,
    );
    const row = await saveProvider({ ...body, workspaceId: ws.id });
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'provider.saved', entityType: 'provider', entityId: row.id, message: `Провайдер ${row.label} сохранён${body.apiKey ? ' (ключ зашифрован)' : ''}` });
    const check = await checkProvider(row);
    const [fresh] = await db.select().from(schema.providerConfigs).where(eq(schema.providerConfigs.id, row.id));
    return { provider: publicProvider(fresh!), check };
  });

  app.post('/api/ws/:ws/providers/:id/check', async (req) => {
    const { ws } = await requireWs(req, 'admin');
    const [row] = await db.select().from(schema.providerConfigs).where(and(eq(schema.providerConfigs.id, idParam(req)), eq(schema.providerConfigs.workspaceId, ws.id)));
    if (!row) throw notFound('Провайдер');
    return checkProvider(row);
  });

  app.delete('/api/ws/:ws/providers/:id', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    await db.delete(schema.providerConfigs).where(and(eq(schema.providerConfigs.id, idParam(req)), eq(schema.providerConfigs.workspaceId, ws.id)));
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'provider.deleted', message: 'Провайдер удалён вместе с ключом' });
    return { ok: true };
  });

  /* ---------------- Campaigns ---------------- */

  app.get('/api/ws/:ws/campaigns', async (req) => {
    const { ws } = await requireWs(req);
    const camps = await db.select().from(schema.campaigns).where(eq(schema.campaigns.workspaceId, ws.id)).orderBy(desc(schema.campaigns.createdAt));
    if (!camps.length) return [];
    const counts = await db
      .select({ campaignId: schema.contentItems.campaignId, status: schema.contentItems.status, n: sql<number>`count(*)::int` })
      .from(schema.contentItems)
      .where(inArray(schema.contentItems.campaignId, camps.map((c) => c.id)))
      .groupBy(schema.contentItems.campaignId, schema.contentItems.status);
    return camps.map((c) => ({ ...c, items: Object.fromEntries(counts.filter((x) => x.campaignId === c.id).map((x) => [x.status, x.n])) }));
  });

  app.post('/api/ws/:ws/campaigns', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const body = parse(z.object({ brandId: z.string().uuid(), title: z.string().trim().min(2).max(160), brief: briefSchema }), req.body);
    if (!isValidTimeZone(body.brief.timezone)) throw badRequest('Неизвестный часовой пояс');
    const [brand] = await db.select().from(schema.brands).where(and(eq(schema.brands.id, body.brandId), eq(schema.brands.workspaceId, ws.id)));
    if (!brand) throw notFound('Бренд');
    const [camp] = await db.insert(schema.campaigns).values({ workspaceId: ws.id, brandId: brand.id, title: body.title, brief: body.brief, createdBy: user.id }).returning();
    await setStage(camp!.id, 'idea', 'done', 'Бриф заполнен');
    await setStage(camp!.id, 'strategy', 'running', 'В очереди');
    await enqueue(Q.strategy, { campaignId: camp!.id }, { singletonKey: `strategy:${camp!.id}` });
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'campaign.created', entityType: 'campaign', entityId: camp!.id, message: `Кампания «${camp!.title}» создана, стратегия в очереди` });
    return camp;
  });

  app.get('/api/ws/:ws/campaigns/:id', async (req) => {
    const { ws } = await requireWs(req);
    const camp = await getCampaign(idParam(req), ws.id);
    const items = await db.select().from(schema.contentItems).where(eq(schema.contentItems.campaignId, camp.id));
    items.sort((a, b) => (a.plannedAt?.getTime() ?? 0) - (b.plannedAt?.getTime() ?? 0) || ITEM_ORDER.indexOf(a.kind) - ITEM_ORDER.indexOf(b.kind));
    const versionIds = items.map((i) => i.currentVersionId).filter(Boolean) as string[];
    const versions = versionIds.length ? await db.select().from(schema.contentVersions).where(inArray(schema.contentVersions.id, versionIds)) : [];
    const assets = await itemAssetsByVersion(versionIds);
    const checks = versionIds.length ? await db.select().from(schema.qualityChecks).where(inArray(schema.qualityChecks.versionId, versionIds)).orderBy(desc(schema.qualityChecks.createdAt)) : [];
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, camp.brandId));
    return {
      campaign: camp,
      brand,
      stages: await computeStages(camp.id),
      items: items.map((i) => {
        const v = versions.find((x) => x.id === i.currentVersionId);
        return { ...i, version: v ? { id: v.id, version: v.version, data: v.data, source: v.source, model: v.model } : null, assets: (assets.get(i.currentVersionId ?? '') ?? []).map(publicAsset), check: checks.find((c) => c.versionId === i.currentVersionId) ?? null };
      }),
      posts: await listPosts(ws.id, { campaignId: camp.id }),
    };
  });

  app.get('/api/ws/:ws/campaigns/:id/stages', async (req) => {
    const { ws } = await requireWs(req);
    const camp = await getCampaign(idParam(req), ws.id);
    return computeStages(camp.id);
  });

  /** Manual edit of strategy and plan (source becomes «manual»). */
  app.put('/api/ws/:ws/campaigns/:id/strategy', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const camp = await getCampaign(idParam(req), ws.id);
    const body = parse(strategyOutputSchema, req.body);
    const plan = normalizePlan(body.plan, camp.brief.platforms, camp.brief.formats);
    await db.update(schema.campaigns).set({ strategy: body.strategy, plan, strategySource: 'manual', updatedAt: new Date() }).where(eq(schema.campaigns.id, camp.id));
    await setStage(camp.id, 'strategy', 'done', `Стратегия отредактирована вручную · ${plan.length} публикаций`);
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'strategy.edited', entityType: 'campaign', entityId: camp.id, message: 'Стратегия и план изменены вручную' });
    return { ok: true };
  });

  app.post('/api/ws/:ws/campaigns/:id/strategy/regenerate', async (req) => {
    const { ws } = await requireWs(req, 'edit');
    const camp = await getCampaign(idParam(req), ws.id);
    await setStage(camp.id, 'strategy', 'running', 'В очереди');
    await enqueue(Q.strategy, { campaignId: camp.id }, { singletonKey: `strategy:${camp.id}:${Date.now()}` });
    return { ok: true };
  });

  /** Create items for plan entries that don't have one yet (after a manual plan edit). */
  app.post('/api/ws/:ws/campaigns/:id/items', async (req) => {
    const { ws } = await requireWs(req, 'edit');
    const camp = await getCampaign(idParam(req), ws.id);
    if (!camp.plan?.length) throw conflict('Сначала нужен план');
    const created = await createItemsFromPlan(camp.id);
    return { created: created.length };
  });

  app.delete('/api/ws/:ws/campaigns/:id', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const camp = await getCampaign(idParam(req), ws.id);
    const [live] = await db.select({ id: schema.platformPosts.id }).from(schema.platformPosts).where(and(eq(schema.platformPosts.campaignId, camp.id), inArray(schema.platformPosts.status, ['scheduled', 'publishing']))).limit(1);
    if (live) throw conflict('В кампании есть запланированные публикации — отмените их');
    await db.delete(schema.platformPosts).where(eq(schema.platformPosts.campaignId, camp.id));
    await db.delete(schema.campaigns).where(eq(schema.campaigns.id, camp.id));
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'campaign.deleted', message: `Кампания «${camp.title}» удалена` });
    return { ok: true };
  });

  /* ---------------- Items ---------------- */

  /** Items across campaigns (Motion Studio, review queue). */
  app.get('/api/ws/:ws/items', async (req) => {
    const { ws } = await requireWs(req);
    const q = req.query as { kind?: string; status?: string };
    const kinds = (q.kind?.split(',') ?? []).filter((k): k is Item['kind'] => (CONTENT_KINDS as readonly string[]).includes(k));
    const conds = [eq(schema.contentItems.workspaceId, ws.id)];
    if (kinds.length) conds.push(inArray(schema.contentItems.kind, kinds));
    if (q.status) conds.push(inArray(schema.contentItems.status, q.status.split(',') as Item['status'][]));
    const items = await db.select().from(schema.contentItems).where(and(...conds)).orderBy(desc(schema.contentItems.updatedAt)).limit(200);
    const vids = items.map((i) => i.currentVersionId).filter(Boolean) as string[];
    const versions = vids.length ? await db.select().from(schema.contentVersions).where(inArray(schema.contentVersions.id, vids)) : [];
    const assets = await itemAssetsByVersion(vids);
    const camps = items.length ? await db.select({ id: schema.campaigns.id, title: schema.campaigns.title }).from(schema.campaigns).where(inArray(schema.campaigns.id, [...new Set(items.map((i) => i.campaignId))])) : [];
    return items.map((i) => {
      const v = versions.find((x) => x.id === i.currentVersionId);
      return { ...i, campaignTitle: camps.find((c) => c.id === i.campaignId)?.title ?? '', version: v ? { id: v.id, version: v.version, data: v.data, source: v.source } : null, assets: (assets.get(i.currentVersionId ?? '') ?? []).map(publicAsset) };
    });
  });

  app.get('/api/ws/:ws/items/:id', async (req) => {
    const { ws } = await requireWs(req);
    const item = await wsItem(ws.id, idParam(req));
    const versions = await listVersions(item.id);
    const assets = await itemAssetsByVersion(versions.map((v) => v.id));
    const checks = await db.select().from(schema.qualityChecks).where(eq(schema.qualityChecks.itemId, item.id)).orderBy(desc(schema.qualityChecks.createdAt));
    const camp = await getCampaign(item.campaignId);
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, camp.brandId));
    const children = await db.select({ id: schema.contentItems.id, title: schema.contentItems.title, status: schema.contentItems.status }).from(schema.contentItems).where(eq(schema.contentItems.parentItemId, item.id));
    return {
      item,
      campaign: { id: camp.id, title: camp.title, timezone: camp.brief.timezone, platforms: camp.brief.platforms, isDemo: camp.isDemo },
      brand,
      versions: versions.map((v) => ({ ...v, assets: (assets.get(v.id) ?? []).map(publicAsset), check: checks.find((c) => c.versionId === v.id) ?? null })),
      approvals: await approvalHistory(item.id),
      posts: await listPosts(ws.id, { itemId: item.id }),
      children,
    };
  });

  /** Manual edit: a new version with source «manual». */
  app.post('/api/ws/:ws/items/:id/versions', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const item = await wsItem(ws.id, idParam(req));
    if (item.status === 'generating') throw conflict('Дождитесь окончания генерации');
    const body = parse(z.object({ data: z.record(z.string(), z.unknown()), note: z.string().max(200).optional() }), req.body);
    let data = parse(SCHEMA_BY_KIND[item.kind], body.data) as Record<string, unknown>;
    if (item.kind === 'video') data = { ...data, aspect: parse(z.enum(['9:16', '1:1', '16:9']).default('9:16'), body.data.aspect) };
    const ver = await addVersion(item, { data, source: 'manual', note: body.note || 'Ручная правка', createdBy: user.id });
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'item.edited', entityType: 'item', entityId: item.id, message: `«${item.title.slice(0, 60)}» — ручная правка, версия ${ver.version}` });
    await afterContentChange(item, ver.id);
    return ver;
  });

  /** Regenerate the whole item or one element (slide:N, scene:N, field:name). */
  app.post('/api/ws/:ws/items/:id/regenerate', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const item = await wsItem(ws.id, idParam(req));
    const body = parse(z.object({ instruction: z.string().trim().max(1000).optional(), target: z.string().regex(/^(slide:\d+|scene:\d+|field:[a-zA-Z]+)$/).optional() }), req.body ?? {});
    if (body.target && !body.instruction) throw badRequest('Опишите, что изменить в выбранном элементе');
    if (item.status === 'generating') throw conflict('Генерация уже идёт');
    await db.update(schema.contentItems).set({ status: 'generating', lastError: null }).where(eq(schema.contentItems.id, item.id));
    await enqueue(Q.generate, { itemId: item.id, instruction: body.instruction, target: body.target, userId: user.id }, { singletonKey: `gen:${item.id}:${Date.now()}` });
    return { ok: true };
  });

  /** Make a past version current again (as a new version, history stays linear). */
  app.post('/api/ws/:ws/items/:id/restore', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const item = await wsItem(ws.id, idParam(req));
    const { versionId } = parse(z.object({ versionId: z.string().uuid() }), req.body);
    const [v] = await db.select().from(schema.contentVersions).where(and(eq(schema.contentVersions.id, versionId), eq(schema.contentVersions.itemId, item.id)));
    if (!v) throw notFound('Версия');
    const ver = await addVersion(item, { data: v.data, source: v.source, provider: v.provider, model: v.model, note: `Восстановлена версия ${v.version}`, createdBy: user.id });
    // Reuse rendered files of the restored version instead of rendering again.
    const files = await db.select().from(schema.assets).where(eq(schema.assets.versionId, v.id));
    if (files.length) {
      await db.insert(schema.assets).values(files.map(({ id: _id, createdAt: _c, ...f }) => ({ ...f, versionId: ver.id })));
      const { runChecks } = await import('../../pipeline/run');
      await runChecks(item.id);
    } else await afterContentChange(item, ver.id);
    return ver;
  });

  /** Render visuals or video for the current version (e.g. after a text edit of a video). */
  app.post('/api/ws/:ws/items/:id/render', async (req) => {
    const { ws } = await requireWs(req, 'edit');
    const item = await wsItem(ws.id, idParam(req));
    const body = parse(z.object({ withoutVoice: z.boolean().optional() }), req.body ?? {});
    if (!item.currentVersionId) throw conflict('Нет версии для рендера');
    if (item.kind === 'video') await enqueue(Q.video, { itemId: item.id, versionId: item.currentVersionId, withoutVoice: !!body.withoutVoice }, { singletonKey: `video:${item.currentVersionId}:${Date.now()}` });
    else if (item.kind === 'carousel' || item.kind === 'graphic') await enqueue(Q.design, { itemId: item.id, versionId: item.currentVersionId }, { singletonKey: `design:${item.currentVersionId}:${Date.now()}` });
    else throw badRequest('Для этого формата рендер не нужен');
    await db.update(schema.contentItems).set({ status: 'generating', lastError: null }).where(eq(schema.contentItems.id, item.id));
    return { ok: true };
  });

  /** Script → video: a linked video item with the same scenes, rendered with voiceover and captions. */
  app.post('/api/ws/:ws/items/:id/video', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const script = await wsItem(ws.id, idParam(req));
    if (script.kind !== 'video_script') throw badRequest('Видео создаётся из сценария');
    const body = parse(z.object({ aspect: z.enum(['9:16', '1:1', '16:9']).default('9:16') }), req.body ?? {});
    const [sv] = await db.select().from(schema.contentVersions).where(eq(schema.contentVersions.id, script.currentVersionId ?? '00000000-0000-0000-0000-000000000000'));
    if (!sv) throw conflict('У сценария нет версии');
    const [video] = await db
      .insert(schema.contentItems)
      .values({ campaignId: script.campaignId, workspaceId: ws.id, kind: 'video', title: script.title, pillar: script.pillar, plannedAt: script.plannedAt, platforms: script.platforms.filter((p) => isPlatformId(p) && PLATFORMS[p].preparedMedia.includes('video')), parentItemId: script.id, status: 'generating', isDemo: script.isDemo })
      .returning();
    const data: VideoData = { ...(sv.data as unknown as VideoScriptData), aspect: body.aspect };
    const ver = await addVersion(video!, { data: data as unknown as Record<string, unknown>, source: sv.source, provider: sv.provider, model: sv.model, note: `Из сценария (версия ${sv.version})`, createdBy: user.id });
    await afterContentChange(video!, ver.id);
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'video.requested', entityType: 'item', entityId: video!.id, message: `Видео по сценарию «${script.title.slice(0, 60)}» поставлено в рендер (${body.aspect})` });
    return video;
  });

  app.post('/api/ws/:ws/items/:id/review', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    return requestReview(ws.id, idParam(req), user.id);
  });

  app.post('/api/ws/:ws/items/:id/decision', async (req) => {
    const { ws, user } = await requireWs(req, 'approve');
    const body = parse(z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().max(1000).optional() }), req.body);
    return decide(ws.id, idParam(req), body.decision, body.comment ?? null, { userId: user.id });
  });

  app.post('/api/ws/:ws/items/:id/posts', async (req) => {
    const { ws, user } = await requireWs(req, 'edit');
    const body = parse(z.object({ platforms: z.array(z.enum(PLATFORM_IDS)).min(1), accounts: z.record(z.string(), z.string().uuid()).optional() }), req.body);
    return preparePosts({ workspaceId: ws.id, itemId: idParam(req), platforms: body.platforms, accounts: body.accounts as never, userId: user.id });
  });
}
