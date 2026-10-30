import type { Content } from './content.ts';
import type { Platform } from './settings.ts';

export interface PlatformRules {
  label: string;
  maxText: number;
  /** Caption limit when images are attached (Telegram: 1024). */
  maxCaption: number;
  maxImages: number;
  requiresImage: boolean;
  maxHashtags: number;
  imageMimes: string[];
  maxImageBytes: number;
  /** Aspect ratio range width/height accepted by the platform. */
  aspect: [number, number];
}

export const RULES: Record<Platform, PlatformRules> = {
  telegram: {
    label: 'Telegram', maxText: 4096, maxCaption: 1024, maxImages: 10, requiresImage: false, maxHashtags: 5,
    imageMimes: ['image/jpeg', 'image/png'], maxImageBytes: 10 * 1024 * 1024, aspect: [0.05, 20],
  },
  vk: {
    label: 'ВКонтакте', maxText: 15000, maxCaption: 15000, maxImages: 10, requiresImage: false, maxHashtags: 10,
    imageMimes: ['image/jpeg', 'image/png'], maxImageBytes: 50 * 1024 * 1024, aspect: [0.05, 20],
  },
  instagram: {
    label: 'Instagram', maxText: 2200, maxCaption: 2200, maxImages: 10, requiresImage: true, maxHashtags: 30,
    imageMimes: ['image/jpeg'], maxImageBytes: 8 * 1024 * 1024, aspect: [0.8, 1.91],
  },
  x: {
    label: 'X', maxText: 280, maxCaption: 280, maxImages: 4, requiresImage: false, maxHashtags: 2,
    imageMimes: ['image/jpeg', 'image/png'], maxImageBytes: 5 * 1024 * 1024, aspect: [0.05, 20],
  },
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tags = (list: string[], max: number) => list.slice(0, max).map((t) => `#${t}`).join(' ');

/** X counts characters with weights; Latin, Cyrillic and punctuation weigh 1, emoji and CJK weigh 2, URLs 23. */
export function xLength(text: string): number {
  let n = 0;
  const withoutUrls = text.replace(/https?:\/\/\S+/g, () => {
    n += 23;
    return '';
  });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0) as number;
    const light = cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    n += light ? 1 : 2;
  }
  return n;
}

function truncateWords(text: string, max: number, measure: (s: string) => number = (s) => s.length): string {
  if (measure(text) <= max) return text;
  let out = '';
  for (const word of text.split(/(\s+)/)) {
    if (measure(`${out}${word}…`) > max) break;
    out += word;
  }
  return `${out.trimEnd()}…`;
}

export interface Composed {
  /** Main text. For Telegram this is HTML (parse_mode=HTML). */
  text: string;
  /** For Telegram: extra messages sent after the album when the text exceeds the caption limit. */
  followUps: string[];
  html: boolean;
}

/**
 * Builds the text for a specific platform from one material.
 * Telegram long texts are split into parts on paragraph boundaries rather than cut.
 */
export function compose(c: Content, platform: Platform, hasImages: boolean): Composed {
  const r = RULES[platform];
  const hashtagLine = c.hashtags.length ? tags(c.hashtags, r.maxHashtags) : '';
  const body = c.body.trim();
  const cta = c.cta.trim();

  if (platform === 'x') {
    const base = c.summary.trim() || c.title.trim() || body;
    const suffix = hashtagLine ? `\n\n${hashtagLine}` : '';
    const room = r.maxText - xLength(suffix);
    return { text: truncateWords(base, room, xLength) + suffix, followUps: [], html: false };
  }

  if (platform === 'telegram') {
    const blocks = [c.title.trim() ? `<b>${escapeHtml(c.title.trim())}</b>` : '', escapeHtml(body), escapeHtml(cta), escapeHtml(hashtagLine)].filter(Boolean);
    const full = blocks.join('\n\n');
    const limit = hasImages ? r.maxCaption : r.maxText;
    if (full.length <= limit) return { text: full, followUps: [], html: true };
    // Split into ≤4096-char messages on paragraph boundaries.
    const paragraphs = full.split(/\n\n/);
    const parts: string[] = [];
    let cur = '';
    for (const p of paragraphs) {
      const candidate = cur ? `${cur}\n\n${p}` : p;
      if (candidate.length <= r.maxText) cur = candidate;
      else {
        if (cur) parts.push(cur);
        cur = p.length > r.maxText ? truncateWords(p, r.maxText) : p;
      }
    }
    if (cur) parts.push(cur);
    if (hasImages) {
      // Album gets a short caption (the title); the full text follows as messages.
      const caption = c.title.trim() ? `<b>${escapeHtml(truncateWords(c.title.trim(), 900))}</b>` : '';
      return { text: caption, followUps: parts, html: true };
    }
    return { text: parts[0], followUps: parts.slice(1), html: true };
  }

  const blocks = [c.title.trim(), body, cta, hashtagLine].filter(Boolean);
  let text = blocks.join('\n\n');
  if (text.length > r.maxText) {
    const tail = [cta, hashtagLine].filter(Boolean).join('\n\n');
    const room = r.maxText - tail.length - 2;
    text = [truncateWords([c.title.trim(), body].filter(Boolean).join('\n\n'), room), tail].filter(Boolean).join('\n\n');
  }
  return { text, followUps: [], html: false };
}
