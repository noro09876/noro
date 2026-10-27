import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { PLATFORMS, type PlatformId } from '../../shared/platforms';
import { checksPassed, runChecks } from '../../shared/quality';
import { db, schema } from '../db/client';
import { ExternalError } from '../lib/errors';
import { adapter } from '../integrations/registry';
import type { MediaRef } from '../integrations/types';
import { enqueue, Q } from '../jobs/queue';
import { materialize } from '../storage';
import { accountCtx, refreshForPublish, type AccountRow } from './accounts';
import { audit } from './audit';
import { getBrand, getCampaign, getItem, versionAssets, type Asset } from './content';
import { publicMediaUrl } from './media';

export type PostRow = typeof schema.platformPosts.$inferSelect;

const LOCK_STALE_MS = 15 * 60 * 1000;

/** Exponential backoff: 1, 4, 16, 60 min … capped at 3 h; honours Retry-After. */
export function backoffMs(attempt: number, retryAfterSec?: number): number {
  const base = Math.min(3 * 3600, 60 * 4 ** Math.max(0, attempt - 1));
  return Math.max(base, retryAfterSec ?? 0) * 1000;
}

/**
 * Claims a post for publishing with a conditional UPDATE: only one worker can move it
 * to `publishing`, and a post that already has a confirmed result is never sent again.
 */
async function claim(postId: string): Promise<PostRow | null> {
  const now = new Date();
  const [row] = await db
    .update(schema.platformPosts)
    .set({ status: 'publishing', lockedAt: now, attempts: sql`${schema.platformPosts.attempts} + 1`, updatedAt: now })
    .where(and(eq(schema.platformPosts.id, postId), inArray(schema.platformPosts.status, ['scheduled', 'ready', 'failed']), sql`${schema.platformPosts.externalId} is null`))
    .returning();
  return row ?? null;
}

async function mediaFor(post: PostRow, tmp: string): Promise<MediaRef[]> {
  if (!post.assetIds.length) return [];
  const rows = await db.select().from(schema.assets).where(inArray(schema.assets.id, post.assetIds));
  const ordered = post.assetIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as Asset[];
  const cover = (await versionAssets(post.versionId)).find((a) => a.role === 'cover');
  const out: MediaRef[] = [];
  for (const a of ordered) {
    if (a.kind !== 'image' && a.kind !== 'video') continue;
    const ref: MediaRef = { kind: a.kind, mime: a.mime, path: await materialize(a.storageKey, tmp), url: publicMediaUrl(a), bytes: a.bytes, width: a.width, height: a.height, durationMs: a.durationMs };
    if (a.kind === 'video' && cover) ref.cover = { kind: 'image', mime: cover.mime, path: await materialize(cover.storageKey, tmp), url: publicMediaUrl(cover), bytes: cover.bytes };
    out.push(ref);
  }
  return out;
}

async function record(post: PostRow, outcome: string, startedAt: Date, extra: { errorCode?: string; message?: string; response?: Record<string, unknown> } = {}) {
  await db.insert(schema.publishAttempts).values({ postId: post.id, attempt: post.attempts, outcome, errorCode: extra.errorCode ?? null, message: extra.message ?? null, response: extra.response ?? null, startedAt });
}

/** Pre-flight: account, approval, quality. Returns a reason string if the post must not be sent. */
async function preflight(post: PostRow): Promise<{ account: AccountRow | null; reason?: string; code?: string }> {
  const item = await getItem(post.itemId);
  if (item.status !== 'approved') return { account: null, code: 'not_approved', reason: 'Материал не согласован — публикация остановлена' };
  if (item.currentVersionId !== post.versionId) return { account: null, code: 'stale_version', reason: 'После подготовки публикации материал изменился. Подготовьте публикацию заново.' };
  const camp = await getCampaign(item.campaignId);
  const brand = await getBrand(camp.brandId);
  const assets = await versionAssets(post.versionId);
  const ver = (await db.select().from(schema.contentVersions).where(eq(schema.contentVersions.id, post.versionId)))[0]!;
  const checks = runChecks({ kind: item.kind, data: ver.data, brand, platforms: [post.platform as PlatformId], assets });
  if (!post.text.trim() && !post.assetIds.length) return { account: null, code: 'empty', reason: 'Пустая публикация' };
  if (!checksPassed(checks)) return { account: null, code: 'checks_failed', reason: `Проверка качества не пройдена: ${checks.filter((c) => c.level === 'error').map((c) => c.message).join('; ')}` };
  if (PLATFORMS[post.platform as PlatformId].mode === 'manual') return { account: null };
  if (!post.accountId) return { account: null, code: 'no_account', reason: 'Не выбран аккаунт площадки' };
  const [acc] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, post.accountId));
  if (!acc) return { account: null, code: 'no_account', reason: 'Аккаунт площадки удалён' };
  if (acc.status !== 'connected') return { account: acc, code: 'account_' + acc.status, reason: `Аккаунт «${acc.displayName}» требует переподключения: ${acc.lastError ?? acc.status}` };
  return { account: acc };
}

