import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { PLATFORMS, type MediaKind, type PlatformId } from '../../shared/platforms';
import { adaptForPlatform } from '../../shared/quality';
import { formatInTz, isValidTimeZone, zonedToUtc } from '../../shared/time';
import type { CarouselData, ContentKind, GraphicData, PostData, VideoData } from '../../shared/types';
import { db, schema } from '../db/client';
import { sha256 } from '../lib/crypto';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { enqueue, Q } from '../jobs/queue';
import { audit } from './audit';
import { currentVersion, getCampaign, getItem, versionAssets, type Asset, type Item } from './content';
import type { PostRow } from './publisher';

/** Minimum distance between two publications on the same account. */
export const DEFAULT_MIN_GAP_MIN = 60;
const EDITABLE: PostRow['status'][] = ['draft', 'ready', 'scheduled', 'failed'];
/** Date parameter for raw SQL expressions (drizzle maps Date only for typed columns). */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/* ---------------- Adaptation ---------------- */

/** Common textual fields of any publishable content kind. */
export function baseFields(kind: ContentKind, data: Record<string, unknown>): { headline?: string; body: string; cta?: string; hashtags: string[] } {
  switch (kind) {
    case 'post': {
      const d = data as unknown as PostData;
      return { headline: d.headline, body: d.body, cta: d.cta, hashtags: d.hashtags ?? [] };
    }
    case 'carousel': {
      const d = data as unknown as CarouselData;
      return { headline: d.title, body: d.caption, hashtags: d.hashtags ?? [] };
    }
    case 'graphic': {
      const d = data as unknown as GraphicData;
      return { headline: d.headline, body: d.caption, hashtags: [] };
    }
    case 'video': {
      const d = data as unknown as VideoData;
      return { headline: d.title, body: d.caption, hashtags: d.hashtags ?? [] };
    }
    default:
      throw badRequest('Сценарий не публикуется сам по себе — создайте из него видео');
  }
}

/** Media kind of the publication and the assets to attach, chosen per platform. */
export function mediaPlan(kind: ContentKind, platform: PlatformId, assets: Asset[]): { media: MediaKind; assets: Asset[] } {
  const spec = PLATFORMS[platform];
  if (kind === 'post') return { media: 'text', assets: [] };
  if (kind === 'carousel') {
    const slides = assets.filter((a) => a.role?.startsWith('slide-')).sort((a, b) => (a.role! < b.role! ? -1 : 1));
    return { media: 'carousel', assets: slides.slice(0, spec.limits.carouselMax ?? slides.length) };
  }
  if (kind === 'graphic') {
    const wide = assets.find((a) => a.role === 'graphic-wide');
    const tall = assets.find((a) => a.role === 'graphic');
    const pick = spec.aspect === '16:9' && wide ? wide : tall ?? wide;
    return { media: 'image', assets: pick ? [pick] : [] };
  }
  const video = assets.find((a) => a.kind === 'video' && a.role === 'final');
  return { media: 'video', assets: video ? [video] : [] };
}

/** Why this content can't go to this platform (null = it can). */
export function unsupportedReason(kind: ContentKind, platform: PlatformId, media: MediaKind, assetCount: number): string | null {
  const spec = PLATFORMS[platform];
  const allowed = spec.mode === 'manual' ? spec.preparedMedia : spec.apiMedia;
  if (!allowed.includes(media)) {
    const what = { text: 'текстовые посты', image: 'изображения', carousel: 'карусели', video: 'видео' }[media];
    return `${spec.name} не принимает ${what} через официальный API`;
  }
  if (media !== 'text' && !assetCount) return 'Нет готовых файлов: дождитесь рендера или запустите его заново';
  if (media === 'carousel' && spec.limits.carouselMin && assetCount < spec.limits.carouselMin) return `${spec.name}: в карусели нужно минимум ${spec.limits.carouselMin} слайда`;
  void kind;
  return null;
}

export function idempotencyKey(itemId: string, versionId: string, platform: string, accountId: string | null) {
  return sha256(`${itemId}:${versionId}:${platform}:${accountId ?? 'manual'}`);
}

/**
 * Creates (or returns existing) platform variants for the current version of an item.
 * Each variant is an independent post with its own text, files and idempotency key.
 */
