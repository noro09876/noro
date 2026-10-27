import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, desc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { PLATFORMS, type PlatformId } from '../../shared/platforms';
import { db, schema } from '../db/client';
import { ExternalError } from '../lib/errors';
import { logger } from '../lib/logger';
import { adapter } from '../integrations/registry';
import { accountCtx } from './accounts';

/**
 * Collects metrics only for real (non-test) publications confirmed by the platform.
 * Whatever the API does not return is stored in `unavailable` with the reason —
 * the UI shows the gap instead of inventing a number.
 */
export async function collectMetrics(now = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 3600_000);
  const posts = await db
    .select()
    .from(schema.platformPosts)
    .where(and(eq(schema.platformPosts.status, 'published'), eq(schema.platformPosts.testMode, false), eq(schema.platformPosts.isDemo, false), isNotNull(schema.platformPosts.externalId), isNotNull(schema.platformPosts.accountId), gte(schema.platformPosts.publishedAt, since)));
  let collected = 0;
  for (const post of posts) {
    const [last] = await db.select({ at: schema.postMetrics.collectedAt }).from(schema.postMetrics).where(eq(schema.postMetrics.postId, post.id)).orderBy(desc(schema.postMetrics.collectedAt)).limit(1);
    if (last && now.getTime() - last.at.getTime() < 6 * 3600_000) continue;
    const a = adapter(post.platform as PlatformId);
    if (!a.metrics) continue;
    const [acc] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, post.accountId!));
    if (!acc || acc.status !== 'connected') continue;
    try {
      const m = await a.metrics(accountCtx(acc), post.externalId!);
      await db.insert(schema.postMetrics).values({ postId: post.id, values: m.values, unavailable: m.unavailable });
      collected++;
    } catch (e) {
      const msg = e instanceof ExternalError ? e.message : (e as Error).message;
      await db.insert(schema.postMetrics).values({ postId: post.id, values: {}, unavailable: { all: `${PLATFORMS[post.platform as PlatformId].name}: ${msg}` } });
    }
  }
  return collected;
}

/** Removes expired sessions/OAuth states and stale temp directories left by crashed renders. */
export async function cleanup(now = new Date()) {
  const s = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).returning({ id: schema.sessions.id });
  const o = await db.delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, now)).returning({ s: schema.oauthStates.state });
  let tmp = 0;
  const dir = os.tmpdir();
  for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (!name.startsWith('noro-')) continue;
    const p = path.join(dir, name);
    const st = await fsp.stat(p).catch(() => null);
    if (st && now.getTime() - st.mtimeMs > 6 * 3600_000) {
      await fsp.rm(p, { recursive: true, force: true });
      tmp++;
    }
  }
  logger.info({ sessions: s.length, oauthStates: o.length, tmp }, 'cleanup done');
  return { sessions: s.length, oauthStates: o.length, tmp };
}

/** Accounts that are not connected keep their scheduled posts from silently failing: surface them. */
export async function accountsNeedingAttention(workspaceId: string) {
  return db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.workspaceId, workspaceId), inArray(schema.socialAccounts.status, ['expired', 'error'])));
}
