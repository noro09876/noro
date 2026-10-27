import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import type { z } from 'zod';
import type { Role } from '../../shared/types';
import { config } from '../config';
import { db, schema } from '../db/client';
import { randomToken, sha256 } from '../lib/crypto';
import { AppError, badRequest, forbidden } from '../lib/errors';

export const SESSION_COOKIE = 'noro_session';
const SESSION_DAYS = 30;

export type UserRow = typeof schema.users.$inferSelect;
export type WorkspaceRow = typeof schema.workspaces.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    ws: WorkspaceRow | null;
    role: Role | null;
  }
}

/* ---------------- Sessions ---------------- */

export async function createSession(reply: FastifyReply, userId: string, userAgent?: string) {
  const token = randomToken(32);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000), userAgent: userAgent?.slice(0, 200) });
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https://'), path: '/', maxAge: SESSION_DAYS * 86400 });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadUser(req: FastifyRequest): Promise<UserRow | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const [row] = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

/* ---------------- RBAC ---------------- */

export type Action = 'read' | 'edit' | 'approve' | 'publish' | 'admin' | 'owner';

const MATRIX: Record<Role, Action[]> = {
  owner: ['read', 'edit', 'approve', 'publish', 'admin', 'owner'],
  admin: ['read', 'edit', 'approve', 'publish', 'admin'],
  editor: ['read', 'edit', 'publish'],
  approver: ['read', 'approve'],
  viewer: ['read'],
};

export function can(role: Role | null, action: Action) {
  return !!role && MATRIX[role].includes(action);
}

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw new AppError(401, 'unauthorized', 'Войдите в систему');
  return req.user;
}

/** Resolves `:ws` from the route, checks membership and the required permission. */
export async function requireWs(req: FastifyRequest, action: Action = 'read'): Promise<{ ws: WorkspaceRow; user: UserRow; role: Role }> {
  const user = requireUser(req);
  const wsId = (req.params as { ws?: string }).ws;
  if (!wsId || !/^[0-9a-f-]{36}$/.test(wsId)) throw badRequest('Не указано рабочее пространство');
  const [m] = await db
    .select({ ws: schema.workspaces, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(and(eq(schema.memberships.workspaceId, wsId), eq(schema.memberships.userId, user.id)));
  if (!m) throw new AppError(404, 'not_found', 'Рабочее пространство не найдено');
  if (!can(m.role, action)) throw forbidden(`Недостаточно прав: роль «${m.role}» не может выполнить это действие`);
  // The demo showcase is read-only for everyone except its seed process.
  if (m.ws.isDemo && action !== 'read') throw forbidden('Демо-пространство только для просмотра. Создайте своё пространство, чтобы работать с материалами.');
  req.ws = m.ws;
  req.role = m.role;
  return { ws: m.ws, user, role: m.role };
}

/* ---------------- Validation ---------------- */

export function parse<T extends z.ZodType>(s: T, data: unknown): z.infer<T> {
  const r = s.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(`Проверьте поля: ${issues.map((i) => (i.path ? `${i.path} — ${i.message}` : i.message)).join('; ')}`, { issues });
  }
  return r.data;
}

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function idParam(req: FastifyRequest, key = 'id'): string {
  const v = (req.params as Record<string, string>)[key];
  if (!v || !uuidRe.test(v)) throw badRequest('Некорректный идентификатор');
  return v;
}
