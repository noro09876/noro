import { uid } from '../../../lib/id';
import { PLATFORM_IDS, STATUSES, TONE_LABELS, type ContentItem, type PlatformId, type Project, type Tone } from './types';

const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object';
const str = (x: unknown, max = 100000) => (typeof x === 'string' ? x.slice(0, max) : '');
const isDay = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

/** Parses and sanitises a JSON export; ids are regenerated to avoid collisions. */
export function parseProjectsJson(text: string): Project[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON.');
  }
  const list = Array.isArray(data) ? data : isObj(data) ? data.projects : null;
  if (!Array.isArray(list)) throw new Error('В JSON нет списка проектов (поле "projects").');
  const out: Project[] = [];
  for (const raw of list.slice(0, 200)) {
    if (!isObj(raw) || !str(raw.source)) continue;
    const tone = (Object.keys(TONE_LABELS) as Tone[]).includes(raw.tone as Tone) ? (raw.tone as Tone) : 'friendly';
    const platforms = Array.isArray(raw.platforms) ? (raw.platforms.filter((p) => PLATFORM_IDS.includes(p as PlatformId)) as PlatformId[]) : [];
    const items: ContentItem[] = Array.isArray(raw.items)
      ? raw.items.filter(isObj).filter((i) => PLATFORM_IDS.includes(i.platform as PlatformId)).map((i) => ({
          id: uid('ci'),
          platform: i.platform as PlatformId,
          title: str(i.title, 500),
          body: str(i.body),
          status: STATUSES.includes(i.status as never) ? (i.status as ContentItem['status']) : 'draft',
          date: isDay(i.date) ? (i.date as string) : new Date().toISOString().slice(0, 10),
          versions: [],
          edited: Boolean(i.edited),
        }))
      : [];
    const now = Date.now();
    out.push({
      id: uid('p'),
      name: str(raw.name, 120) || 'Импортированный проект',
      topic: str(raw.topic, 120),
      audience: str(raw.audience, 120),
      tone,
      platforms: platforms.length ? platforms : ['telegram'],
      source: str(raw.source, 20000),
      startDate: isDay(raw.startDate) ? (raw.startDate as string) : new Date().toISOString().slice(0, 10),
      createdAt: now,
      updatedAt: now,
      analysis: null,
      items,
      variant: 0,
    });
  }
  if (!out.length) throw new Error('В файле не найдено проектов с исходным текстом.');
  return out;
}