export async function preparePosts(input: { workspaceId: string; itemId: string; platforms: PlatformId[]; accounts?: Partial<Record<PlatformId, string>>; userId?: string; timezone?: string }) {
  const item = await getItem(input.itemId, input.workspaceId);
  const ver = await currentVersion(item);
  if (!ver) throw badRequest('У материала ещё нет версии');
  const camp = await getCampaign(item.campaignId);
  const assets = await versionAssets(ver.id);
  const base = baseFields(item.kind, ver.data);
  const out: { platform: PlatformId; post?: PostRow; error?: string }[] = [];
  for (const platform of input.platforms) {
    const spec = PLATFORMS[platform];
    const plan = mediaPlan(item.kind, platform, assets);
    const reason = unsupportedReason(item.kind, platform, plan.media, plan.assets.length);
    if (reason) {
      out.push({ platform, error: reason });
      continue;
    }
    let accountId: string | null = null;
    if (spec.mode !== 'manual') {
      accountId = input.accounts?.[platform] ?? (await defaultAccount(input.workspaceId, platform));
      if (accountId) await assertAccount(input.workspaceId, accountId, platform);
    }
    const adapted = adaptForPlatform(platform, base, plan.media !== 'text');
    const key = idempotencyKey(item.id, ver.id, platform, accountId);
    const [created] = await db
      .insert(schema.platformPosts)
      .values({
        workspaceId: item.workspaceId,
        campaignId: item.campaignId,
        itemId: item.id,
        versionId: ver.id,
        platform,
        accountId,
        title: adapted.title ?? null,
        text: adapted.text,
        hashtags: adapted.hashtags,
        assetIds: plan.assets.map((a) => a.id),
        status: item.status === 'approved' ? 'ready' : 'draft',
        timezone: input.timezone ?? camp.brief.timezone,
        scheduledAt: null,
        idempotencyKey: key,
        meta: { media: plan.media, truncated: adapted.truncated },
        isDemo: item.isDemo,
      })
      .onConflictDoNothing({ target: schema.platformPosts.idempotencyKey })
      .returning();
    const post = created ?? (await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.idempotencyKey, key)))[0]!;
    out.push({ platform, post });
  }
  if (out.some((o) => o.post)) {
    await audit({ workspaceId: item.workspaceId, actorType: input.userId ? 'user' : 'worker', actorId: input.userId, action: 'posts.prepared', entityType: 'item', entityId: item.id, message: `Подготовлены версии для: ${out.filter((o) => o.post).map((o) => PLATFORMS[o.platform].name).join(', ')}` });
  }
  return out;
}

async function defaultAccount(workspaceId: string, platform: PlatformId): Promise<string | null> {
  const [acc] = await db
    .select({ id: schema.socialAccounts.id })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.workspaceId, workspaceId), eq(schema.socialAccounts.platform, platform), eq(schema.socialAccounts.status, 'connected')))
    .orderBy(desc(schema.socialAccounts.createdAt))
    .limit(1);
  return acc?.id ?? null;
}

async function assertAccount(workspaceId: string, accountId: string, platform: PlatformId) {
  const [acc] = await db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.id, accountId), eq(schema.socialAccounts.workspaceId, workspaceId)));
  if (!acc) throw notFound('Аккаунт');
  if (acc.platform !== platform) throw badRequest('Аккаунт относится к другой площадке');
  return acc;
}

export async function getPost(id: string, workspaceId: string): Promise<PostRow> {
  const [p] = await db.select().from(schema.platformPosts).where(and(eq(schema.platformPosts.id, id), eq(schema.platformPosts.workspaceId, workspaceId)));
  if (!p) throw notFound('Публикация');
  return p;
}

