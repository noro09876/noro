import { PLATFORMS, textLimitFor, type PlatformId } from './platforms';
import type {
  BrandProfile,
  CarouselData,
  CheckResult,
  ContentKind,
  GraphicData,
  PostData,
  VideoData,
  VideoScriptData,
} from './types';

/**
 * Deterministic quality gate. Runs before approval and again right before publishing.
 * It cannot prove that generated text is good; it catches what can be checked
 * mechanically: empty fields, brand violations, platform limits, missing files.
 */

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export function findForbidden(text: string, brand: Pick<BrandProfile, 'forbidden' | 'vocabulary'>): string[] {
  const t = norm(text);
  const hits = new Set<string>();
  for (const w of [...(brand.forbidden ?? []), ...(brand.vocabulary?.avoid ?? [])]) {
    const term = norm(w.trim());
    if (term.length >= 2 && t.includes(term)) hits.add(w.trim());
  }
  return [...hits];
}

export function textOf(kind: ContentKind, data: unknown): string {
  const d = data as Record<string, unknown>;
  switch (kind) {
    case 'post': {
      const p = d as unknown as PostData;
      return [p.headline, p.body, p.cta, ...(p.hashtags ?? [])].join('\n');
    }
    case 'carousel': {
      const c = d as unknown as CarouselData;
      return [c.title, c.caption, ...(c.slides ?? []).flatMap((s) => [s.kicker ?? '', s.title, s.body])].join('\n');
    }
    case 'graphic': {
      const g = d as unknown as GraphicData;
      return [g.headline, g.subline, g.caption].join('\n');
    }
    case 'video_script':
    case 'video': {
      const v = d as unknown as VideoScriptData;
      return [v.title, v.hook, v.caption, ...(v.scenes ?? []).flatMap((s) => [s.title, s.text ?? '', s.voiceover])].join('\n');
    }
  }
}

export interface CheckInput {
  kind: ContentKind;
  data: unknown;
  brand: Pick<BrandProfile, 'forbidden' | 'vocabulary' | 'name'>;
  platforms: PlatformId[];
  /** Assets attached to the current version. */
  assets: { kind: string; durationMs?: number | null; bytes?: number | null; mime?: string | null }[];
}

const blank = (s: unknown) => typeof s !== 'string' || !s.trim();

export function runChecks(input: CheckInput): CheckResult[] {
  const out: CheckResult[] = [];
  const { kind, data, brand, platforms, assets } = input;
  const d = (data ?? {}) as Record<string, unknown>;

  // 1. Required fields
  if (kind === 'post') {
    const p = d as unknown as PostData;
    if (blank(p.body)) out.push({ code: 'empty_body', level: 'error', message: 'Пустой текст поста' });
    if (blank(p.headline)) out.push({ code: 'empty_headline', level: 'warning', message: 'Нет заголовка' });
    if (blank(p.cta)) out.push({ code: 'no_cta', level: 'warning', message: 'Нет призыва к действию' });
  }
  if (kind === 'carousel') {
    const c = d as unknown as CarouselData;
    const slides = c.slides ?? [];
    if (slides.length < 2) out.push({ code: 'few_slides', level: 'error', message: 'В карусели меньше 2 слайдов' });
    slides.forEach((s, i) => {
      if (blank(s.title)) out.push({ code: 'empty_slide', level: 'error', message: `Слайд ${i + 1}: пустой заголовок` });
      if ((s.body ?? '').length > 260) out.push({ code: 'slide_dense', level: 'warning', message: `Слайд ${i + 1}: текст длиннее 260 символов, плохо читается` });
    });
    if (blank(c.caption)) out.push({ code: 'empty_caption', level: 'error', message: 'Нет подписи к карусели' });
    const images = assets.filter((a) => a.kind === 'image').length;
    if (images < slides.length) out.push({ code: 'missing_slides', level: 'error', message: `Отрендерено ${images} из ${slides.length} слайдов` });
  }
  if (kind === 'graphic') {
    const g = d as unknown as GraphicData;
    if (blank(g.headline)) out.push({ code: 'empty_headline', level: 'error', message: 'Пустой заголовок графики' });
    if (!assets.some((a) => a.kind === 'image')) out.push({ code: 'missing_image', level: 'error', message: 'Изображение ещё не создано' });
  }
  if (kind === 'video_script' || kind === 'video') {
    const v = d as unknown as VideoData;
    const scenes = v.scenes ?? [];
    if (scenes.length < 3) out.push({ code: 'few_scenes', level: 'error', message: 'В сценарии меньше 3 сцен' });
    scenes.forEach((s, i) => {
      if (blank(s.voiceover)) out.push({ code: 'empty_vo', level: 'error', message: `Сцена ${i + 1}: нет текста озвучки` });
      if (blank(s.title)) out.push({ code: 'empty_scene_title', level: 'warning', message: `Сцена ${i + 1}: нет заголовка в кадре` });
    });
    const planned = scenes.reduce((a, s) => a + (s.durationSec || 0), 0);
    if (planned > 90) out.push({ code: 'too_long', level: 'warning', message: `Плановая длительность ${Math.round(planned)} с — для Shorts/Reels лучше до 60 с` });
    if (kind === 'video') {
      const video = assets.find((a) => a.kind === 'video');
      if (!video) out.push({ code: 'missing_video', level: 'error', message: 'Видеофайл ещё не отрендерен' });
      else {
        const sec = (video.durationMs ?? 0) / 1000;
        if (sec < 5) out.push({ code: 'video_short', level: 'error', message: `Ролик слишком короткий: ${sec.toFixed(1)} с` });
        for (const pid of platforms) {
          const max = PLATFORMS[pid].limits.videoMaxSec;
          if (max && sec > max) out.push({ code: 'video_too_long', level: 'error', platform: pid, message: `${PLATFORMS[pid].name}: ролик ${sec.toFixed(0)} с длиннее лимита ${max} с` });
          const mb = PLATFORMS[pid].limits.videoMaxMb;
          if (mb && (video.bytes ?? 0) > mb * 1024 * 1024) out.push({ code: 'video_too_big', level: 'error', platform: pid, message: `${PLATFORMS[pid].name}: файл больше ${mb} МБ` });
        }
      }
      if (!assets.some((a) => a.kind === 'subtitle')) out.push({ code: 'no_subtitles', level: 'warning', message: 'Нет файла субтитров' });
    }
  }

  // 2. Brand rules
  const hits = findForbidden(textOf(kind, d), brand);
  if (hits.length) out.push({ code: 'forbidden', level: 'error', message: `Запрещённые формулировки бренда: ${hits.join(', ')}` });

  // 3. Placeholder leftovers from templates / models
  const all = textOf(kind, d);
  if (/\[(?:вставьте|название|ссылка|todo|placeholder)[^\]]*\]|lorem ipsum|\{\{.+?\}\}/i.test(all)) {
    out.push({ code: 'placeholder', level: 'error', message: 'В тексте остались заглушки вида [вставьте …] или {{…}}' });
  }

  // 4. Platform media compatibility
  for (const pid of platforms) {
    const spec = PLATFORMS[pid];
    const media = kind === 'post' ? 'text' : kind === 'carousel' ? 'carousel' : kind === 'graphic' ? 'image' : kind === 'video' ? 'video' : null;
    if (!media) continue;
    if (spec.mode !== 'manual' && !spec.apiMedia.includes(media)) {
      out.push({ code: 'unsupported_media', level: 'warning', platform: pid, message: `${spec.name}: API не публикует формат «${media}», материал будет подготовлен для ручного размещения` });
    }
  }

  if (!out.some((r) => r.level !== 'ok')) out.push({ code: 'all_ok', level: 'ok', message: 'Все проверки пройдены' });
  return out;
}