export async function publishPost(postId: string): Promise<PostRow> {
  const startedAt = new Date();
  const [current] = await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.id, postId));
  if (!current) throw new Error('post not found');
  if (current.externalId || current.status === 'published') {
    await record(current, 'skipped_duplicate', startedAt, { message: 'Публикация уже подтверждена — повтор не отправлен' });
    return current;
  }
  // Demo showcase posts are never sent anywhere.
  if (current.isDemo) {
    await record(current, 'skipped_demo', startedAt, { message: 'Демо-публикация: отправка на площадку отключена' });
    return current;
  }
  const spec = PLATFORMS[current.platform as PlatformId];

  // Manual platforms never call an API.
  if (spec.mode === 'manual') {
    const pf = await preflight(current);
    if (pf.reason) return fail(current, startedAt, pf.code!, pf.reason, false);
    const [row] = await db.update(schema.platformPosts).set({ status: 'manual_pending', updatedAt: new Date() }).where(eq(schema.platformPosts.id, postId)).returning();
    await audit({ workspaceId: current.workspaceId, actorType: 'worker', action: 'post.manual_pending', entityType: 'post', entityId: postId, message: `${spec.name}: пакет готов, ждёт ручного размещения` });
    return row!;
  }

  const post = await claim(postId);
  if (!post) {
    const [p] = await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.id, postId));
    return p!;
  }
  const pf = await preflight(post);
  if (pf.reason) return fail(post, startedAt, pf.code!, pf.reason, false);
  let account = pf.account!;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'noro-pub-'));
  try {
    const media = await mediaFor(post, tmp);
    const a = adapter(post.platform as PlatformId);
    const run = () =>
      a.publish(accountCtx(account), {
        postId: post.id,
        title: post.title,
        text: post.text,
        media,
        progress: (post.meta.progress as Record<string, unknown>) ?? {},
        saveProgress: async (p) => {
          post.meta = { ...post.meta, progress: { ...((post.meta.progress as Record<string, unknown>) ?? {}), ...p } };
          await db.update(schema.platformPosts).set({ meta: post.meta, lockedAt: new Date() }).where(eq(schema.platformPosts.id, post.id));
        },
      });
    let result;
    try {
      result = await run();
    } catch (e) {
      // One transparent token refresh on auth errors, then a single retry.
      if (e instanceof ExternalError && e.code === 'auth') {
        const refreshed = await refreshForPublish(account);
        if (!refreshed) throw e;
        account = refreshed;
        result = await run();
      } else throw e;
    }
    const testMode = !!account.meta.test || !!result.meta?.visibleOnlyToAuthor;
    const [row] = await db
      .update(schema.platformPosts)
      .set({ status: 'published', externalId: result.externalId, externalUrl: result.url, publishedAt: new Date(), lastError: null, lastErrorCode: null, lockedAt: null, testMode, meta: { ...post.meta, result: result.meta ?? {} }, updatedAt: new Date() })
      .where(eq(schema.platformPosts.id, post.id))
      .returning();
    await record(post, testMode ? 'test' : 'success', startedAt, { response: { externalId: result.externalId, url: result.url } });
    await audit({ workspaceId: post.workspaceId, actorType: 'worker', action: 'post.published', entityType: 'post', entityId: post.id, message: `${spec.name}: опубликовано${testMode ? ' (тестовая/приватная публикация)' : ''} — ${result.url ?? result.externalId}` });
    return row!;
  } catch (e) {
    const err = e instanceof ExternalError ? e : new ExternalError(spec.name, 'internal', (e as Error).message, true);
    return fail(post, startedAt, err.code, err.message, err.retryable, err.retryAfterSec);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function fail(post: PostRow, startedAt: Date, code: string, message: string, retryable: boolean, retryAfterSec?: number): Promise<PostRow> {
  const canRetry = retryable && post.attempts < post.maxAttempts;
  const next = canRetry ? new Date(Date.now() + backoffMs(post.attempts, retryAfterSec)) : null;
  const [row] = await db
    .update(schema.platformPosts)
    .set({ status: canRetry ? 'scheduled' : 'failed', lastError: message, lastErrorCode: code, nextAttemptAt: next, lockedAt: null, updatedAt: new Date() })
    .where(eq(schema.platformPosts.id, post.id))
    .returning();
  await record(post, 'error', startedAt, { errorCode: code, message });
  await audit({
    workspaceId: post.workspaceId,
    actorType: 'worker',
    action: canRetry ? 'post.retry_scheduled' : 'post.failed',
    entityType: 'post',
    entityId: post.id,
    level: canRetry ? 'warn' : 'error',
    message: `${PLATFORMS[post.platform as PlatformId].name}: ${message}${canRetry ? ` — повтор ${next!.toLocaleString('ru-RU', { timeZone: post.timezone })}` : ''}`,
  });
  if (canRetry) await enqueue(Q.publish, { postId: post.id }, { startAfter: next!, singletonKey: `pub:${post.id}:${post.attempts}` });
  return row!;
}

/**
 * A worker that died between "sent" and "recorded" leaves a post in `publishing`.
 * Its outcome is unknown, so it is NOT retried automatically (that could duplicate it):
 * it is marked failed with a request to verify on the platform.
 */
export async function recoverStuck() {
  const stale = new Date(Date.now() - LOCK_STALE_MS);
  const rows = await db
    .update(schema.platformPosts)
    .set({ status: 'failed', lastErrorCode: 'unknown_outcome', lastError: 'Публикация прервалась на этапе отправки. Проверьте на площадке, вышел ли пост, затем отметьте результат или повторите.', lockedAt: null, updatedAt: new Date() })
    .where(and(eq(schema.platformPosts.status, 'publishing'), lt(schema.platformPosts.lockedAt, stale)))
    .returning();
  for (const r of rows) await audit({ workspaceId: r.workspaceId, actorType: 'system', action: 'post.unknown_outcome', entityType: 'post', entityId: r.id, level: 'warn', message: 'Публикация прервалась — нужна ручная проверка' });
  return rows.length;
}
