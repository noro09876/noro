import { describe, expect, it } from 'vitest';
import { analyze, extractKeywords, extractTheses, validateSource } from './analyze';
import { DEMO_SOURCE, demoProject } from './demo';
import { buildItems, lengthState, projectToMarkdown } from './generate';

const opts = { topic: 'потеря заявок', audience: 'владельцы бизнеса', tone: 'friendly' as const };

describe('analysis', () => {
  it('validates source length', () => {
    expect(validateSource('коротко')).toMatch(/короткий/);
    expect(validateSource('а'.repeat(20001))).toMatch(/длиннее/);
    expect(validateSource(DEMO_SOURCE)).toBeNull();
  });
  it('extracts keywords and theses from the source', () => {
    const k = extractKeywords(DEMO_SOURCE);
    expect(k).toContain('заявки');
    const t = extractTheses(DEMO_SOURCE, 5);
    expect(t).toHaveLength(5);
    // theses are source sentences (a leading connector may be trimmed)
    for (const s of t) expect(DEMO_SOURCE.toLowerCase()).toContain(s.slice(1).toLowerCase());
  });
  it('produces headlines, ctas and stats', () => {
    const a = analyze(DEMO_SOURCE, opts);
    expect(a.headlines.length).toBeGreaterThanOrEqual(5);
    expect(a.ctas.length).toBe(3);
    expect(a.stats.words).toBeGreaterThan(300);
    expect(a.facts.some((f) => f.includes('15 минут'))).toBe(true);
  });
  it('tone changes headlines', () => {
    expect(analyze(DEMO_SOURCE, { ...opts, tone: 'expert' }).headlines[0]).not.toBe(analyze(DEMO_SOURCE, opts).headlines[0]);
  });
});

describe('drafts', () => {
  const p = demoProject('2026-10-26');
  const a = analyze(p.source, p);
  it('builds one item per platform with schedule offsets', () => {
    const items = buildItems(p, a);
    expect(items.map((i) => i.platform)).toEqual(p.platforms);
    expect(items.find((i) => i.platform === 'vk')?.date).toBe('2026-10-27');
    for (const i of items) expect(lengthState(i.platform, i.body).level).not.toBe('over');
  });
  it('keeps hand-edited items unless overwrite is requested and stores versions', () => {
    const items = buildItems(p, a);
    const edited = items.map((i) => (i.platform === 'telegram' ? { ...i, body: 'мой текст', edited: true } : i));
    const again = buildItems({ ...p, items: edited, variant: 1 }, a);
    expect(again.find((i) => i.platform === 'telegram')?.body).toBe('мой текст');
    const forced = buildItems({ ...p, items: edited, variant: 1 }, a, true);
    const tg = forced.find((i) => i.platform === 'telegram')!;
    expect(tg.body).not.toBe('мой текст');
    expect(tg.versions.at(-1)?.body).toBe('мой текст');
  });
  it('drafts only use sentences from the source', () => {
    const items = buildItems(p, a);
    const tg = items.find((i) => i.platform === 'telegram')!;
    for (const t of a.theses.slice(0, 4)) expect(tg.body).toContain(t);
  });
  it('length checks and markdown export', () => {
    expect(lengthState('shorts', 'x'.repeat(1300)).level).toBe('over');
    expect(lengthState('telegram', 'x'.repeat(100)).level).toBe('short');
    const md = projectToMarkdown({ ...p, analysis: a, items: buildItems(p, a) });
    expect(md).toContain('## Тезисы');
    expect(md).toContain('## Telegram');
  });
});

describe('headings', () => {
  it('makes short readable headings', async () => {
    const { headingFrom, tidy } = await import('./analyze');
    expect(headingFrom('Первая причина — заявки приходят в разные места.')).toBe('Первая причина: заявки приходят в разные места');
    expect(headingFrom('Клиент, который оставил заявку, обычно пишет сразу в несколько компаний.')).toBe('Клиент, который оставил заявку');
    expect(tidy('Затем договоритесь о сроке.')).toBe('Договоритесь о сроке.');
  });
});
