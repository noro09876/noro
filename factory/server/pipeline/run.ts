import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { buildCues, toSrt, toVtt, type TimedSegment } from '../../shared/captions';
import { PLATFORMS, type PlatformId } from '../../shared/platforms';
import { checksPassed, runChecks as evaluateChecks } from '../../shared/quality';
import { SCHEDULE_DEFAULT_TIMES, planDate } from '../../shared/time';
import { SCHEMA_BY_KIND, strategyOutputSchema } from '../../shared/schemas';
import type { CarouselData, ContentKind, GraphicData, PlanEntry, VideoData, VideoScriptData } from '../../shared/types';
import { db, schema } from '../db/client';
import { ExternalError } from '../lib/errors';
import { logger } from '../lib/logger';
import { findImage, findTts } from '../providers/registry';
import { piperAvailable, piperTts } from '../providers/tts/piper';
import type { TtsProvider, ProviderRuntime } from '../providers/types';
import { renderPromoMp4, renderStillPng, withAssetServer } from '../render/remotion';
import { audit } from '../services/audit';
import {
  addVersion,
  brandProfile,
  currentVersion,
  getBrand,
  getCampaign,
  getItem,
  saveAsset,
  setItemStatus,
  versionAssets,
  type Item,
} from '../services/content';
import { assertWithinLimit, defaultProvider, generateWithLlm, limitsFor, recordUsage, runtimeOf } from '../services/providers';
import { onItemChecked, onStrategyOutcome } from '../services/automation';
import { enqueue, Q } from '../jobs/queue';
import { itemPrompt, revisePrompt, strategyPrompt, SYSTEM_BASE } from './prompts';
import { setStage } from './stages';

const errText = (e: unknown) => (e instanceof ExternalError ? e.message : `Внутренняя ошибка: ${(e as Error).message}`);

/* ---------------- Strategy ---------------- */

export async function runStrategy(campaignId: string) {
  const camp = await getCampaign(campaignId);
  const brand = brandProfile(await getBrand(camp.brandId));
  await setStage(campaignId, 'strategy', 'running', 'Модель строит стратегию и план');
  try {
    const res = await generateWithLlm(camp.workspaceId, {
      system: SYSTEM_BASE,
      prompt: strategyPrompt(brand, camp.brief),
      schema: strategyOutputSchema,
      schemaName: 'strategy',
      context: { brief: camp.brief },
    });
    const limits = await limitsFor(camp.workspaceId);
    // Hard cap: the workspace limit, and for automation runs exactly the requested count.
    const cap = Math.min(limits.maxItemsPerCampaign, camp.ruleId ? camp.brief.frequency : Infinity);
    const plan = normalizePlan(res.data.plan, camp.brief.platforms, camp.brief.formats).slice(0, cap);
    await db.update(schema.campaigns).set({ strategy: res.data.strategy, plan, strategySource: res.source, updatedAt: new Date() }).where(eq(schema.campaigns.id, campaignId));
    await setStage(campaignId, 'strategy', 'done', `Стратегия готова · ${plan.length} публикаций в плане · ${res.provider}/${res.model}`);
    await audit({ workspaceId: camp.workspaceId, actorType: 'worker', action: 'strategy.done', entityType: 'campaign', entityId: campaignId, message: `Стратегия и план (${plan.length}) созданы моделью ${res.model}` });
    await createItemsFromPlan(campaignId);
    await onStrategyOutcome(campaignId, true);
  } catch (e) {
    await setStage(campaignId, 'strategy', 'failed', 'Стратегия не создана', errText(e));
    await onStrategyOutcome(campaignId, false, errText(e));
    await audit({ workspaceId: camp.workspaceId, actorType: 'worker', action: 'strategy.failed', entityType: 'campaign', entityId: campaignId, level: 'error', message: errText(e) });
    if (e instanceof ExternalError && !e.retryable) return; // permanent: surface to the user, don't retry
    throw e;
  }
}

/** Keeps only formats/platforms the brief asked for, sorts by date. */
export function normalizePlan(plan: PlanEntry[], platforms: PlatformId[], formats: ContentKind[]): PlanEntry[] {
  return plan
    .filter((p) => formats.includes(p.kind))
    .map((p) => {
      let pl = p.platforms.filter((x) => platforms.includes(x));
      if (p.kind === 'video') pl = pl.filter((x) => PLATFORMS[x].preparedMedia.includes('video'));
      if (!pl.length) pl = platforms.filter((x) => p.kind !== 'video' || PLATFORMS[x].preparedMedia.includes('video'));
      return { ...p, platforms: pl.length ? pl : platforms };
    })
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
}

