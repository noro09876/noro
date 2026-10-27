/**
 * Builds the isolated demo workspace «Демо: Veltro» from showcase/campaign.json.
 *
 * Texts are prepared in advance and stored with source=demo (they are NOT presented
 * as model output). Visuals, voiceover, subtitles and video are produced by the real
 * factory pipeline: the same Remotion templates, Piper TTS and quality checks that
 * user campaigns use. Demo posts are never sent anywhere: the scheduler and the
 * publisher skip every row with is_demo=true.
 *
 *   npm run showcase:build            rebuild (drops the previous demo workspace)
 *   npm run showcase:build -- --no-video   skip the slow video render
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { PLATFORMS, type PlatformId } from '../shared/platforms';
import { planDate } from '../shared/time';
import type { CampaignBrief, ContentKind, PlanEntry, StrategyData, VideoData, VideoScriptData } from '../shared/types';
import { ROOT } from '../server/config';
import { closeDb, db, schema } from '../server/db/client';
import { runMigrations } from '../server/db/migrate';
import { stopBoss } from '../server/jobs/queue';
import { runChecks, runDesign, runVideo } from '../server/pipeline/run';
import { setStage } from '../server/pipeline/stages';
import { audit } from '../server/services/audit';
import { addVersion, getItem } from '../server/services/content';
import { preparePosts } from '../server/services/posts';
import { decide, requestReview } from '../server/services/review';
import { storage } from '../server/storage';

interface ShowItem {
  kind: ContentKind;
  day: number;
  time: string;
  pillar: string;
  platforms: PlatformId[];
  title: string;
  data: Record<string, unknown>;
  approval: 'approved' | 'in_review' | 'ready';
  render?: boolean;
}
interface Showcase {
  brand: Omit<typeof schema.brands.$inferInsert, 'workspaceId'>;
  campaign: { title: string; brief: CampaignBrief; strategy: StrategyData };
  items: ShowItem[];
}

const WS_NAME = 'Демо: Veltro';
const noVideo = process.argv.includes('--no-video');
const log = (s: string) => console.log(`· ${s}`);

async function dropPrevious() {
  const old = await db.select().from(schema.workspaces).where(and(eq(schema.workspaces.isDemo, true), eq(schema.workspaces.name, WS_NAME)));
  for (const ws of old) {
    const files = await db.select({ key: schema.assets.storageKey }).from(schema.assets).where(eq(schema.assets.workspaceId, ws.id));
    for (const f of files) await storage().delete(f.key).catch(() => undefined);
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
    log(`Удалено прежнее демо-пространство (${files.length} файлов)`);
  }
}

async function main() {
  const src: Showcase = JSON.parse(fs.readFileSync(path.join(ROOT, 'showcase/campaign.json'), 'utf8'));
  await runMigrations();
  await dropPrevious();

  const [ws] = await db.insert(schema.workspaces).values({ name: WS_NAME, isDemo: true, settings: { timezone: src.campaign.brief.timezone, dailyRenderLimit: 200 } }).returning();
  const [brand] = await db.insert(schema.brands).values({ ...src.brand, workspaceId: ws!.id, isDemo: true }).returning();

  const sorted = [...src.items].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
  const plan: PlanEntry[] = sorted.map((i) => ({ day: i.day, time: i.time, kind: i.kind, pillar: i.pillar, topic: i.title, angle: i.title, platforms: i.platforms }));
  const [camp] = await db
    .insert(schema.campaigns)
    .values({ workspaceId: ws!.id, brandId: brand!.id, title: src.campaign.title, brief: src.campaign.brief, strategy: src.campaign.strategy, plan, strategySource: 'demo', isDemo: true })
    .returning();
  await setStage(camp!.id, 'strategy', 'done', `Стратегия и план (${plan.length}) — демо-данные витрины`);
  log(`Кампания «${camp!.title}»: ${plan.length} материалов в плане`);

  const tz = src.campaign.brief.timezone;
  const made: { id: string; show: ShowItem }[] = [];
  for (const [i, show] of sorted.entries()) {
    const [item] = await db
      .insert(schema.contentItems)
      .values({ campaignId: camp!.id, workspaceId: ws!.id, kind: show.kind, title: show.title, pillar: show.pillar, planIndex: i, plannedAt: planDate(src.campaign.brief.startDate, show.day, show.time, tz), platforms: show.platforms, status: 'generating', isDemo: true })
      .returning();
    const ver = await addVersion(item!, { data: show.data, source: 'demo', note: 'Текст витрины, подготовлен заранее' });
    if (show.kind === 'carousel' || show.kind === 'graphic') {
      log(`Рендер ${show.kind === 'carousel' ? 'карусели' : 'графики'}: ${show.title}`);
      await runDesign(item!.id, ver.id);
    } else {
      await runChecks(item!.id);
    }
    made.push({ id: item!.id, show });

    if (show.kind === 'video_script' && show.render && !noVideo) {
      const platforms = show.platforms.filter((p) => PLATFORMS[p].preparedMedia.includes('video'));
      const [video] = await db
        .insert(schema.contentItems)
        .values({ campaignId: camp!.id, workspaceId: ws!.id, kind: 'video', title: show.title, pillar: show.pillar, plannedAt: item!.plannedAt, platforms, parentItemId: item!.id, status: 'generating', isDemo: true })
        .returning();
      const data: VideoData = { ...(show.data as unknown as VideoScriptData), aspect: '9:16' };
      const vv = await addVersion(video!, { data: data as unknown as Record<string, unknown>, source: 'demo', note: 'Из сценария (версия 1)' });
      log(`Рендер видео 9:16 с озвучкой: ${show.title}`);
      const t0 = Date.now();
      await runVideo(video!.id, vv.id);
      const after = await getItem(video!.id);
      if (after.status === 'failed') throw new Error(`Видео не отрендерено: ${after.lastError}`);
      log(`  готово за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
      made.push({ id: video!.id, show: { ...show, kind: 'video', platforms } });
    }
  }

  // Approvals exactly as declared in the showcase file.
  for (const { id, show } of made) {
    const item = await getItem(id);
    if (item.status === 'failed') throw new Error(`«${item.title}»: ${item.lastError}`);
    if (show.approval === 'approved') await decide(ws!.id, id, 'approved', 'Демо: согласовано редактором витрины', { userId: null });
    else if (show.approval === 'in_review') await requestReview(ws!.id, id, null);
  }

  // Platform versions + calendar. Demo posts are never published (scheduler and publisher skip is_demo).
  let posts = 0;
  for (const { id, show } of made) {
    if (show.kind === 'video_script') continue; // a script is published as its rendered video
    const item = await getItem(id);
    const res = await preparePosts({ workspaceId: ws!.id, itemId: id, platforms: show.platforms, timezone: tz });
    for (const r of res) {
      if (r.error) log(`  ${PLATFORMS[r.platform].name}: ${r.error}`);
      if (!r.post) continue;
      posts++;
      const manual = PLATFORMS[r.platform].mode === 'manual';
      const status = item.status !== 'approved' ? r.post.status : manual ? 'manual_pending' : 'scheduled';
      await db.update(schema.platformPosts).set({ scheduledAt: item.plannedAt, status, updatedAt: new Date() }).where(eq(schema.platformPosts.id, r.post.id));
    }
  }
  log(`Подготовлено версий для площадок: ${posts}`);

  // Every existing user can browse the showcase read-only.
  const users = await db.select({ id: schema.users.id }).from(schema.users);
  if (users.length) await db.insert(schema.memberships).values(users.map((u) => ({ workspaceId: ws!.id, userId: u.id, role: 'viewer' as const }))).onConflictDoNothing();

  await audit({ workspaceId: ws!.id, actorType: 'system', action: 'showcase.built', entityType: 'campaign', entityId: camp!.id, message: `Витрина собрана: ${made.length} материалов, ${posts} версий для площадок. Публикации демо не отправляются.` });

  const counts = await db.select({ kind: schema.contentItems.kind, status: schema.contentItems.status }).from(schema.contentItems).where(inArray(schema.contentItems.id, made.map((m) => m.id)));
  const summary = counts.reduce<Record<string, number>>((a, c) => ((a[`${c.kind}:${c.status}`] = (a[`${c.kind}:${c.status}`] ?? 0) + 1), a), {});
  console.log('\nВитрина готова:', summary);
  console.log(`Рабочее пространство: ${ws!.id}`);
}

main()
  .then(async () => {
    await stopBoss().catch(() => undefined);
    await closeDb();
  })
  .catch(async (e) => {
    console.error('Сборка витрины не удалась:', e);
    await stopBoss().catch(() => undefined);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
