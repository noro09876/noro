import fs from 'node:fs';
import path from 'node:path';
import type { Db, Row } from './db.ts';
import { json, now, parse } from './db.ts';
import { sha256 } from './crypto.ts';
import type { Format, Platform } from './settings.ts';
import { buildSlideSvg, rasterize, type Slide } from './carousel/render.ts';

export type ContentStatus = 'draft' | 'ready' | 'scheduled' | 'published' | 'partial' | 'failed' | 'archived';

export interface Content {
  id: number;
  brandId: number;
  topic: string;
  title: string;
  body: string;
  summary: string;
  cta: string;
  hashtags: string[];
  format: Format;
  platforms: Platform[];
  slides: Slide[];
  status: ContentStatus;
  source: 'agent' | 'manual';
  model: string | null;
  isDemo: boolean;
  generationCount: number;
  review: Review | null;
  contentHash: string | null;
  planItemId: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  checkedAt: string;
  errors: string[];
  warnings: string[];
}

export interface Brand {
  id: number;
  name: string;
  handle: string;
  audience: string;
  voice: string;
  accent: string;
  background: string;
  defaultHashtags: string[];
  defaultCta: string;
  bannedWords: string[];
  isDefault: boolean;
}

export interface Media {
  id: number;
  contentId: number;
  idx: number;
  kind: 'slide' | 'cover';
  file: string;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  sha256: string;
  variant: string;
}