export async function createItemsFromPlan(campaignId: string, { enqueueGeneration = true } = {}) {
  const camp = await getCampaign(campaignId);
  const plan = camp.plan ?? [];
  const existing = await db.select({ planIndex: schema.contentItems.planIndex }).from(schema.contentItems).where(eq(schema.contentItems.campaignId, campaignId));
  const have = new Set(existing.map((e) => e.planIndex));
  const created: Item[] = [];
  for (const [i, entry] of plan.entries()) {
    if (have.has(i)) continue;
    const [item] = await db
      .insert(schema.contentItems)
      .values({
        campaignId,
        workspaceId: camp.workspaceId,
        kind: entry.kind,
        title: entry.topic.slice(0, 200),
        pillar: entry.pillar,
        planIndex: i,
        plannedAt: planDate(camp.brief.startDate, entry.day, entry.time || SCHEDULE_DEFAULT_TIMES[0]!, camp.brief.timezone),
        platforms: entry.platforms,
        status: enqueueGeneration ? 'generating' : 'draft',
        isDemo: camp.isDemo,
      })
      .returning();
    created.push(item!);
    if (enqueueGeneration) await enqueue(Q.generate, { itemId: item!.id }, { singletonKey: `gen:${item!.id}` });
  }
  return created;
}

/* ---------------- Text generation ---------------- */

export async function runGenerate(itemId: string, opts: { instruction?: string; target?: string; userId?: string } = {}) {
  const item = await getItem(itemId);
  const camp = await getCampaign(item.campaignId);
  const brand = brandProfile(await getBrand(camp.brandId));
  const entry = camp.plan?.[item.planIndex ?? -1] ?? { topic: item.title, angle: item.title, pillar: item.pillar ?? '', platforms: item.platforms as PlatformId[] };
  const ctx = { brand, brief: camp.brief, strategy: camp.strategy ?? null, entry };
  const kind = item.kind;
  const schemaFor = SCHEMA_BY_KIND[kind];
  await setItemStatus(itemId, 'generating');
  try {
    const prev = await currentVersion(item);
    const prompt = opts.instruction && prev ? revisePrompt(kind, ctx, prev.data, opts.instruction, opts.target) : itemPrompt(kind, ctx);
    const res = await generateWithLlm(camp.workspaceId, {
      system: SYSTEM_BASE,
      prompt,
      schema: schemaFor as never,
      schemaName: kind === 'video' ? 'video_script' : kind,
      context: { topic: entry.topic },
    });
    let data = res.data as Record<string, unknown>;
    if (prev && opts.target) data = mergeTarget(prev.data, data, opts.target);
    if (kind === 'video') data = { ...data, aspect: (prev?.data as Partial<VideoData> | undefined)?.aspect ?? '9:16' };
    const ver = await addVersion(item, {
      data,
      source: res.source,
      provider: res.provider,
      model: res.model,
      note: opts.instruction ? `Перегенерация: ${opts.instruction}${opts.target ? ` (${opts.target})` : ''}` : 'Первичная генерация',
      createdBy: opts.userId ?? null,
    });
    await audit({ workspaceId: item.workspaceId, actorType: 'worker', action: 'item.generated', entityType: 'item', entityId: itemId, message: `«${item.title.slice(0, 60)}» — версия ${ver.version} (${res.model})` });
    await afterContentChange(item, ver.id);
  } catch (e) {
    await setItemStatus(itemId, 'failed', errText(e));
    await audit({ workspaceId: item.workspaceId, actorType: 'worker', action: 'item.failed', entityType: 'item', entityId: itemId, level: 'error', message: errText(e) });
    if (e instanceof ExternalError && !e.retryable) return;
    throw e;
  }
}

/** Applies a targeted rewrite: only the named slide/scene/field is taken from the new output. */
export function mergeTarget(prev: Record<string, unknown>, next: Record<string, unknown>, target: string): Record<string, unknown> {
  const m = target.match(/^(slide|scene):(\d+)$/);
  if (m) {
    const key = m[1] === 'slide' ? 'slides' : 'scenes';
    const idx = Number(m[2]);
    const a = [...((prev[key] as unknown[]) ?? [])];
    const b = (next[key] as unknown[]) ?? [];
    if (b[idx] !== undefined && idx < a.length) a[idx] = b[idx];
    return { ...prev, [key]: a };
  }
  if (target.startsWith('field:')) {
    const f = target.slice(6);
    return next[f] !== undefined ? { ...prev, [f]: next[f] } : prev;
  }
  return next;
}

