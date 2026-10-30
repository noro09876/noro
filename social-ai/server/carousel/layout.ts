import opentype from 'opentype.js';
import fs from 'node:fs';
import path from 'node:path';

const FONT_DIR = path.join(import.meta.dirname, '..', 'assets', 'fonts');

export const FONTS = {
  display: { family: 'Inter Display', weight: 700, file: 'InterDisplay-Bold.otf' },
  displaySemi: { family: 'Inter Display', weight: 600, file: 'InterDisplay-SemiBold.otf' },
  body: { family: 'Inter', weight: 400, file: 'Inter-Regular.otf' },
  medium: { family: 'Inter', weight: 500, file: 'Inter-Medium.otf' },
} as const;
export type FontKey = keyof typeof FONTS;

export const fontFiles = Object.values(FONTS).map((f) => path.join(FONT_DIR, f.file));

const cache = new Map<FontKey, opentype.Font>();
function font(key: FontKey): opentype.Font {
  let f = cache.get(key);
  if (!f) {
    const buf = fs.readFileSync(path.join(FONT_DIR, FONTS[key].file));
    f = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    cache.set(key, f);
  }
  return f;
}

export function measure(text: string, key: FontKey, size: number): number {
  return font(key).getAdvanceWidth(text, size, { kerning: true });
}

/** Russian typography: short prepositions and conjunctions must not hang at the end of a line. */
export function glueShortWords(text: string): string {
  return text.replace(/(^|[\s(«"])([вкосуиаВКОСУИА]|за|на|не|по|до|от|из|со|во|ко|об|но|же|ли|для|при|без|Не|На|За|По|До|От|Из|Для|При|Без)[ \t]+/g, '$1$2\u00a0');
}

/** Greedy word wrap. Words wider than the line are split by characters with a hyphen. */
export function wrap(text: string, key: FontKey, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of glueShortWords(text).split(/\n/)) {
    const words = paragraph.split(/[ \t]+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (let word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, key, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      while (measure(word, key, size) > maxWidth) {
        let cut = word.length - 1;
        while (cut > 1 && measure(`${word.slice(0, cut)}-`, key, size) > maxWidth) cut--;
        lines.push(`${word.slice(0, cut)}-`);
        word = word.slice(cut);
      }
      line = word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export interface FitResult {
  size: number;
  lines: string[];
  height: number;
  overflow: boolean;
}

/**
 * Finds the largest font size (stepping down from max to min) at which the text fits the box.
 * If even the minimum size does not fit, returns overflow=true so validation can block publishing.
 */
export function fit(
  text: string, key: FontKey, box: { width: number; height: number; maxLines?: number },
  sizes: { max: number; min: number; lineHeight: number },
): FitResult {
  let last: FitResult | null = null;
  for (let size = sizes.max; size >= sizes.min; size -= 2) {
    const lines = wrap(text, key, size, box.width);
    const height = lines.length * size * sizes.lineHeight;
    last = { size, lines, height, overflow: false };
    if (height <= box.height && (!box.maxLines || lines.length <= box.maxLines)) return last;
  }
  return { ...(last as FitResult), overflow: true };
}
