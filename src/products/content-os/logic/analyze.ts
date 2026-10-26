import { sentences, terms, words } from '../../../lib/text/tokenize';
import { RU_STOPWORDS } from '../../../lib/text/stopwords';
import { stem } from '../../../lib/text/tokenize';
import type { Analysis, Tone } from './types';

export const MIN_SOURCE = 300;
export const MAX_SOURCE = 20000;

export function validateSource(text: string): string | null {
  const t = text.trim();
  if (t.length < MIN_SOURCE) return `Исходник слишком короткий: ${t.length} символов. Нужно от ${MIN_SOURCE} — иначе не из чего выделять тезисы.`;
  if (t.length > MAX_SOURCE) return `Исходник длиннее ${MAX_SOURCE.toLocaleString('ru-RU')} символов. Разбейте материал на несколько проектов.`;
  if (sentences(t).length < 3) return 'В тексте меньше трёх предложений — добавьте материала.';
  return null;
}

/** Keywords: frequent meaningful stems, shown in their most frequent surface form. */
const KEYWORD_SKIP = new Set(
  'который которая которое которые которых первый первая первое вторая второй третья третий также можно нужно должен должна должно просто часто обычно очень этого этой этом этот чтобы иначе после затем потом сначала главное наконец например'.split(' '),
);

/** Groups light-stemmer variants («заявк», «заявок») under one key. */
const keyOf = (s: string) => s.slice(0, Math.max(4, s.length - 2));