export function toContent(r: Row): Content {
  return {
    id: r.id as number,
    brandId: r.brand_id as number,
    topic: r.topic as string,
    title: r.title as string,
    body: r.body as string,
    summary: r.summary as string,
    cta: r.cta as string,
    hashtags: parse(r.hashtags, []),
    format: r.format as Format,
    platforms: parse(r.platforms, []),
    slides: parse(r.slides, []),
    status: r.status as ContentStatus,
    source: r.source as 'agent' | 'manual',
    model: (r.model as string) ?? null,
    isDemo: Boolean(r.is_demo),
    generationCount: r.generation_count as number,
    review: parse(r.review, null),
    contentHash: (r.content_hash as string) ?? null,
    planItemId: (r.plan_item_id as number) ?? null,
    archivedAt: (r.archived_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function toBrand(r: Row): Brand {
  return {
    id: r.id as number,
    name: r.name as string,
    handle: r.handle as string,
    audience: r.audience as string,
    voice: r.voice as string,
    accent: r.accent as string,
    background: r.background as string,
    defaultHashtags: parse(r.default_hashtags, []),
    defaultCta: r.default_cta as string,
    bannedWords: parse(r.banned_words, []),
    isDefault: Boolean(r.is_default),
  };
}

export function toMedia(r: Row): Media {
  return {
    id: r.id as number, contentId: r.content_id as number, idx: r.idx as number, kind: r.kind as Media['kind'],
    file: r.file as string, width: r.width as number, height: r.height as number, mime: r.mime as string,
    bytes: r.bytes as number, sha256: r.sha256 as string, variant: r.variant as string,
  };
}

/** Normalized text used for duplicate detection. */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function contentHash(c: Pick<Content, 'title' | 'body' | 'slides'>): string {
  return sha256(normalizeText([c.title, c.body, ...c.slides.map((s) => `${s.title} ${s.text}`)].join(' ')));
}

/** Jaccard similarity on word 3-grams; catches near-duplicates that differ only cosmetically. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = normalizeText(s).split(' ').filter(Boolean);
    const out = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    if (!out.size && w.length) out.add(w.join(' '));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface ContentInput {
  brandId: number;
  topic?: string;
  title?: string;
  body?: string;
  summary?: string;
  cta?: string;
  hashtags?: string[];
  format?: Format;
  platforms?: Platform[];
  slides?: Slide[];
  source?: 'agent' | 'manual';
  model?: string | null;
  isDemo?: boolean;
  planItemId?: number | null;
  status?: ContentStatus;
}

export function cleanHashtags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const tag = t.trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 30);
}

export class ContentRepo {
  private readonly db: Db;
  private readonly mediaDir: string;

  constructor(
    db: Db,
    mediaDir: string,
  ) {
    this.db = db;
    this.mediaDir = mediaDir;
  }

  get(id: number): Content | null {
    const r = this.db.get('SELECT * FROM content WHERE id = ?', id);
    return r ? toContent(r) : null;
  }

  brand(id: number): Brand | null {
    const r = this.db.get('SELECT * FROM brands WHERE id = ?', id);
    return r ? toBrand(r) : null;
  }

  create(input: ContentInput): Content {
    const t = now();
    const slides = (input.slides ?? []).map((s) => ({ title: s.title ?? '', text: s.text ?? '' }));
    const base = { title: input.title ?? '', body: input.body ?? '', slides };
    const id = this.db.insert('content', {
      brand_id: input.brandId,
      topic: input.topic ?? '',
      title: base.title,
      body: base.body,
      summary: input.summary ?? '',
      cta: input.cta ?? '',
      hashtags: json(cleanHashtags(input.hashtags ?? [])),
      format: input.format ?? (slides.length ? 'carousel' : 'post'),
      platforms: json(input.platforms ?? []),
      slides: json(slides),
      status: input.status ?? 'draft',
      source: input.source ?? 'manual',
      model: input.model ?? null,
      is_demo: input.isDemo ? 1 : 0,
      generation_count: input.source === 'agent' ? 1 : 0,
      content_hash: contentHash(base),
      plan_item_id: input.planItemId ?? null,
      created_at: t,
      updated_at: t,
    });
    return this.get(id) as Content;
  }

  update(id: number, patch: Partial<ContentInput> & { review?: Review | null; generationCount?: number }): Content {
    const cur = this.get(id);
    if (!cur) throw new Error('Материал не найден');
    const next = { ...cur, ...patch } as Content;
    const values: Record<string, string | number | null> = {
      topic: next.topic,
      title: next.title,
      body: next.body,
      summary: next.summary,
      cta: next.cta,
      hashtags: json(cleanHashtags(next.hashtags)),
      format: next.format,
      platforms: json(next.platforms),
      slides: json(next.slides.map((s) => ({ title: s.title ?? '', text: s.text ?? '' }))),
      status: next.status,
      model: next.model,
      content_hash: contentHash(next),
      generation_count: next.generationCount,
      updated_at: now(),
    };
    if ('review' in patch) values.review = patch.review ? json(patch.review) : null;
    this.db.update('content', id, values);
    return this.get(id) as Content;
  }

  media(contentId: number): Media[] {
    return this.db.all('SELECT * FROM media WHERE content_id = ? ORDER BY idx', contentId).map(toMedia);
  }

  mediaPath(m: Media): string {
    return path.join(this.mediaDir, m.file);
  }

  /**
   * Renders the images for a material: every slide for carousels, a single cover card otherwise.
   * Old files are replaced. Returns overflow warnings so the caller can block publishing.
   */
  renderMedia(contentId: number, opts: { size: string; showCounter: boolean; jpegQuality: number }): { media: Media[]; warnings: string[]; overflow: boolean } {
    const c = this.get(contentId);
    if (!c) throw new Error('Материал не найден');
    const brand = this.brand(c.brandId);
    const [width, height] = opts.size.split('x').map(Number);
    const slides: Slide[] = c.format === 'carousel' && c.slides.length
      ? c.slides
      : [{ title: c.title || c.slides[0]?.title || '', text: c.summary || '' }];
    const style = {
      brandName: brand?.name ?? 'NORO', handle: brand?.handle ?? '', accent: brand?.accent ?? '#c9f45f',
      background: brand?.background ?? '#0b0c0d', topic: c.topic, showCounter: opts.showCounter,
    };
    const dir = path.join(this.mediaDir, `content-${c.id}`);
    for (const old of this.media(c.id)) fs.rmSync(this.mediaPath(old), { force: true });
    this.db.run('DELETE FROM media WHERE content_id = ?', c.id);
    fs.mkdirSync(dir, { recursive: true });

    const warnings: string[] = [];
    let overflow = false;
    slides.forEach((slide, i) => {
      const r = buildSlideSvg(slide, i, slides.length, style, width, height);
      warnings.push(...r.warnings);
      overflow ||= r.overflow;
      const img = rasterize(r.svg, 'jpeg', opts.jpegQuality);
      const hash = sha256(img.data);
      const file = `content-${c.id}/${String(i + 1).padStart(2, '0')}-${hash.slice(0, 10)}.jpg`;
      fs.writeFileSync(path.join(this.mediaDir, file), img.data);
      this.db.insert('media', {
        content_id: c.id, idx: i, kind: c.format === 'carousel' ? 'slide' : 'cover', file, width: img.width,
        height: img.height, mime: 'image/jpeg', bytes: img.data.length, sha256: hash, variant: opts.size, created_at: now(),
      });
    });
    return { media: this.media(c.id), warnings, overflow };
  }
}
