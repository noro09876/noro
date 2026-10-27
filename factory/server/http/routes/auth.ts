import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ROLES } from '../../../shared/types';
import { config } from '../../config';
import { db, schema } from '../../db/client';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../../services/audit';
import { DEFAULT_LIMITS, limitsFor, usedToday } from '../../services/providers';
import { createSession, destroySession, parse, requireUser, requireWs } from '../context';

const credsSchema = z.object({ email: z.string().trim().toLowerCase().email('Некорректный email').max(200), password: z.string().min(1).max(200) });
const signupSchema = credsSchema.extend({ name: z.string().trim().min(1, 'Укажите имя').max(80), password: z.string().min(10, 'Пароль — минимум 10 символов').max(200), workspace: z.string().trim().max(80).optional() });

async function workspacesOf(userId: string) {
  return db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name, isDemo: schema.workspaces.isDemo, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(schema.workspaces.isDemo, schema.workspaces.createdAt);
}

/** Every user can look at the demo showcase (read-only). */
async function joinDemo(userId: string) {
  const demos = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.isDemo, true));
  for (const d of demos) await db.insert(schema.memberships).values({ workspaceId: d.id, userId, role: 'viewer' }).onConflictDoNothing();
}

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/api/auth/signup', strict, async (req, reply) => {
    const body = parse(signupSchema, req.body);
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.users)) as [{ n: number }];
    if (!config.signupOpen && n > 0) throw new AppError(403, 'signup_closed', 'Регистрация закрыта. Попросите администратора добавить вас в пространство.');
    const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${body.email}`);
    if (exists) throw conflict('Пользователь с таким email уже есть');
    const user = await db.transaction(async (tx) => {
      const [u] = await tx.insert(schema.users).values({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password) }).returning();
      const [ws] = await tx.insert(schema.workspaces).values({ name: body.workspace || `${body.name}: пространство` }).returning();
      await tx.insert(schema.memberships).values({ workspaceId: ws!.id, userId: u!.id, role: 'owner' });
      return u!;
    });
    await joinDemo(user.id);
    await createSession(reply, user.id, req.headers['user-agent']);
    return { user: { id: user.id, email: user.email, name: user.name }, workspaces: await workspacesOf(user.id) };
  });

  app.post('/api/auth/login', strict, async (req, reply) => {
    const body = parse(credsSchema, req.body);
    const [user] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${body.email}`);
    // Same message and similar work for unknown users: no account enumeration.
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : (await hashPassword(body.password), false);
    if (!user || !ok) throw new AppError(401, 'bad_credentials', 'Неверный email или пароль');
    await joinDemo(user.id);
    await createSession(reply, user.id, req.headers['user-agent']);
    return { user: { id: user.id, email: user.email, name: user.name }, workspaces: await workspacesOf(user.id) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user) return { user: null, workspaces: [], signupOpen: config.signupOpen };
    return { user: { id: req.user.id, email: req.user.email, name: req.user.name }, workspaces: await workspacesOf(req.user.id), signupOpen: config.signupOpen };
  });

  app.post('/api/workspaces', async (req) => {
    const user = requireUser(req);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    const ws = await db.transaction(async (tx) => {
      const [w] = await tx.insert(schema.workspaces).values({ name }).returning();
      await tx.insert(schema.memberships).values({ workspaceId: w!.id, userId: user.id, role: 'owner' });
      return w!;
    });
    return ws;
  });

  /* ---------------- Workspace ---------------- */

  app.get('/api/ws/:ws', async (req) => {
    const { ws, role } = await requireWs(req);
    const limits = await limitsFor(ws.id);
    const used = { llm: await usedToday(ws.id, 'llm'), render: await usedToday(ws.id, 'render'), tts: await usedToday(ws.id, 'tts'), image: await usedToday(ws.id, 'image') };
    return { ...ws, role, limits, defaults: DEFAULT_LIMITS, used };
  });

  app.patch('/api/ws/:ws/settings', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        dailyGenerationLimit: z.number().int().min(1).max(5000).optional(),
        dailyRenderLimit: z.number().int().min(1).max(500).optional(),
        maxItemsPerCampaign: z.number().int().min(1).max(200).optional(),
        timezone: z.string().max(64).optional(),
        retentionDays: z.number().int().min(1).max(3650).optional(),
      }),
      req.body,
    );
    const { name, ...settings } = body;
    const [row] = await db.update(schema.workspaces).set({ ...(name ? { name } : {}), settings: { ...ws.settings, ...settings } }).where(eq(schema.workspaces.id, ws.id)).returning();
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'settings.updated', message: 'Изменены настройки пространства' });
    return row;
  });

  app.get('/api/ws/:ws/members', async (req) => {
    const { ws } = await requireWs(req);
    return db
      .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.memberships.role, since: schema.memberships.createdAt })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.workspaceId, ws.id));
  });

  app.post('/api/ws/:ws/members', async (req) => {
    const { ws, user, role } = await requireWs(req, 'admin');
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES) }), req.body);
    if (body.role === 'owner' && role !== 'owner') throw badRequest('Назначить владельца может только владелец');
    const [u] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${body.email}`);
    if (!u) throw notFound('Пользователь с таким email (он должен сначала зарегистрироваться)');
    await db.insert(schema.memberships).values({ workspaceId: ws.id, userId: u.id, role: body.role }).onConflictDoUpdate({ target: [schema.memberships.workspaceId, schema.memberships.userId], set: { role: body.role } });
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'member.added', message: `${u.email}: роль ${body.role}` });
    return { ok: true };
  });

  app.delete('/api/ws/:ws/members/:userId', async (req) => {
    const { ws, user } = await requireWs(req, 'admin');
    const target = (req.params as { userId: string }).userId;
    const owners = await db.select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, ws.id), eq(schema.memberships.role, 'owner')));
    if (owners.length === 1 && owners[0]!.userId === target) throw conflict('Нельзя удалить единственного владельца');
    await db.delete(schema.memberships).where(and(eq(schema.memberships.workspaceId, ws.id), eq(schema.memberships.userId, target)));
    await audit({ workspaceId: ws.id, actorType: 'user', actorId: user.id, action: 'member.removed', message: `Участник удалён` });
    return { ok: true };
  });

  /* ---------------- Journal ---------------- */

  app.get('/api/ws/:ws/audit', async (req) => {
    const { ws } = await requireWs(req);
    const q = req.query as { level?: string; before?: string; limit?: string; entityId?: string };
    const conds = [eq(schema.auditLog.workspaceId, ws.id)];
    if (q.level) conds.push(inArray(schema.auditLog.level, q.level.split(',')));
    if (q.before) conds.push(lt(schema.auditLog.createdAt, new Date(q.before)));
    if (q.entityId) conds.push(eq(schema.auditLog.entityId, q.entityId));
    return db.select().from(schema.auditLog).where(and(...conds)).orderBy(desc(schema.auditLog.createdAt)).limit(Math.min(200, Number(q.limit) || 50));
  });

  app.get('/api/ws/:ws/usage', async (req) => {
    const { ws } = await requireWs(req);
    const since = new Date(Date.now() - 30 * 86400_000);
    return db
      .select({ day: sql<string>`to_char(${schema.usage.createdAt}, 'YYYY-MM-DD')`, kind: schema.usage.kind, provider: schema.usage.provider, n: sql<number>`sum(${schema.usage.units})::int`, inTok: sql<number>`coalesce(sum(${schema.usage.inputTokens}),0)::int`, outTok: sql<number>`coalesce(sum(${schema.usage.outputTokens}),0)::int` })
      .from(schema.usage)
      .where(and(eq(schema.usage.workspaceId, ws.id), gte(schema.usage.createdAt, since)))
      .groupBy(sql`1`, schema.usage.kind, schema.usage.provider)
      .orderBy(sql`1`);
  });
}
