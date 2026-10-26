import { sentences, terms, words } from '../../../lib/text/tokenize';
import type { Article } from './types';

export interface Chunk {
  articleId: string;
  title: string;
  text: string;
  terms: string[];
  tf: Map<string, number>;
}

export interface SearchIndex {
  chunks: Chunk[];
  df: Map<string, number>;
  avgLen: number;
  synonyms: Map<string, string[]>;
}

export interface Hit {
  chunk: Chunk;
  score: number;
  /** share of question idf mass covered by the chunk (0..1) */
  coverage: number;
  matched: string[];
}

/** Splits an article into paragraph-sized chunks; the title is repeated for context. */
export function chunkArticle(a: Article): Array<{ title: string; text: string }> {
  const paras = a.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Array<{ title: string; text: string }> = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n' + p).length > 650 && buf) {
      out.push({ title: a.title, text: buf });
      buf = p;
    } else buf = buf ? `${buf}\n${p}` : p;
  }
  if (buf) out.push({ title: a.title, text: buf });
  return out.length ? out : [{ title: a.title, text: a.title }];
}

/** Parses synonym lines "вернуть = возврат, вернуть деньги" into stem groups. */
export function parseSynonyms(lines: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of lines) {
    const words = line
      .split(/[=,;]/)
      .map((w) => w.trim())
      .filter(Boolean);
    const stems = [...new Set(words.flatMap((w) => terms(w)))];
    for (const s of stems) map.set(s, [...new Set([...(map.get(s) ?? []), ...stems.filter((x) => x !== s)])]);
  }
  return map;
}

export function buildIndex(articles: Article[], synonymLines: string[] = []): SearchIndex {
  const chunks: Chunk[] = [];
  for (const a of articles) {
    for (const c of chunkArticle(a)) {
      // title terms are counted twice: titles are strong relevance signals
      const t = [...terms(c.title), ...terms(c.title), ...terms(c.text)];
      const tf = new Map<string, number>();
      for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
      chunks.push({ articleId: a.id, title: c.title, text: c.text, terms: t, tf });
    }
  }
  const df = new Map<string, number>();
  for (const c of chunks) for (const w of c.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const avgLen = chunks.length ? chunks.reduce((s, c) => s + c.terms.length, 0) / chunks.length : 1;
  return { chunks, df, avgLen, synonyms: parseSynonyms(synonymLines) };
}

function idf(index: SearchIndex, term: string): number {
  const n = index.chunks.length;
  const d = index.df.get(term) ?? 0;
  return Math.log(1 + (n - d + 0.5) / (d + 0.5));
}

/** Conversational filler that carries no meaning for retrieval. */
const QUERY_FILLER = new Set(
  'сколько можно ли как длится длиться действует работает работаете бывает будет можете сделать делать узнать занимает какой какая какое какие где когда почему зачем есть нужно надо хочу хотел хотела подскажите пожалуйста скажите здравствуйте привет добрый вечер утро спасибо мне меня вас вам у я мы если а'.split(' '),
);

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Meaningful query terms: filler words removed, then stemmed. */
export function queryTerms(query: string): string[] {
  const kept = words(query).filter((w) => !QUERY_FILLER.has(w));
  return [...new Set(terms(kept.join(' ')))];
}

/**
 * Expands a query term into its group: itself, synonyms and — when the stem is
 * unknown — the closest known stem by shared prefix (covers verb forms the
 * light stemmer misses: «привезут» → «привезти»).
 */
function expand(index: SearchIndex, t: string): string[] {
  const group = new Set([t, ...(index.synonyms.get(t) ?? [])]);
  if (!index.df.has(t) && !index.synonyms.has(t) && t.length >= 5) {
    const need = Math.max(5, t.length - 2);
    let best = '';
    let bestLen = 0;
    for (const v of [...index.df.keys(), ...index.synonyms.keys()]) {
      const l = commonPrefix(t, v);
      if (l >= need && l > bestLen) {
        best = v;
        bestLen = l;
      }
    }
    if (best) {
      group.add(best);
      for (const s of index.synonyms.get(best) ?? []) group.add(s);
    }
  }
  return [...group];
}

/** BM25 ranking with synonym expansion and term-coverage confidence. */
export function search(index: SearchIndex, query: string, limit = 5): Hit[] {
  const qTerms = queryTerms(query);
  if (qTerms.length === 0 || index.chunks.length === 0) return [];
  const k1 = 1.4;
  const b = 0.75;
  // Each query term may be satisfied by itself or a synonym.
  const groups = qTerms.map((t) => expand(index, t));
  // A group's weight is the idf of its known terms; an unknown word keeps its
  // (high) idf so questions about things absent from the base get low coverage.
  const weights = groups.map((g) => {
    const known = g.filter((t) => index.df.has(t));
    return Math.max(...(known.length ? known : [g[0]!]).map((t) => idf(index, t)), 0.1);
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const hits: Hit[] = [];
  for (const c of index.chunks) {
    let score = 0;
    let covered = 0;
    const matched: string[] = [];
    groups.forEach((g, gi) => {
      let best = 0;
      let bestTerm = '';
      for (const t of g) {
        const f = c.tf.get(t) ?? 0;
        if (!f) continue;
        const s = idf(index, t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.terms.length) / index.avgLen)));
        if (s > best) {
          best = s;
          bestTerm = t;
        }
      }
      if (best > 0) {
        score += best;
        covered += weights[gi]!;
        if (!matched.includes(bestTerm)) matched.push(bestTerm);
      }
    });
    if (score > 0) hits.push({ chunk: c, score, coverage: totalWeight ? covered / totalWeight : 0, matched });
  }
  return hits.sort((a, b2) => b2.score - a.score).slice(0, limit);
}

/** Picks the sentences of a chunk that best match the query, keeping original order. */
export function bestSentences(text: string, matchedTerms: string[], max = 3): string[] {
  const set = new Set(matchedTerms);
  const sents = sentences(text);
  const scored = sents.map((s, i) => ({ s, i, score: terms(s).filter((t) => set.has(t)).length }));
  const top = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
  return top.length ? top : sents.slice(0, 1);
}
