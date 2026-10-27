import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { STAGES, type Stage, type StageStatus } from '../../shared/types';

/** Explicitly tracked stages (job-driven). Other stages are derived from items and posts. */
export async function setStage(campaignId: string, stage: Stage, status: StageStatus, detail?: string | null, error?: string | null) {
  const now = new Date();
  await db
    .insert(schema.pipelineStages)
    .values({ campaignId, stage, status, detail: detail ?? null, error: error ?? null, startedAt: status === 'running' ? now : null, finishedAt: ['done', 'failed', 'skipped'].includes(status) ? now : null, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.pipelineStages.campaignId, schema.pipelineStages.stage],
      set: {
        status,
        detail: detail ?? null,
        error: error ?? null,
        updatedAt: now,
        ...(status === 'running' ? { startedAt: now, finishedAt: null } : {}),
        ...(['done', 'failed', 'skipped'].includes(status) ? { finishedAt: now } : {}),
      },
    });
}

export interface StageView {
  stage: Stage;
  status: StageStatus;
  detail: string;
  error?: string | null;
  done: number;
  total: number;
}

/**
 * Computes the pipeline rail from real state. Nothing here is decorative:
 * every status is derived from items, checks, approvals and posts in the database.
 */
export async function computeStages(campaignId: string): Promise<StageView[]> {
  const [camp] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
  const tracked = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.campaignId, campaignId));
  const items = await db.select().from(schema.contentItems).where(eq(schema.contentItems.campaignId, campaignId));
  const posts = await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.campaignId, campaignId));
  const checks = items.length ? await db.select().from(schema.qualityChecks).where(inArray(schema.qualityChecks.itemId, items.map((i) => i.id))) : [];
  const metrics = posts.length ? await db.select({ postId: schema.postMetrics.postId }).from(schema.postMetrics).where(inArray(schema.postMetrics.postId, posts.map((p) => p.id))) : [];

  const byStage = new Map(tracked.map((t) => [t.stage, t]));
  const out: StageView[] = [];
  const push = (stage: Stage, status: StageStatus, detail: string, done = 0, total = 0, error?: string | null) => out.push({ stage, status, detail, done, total, error });

  // idea
  push('idea', camp ? 'done' : 'pending', camp ? 'Бриф сохранён' : 'Нет брифа');

  // strategy
  const st = byStage.get('strategy');
  if (st) push('strategy', st.status, st.detail ?? '', camp?.plan?.length ?? 0, camp?.plan?.length ?? 0, st.error);
  else push('strategy', camp?.strategy ? 'done' : 'pending', camp?.strategy ? 'Стратегия и план готовы' : 'Ожидает запуска');

  // generation — text content of every item
  const gen = items;
  const genDone = gen.filter((i) => i.currentVersionId).length;
  const genFailed = gen.filter((i) => i.status === 'failed' && !i.currentVersionId);
  const genRunning = gen.some((i) => i.status === 'generating' && !i.currentVersionId);
  push(
    'generation',
    !gen.length ? 'pending' : genFailed.length ? 'failed' : genRunning ? 'running' : genDone === gen.length ? 'done' : 'pending',
    gen.length ? `${genDone} из ${gen.length} материалов` : 'Нет материалов',
    genDone,
    gen.length,
    genFailed[0]?.lastError,
  );

  // design — visual items need rendered assets
  const visual = items.filter((i) => ['carousel', 'graphic', 'video'].includes(i.kind));
  const designDone = visual.filter((i) => i.currentVersionId && i.status !== 'generating' && !(i.status === 'failed')).length;
  const designFailed = visual.filter((i) => i.status === 'failed' && i.currentVersionId);
  const designRunning = visual.some((i) => i.status === 'generating' && i.currentVersionId);
  push(
    'design',
    !visual.length ? 'skipped' : designFailed.length ? 'failed' : designRunning ? 'running' : designDone === visual.length ? 'done' : 'pending',
    visual.length ? `${designDone} из ${visual.length} визуальных материалов` : 'В кампании нет визуальных форматов',
    designDone,
    visual.length,
    designFailed[0]?.lastError,
  );

  // review — latest check per item
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) {
    const prev = latest.get(c.itemId);
    if (!prev || prev.createdAt < c.createdAt) latest.set(c.itemId, c);
  }
  const ready = items.filter((i) => i.currentVersionId);
  const checked = ready.filter((i) => latest.get(i.id)?.versionId === i.currentVersionId);
  const failing = checked.filter((i) => !latest.get(i.id)!.passed);
  push(
    'review',
    !ready.length ? 'pending' : failing.length ? 'needs_input' : checked.length === ready.length ? 'done' : 'running',
    failing.length ? `Ошибки проверки: ${failing.length}` : `${checked.length} из ${ready.length} проверено`,
    checked.length - failing.length,
    ready.length,
  );

  // approval
  const approved = items.filter((i) => i.status === 'approved').length;
  const inReview = items.filter((i) => i.status === 'in_review').length;
  const rejected = items.filter((i) => i.status === 'rejected').length;
  push(
    'approval',
    !items.length ? 'pending' : approved === items.length ? 'done' : inReview || rejected ? 'needs_input' : 'pending',
    `${approved} согласовано${inReview ? `, ${inReview} ждут решения` : ''}${rejected ? `, ${rejected} отклонено` : ''}`,
    approved,
    items.length,
  );

  // scheduling
  const live = posts.filter((p) => p.status !== 'cancelled');
  const planned = live.filter((p) => p.scheduledAt || ['published', 'manual_done', 'publishing'].includes(p.status)).length;
  push(
    'scheduling',
    !live.length ? (approved ? 'needs_input' : 'pending') : planned === live.length ? 'done' : 'needs_input',
    live.length ? `${planned} из ${live.length} публикаций в календаре` : approved ? 'Подготовьте публикации для площадок' : 'Ожидает согласования',
    planned,
    live.length,
  );

  // publishing
  const published = live.filter((p) => p.status === 'published' || p.status === 'manual_done').length;
  const failed = live.filter((p) => p.status === 'failed');
  const manual = live.filter((p) => p.status === 'manual_pending').length;
  const publishing = live.some((p) => p.status === 'publishing');
  push(
    'publishing',
    !live.length ? 'pending' : failed.length ? 'failed' : publishing ? 'running' : manual ? 'needs_input' : published === live.length ? 'done' : 'pending',
    live.length ? `${published} из ${live.length} опубликовано${manual ? `, ${manual} ждут ручного размещения` : ''}` : 'Нет публикаций',
    published,
    live.length,
    failed[0]?.lastError,
  );

  // analytics
  const withMetrics = new Set(metrics.map((m) => m.postId));
  const measured = live.filter((p) => withMetrics.has(p.id)).length;
  push('analytics', measured ? 'done' : published ? 'running' : 'pending', measured ? `Статистика по ${measured} публикациям` : published ? 'Ожидаем данные площадок' : 'Нет опубликованных материалов', measured, published);

  return STAGES.map((s) => out.find((o) => o.stage === s)!);
}
