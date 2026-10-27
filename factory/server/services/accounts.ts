import crypto from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { isPlatformId, type PlatformId } from '../../shared/platforms';
import { config } from '../config';
import { db, schema } from '../db/client';
import { decrypt, decryptJson, encrypt, encryptJson, mask } from '../lib/crypto';
import { AppError, ExternalError } from '../lib/errors';
import { adapter } from '../integrations/registry';
import type { AccountCtx, Credentials, OAuthApp, TokenSet } from '../integrations/types';
import { audit } from './audit';

export type AccountRow = typeof schema.socialAccounts.$inferSelect;

export function accountCtx(row: AccountRow): AccountCtx {
  return { id: row.id, creds: decryptJson<Credentials>(row.credentialsEnc), meta: row.meta, externalId: row.externalId };
}

export function publicAccount(row: AccountRow) {
  return {
    id: row.id,
    platform: row.platform,
    displayName: row.displayName,
    externalId: row.externalId,
    status: row.status,
    scopes: row.scopes,
    tokenExpiresAt: row.tokenExpiresAt,
    meta: Object.fromEntries(Object.entries(row.meta).filter(([k]) => !/token|secret/i.test(k))),
    lastCheckedAt: row.lastCheckedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

/* ---------- OAuth applications ---------- */

export async function getApp(workspaceId: string, platform: PlatformId): Promise<OAuthApp | null> {
  const [row] = await db.select().from(schema.integrationApps).where(and(eq(schema.integrationApps.workspaceId, workspaceId), eq(schema.integrationApps.platform, platform)));
  const redirectUri = `${config.publicUrl}/api/oauth/callback/${platform}`;
  if (row) return { clientId: row.clientId, clientSecret: decrypt(row.secretEnc), redirectUri };
  // Fallback: app credentials from the environment (single-tenant deployments).
  const id = process.env[`${platform.toUpperCase()}_CLIENT_ID`];
  const secret = process.env[`${platform.toUpperCase()}_CLIENT_SECRET`];
  return id && secret ? { clientId: id, clientSecret: secret, redirectUri } : null;
}

export async function saveApp(workspaceId: string, platform: PlatformId, clientId: string, clientSecret: string) {
  await db
    .insert(schema.integrationApps)
    .values({ workspaceId, platform, clientId, secretEnc: encrypt(clientSecret), secretHint: mask(clientSecret) })
    .onConflictDoUpdate({ target: [schema.integrationApps.workspaceId, schema.integrationApps.platform], set: { clientId, secretEnc: encrypt(clientSecret), secretHint: mask(clientSecret) } });
}

/* ---------- Token connections ---------- */

export async function connectWithToken(workspaceId: string, userId: string, platform: PlatformId, fields: Record<string, string>, opts: { test?: boolean } = {}) {
  const a = adapter(platform);
  if (a.connect !== 'token') throw new AppError(400, 'bad_connect', 'Эта площадка подключается через OAuth');
  const creds: Credentials = { botToken: fields.botToken?.trim() };
  const meta: Record<string, unknown> = { chatId: fields.chatId?.trim(), test: !!opts.test };
  const v = await a.verify(creds, meta);
  const [row] = await db
    .insert(schema.socialAccounts)
    .values({ workspaceId, platform, displayName: v.displayName, externalId: v.externalId, status: 'connected', scopes: v.scopes, credentialsEnc: encryptJson(creds), tokenExpiresAt: v.expiresAt ?? null, meta: { ...meta, ...v.meta, warnings: v.warnings ?? [] }, lastCheckedAt: new Date() })
    .returning();
  await audit({ workspaceId, actorType: 'user', actorId: userId, action: 'account.connected', entityType: 'account', entityId: row!.id, message: `Подключён ${platform}: ${v.displayName}${opts.test ? ' (тестовый)' : ''}` });
  return row!;
}

/* ---------- OAuth connections ---------- */

export async function startOAuth(workspaceId: string, userId: string, platform: PlatformId, opts: { test?: boolean } = {}) {
  const a = adapter(platform);
  if (a.connect !== 'oauth' || !a.authorizeUrl) throw new AppError(400, 'bad_connect', 'Площадка не поддерживает OAuth');
  const app = await getApp(workspaceId, platform);
  if (!app) throw new AppError(412, 'no_app', 'Сначала укажите данные приложения в «Настройки → Интеграции»');
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  await db.insert(schema.oauthStates).values({ state, workspaceId, userId, platform, codeVerifier: verifier, meta: { test: !!opts.test }, expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
  return a.authorizeUrl(app, state, challenge);
}

export async function finishOAuth(platform: string, query: Record<string, string>) {
  if (!isPlatformId(platform)) throw new AppError(400, 'bad_platform', 'Неизвестная площадка');
  const state = query.state ?? '';
  const [st] = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  if (!st || st.platform !== platform || st.expiresAt < new Date()) throw new AppError(400, 'bad_state', 'Сессия подключения устарела. Начните подключение заново.');
  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  if (query.error) throw new AppError(400, 'denied', `Площадка отказала в доступе: ${query.error_description ?? query.error}`);
  const a = adapter(platform);
  const app = await getApp(st.workspaceId, platform);
  if (!app || !a.exchangeCode) throw new AppError(412, 'no_app', 'Не настроено приложение площадки');
  const tokens = await a.exchangeCode(app, query.code ?? '', st.codeVerifier ?? '', query);
  const creds = credsFrom(tokens);
  const meta: Record<string, unknown> = { test: !!st.meta.test };
  // VK: one login → choose a community later; save a pending account now.
  const needsTarget = !!a.listTargets;
  let v = needsTarget ? null : await a.verify(creds, meta, app);
  const [row] = await db
    .insert(schema.socialAccounts)
    .values({
      workspaceId: st.workspaceId,
      platform,
      displayName: v?.displayName ?? 'Выберите сообщество',
      externalId: v?.externalId ?? null,
      status: v ? 'connected' : 'error',
      lastError: v ? null : 'Выберите сообщество для публикаций',
      scopes: tokens.scopes ?? v?.scopes ?? [],
      credentialsEnc: encryptJson(creds),
      tokenExpiresAt: tokens.expiresAt ?? null,
      meta: { ...meta, ...(v?.meta ?? {}), warnings: v?.warnings ?? [] },
      lastCheckedAt: new Date(),
    })
    .returning();
  v = v ?? null;
  await audit({ workspaceId: st.workspaceId, actorType: 'user', actorId: st.userId, action: 'account.connected', entityType: 'account', entityId: row!.id, message: `Авторизация ${platform} выполнена` });
  return row!;
}

function credsFrom(t: TokenSet, prev: Credentials = {}): Credentials {
  return { ...prev, accessToken: t.accessToken, refreshToken: t.refreshToken ?? prev.refreshToken, userId: t.userId ?? prev.userId, deviceId: t.deviceId ?? prev.deviceId };
}

export async function chooseTarget(row: AccountRow, targetId: string) {
  const a = adapter(row.platform as PlatformId);
  const ctx = accountCtx(row);
  const v = await a.verify(ctx.creds, { ...row.meta, groupId: targetId });
  const [up] = await db
    .update(schema.socialAccounts)
    .set({ displayName: v.displayName, externalId: v.externalId, status: 'connected', lastError: null, meta: { ...row.meta, ...v.meta }, lastCheckedAt: new Date() })
    .where(eq(schema.socialAccounts.id, row.id))
    .returning();
  return up!;
}

/** Re-validates an account: refreshes the token when the API supports it, re-checks permissions. */
export async function checkAccount(row: AccountRow): Promise<AccountRow> {
  const platform = row.platform as PlatformId;
  const a = adapter(platform);
  let creds = accountCtx(row).creds;
  let expiresAt = row.tokenExpiresAt;
  try {
    if (a.refresh && expiresAt && expiresAt.getTime() - Date.now() < 7 * 24 * 3600 * 1000) {
      const app = await getApp(row.workspaceId, platform);
      if (app) {
        const t = await a.refresh(app, creds);
        creds = credsFrom(t, creds);
        expiresAt = t.expiresAt ?? null;
      }
    }
    const v = await a.verify(creds, row.meta, (await getApp(row.workspaceId, platform)) ?? undefined);
    const [up] = await db
      .update(schema.socialAccounts)
      .set({ status: 'connected', lastError: null, credentialsEnc: encryptJson(creds), tokenExpiresAt: expiresAt, displayName: v.displayName, meta: { ...row.meta, ...v.meta, warnings: v.warnings ?? [] }, lastCheckedAt: new Date() })
      .where(eq(schema.socialAccounts.id, row.id))
      .returning();
    return up!;
  } catch (e) {
    const msg = e instanceof ExternalError ? e.message : (e as Error).message;
    const status = e instanceof ExternalError && e.code === 'auth' ? 'expired' : 'error';
    const [up] = await db.update(schema.socialAccounts).set({ status, lastError: msg, lastCheckedAt: new Date() }).where(eq(schema.socialAccounts.id, row.id)).returning();
    await audit({ workspaceId: row.workspaceId, actorType: 'worker', action: 'account.check_failed', entityType: 'account', entityId: row.id, level: 'warn', message: `${row.displayName}: ${msg}` });
    return up!;
  }
}

/** Refreshes tokens that expire within 7 days (cron). */
export async function refreshExpiring() {
  const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const rows = await db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.status, 'connected'), lt(schema.socialAccounts.tokenExpiresAt, soon)));
  for (const r of rows) await checkAccount(r);
  return rows.length;
}

/** Applies a refreshed token set during publishing (expired access token, valid refresh token). */
export async function refreshForPublish(row: AccountRow): Promise<AccountRow | null> {
  const platform = row.platform as PlatformId;
  const a = adapter(platform);
  if (!a.refresh) return null;
  const app = await getApp(row.workspaceId, platform);
  if (!app) return null;
  try {
    const t = await a.refresh(app, accountCtx(row).creds);
    const [up] = await db
      .update(schema.socialAccounts)
      .set({ credentialsEnc: encryptJson(credsFrom(t, accountCtx(row).creds)), tokenExpiresAt: t.expiresAt ?? null, status: 'connected', lastError: null })
      .where(eq(schema.socialAccounts.id, row.id))
      .returning();
    return up!;
  } catch {
    return null;
  }
}
