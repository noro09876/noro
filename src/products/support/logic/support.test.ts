import { describe, expect, it } from 'vitest';
import { composeAnswer } from './answer';
import { classify } from './classify';
import { DEFAULT_SETTINGS, DEMO_ARTICLES } from './demoKb';
import { articlesFromJson, articlesFromText } from './importer';
import { buildIndex, parseSynonyms, search } from './search';
import { computeStats } from './stats';

const index = buildIndex(DEMO_ARTICLES, DEFAULT_SETTINGS.synonyms);

describe('search', () => {
  it('finds the returns article for a paraphrased question', () => {
    const hits = search(index, 'Как вернуть товар, если прошло 10 дней?');
    expect(hits[0]?.chunk.articleId).toBe('kb-returns');
  });
  it('uses synonyms', () => {
    const syn = parseSynonyms(['привезти = доставка']);
    expect([...syn.values()].flat().length).toBeGreaterThan(0);
    const hits = search(index, 'когда привезут');
    expect(hits[0]?.chunk.articleId).toBe('kb-delivery');
  });
  it('returns nothing for empty query or empty index', () => {
    expect(search(index, '   ')).toEqual([]);
    expect(search(buildIndex([]), 'доставка')).toEqual([]);
  });
});

describe('composeAnswer', () => {
  it('answers from sources with greeting and signature', () => {
    const a = composeAnswer('Как вернуть товар, если прошло 10 дней?', index, DEFAULT_SETTINGS);
    expect(a.kind).toBe('answer');
    expect(a.text).toContain('14 дней');
    expect(a.text.startsWith('Здравствуйте!')).toBe(true);
    expect(a.sources[0]?.title).toBe('Возврат и обмен товара');
    expect(a.engine).toBe('local');
  });
  it('honestly refuses when the base has no answer', () => {
    const a = composeAnswer('Есть ли у вас доставка дронами на Луну?', index, DEFAULT_SETTINGS);
    expect(a.kind).toBe('insufficient');
    expect(a.text).toMatch(/нет точного ответа/);
  });
  it('escalates on keywords and blocks stop topics', () => {
    expect(composeAnswer('Позовите оператора, пожалуйста', index, DEFAULT_SETTINGS).kind).toBe('escalate');
    expect(composeAnswer('Что думаете про политику?', index, DEFAULT_SETTINGS).kind).toBe('blocked');
  });
  it('respects threshold changes', () => {
    const q = 'доставка дронами';
    expect(composeAnswer(q, index, { ...DEFAULT_SETTINGS, threshold: 0.15 }).kind).toBe('answer');
    expect(composeAnswer(q, index, { ...DEFAULT_SETTINGS, threshold: 0.9 }).kind).toBe('insufficient');
  });
  it('formal tone changes wording', () => {
    const a = composeAnswer('Сколько стоит доставка?', index, { ...DEFAULT_SETTINGS, tone: 'formal', greeting: '', signature: '' });
    expect(a.text.startsWith('Согласно информации')).toBe(true);
  });
});

describe('classify', () => {
  it('detects topic and high priority with reasons', () => {
    const c = classify('Деньги списали дважды!! Срочно верните');
    expect(c.category).toBe('Оплата');
    expect(c.priority).toBe('high');
    expect(c.priorityReasons.length).toBeGreaterThan(0);
  });
  it('low priority for info questions', () => {
    const c = classify('Какие у вас есть подарочные сертификаты?');
    expect(c.category).toBe('Бонусы и акции');
    expect(c.priority).toBe('low');
  });
});

describe('import', () => {
  it('splits markdown by headings', () => {
    const arts = articlesFromText('# Доставка\nПривозим за день.\n\n## Оплата\n**Картой** или [СБП](http://x).', 'kb.md');
    expect(arts.map((x) => x.title)).toEqual(['Доставка', 'Оплата']);
    expect(arts[1]?.body).toBe('Картой или СБП.');
  });
  it('plain text without headings becomes one article', () => {
    expect(articlesFromText('Просто текст', 'faq.txt')[0]?.title).toBe('faq');
  });
  it('validates JSON', () => {
    expect(() => articlesFromJson('{oops')).toThrow(/JSON/);
    expect(() => articlesFromJson('[]')).toThrow(/не найдено/);
    expect(articlesFromJson(JSON.stringify({ articles: [{ title: 'A', body: 'B' }] }))).toHaveLength(1);
  });
});

describe('stats', () => {
  it('counts answer kinds', () => {
    const ans = composeAnswer('Сколько стоит доставка?', index, DEFAULT_SETTINGS);
    const no = composeAnswer('доставка дронами на Луну', index, DEFAULT_SETTINGS);
    const s = computeStats(
      [
        {
          id: 'c',
          startedAt: 0,
          messages: [
            { id: '1', role: 'user', text: 'Сколько стоит доставка?', at: 0, classification: classify('Сколько стоит доставка?') },
            { id: '2', role: 'bot', text: ans.text, at: 0, answer: ans },
            { id: '3', role: 'user', text: 'доставка дронами на Луну', at: 0 },
            { id: '4', role: 'bot', text: no.text, at: 0, answer: no },
          ],
        },
      ],
      [],
    );
    expect(s.questions).toBe(2);
    expect(s.answered).toBe(1);
    expect(s.insufficient).toBe(1);
    expect(s.unanswered).toEqual(['доставка дронами на Луну']);
  });
});