export function checksPassed(results: CheckResult[]): boolean {
  return !results.some((r) => r.level === 'error');
}

/* ---------- Platform adaptation ---------- */

export interface Adapted {
  title?: string;
  text: string;
  hashtags: string[];
  truncated: boolean;
}

/** Trim to `max` characters on a sentence or word boundary, never mid-word. */
export function smartTrim(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const slice = text.slice(0, max - 1);
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('\n'));
  if (sentence > max * 0.6) return { text: slice.slice(0, sentence + 1).trim(), truncated: true };
  const word = slice.lastIndexOf(' ');
  return { text: `${slice.slice(0, word > 0 ? word : slice.length).trim()}…`, truncated: true };
}

const HASHTAG_LIMIT: Partial<Record<PlatformId, number>> = {
  instagram: 8,
  threads: 1,
  tiktok: 5,
  youtube: 3,
  vk: 5,
  telegram: 3,
  max: 3,
};

export function cleanTag(t: string): string {
  return '#' + t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
}

/**
 * Deterministic adaptation of base content to a platform: length limits, hashtag
 * policy, title fields. LLM re-writing per platform is a separate optional step.
 */
export function adaptForPlatform(
  platform: PlatformId,
  base: { headline?: string; body: string; cta?: string; hashtags?: string[] },
  hasMedia: boolean,
): Adapted {
  const spec = PLATFORMS[platform];
  const tags = (base.hashtags ?? []).map(cleanTag).filter((t) => t.length > 1).slice(0, HASHTAG_LIMIT[platform] ?? 0);
  const longform = spec.mode === 'manual';
  let title: string | undefined;
  let core: string;

  if (platform === 'youtube') {
    title = smartTrim(base.headline || base.body.split('\n')[0] || '', spec.limits.titleMax ?? 100).text.replace(/…$/, '');
    core = [base.body, base.cta].filter(Boolean).join('\n\n');
  } else if (longform) {
    title = base.headline;
    core = [base.body, base.cta].filter(Boolean).join('\n\n');
  } else {
    core = [base.headline, base.body, base.cta].filter(Boolean).join('\n\n');
  }

  const tagLine = tags.length ? `\n\n${tags.join(' ')}` : '';
  // Telegram: the adapter sends a long text as a separate message after the media, so the full limit applies.
  const limit = platform === 'telegram' ? spec.limits.textMax : textLimitFor(platform, hasMedia);
  const trimmed = smartTrim(core, Math.max(40, limit - tagLine.length));
  return { title, text: trimmed.text + tagLine, hashtags: tags, truncated: trimmed.truncated };
}
