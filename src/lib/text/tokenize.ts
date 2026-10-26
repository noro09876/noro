import { EN_STOPWORDS, RU_STOPWORDS } from './stopwords';
import { stemEn, stemRu } from './stem';

const WORD_RE = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;

export function words(text: string): string[] {
  return (text.toLowerCase().replace(/ё/g, 'е').match(WORD_RE) ?? []) as string[];
}

export function stem(word: string): string {
  return /[а-я]/.test(word) ? stemRu(word) : stemEn(word);
}

/** Lowercase → words → drop stopwords → stem. */
export function terms(text: string, keepStopwords = false): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    if (!keepStopwords && (RU_STOPWORDS.has(w) || EN_STOPWORDS.has(w))) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Splits text into sentences (handles ., !, ?, … and line breaks). */
export function sentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?…])\s+(?=[«"A-ZА-ЯЁ0-9])|\n{1,}/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