/** Manual edit of a platform variant (text/title/account). */
export async function updatePost(workspaceId: string, id: string, patch: { text?: string; title?: string | null; accountId?: string | null }, userId: string) {
  const post = await getPost(id, workspaceId);
  if (!EDITABLE.includes(post.status)) throw conflict('Публикацию в этом статусе нельзя изменить');
  const platform = post.platform as PlatformId;
  const spec = PLATFORMS[platform];
  const set: Partial<PostRow> = { updatedAt: new Date() };
  if (patch.text !== undefined) {
    const hasMedia = post.assetIds.length > 0;
    const limit = hasMedia && spec.limits.captionMax && platform !== 'telegram' ? spec.limits.captionMax : spec.limits.textMax;
    if (!patch.text.trim() && !hasMedia) throw badRequest('Текст не может быть пустым');
    if ([...patch.text].length > limit) throw badRequest(`${spec.name}: максимум ${limit} символов, сейчас ${[...patch.text].length}`);
    set.text = patch.text;
  }
  if (patch.title !== undefined) {
    if (patch.title && spec.limits.titleMax && patch.title.length > spec.limits.titleMax) throw badRequest(`Заголовок: максимум ${spec.limits.titleMax} символов`);
    set.title = patch.title;
  }
  if (patch.accountId !== undefined && spec.mode !== 'manual') {
    if (patch.accountId) await assertAccount(workspaceId, patch.accountId, platform);
    set.accountId = patch.accountId;
    // A different target is a different publication: new idempotency key.
    set.idempotencyKey = idempotencyKey(post.itemId, post.versionId, platform, patch.accountId);
  }
  try {
    const [row] = await db.update(schema.platformPosts).set(set).where(eq(schema.platformPosts.id, id)).returning();
    await audit({ workspaceId, actorType: 'user', actorId: userId, action: 'post.edited', entityType: 'post', entityId: id, message: `${spec.name}: версия публикации изменена вручную` });
    return row!;
  } catch (e) {
    if (String((e as { code?: string }).code) === '23505') throw conflict('Для этого аккаунта такая публикация уже подготовлена');
    throw e;
  }
}

/* ---------------- Scheduling ---------------- */

export interface Conflict {
  postId: string;
  platform: string;
  scheduledAt: Date;
  reason: string;
}

/** Posts that would collide with a publication at `at` on the same target. */
export async function findConflicts(post: Pick<PostRow, 'id' | 'workspaceId' | 'platform' | 'accountId'>, at: Date, gapMin = DEFAULT_MIN_GAP_MIN): Promise<Conflict[]> {
  const from = new Date(at.getTime() - gapMin * 60_000);
  const to = new Date(at.getTime() + gapMin * 60_000);
  const target = post.accountId ? eq(schema.platformPosts.accountId, post.accountId) : and(eq(schema.platformPosts.platform, post.platform), isNull(schema.platformPosts.accountId));
  const near = await db
    .select()
    .from(schema.platformPosts)
    .where(
      and(
        eq(schema.platformPosts.workspaceId, post.workspaceId),
        ne(schema.platformPosts.id, post.id),
        target,
        inArray(schema.platformPosts.status, ['scheduled', 'publishing', 'published', 'manual_pending']),
        or(and(gte(schema.platformPosts.scheduledAt, from), lte(schema.platformPosts.scheduledAt, to)), and(gte(schema.platformPosts.publishedAt, from), lte(schema.platformPosts.publishedAt, to))),
      ),
    );
  const out: Conflict[] = near.map((p) => ({ postId: p.id, platform: p.platform, scheduledAt: (p.scheduledAt ?? p.publishedAt)!, reason: `Меньше ${gapMin} мин до другой публикации в этом аккаунте` }));

  // Daily caps published by the platform (Instagram 100/24h, Threads 250/24h …).
  const cap = PLATFORMS[post.platform as PlatformId].limits.postsPerDay;
  if (cap && post.accountId) {
    const dayFrom = new Date(at.getTime() - 24 * 3600_000);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.platformPosts)
      .where(and(eq(schema.platformPosts.accountId, post.accountId), ne(schema.platformPosts.id, post.id), inArray(schema.platformPosts.status, ['scheduled', 'publishing', 'published']), gte(sql`coalesce(${schema.platformPosts.publishedAt}, ${schema.platformPosts.scheduledAt})`, ts(dayFrom)), lte(sql`coalesce(${schema.platformPosts.publishedAt}, ${schema.platformPosts.scheduledAt})`, ts(at))));
    if ((row?.n ?? 0) >= cap) out.push({ postId: post.id, platform: post.platform, scheduledAt: at, reason: `Лимит площадки: не больше ${cap} публикаций за 24 часа` });
  }
  return out;
}

export function resolveWhen(when: { at?: string; date?: string; time?: string; timezone?: string }, fallbackTz: string): { at: Date; timezone: string } {
  const timezone = when.timezone ?? fallbackTz;
  if (!isValidTimeZone(timezone)) throw badRequest('Неизвестный часовой пояс');
  if (when.at) {
    const at = new Date(when.at);
    if (Number.isNaN(at.getTime())) throw badRequest('Некорректная дата');
    return { at, timezone };
  }
  if (!when.date || !/^\d{4}-\d{2}-\d{2}$/.test(when.date) || !when.time || !/^\d{2}:\d{2}$/.test(when.time)) throw badRequest('Укажите дату и время');
  return { at: zonedToUtc(when.date, when.time, timezone), timezone };
}