export function extractKeywords(text: string, limit = 8): string[] {
  const counts = new Map<string, number>();
  const surface = new Map<string, Map<string, number>>();
  for (const w of words(text)) {
    if (w.length < 4 || RU_STOPWORDS.has(w) || KEYWORD_SKIP.has(w) || /^\d+$/.test(w)) continue;
    const s = keyOf(stem(w));
    counts.set(s, (counts.get(s) ?? 0) + 1);
    const m = surface.get(s) ?? new Map<string, number>();
    m.set(w, (m.get(w) ?? 0) + 1);
    surface.set(s, m);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([s]) => [...surface.get(s)!.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]![0]);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export interface Paragraph {
  index: number;
  sentences: string[];
}

/** Paragraphs split by blank lines; a first short line without a full stop is the title. */
export function splitSource(text: string): { title: string | null; paragraphs: Paragraph[] } {
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  let title: string | null = null;
  if (blocks[0] && blocks[0].length <= 140 && !/[.!?…]$/.test(blocks[0]) && !blocks[0].includes('\n')) title = blocks.shift()!;
  return { title, paragraphs: blocks.map((b, index) => ({ index, sentences: sentences(b) })) };
}

const CONNECTOR_RE = /^(например|и наконец|наконец|затем|после этого|также|кроме того|при этом|поэтому|итак|в итоге|но|и|а)[,\s]+/i;

/** Removes a leading connector («Затем», «И наконец,») so a sentence reads on its own. */
export function tidy(sentence: string): string {
  const t = sentence.replace(CONNECTOR_RE, '').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : sentence;
}

/**
 * Theses: at most one sentence per paragraph, ranked by centrality (term
 * weights shared with the rest of the text) with a bonus for topic sentences
 * (first in a paragraph), then de-duplicated (MMR-like) and kept in text order.
 */
export function extractTheses(text: string, limit = 5): string[] {
  const { paragraphs } = splitSource(text);
  const cands = paragraphs.flatMap((p) => p.sentences.map((s, j) => ({ s, p: p.index, first: j === 0 })))
    .filter((c) => c.s.length >= 40 && c.s.length <= 320 && !c.s.endsWith('?'));
  if (!cands.length) return [];
  const sentTerms = cands.map((c) => new Set(terms(c.s)));
  const tf = new Map<string, number>();
  for (const set of sentTerms) for (const t of set) tf.set(t, (tf.get(t) ?? 0) + 1);
  const scored = cands.map((c, i) => {
    const set = sentTerms[i]!;
    let score = 0;
    for (const t of set) score += Math.log(1 + (tf.get(t) ?? 0));
    score /= Math.sqrt(set.size || 1);
    if (c.first) score *= 1.35;
    if (/^например/i.test(c.s)) score *= 0.6;
    return { ...c, i, set, score };
  });
  // best sentence of each paragraph
  const perPara = new Map<number, (typeof scored)[number]>();
  for (const c of scored) if (!perPara.has(c.p) || perPara.get(c.p)!.score < c.score) perPara.set(c.p, c);
  const pool = [...perPara.values()].sort((a, b) => b.score - a.score);
  const picked: typeof scored = [];
  while (picked.length < limit && pool.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    pool.forEach((c, idx) => {
      const redundancy = Math.max(0, ...picked.map((p) => jaccard(p.set, c.set)));
      const val = c.score * (1 - 0.8 * redundancy);
      if (val > bestVal) {
        bestVal = val;
        bestIdx = idx;
      }
    });
    picked.push(pool.splice(bestIdx, 1)[0]!);
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => tidy(p.s));
}

/** Short heading from a sentence: cut at a comma/colon/dash after 3+ words, max 9 words. */
export function headingFrom(sentence: string): string {
  const clean = sentence.replace(/[.!?…]+$/, '');
  const dash = clean.split(/\s[—–]\s/);
  if (dash.length > 1 && dash[0]!.split(/\s+/).length <= 3) {
    // «Первая причина — заявки приходят…» → «Первая причина: заявки приходят…»
    return headingFrom(`${dash[0]}: ${dash.slice(1).join(' — ')}`);
  }
  const ws = clean.split(/\s+/);
  const out: string[] = [];
  for (const w of ws) {
    out.push(w);
    if (out.length >= 3 && /[,:;—–]$/.test(w)) break;
    if (out.length >= 3 && ws[out.length] && /^[—–-]$/.test(ws[out.length]!)) break;
    if (out.length >= 9) break;
  }
  const h = out.join(' ').replace(/[\s,:;—–-]+$/, '');
  return out.length < ws.length && out.length >= 9 ? `${h}…` : h;
}

export function extractFacts(text: string, limit = 4): string[] {
  return sentences(text)
    .filter((s) => /\d/.test(s) && s.length <= 260)
    .slice(0, limit);
}

export function extractQuestions(text: string, limit = 3): string[] {
  return sentences(text)
    .filter((s) => s.endsWith('?') && s.length <= 200)
    .slice(0, limit);
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const low = (s: string) => (s && !/^[A-ZА-ЯЁ]{2,}/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

export function makeHeadlines(topic: string, keywords: string[], audience: string, thesisCount: number, tone: Tone, sourceTitle: string | null = null): string[] {
  const t = topic.trim() || keywords[0] || 'главное';
  const T = cap(t);
  const n = Math.max(3, Math.min(thesisCount, 7));
  const aud = audience.trim();
  const byTone: Record<Tone, string[]> = {
    friendly: [`Простыми словами: ${low(t)}`],
    expert: [`${T}: разбор по шагам`, `${T}: чек-лист из ${n} пунктов`],
    bold: [`${T} — без воды`, `${T}: неудобная правда`],
    formal: [`${T}: основные положения`],
  };
  const base = [
    sourceTitle ?? '',
    `${T}: ${n} ${n < 5 ? 'главные мысли' : 'главных мыслей'}`,
    `${T}: почему это важнее, чем кажется`,
    `${T}: с чего начать`,
    aud ? `${cap(aud)}, это для вас: ${low(t)}` : '',
    `${T}: ошибки, которые стоят дороже всего`,
  ].filter(Boolean);
  return [...new Set([...byTone[tone], ...base])].slice(0, 7);
}

export const CTA_BY_TONE: Record<Tone, string[]> = {
  friendly: ['Напишите в комментариях, как это устроено у вас', 'Сохраните пост, чтобы вернуться к нему', 'Перешлите тому, кому это пригодится'],
  expert: ['Если хотите разобрать ваш случай — напишите в личные сообщения', 'Сохраните чек-лист и сверьтесь с ним на неделе', 'Подпишитесь: в следующем материале — разбор примеров'],
  bold: ['Проверьте это у себя сегодня, а не «когда-нибудь»', 'Не согласны? Спорим в комментариях', 'Делитесь, пока конкуренты не прочитали'],
  formal: ['Подробности — по ссылке в профиле', 'Для консультации оставьте заявку на сайте', 'Подпишитесь на рассылку, чтобы получать материалы'],
};

export function analyze(text: string, opts: { topic: string; audience: string; tone: Tone }): Analysis {
  const clean = text.trim();
  const keywords = extractKeywords(clean);
  const theses = extractTheses(clean);
  const { title, paragraphs } = splitSource(clean);
  const lastPara = paragraphs.at(-1);
  const w = words(clean).length;
  const description = (theses[0] ?? sentences(clean)[0] ?? '').slice(0, 220);

  return {
    theses,
    keywords,
    facts: extractFacts(clean).map(tidy).filter((f) => !theses.includes(f)),
    questions: extractQuestions(clean).filter((q) => q.length >= 25),
    headlines: makeHeadlines(opts.topic, keywords, opts.audience, theses.length, opts.tone, title),
    conclusion: lastPara ? tidy(lastPara.sentences[0] ?? '') : '',
    paragraphs: paragraphs.map((p) => p.sentences.join(' ')),
    ctas: CTA_BY_TONE[opts.tone],
    description,
    stats: { chars: clean.length, words: w, sentences: sentences(clean).length, readingMinutes: Math.max(1, Math.round(w / 180)) },
  };
}
