import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client';
import { decrypt, encrypt, mask } from '../lib/crypto';
import { AppError, ExternalError } from '../lib/errors';
import { findImage, findLlm, findTts } from '../providers/registry';
import type { LlmRequest, LlmResult, ProviderRuntime } from '../providers/types';

export type ProviderRow = typeof schema.providerConfigs.$inferSelect;

export function runtimeOf(row: ProviderRow): ProviderRuntime {
  return { apiKey: row.secretEnc ? decrypt(row.secretEnc) : undefined, model: row.model, settings: row.settings ?? {} };
}

export async function defaultProvider(workspaceId: string, kind: 'llm' | 'image' | 'tts'): Promise<ProviderRow | null> {
  const rows = await db.select().from(schema.providerConfigs).where(and(eq(schema.providerConfigs.workspaceId, workspaceId), eq(schema.providerConfigs.kind, kind)));
  return rows.find((r) => r.isDefault) ?? rows[0] ?? null;
}

export async function saveProvider(input: {
  workspaceId: string;
  id?: string;
  kind: 'llm' | 'image' | 'tts';
  provider: string;
  label?: string;
  model?: string;
  settings?: Record<string, string>;
  apiKey?: string | null;
  isDefault?: boolean;
}) {
  const impl = input.kind === 'llm' ? findLlm(input.provider) : input.kind === 'image' ? findImage(input.provider) : findTts(input.provider);
  if (!impl) throw new AppError(400, 'unknown_provider', 'Неизвестный провайдер');
  const values = {
    workspaceId: input.workspaceId,
    kind: input.kind,
    provider: input.provider,
    label: input.label || impl.info.name,
    model: input.model || impl.info.defaultModel || '',
    settings: input.settings ?? {},
    isDefault: input.isDefault ?? false,
    status: 'unchecked',
    lastError: null,
  };
  const secret = input.apiKey ? { secretEnc: encrypt(input.apiKey), secretHint: mask(input.apiKey) } : {};
  return db.transaction(async (tx) => {
    if (values.isDefault) {
      await tx.update(schema.providerConfigs).set({ isDefault: false }).where(and(eq(schema.providerConfigs.workspaceId, input.workspaceId), eq(schema.providerConfigs.kind, input.kind)));
    }
    if (input.id) {
      const [row] = await tx
        .update(schema.providerConfigs)
        .set({ ...values, ...secret })
        .where(and(eq(schema.providerConfigs.id, input.id), eq(schema.providerConfigs.workspaceId, input.workspaceId)))
        .returning();
      if (!row) throw new AppError(404, 'not_found', 'Провайдер не найден');
      return row;
    }
    const existing = await tx.select({ id: schema.providerConfigs.id }).from(schema.providerConfigs).where(and(eq(schema.providerConfigs.workspaceId, input.workspaceId), eq(schema.providerConfigs.kind, input.kind)));
    const [row] = await tx.insert(schema.providerConfigs).values({ ...values, isDefault: values.isDefault || existing.length === 0, ...secret }).returning();
    return row!;
  });
}

/** Public shape — never contains the secret. */
export function publicProvider(r: ProviderRow) {
  return {
    id: r.id,
    kind: r.kind,
    provider: r.provider,
    label: r.label,
    model: r.model,
    settings: r.settings,
    hasKey: !!r.secretEnc,
    keyHint: r.secretHint,
    isDefault: r.isDefault,
    status: r.status,
    lastError: r.lastError,
    lastCheckedAt: r.lastCheckedAt,
  };
}

export async function checkProvider(row: ProviderRow): Promise<{ ok: boolean; message: string }> {
  const impl = row.kind === 'llm' ? findLlm(row.provider) : row.kind === 'image' ? findImage(row.provider) : findTts(row.provider);
  if (!impl) return { ok: false, message: 'Провайдер недоступен' };
  try {
    const message = await impl.check(runtimeOf(row));
    await db.update(schema.providerConfigs).set({ status: 'ok', lastError: null, lastCheckedAt: new Date() }).where(eq(schema.providerConfigs.id, row.id));
    return { ok: true, message };
  } catch (e) {
    const message = e instanceof ExternalError ? e.message : `Проверка не удалась: ${(e as Error).message}`;
    await db.update(schema.providerConfigs).set({ status: 'error', lastError: message, lastCheckedAt: new Date() }).where(eq(schema.providerConfigs.id, row.id));
    return { ok: false, message };
  }
}

/* ---------------- Limits ---------------- */

export const DEFAULT_LIMITS = { dailyGenerationLimit: 200, dailyRenderLimit: 30, maxItemsPerCampaign: 40 };

export async function limitsFor(workspaceId: string) {
  const [ws] = await db.select({ settings: schema.workspaces.settings }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  return { ...DEFAULT_LIMITS, ...(ws?.settings ?? {}) };
}

export async function usedToday(workspaceId: string, kind: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.usage.units}),0)::int` })
    .from(schema.usage)
    .where(and(eq(schema.usage.workspaceId, workspaceId), eq(schema.usage.kind, kind), gte(schema.usage.createdAt, since)));
  return r?.n ?? 0;
}

export async function assertWithinLimit(workspaceId: string, kind: 'llm' | 'render' | 'tts' | 'image') {
  const limits = await limitsFor(workspaceId);
  const max = kind === 'render' ? limits.dailyRenderLimit : limits.dailyGenerationLimit;
  const used = await usedToday(workspaceId, kind);
  if (used >= max) {
    throw new ExternalError('Лимиты', 'limit_reached', `Достигнут суточный лимит (${kind === 'render' ? 'рендеров' : 'генераций'}: ${used}/${max}). Измените лимит в настройках или дождитесь завтра.`, false);
  }
}

export async function recordUsage(workspaceId: string, kind: string, provider: string, u: { inputTokens?: number; outputTokens?: number } = {}) {
  await db.insert(schema.usage).values({ workspaceId, kind, provider, units: 1, inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null });
}

/* ---------------- LLM call helper ---------------- */

export class NoProviderError extends ExternalError {
  constructor(kind: string) {
    super('Провайдеры', 'no_provider', kind === 'llm' ? 'Языковая модель не подключена. Откройте «Настройки → Провайдеры ИИ» и добавьте ключ.' : `Провайдер «${kind}» не подключён`, false);
  }
}

export async function generateWithLlm<T>(
  workspaceId: string,
  req: Omit<LlmRequest<T>, 'jsonSchema'>,
): Promise<LlmResult<T> & { provider: string; source: 'ai' | 'test' }> {
  const row = await defaultProvider(workspaceId, 'llm');
  if (!row) throw new NoProviderError('llm');
  const impl = findLlm(row.provider);
  if (!impl) throw new NoProviderError('llm');
  await assertWithinLimit(workspaceId, 'llm');
  const jsonSchema = z.toJSONSchema(req.schema as z.ZodType, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const res = await impl.generate(runtimeOf(row), { ...req, jsonSchema });
  await recordUsage(workspaceId, 'llm', row.provider, res.usage);
  return { ...res, provider: row.provider, source: impl.info.testOnly ? 'test' : 'ai' };
}