async function assertPublishable(post: PostRow, item: Item) {
  if (item.status !== 'approved') throw new AppError(409, 'not_approved', 'Сначала согласуйте материал');
  if (item.currentVersionId !== post.versionId) throw new AppError(409, 'stale_version', 'Материал изменился после подготовки публикации — подготовьте её заново');
  const spec = PLATFORMS[post.platform as PlatformId];
  if (spec.mode !== 'manual') {
    if (!post.accountId) throw new AppError(412, 'no_account', `Подключите аккаунт ${spec.name} и выберите его в публикации`);
    const [acc] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, post.accountId));
    if (!acc || acc.status !== 'connected') throw new AppError(412, 'account_not_ready', `Аккаунт ${spec.name} требует переподключения`);
  }
}

export async function schedulePost(workspaceId: string, id: string, when: { at?: string; date?: string; time?: string; timezone?: string; force?: boolean }, userId: string | null) {
  const post = await getPost(id, workspaceId);
  if (!['draft', 'ready', 'scheduled', 'failed'].includes(post.status)) throw conflict('Эту публикацию уже нельзя перепланировать');
  if (post.lastErrorCode === 'unknown_outcome') throw conflict('Сначала проверьте на площадке, вышла ли предыдущая попытка');
  const item = await getItem(post.itemId);
  await assertPublishable(post, item);
  const { at, timezone } = resolveWhen(when, post.timezone);
  if (at.getTime() < Date.now() - 60_000) throw badRequest('Время публикации уже прошло');
  const conflicts = await findConflicts(post, at);
  if (conflicts.length && !when.force) throw new AppError(409, 'schedule_conflict', conflicts.map((c) => c.reason).join('; '), { conflicts });
  const [row] = await db
    .update(schema.platformPosts)
    .set({ status: 'scheduled', scheduledAt: at, timezone, nextAttemptAt: at, attempts: post.status === 'failed' ? 0 : post.attempts, lastError: null, lastErrorCode: null, updatedAt: new Date() })
    .where(eq(schema.platformPosts.id, id))
    .returning();
  const local = formatInTz(at, timezone);
  await audit({ workspaceId, actorType: userId ? 'user' : 'worker', actorId: userId ?? undefined, action: 'post.scheduled', entityType: 'post', entityId: id, message: `${PLATFORMS[post.platform as PlatformId].name}: запланировано на ${local.date} ${local.time} (${timezone})${conflicts.length ? ' — несмотря на предупреждение' : ''}` });
  return row!;
}

/** Publish now: schedules for "now" and enqueues immediately. */
export async function publishNow(workspaceId: string, id: string, userId: string, opts: { confirmNotPublished?: boolean } = {}) {
  const post = await getPost(id, workspaceId);
  if (post.status === 'published' || post.externalId) throw conflict('Публикация уже подтверждена площадкой — повтор не нужен');
  if (post.lastErrorCode === 'unknown_outcome' && !opts.confirmNotPublished) {
    throw new AppError(409, 'unknown_outcome', 'Прошлая попытка прервалась: проверьте на площадке, что пост не вышел, и подтвердите повтор');
  }
  const item = await getItem(post.itemId);
  await assertPublishable(post, item);
  const now = new Date();
  const [row] = await db
    .update(schema.platformPosts)
    .set({ status: 'scheduled', scheduledAt: now, nextAttemptAt: now, attempts: 0, lastError: null, lastErrorCode: null, updatedAt: now })
    .where(and(eq(schema.platformPosts.id, id), inArray(schema.platformPosts.status, ['draft', 'ready', 'scheduled', 'failed'])))
    .returning();
  if (!row) throw conflict('Публикация уже выполняется');
  await enqueue(Q.publish, { postId: id }, { singletonKey: `pub:${id}:0` });
  await audit({ workspaceId, actorType: 'user', actorId: userId, action: 'post.publish_now', entityType: 'post', entityId: id, message: `${PLATFORMS[post.platform as PlatformId].name}: отправлено в очередь публикации` });
  return row;
}