/** After any new version: render visuals (if needed) and run checks. */
export async function afterContentChange(item: Item, versionId: string) {
  if (item.kind === 'carousel' || item.kind === 'graphic') {
    await setItemStatus(item.id, 'generating');
    await enqueue(Q.design, { itemId: item.id, versionId }, { singletonKey: `design:${versionId}` });
  } else if (item.kind === 'video') {
    // Video rendering is expensive: it starts automatically only for the first version.
    const assets = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.itemId, item.id), eq(schema.assets.kind, 'video')));
    if (!assets.length) {
      await setItemStatus(item.id, 'generating');
      await enqueue(Q.video, { itemId: item.id, versionId }, { singletonKey: `video:${versionId}` });
    } else {
      await runChecks(item.id);
    }
  } else {
    await runChecks(item.id);
  }
}

/* ---------------- Design (stills) ---------------- */

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.slice(-400)}`))));
  });
}

async function tmpDir(prefix: string) {
  return fsp.mkdtemp(path.join(os.tmpdir(), `noro-${prefix}-`));
}

async function toJpeg(png: string): Promise<string> {
  const jpg = png.replace(/\.png$/, '.jpg');
  await ffmpeg(['-i', png, '-q:v', '2', '-pix_fmt', 'yuvj444p', jpg]);
  return jpg;
}

async function aiBackground(workspaceId: string, prompt: string | undefined, dir: string): Promise<string | undefined> {
  if (!prompt) return undefined;
  const row = await defaultProvider(workspaceId, 'image');
  if (!row) return undefined;
  const impl = findImage(row.provider);
  if (!impl) return undefined;
  try {
    await assertWithinLimit(workspaceId, 'image');
    const img = await impl.generate(runtimeOf(row), { prompt: `${prompt}. Abstract, minimal, dark, no people, no text, no logos.`, size: '1024x1536' });
    await recordUsage(workspaceId, 'image', row.provider);
    const f = path.join(dir, 'bg.png');
    await fsp.writeFile(f, img.data);
    return f;
  } catch (e) {
    logger.warn({ err: errText(e) }, 'AI background failed, rendering without it');
    return undefined;
  }
}

export async function runDesign(itemId: string, versionId: string) {
  const item = await getItem(itemId);
  const camp = await getCampaign(item.campaignId);
  const brand = await getBrand(camp.brandId);
  const ver = await currentVersion(item);
  if (!ver || ver.id !== versionId) return; // superseded by a newer version
  const dir = await tmpDir('design');
  try {
    await assertWithinLimit(item.workspaceId, 'render');
    // Remove assets from a previous attempt on this same version (retry safety).
    const old = await versionAssets(versionId);
    if (old.length) await db.delete(schema.assets).where(eq(schema.assets.versionId, versionId));
    const base = { brandName: brand.name, visual: brand.visual, label: item.pillar ?? undefined };
    const source = ver.source === 'demo' ? 'demo' : 'template';
    if (item.kind === 'carousel') {
      const data = ver.data as unknown as CarouselData;
      for (const [i, slide] of data.slides.entries()) {
        const png = path.join(dir, `slide-${i + 1}.png`);
        const { width, height } = await renderStillPng('Slide', { ...base, slide, index: i, total: data.slides.length, aspect: '4:5' }, png);
        const jpg = await toJpeg(png);
        await saveAsset({ workspaceId: item.workspaceId, campaignId: item.campaignId, itemId, versionId, kind: 'image', role: `slide-${String(i + 1).padStart(2, '0')}`, mime: 'image/jpeg', file: jpg, ext: 'jpg', width, height, source, isDemo: item.isDemo });
      }
    } else {
      const data = ver.data as unknown as GraphicData;
      const bg = await aiBackground(item.workspaceId, data.imagePrompt, dir);
      const aspects: ('4:5' | '16:9')[] = ['4:5'];
      if ((item.platforms as PlatformId[]).some((p) => PLATFORMS[p].aspect === '16:9')) aspects.push('16:9');
      for (const aspect of aspects) {
        const png = path.join(dir, `graphic-${aspect.replace(':', 'x')}.png`);
        const props = { ...base, headline: data.headline, subline: data.subline, block: data.visual, aspect, backgroundUrl: undefined as string | undefined };
        const render = async (baseUrl?: string) => renderStillPng('Graphic', { ...props, backgroundUrl: baseUrl ? `${baseUrl}/bg.png` : undefined }, png);
        const { width, height } = bg ? await withAssetServer(dir, (u) => render(u)) : await render();
        const jpg = await toJpeg(png);
        await saveAsset({ workspaceId: item.workspaceId, campaignId: item.campaignId, itemId, versionId, kind: 'image', role: aspect === '4:5' ? 'graphic' : 'graphic-wide', mime: 'image/jpeg', file: jpg, ext: 'jpg', width, height, source: bg ? 'ai' : source, meta: { aspect, aiBackground: !!bg }, isDemo: item.isDemo });
      }
    }
    await recordUsage(item.workspaceId, 'render', 'remotion');
    await runChecks(itemId);
  } catch (e) {
    await setItemStatus(itemId, 'failed', `Рендер не удался: ${errText(e)}`);
    await audit({ workspaceId: item.workspaceId, actorType: 'worker', action: 'design.failed', entityType: 'item', entityId: itemId, level: 'error', message: errText(e) });
    throw e;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/* ---------------- Video ---------------- */

async function ttsFor(workspaceId: string): Promise<{ impl: TtsProvider; rt: ProviderRuntime; id: string } | null> {
  const row = await defaultProvider(workspaceId, 'tts');
  if (row) {
    const impl = findTts(row.provider);
    if (impl) return { impl, rt: runtimeOf(row), id: row.provider };
  }
  if (piperAvailable()) return { impl: piperTts, rt: { model: 'ru-irinia-medium', settings: {} }, id: 'piper' };
  return null;
}

export async function runVideo(itemId: string, versionId: string, opts: { withoutVoice?: boolean } = {}) {
  const item = await getItem(itemId);
  const camp = await getCampaign(item.campaignId);
  const brand = await getBrand(camp.brandId);
  const ver = await currentVersion(item);
  if (!ver || ver.id !== versionId) return;
  const data = ver.data as unknown as VideoData;
  const dir = await tmpDir('video');
  try {
    await assertWithinLimit(item.workspaceId, 'render');
    const tts = opts.withoutVoice ? null : await ttsFor(item.workspaceId);
    if (!tts && !opts.withoutVoice) {
      throw new ExternalError('Озвучка', 'no_tts', 'Не подключён провайдер озвучки. Выполните npm run tts:setup (Piper, бесплатно) или добавьте ElevenLabs/OpenAI в настройках. Можно отрендерить ролик без голоса.', false);
    }

    // 1. Voiceover per scene → exact timeline
    const LEAD = 250;
    const timeline: { sceneId: string; fromMs: number; durationMs: number }[] = [];
    const segments: TimedSegment[] = [];
    const parts: string[] = [];
    let t = 0;
    for (const [i, scene] of data.scenes.entries()) {
      let audioMs = 0;
      if (tts) {
        const r = await tts.impl.synthesize(tts.rt, { text: scene.voiceover });
        const raw = path.join(dir, `vo-${i}.${r.mime === 'audio/wav' ? 'wav' : 'mp3'}`);
        await fsp.writeFile(raw, r.data);
        const wav = path.join(dir, `vo-${i}-n.wav`);
        await ffmpeg(['-i', raw, '-ar', '48000', '-ac', '1', wav]);
        audioMs = r.durationMs;
        parts.push(wav);
      }
      const durationMs = Math.round(Math.max(scene.durationSec * 1000, audioMs + LEAD + 450));
      timeline.push({ sceneId: scene.id, fromMs: t, durationMs });
      segments.push({ text: scene.voiceover, startMs: t + LEAD, durationMs: audioMs || durationMs - LEAD - 200 });
      t += durationMs;
    }
    if (tts) await recordUsage(item.workspaceId, 'tts', tts.id);

    // 2. One voiceover track with silences matching the timeline
    let voiceFile: string | undefined;
    if (tts) {
      voiceFile = path.join(dir, 'voiceover.wav');
      const inputs = parts.flatMap((p) => ['-i', p]);
      const filters = timeline.map((tl, i) => `[${i}:a]adelay=${tl.fromMs + LEAD}|${tl.fromMs + LEAD}[a${i}]`).join(';');
      const mix = `${timeline.map((_, i) => `[a${i}]`).join('')}amix=inputs=${timeline.length}:normalize=0,apad=whole_dur=${(t / 1000).toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
      await ffmpeg([...inputs, '-filter_complex', `${filters};${mix}`, '-map', '[out]', '-ar', '48000', '-ac', '2', voiceFile]);
    }

    // 3. Captions
    const cues = buildCues(segments);
    const aspect = data.aspect ?? '9:16';

    // 4. Render
    const out = path.join(dir, 'video.mp4');
    const props = {
      brandName: brand.name,
      visual: brand.visual,
      scenes: data.scenes,
      timeline,
      captions: cues,
      showCaptions: true,
      label: item.pillar ?? undefined,
      aspect,
      voiceoverUrl: undefined as string | undefined,
    };
    const { width, height } = await withAssetServer(dir, (baseUrl) => renderPromoMp4({ ...props, voiceoverUrl: voiceFile ? `${baseUrl}/voiceover.wav` : undefined }, out));
    const final = path.join(dir, 'final.mp4');
    await ffmpeg(['-i', out, '-c', 'copy', '-movflags', '+faststart', final]);
    const cover = path.join(dir, 'cover.jpg');
    await ffmpeg(['-ss', String(Math.min(1.2, t / 2000)), '-i', final, '-frames:v', '1', '-q:v', '2', cover]);

    // 5. Store
    const old = await versionAssets(versionId);
    if (old.length) await db.delete(schema.assets).where(eq(schema.assets.versionId, versionId));
    const source = ver.source === 'demo' ? 'demo' : 'template';
    const common = { workspaceId: item.workspaceId, campaignId: item.campaignId, itemId, versionId, isDemo: item.isDemo };
    await saveAsset({ ...common, kind: 'video', role: 'final', mime: 'video/mp4', file: final, ext: 'mp4', width, height, durationMs: t, source, meta: { timeline, voice: tts ? tts.id : null, captions: true, aspect } });
    await saveAsset({ ...common, kind: 'image', role: 'cover', mime: 'image/jpeg', file: cover, ext: 'jpg', width, height, source });
    await saveAsset({ ...common, kind: 'subtitle', role: 'subtitles-vtt', mime: 'text/vtt', buffer: Buffer.from(toVtt(cues)), ext: 'vtt', source });
    await saveAsset({ ...common, kind: 'subtitle', role: 'subtitles-srt', mime: 'application/x-subrip', buffer: Buffer.from(toSrt(cues)), ext: 'srt', source });
    if (voiceFile) await saveAsset({ ...common, kind: 'audio', role: 'voiceover', mime: 'audio/wav', file: voiceFile, ext: 'wav', durationMs: t, source: 'ai', meta: { provider: tts?.id } });
    await recordUsage(item.workspaceId, 'render', 'remotion');
    await audit({ workspaceId: item.workspaceId, actorType: 'worker', action: 'video.rendered', entityType: 'item', entityId: itemId, message: `Видео «${data.title.slice(0, 50)}» отрендерено: ${(t / 1000).toFixed(1)} с, ${width}×${height}${tts ? `, озвучка ${tts.id}` : ', без озвучки'}` });
    await runChecks(itemId);
  } catch (e) {
    await setItemStatus(itemId, 'failed', `Видео не создано: ${errText(e)}`);
    await audit({ workspaceId: item.workspaceId, actorType: 'worker', action: 'video.failed', entityType: 'item', entityId: itemId, level: 'error', message: errText(e) });
    if (e instanceof ExternalError && !e.retryable) return;
    throw e;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/* ---------------- Quality checks ---------------- */

export async function runChecks(itemId: string) {
  const item = await getItem(itemId);
  const ver = await currentVersion(item);
  if (!ver) return null;
  const camp = await getCampaign(item.campaignId);
  const brand = await getBrand(camp.brandId);
  const assets = await versionAssets(ver.id);
  const results = evaluateChecks({ kind: item.kind, data: ver.data, brand, platforms: item.platforms as PlatformId[], assets });
  const passed = checksPassed(results);
  await db.insert(schema.qualityChecks).values({ itemId, versionId: ver.id, results, passed });
  // Approval state survives only for the version it was given to.
  const keep = item.status === 'approved' || item.status === 'in_review' || item.status === 'rejected';
  const [latestApproval] = await db.select().from(schema.approvals).where(and(eq(schema.approvals.itemId, itemId), eq(schema.approvals.versionId, ver.id)));
  if (!keep || !latestApproval) {
    await setItemStatus(itemId, 'ready', null);
    await onItemChecked(itemId, passed);
  }
  return { passed, results };
}

export type { VideoScriptData };
