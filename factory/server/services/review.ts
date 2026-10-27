import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { AppError, badRequest, conflict } from '../lib/errors';
import { audit } from './audit';
import { currentVersion, getItem, setItemStatus } from './content';

/**
 * Review and approval. An approval belongs to one exact version: editing the material
 * creates a new version and cancels a pending approval (services/content.addVersion),
 * and a post prepared from an older version refuses to publish.
 */

async function latestCheck(itemId: string, versionId: string) {
  const [c] = await db
    .select()
    .from(schema.qualityChecks)
    .where(and(eq(schema.qualityChecks.itemId, itemId), eq(schema.qualityChecks.versionId, versionId)))
    .orderBy(desc(schema.qualityChecks.createdAt))
    .limit(1);
  return c ?? null;
}

export async function requestReview(workspaceId: string, itemId: string, userId: string | null) {
  const item = await getItem(itemId, workspaceId);
  const ver = await currentVersion(item);
  if (!ver) throw badRequest('Нет версии для согласования');
  if (item.status === 'generating') throw conflict('Материал ещё создаётся');
  const check = await latestCheck(itemId, ver.id);
  if (!check) throw conflict('Проверка качества ещё не выполнена');
  if (!check.passed) throw new AppError(409, 'checks_failed', 'Исправьте ошибки проверки качества перед отправкой на согласование');
  const [pending] = await db.select().from(schema.approvals).where(and(eq(schema.approvals.itemId, itemId), eq(schema.approvals.versionId, ver.id), eq(schema.approvals.status, 'pending')));
  if (pending) return pending;
  const [row] = await db.insert(schema.approvals).values({ itemId, versionId: ver.id, requestedBy: userId, status: 'pending' }).returning();
  await setItemStatus(itemId, 'in_review');
  await audit({ workspaceId, actorType: userId ? 'user' : 'worker', actorId: userId, action: 'approval.requested', entityType: 'item', entityId: itemId, message: `«${item.title.slice(0, 60)}» (версия ${ver.version}) отправлен на согласование` });
  return row!;
}

export async function decide(workspaceId: string, itemId: string, decision: 'approved' | 'rejected', comment: string | null, actor: { userId: string | null; automatic?: string }) {
  const item = await getItem(itemId, workspaceId);
  const ver = await currentVersion(item);
  if (!ver) throw badRequest('Нет версии');
  if (decision === 'approved') {
    const check = await latestCheck(itemId, ver.id);
    if (!check?.passed) throw new AppError(409, 'checks_failed', 'Нельзя согласовать материал, который не прошёл проверку качества');
  }
  if (decision === 'rejected' && !comment?.trim()) throw badRequest('Напишите, что нужно исправить');
  let [appr] = await db.select().from(schema.approvals).where(and(eq(schema.approvals.itemId, itemId), eq(schema.approvals.versionId, ver.id), eq(schema.approvals.status, 'pending')));
  if (!appr) [appr] = await db.insert(schema.approvals).values({ itemId, versionId: ver.id, requestedBy: actor.userId, status: 'pending' }).returning();
  const [row] = await db
    .update(schema.approvals)
    .set({ status: decision, decidedBy: actor.userId, comment: actor.automatic ? `${actor.automatic}${comment ? ` — ${comment}` : ''}` : comment, decidedAt: new Date() })
    .where(eq(schema.approvals.id, appr!.id))
    .returning();
  await setItemStatus(itemId, decision, decision === 'rejected' ? comment : null);
  // Posts prepared while the item was a draft become ready once it's approved.
  if (decision === 'approved') {
    await db
      .update(schema.platformPosts)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(and(eq(schema.platformPosts.itemId, itemId), eq(schema.platformPosts.versionId, ver.id), eq(schema.platformPosts.status, 'draft')));
  }
  await audit({
    workspaceId,
    actorType: actor.userId ? 'user' : 'worker',
    actorId: actor.userId,
    action: `approval.${decision}`,
    entityType: 'item',
    entityId: itemId,
    level: decision === 'rejected' ? 'warn' : 'info',
    message: `«${item.title.slice(0, 60)}» (версия ${ver.version}) ${decision === 'approved' ? 'согласован' : 'отклонён'}${actor.automatic ? ` (${actor.automatic})` : ''}${comment ? `: ${comment}` : ''}`,
  });
  if (decision === 'approved') {
    const { onItemApproved } = await import('./automation');
    await onItemApproved(itemId);
  }
  return row!;
}

export async function approvalHistory(itemId: string) {
  return db.select().from(schema.approvals).where(eq(schema.approvals.itemId, itemId)).orderBy(desc(schema.approvals.createdAt));
}