export async function cancelPost(workspaceId: string, id: string, userId: string) {
  const post = await getPost(id, workspaceId);
  const [row] = await db
    .update(schema.platformPosts)
    .set({ status: 'cancelled', nextAttemptAt: null, updatedAt: new Date() })
    .where(and(eq(schema.platformPosts.id, id), inArray(schema.platformPosts.status, ['draft', 'ready', 'scheduled', 'failed', 'manual_pending'])))
    .returning();
  if (!row) throw conflict(post.status === 'publishing' ? 'Публикация уже отправляется — отменить нельзя' : 'Публикацию в этом статусе нельзя отменить');
  await audit({ workspaceId, actorType: 'user', actorId: userId, action: 'post.cancelled', entityType: 'post', entityId: id, message: `${PLATFORMS[post.platform as PlatformId].name}: публикация отменена` });
  return row;
}

const MANUAL_HOSTS: Partial<Record<PlatformId, string[]>> = { dzen: ['dzen.ru'], teletype: ['teletype.in'], vcru: ['vc.ru'] };

/**
 * The user confirms a manual placement (or a post whose outcome was unknown) with a link.
 * The status says «Размещено вручную» and never pretends the factory published it.
 */
export async function markManualDone(workspaceId: string, id: string, url: string, userId: string) {
  const post = await getPost(id, workspaceId);
  const platform = post.platform as PlatformId;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw badRequest('Укажите ссылку на опубликованный материал');
  }
  if (u.protocol !== 'https:') throw badRequest('Ссылка должна начинаться с https://');
  const hosts = MANUAL_HOSTS[platform];
  if (hosts && !hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) throw badRequest(`Ссылка не ведёт на ${PLATFORMS[platform].name}`);
  const isManual = PLATFORMS[platform].mode === 'manual';
  if (!isManual && post.lastErrorCode !== 'unknown_outcome') throw conflict('Отметка вручную доступна только для ручных площадок и прерванных публикаций');
  const [row] = await db
    .update(schema.platformPosts)
    .set({ status: 'manual_done', externalUrl: u.toString(), publishedAt: new Date(), lastError: null, lastErrorCode: null, meta: { ...post.meta, confirmedBy: userId }, updatedAt: new Date() })
    .where(and(eq(schema.platformPosts.id, id), inArray(schema.platformPosts.status, ['ready', 'scheduled', 'manual_pending', 'failed'])))
    .returning();
  if (!row) throw conflict('Публикацию в этом статусе нельзя отметить');
  await audit({ workspaceId, actorType: 'user', actorId: userId, action: 'post.manual_done', entityType: 'post', entityId: id, message: `${PLATFORMS[platform].name}: размещено вручную — ${u.toString()}` });
  return row;
}

/* ---------------- Scheduler ---------------- */

/** Enqueues every post whose time has come. Safe to run concurrently: the publisher claims posts atomically. */
export async function enqueueDue(now = new Date()) {
  const due = await db
    .select({ id: schema.platformPosts.id, attempts: schema.platformPosts.attempts })
    .from(schema.platformPosts)
    .where(and(eq(schema.platformPosts.status, 'scheduled'), eq(schema.platformPosts.isDemo, false), isNull(schema.platformPosts.externalId), lte(sql`coalesce(${schema.platformPosts.nextAttemptAt}, ${schema.platformPosts.scheduledAt})`, ts(now))))
    .limit(200);
  for (const p of due) await enqueue(Q.publish, { postId: p.id }, { singletonKey: `pub:${p.id}:${p.attempts}` });
  return due.length;
}

export async function listPosts(workspaceId: string, f: { campaignId?: string; itemId?: string; from?: Date; to?: Date; status?: PostRow['status'][] } = {}) {
  const conds = [eq(schema.platformPosts.workspaceId, workspaceId)];
  if (f.campaignId) conds.push(eq(schema.platformPosts.campaignId, f.campaignId));
  if (f.itemId) conds.push(eq(schema.platformPosts.itemId, f.itemId));
  if (f.from) conds.push(gte(sql`coalesce(${schema.platformPosts.scheduledAt}, ${schema.platformPosts.publishedAt}, ${schema.platformPosts.createdAt})`, ts(f.from)));
  if (f.to) conds.push(lte(sql`coalesce(${schema.platformPosts.scheduledAt}, ${schema.platformPosts.publishedAt}, ${schema.platformPosts.createdAt})`, ts(f.to)));
  if (f.status?.length) conds.push(inArray(schema.platformPosts.status, f.status));
  return db.select().from(schema.platformPosts).where(and(...conds)).orderBy(sql`coalesce(${schema.platformPosts.scheduledAt}, ${schema.platformPosts.createdAt})`);
}
