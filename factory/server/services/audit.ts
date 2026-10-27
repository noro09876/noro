import { db, schema } from '../db/client';
import { logger, scrub } from '../lib/logger';

export interface AuditEntry {
  workspaceId?: string | null;
  actorType: 'user' | 'worker' | 'system';
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  level?: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

/** Operation journal shown in the UI. Messages are scrubbed of anything token-like. */
export async function audit(e: AuditEntry) {
  const message = scrub(e.message);
  logger[e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : 'info']({ action: e.action, entity: e.entityType, entityId: e.entityId, ws: e.workspaceId }, message);
  try {
    await db.insert(schema.auditLog).values({
      workspaceId: e.workspaceId ?? null,
      actorType: e.actorType,
      actorId: e.actorId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      level: e.level ?? 'info',
      message,
      data: e.data ?? {},
    });
  } catch (err) {
    logger.error({ err }, 'audit write failed');
  }
}
