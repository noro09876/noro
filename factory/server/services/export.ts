import { ZipArchive } from 'archiver';
import { eq, inArray } from 'drizzle-orm';
import { PLATFORMS, type PlatformId } from '../../shared/platforms';
import { formatInTz } from '../../shared/time';
import type { CarouselData, GraphicData, PostData, VideoScriptData } from '../../shared/types';
import { KIND_LABEL, POST_STATUS_LABEL, SOURCE_LABEL } from '../../shared/types';
import { db, schema } from '../db/client';
import { storage } from '../storage';
import { getCampaign, type Asset, type Item, type Version } from './content';
import type { PostRow } from './publisher';

/**
 * Export of a campaign or a single item as a ZIP: Markdown texts, rendered images,
 * videos with subtitles, per-platform variants, the plan as CSV and the schedule as ICS.
 * This is also the «ready package» for platforms without a publishing API.
 */

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'audio/wav': 'wav', 'text/vtt': 'vtt', 'application/x-subrip': 'srt' };

export function itemMarkdown(item: Item, v: Version): string {
  const d = v.data;
  const head = `# ${item.title}\n\n_${KIND_LABEL[item.kind]} · версия ${v.version} · ${SOURCE_LABEL[v.source]}${v.model ? ` (${v.model})` : ''}_\n\n`;
  switch (item.kind) {
    case 'post': {
      const p = d as unknown as PostData;
      return `${head}## ${p.headline}\n\n${p.body}\n\n**${p.cta}**\n\n${p.hashtags.join(' ')}\n`;
    }
    case 'carousel': {
      const c = d as unknown as CarouselData;
      return `${head}## ${c.title}\n\n${c.caption}\n\n${c.slides.map((s, i) => `### Слайд ${i + 1}: ${s.title}\n${s.kicker ? `_${s.kicker}_\n` : ''}${s.body}`).join('\n\n')}\n\n${c.hashtags.join(' ')}\n`;
    }
    case 'graphic': {
      const g = d as unknown as GraphicData;
      return `${head}## ${g.headline}\n\n${g.subline}\n\n${g.caption}\n`;
    }
    default: {
      const s = d as unknown as VideoScriptData;
      return `${head}## ${s.title}\n\n**Хук:** ${s.hook}\n\n${s.scenes.map((sc, i) => `### Сцена ${i + 1} · ${sc.kind} · ${sc.durationSec} с\n**На экране:** ${sc.title}${sc.text ? ` — ${sc.text}` : ''}\n**Голос:** ${sc.voiceover}`).join('\n\n')}\n\n**Подпись:** ${s.caption}\n\n${s.hashtags.join(' ')}\n`;
    }
  }
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function icsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export function postsIcs(posts: (PostRow & { itemTitle: string })[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NORO//Content Factory//RU', 'CALSCALE:GREGORIAN'];
  for (const p of posts) {
    if (!p.scheduledAt) continue;
    const manual = PLATFORMS[p.platform as PlatformId].mode === 'manual';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${p.id}@noro-factory`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(p.scheduledAt)}`,
      `DTEND:${icsDate(new Date(p.scheduledAt.getTime() + 15 * 60_000))}`,
      `SUMMARY:${icsText(`${manual ? 'Разместить вручную' : 'Публикация'} · ${PLATFORMS[p.platform as PlatformId].name}: ${p.itemTitle}`)}`,
      `DESCRIPTION:${icsText(p.text.slice(0, 900))}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(`Через 30 минут: ${PLATFORMS[p.platform as PlatformId].name}`)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';

async function addItem(zip: ZipArchive, dir: string, item: Item, v: Version, assets: Asset[], posts: PostRow[]) {
  zip.append(itemMarkdown(item, v), { name: `${dir}/text.md` });
  for (const a of assets) {
    if (a.role === 'voiceover') continue;
    zip.append(await storage().get(a.storageKey), { name: `${dir}/${a.role ?? a.id}.${EXT[a.mime] ?? 'bin'}` });
  }
  for (const p of posts) {
    const tz = p.timezone;
    const when = p.scheduledAt ? formatInTz(p.scheduledAt, tz) : null;
    const meta = `<!-- ${PLATFORMS[p.platform as PlatformId].name} · ${POST_STATUS_LABEL[p.status]}${when ? ` · ${when.date} ${when.time} (${tz})` : ''}${p.externalUrl ? ` · ${p.externalUrl}` : ''} -->\n`;
    zip.append(`${meta}${p.title ? `# ${p.title}\n\n` : ''}${p.text}\n`, { name: `${dir}/platforms/${p.platform}.md` });
  }
}

/** Streams a ZIP for a whole campaign. */
export async function campaignZip(campaignId: string, workspaceId: string): Promise<{ stream: ZipArchive; filename: string }> {
  const camp = await getCampaign(campaignId, workspaceId);
  const items = await db.select().from(schema.contentItems).where(eq(schema.contentItems.campaignId, camp.id));
  const vids = items.map((i) => i.currentVersionId).filter(Boolean) as string[];
  const versions = vids.length ? await db.select().from(schema.contentVersions).where(inArray(schema.contentVersions.id, vids)) : [];
  const assets = vids.length ? await db.select().from(schema.assets).where(inArray(schema.assets.versionId, vids)) : [];
  const posts = await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.campaignId, camp.id));
  const zip = new ZipArchive({ zlib: { level: 6 } });
  const tz = camp.brief.timezone;
  const readme = [
    `# ${camp.title}`,
    camp.isDemo ? '\n> ДЕМО: вымышленный бренд, тексты подготовлены при разработке витрины. Не является результатом реальной кампании.\n' : '',
    `Часовой пояс: ${tz}. Площадки: ${camp.brief.platforms.map((p) => PLATFORMS[p].name).join(', ')}.`,
    camp.strategy ? `\n## Стратегия\n\n${camp.strategy.summary}\n\n**Позиционирование:** ${camp.strategy.positioning}\n\n${camp.strategy.pillars.map((p) => `- **${p.name}** — ${p.description}`).join('\n')}` : '',
    '\nФайлы: `items/` — материалы (текст, изображения, видео, субтитры, версии под площадки), `plan.csv` — контент-план, `calendar.ics` — расписание с напоминаниями.',
  ].join('\n');
  zip.append(readme, { name: 'README.md' });
  const header = ['Дата', 'Время', 'Формат', 'Рубрика', 'Тема', 'Площадки', 'Статус'].map(csvCell).join(',');
  const rows = items
    .sort((a, b) => (a.plannedAt?.getTime() ?? 0) - (b.plannedAt?.getTime() ?? 0))
    .map((i) => {
      const w = i.plannedAt ? formatInTz(i.plannedAt, tz) : { date: '', time: '' };
      return [w.date, w.time, KIND_LABEL[i.kind], i.pillar, i.title, (i.platforms as PlatformId[]).map((p) => PLATFORMS[p]?.name ?? p).join(' / '), i.status].map(csvCell).join(',');
    });
  zip.append('\ufeff' + [header, ...rows].join('\r\n'), { name: 'plan.csv' });
  zip.append(postsIcs(posts.map((p) => ({ ...p, itemTitle: items.find((i) => i.id === p.itemId)?.title ?? '' }))), { name: 'calendar.ics' });
  for (const [n, item] of items.entries()) {
    const v = versions.find((x) => x.id === item.currentVersionId);
    if (!v) continue;
    await addItem(zip, `items/${String(n + 1).padStart(2, '0')}-${item.kind}-${slug(item.title)}`, item, v, assets.filter((a) => a.versionId === v.id), posts.filter((p) => p.itemId === item.id && p.versionId === v.id));
  }
  void zip.finalize();
  return { stream: zip, filename: `${slug(camp.title)}.zip` };
}

export async function itemZip(itemId: string, workspaceId: string): Promise<{ stream: ZipArchive; filename: string }> {
  const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, itemId));
  if (!item || item.workspaceId !== workspaceId || !item.currentVersionId) throw new Error('not found');
  const [v] = await db.select().from(schema.contentVersions).where(eq(schema.contentVersions.id, item.currentVersionId));
  const assets = await db.select().from(schema.assets).where(eq(schema.assets.versionId, v!.id));
  const posts = (await db.select().from(schema.platformPosts).where(eq(schema.platformPosts.itemId, item.id))).filter((p) => p.versionId === v!.id);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  await addItem(zip, slug(item.title), item, v!, assets, posts);
  void zip.finalize();
  return { stream: zip, filename: `${slug(item.title)}.zip` };
}
