import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { notFound } from '../lib/errors';
import type { BrandProfile, ContentKind, VersionSource } from '../../shared/types';
import { storage } from '../storage';

export type Item = typeof schema.contentItems.$inferSelect;
export type Version = typeof schema.contentVersions.$inferSelect;
export type Campaign = typeof schema.campaigns.$inferSelect;
export type Asset = typeof schema.assets.$inferSelect;
export type BrandRow = typeof schema.brands.$inferSelect;

export function brandProfile(b: BrandRow): BrandProfile {
  return {
    name: b.name,
    description: b.description,
    product: b.product,
    audience: b.audience,
    goals: b.goals,
    tone: b.tone,
    vocabulary: b.vocabulary,
    visual: b.visual,
    forbidden: b.forbidden,
    examplesGood: b.examplesGood,
    examplesBad: b.examplesBad,
  };
}

export async function getCampaign(id: string, workspaceId?: string): Promise<Campaign> {
  const [c] = await db
    .select()
    .from(schema.campaigns)
    .where(workspaceId ? and(eq(schema.campaigns.id, id), eq(schema.campaigns.workspaceId, workspaceId)) : eq(schema.campaigns.id, id));
  if (!c) throw notFound('Кампания');
  return c;
}

export async function getBrand(id: string): Promise<BrandRow> {
  const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, id));
  if (!b) throw notFound('Бренд');
  return b;
}

export async function getItem(id: string, workspaceId?: string): Promise<Item> {
  const [i] = await db
    .select()
    .from(schema.contentItems)
    .where(workspaceId ? and(eq(schema.contentItems.id, id), eq(schema.contentItems.workspaceId, workspaceId)) : eq(schema.contentItems.id, id));
  if (!i) throw notFound('Материал');
  return i;
}

export async function getVersion(id: string): Promise<Version> {
  const [v] = await db.select().from(schema.contentVersions).where(eq(schema.contentVersions.id, id));
  if (!v) throw notFound('Версия');
  return v;
}

export async function currentVersion(item: Item): Promise<Version | null> {
  if (!item.currentVersionId) return null;
  return getVersion(item.currentVersionId);
}

export async function listVersions(itemId: string) {
  return db.select().from(schema.contentVersions).where(eq(schema.contentVersions.itemId, itemId)).orderBy(desc(schema.contentVersions.version));
}

/** Appends a version and makes it current. Any pending approval of an older version is cancelled. */
export async function addVersion(
  item: Pick<Item, 'id'>,
  v: { data: Record<string, unknown>; source: VersionSource; provider?: string | null; model?: string | null; note?: string | null; createdBy?: string | null },
): Promise<Version> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`coalesce(max(${schema.contentVersions.version}),0)::int` })
      .from(schema.contentVersions)
      .where(eq(schema.contentVersions.itemId, item.id));
    const [ver] = await tx
      .insert(schema.contentVersions)
      .values({ itemId: item.id, version: (row?.n ?? 0) + 1, data: v.data, source: v.source, provider: v.provider ?? null, model: v.model ?? null, note: v.note ?? null, createdBy: v.createdBy ?? null })
      .returning();
    await tx.update(schema.contentItems).set({ currentVersionId: ver!.id, updatedAt: new Date(), lastError: null }).where(eq(schema.contentItems.id, item.id));
    await tx
      .update(schema.approvals)
      .set({ status: 'cancelled', comment: 'Создана новая версия', decidedAt: new Date() })
      .where(and(eq(schema.approvals.itemId, item.id), eq(schema.approvals.status, 'pending')));
    return ver!;
  });
}

export async function setItemStatus(id: string, status: Item['status'], lastError: string | null = null) {
  await db.update(schema.contentItems).set({ status, lastError, updatedAt: new Date() }).where(eq(schema.contentItems.id, id));
}

export async function versionAssets(versionId: string): Promise<Asset[]> {
  return db.select().from(schema.assets).where(eq(schema.assets.versionId, versionId)).orderBy(asc(schema.assets.role), asc(schema.assets.createdAt));
}

export async function itemAssetsByVersion(versionIds: string[]): Promise<Map<string, Asset[]>> {
  const map = new Map<string, Asset[]>();
  if (!versionIds.length) return map;
  const rows = await db.select().from(schema.assets).where(inArray(schema.assets.versionId, versionIds)).orderBy(asc(schema.assets.role));
  for (const r of rows) {
    const k = r.versionId!;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return map;
}

export async function saveAsset(a: {
  workspaceId: string;
  campaignId?: string | null;
  itemId?: string | null;
  versionId?: string | null;
  kind: Asset['kind'];
  role: string;
  mime: string;
  file?: string;
  buffer?: Buffer;
  ext: string;
  width?: number;
  height?: number;
  durationMs?: number;
  source?: VersionSource;
  meta?: Record<string, unknown>;
  isDemo?: boolean;
}): Promise<Asset> {
  const id = crypto.randomUUID();
  const key = `ws/${a.workspaceId}/${a.itemId ? `items/${a.itemId}` : 'misc'}/${id}.${a.ext}`;
  const s = storage();
  let bytes = 0;
  if (a.file) {
    await s.putFile(key, a.file, a.mime);
    bytes = (await import('node:fs')).statSync(a.file).size;
  } else if (a.buffer) {
    await s.put(key, a.buffer, a.mime);
    bytes = a.buffer.length;
  }
  const [row] = await db
    .insert(schema.assets)
    .values({
      id,
      workspaceId: a.workspaceId,
      campaignId: a.campaignId ?? null,
      itemId: a.itemId ?? null,
      versionId: a.versionId ?? null,
      kind: a.kind,
      role: a.role,
      mime: a.mime,
      storageKey: key,
      bytes,
      width: a.width ?? null,
      height: a.height ?? null,
      durationMs: a.durationMs ?? null,
      source: a.source ?? 'template',
      meta: a.meta ?? {},
      isDemo: a.isDemo ?? false,
    })
    .returning();
  return row!;
}

export const ITEM_ORDER: ContentKind[] = ['post', 'carousel', 'graphic', 'video_script', 'video'];
