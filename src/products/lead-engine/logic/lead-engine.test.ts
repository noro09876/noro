import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../../../lib/csv';
import { demoFile } from '../../../test/fixtures';
import { detectLeadColumns } from './columns';
import { findDuplicateGroups, mergeAllDuplicates, mergeGroup, DEFAULT_DEDUPE } from './dedupe';
import { countIssues, detectIssues } from './issues';
import { emptyFields, leadsFromTable, searchLeads } from './lead';
import { normalizeLeadFields, parseCompanySize } from './normalize';
import { DEFAULT_SCORING, ruleMatches, ruleScorer, scoreAll, tierFor } from './scoring';
import { renderTemplate } from './templates';
import type { Lead, ScoringConfig } from './types';

function lead(partial: Partial<Lead['fields']>, id = 'x'): Lead {
  return { id, fields: { ...emptyFields(), ...partial }, extra: {}, status: 'new', nextAction: '', dueDate: '', history: [], mergedCount: 0 };
}

const demo = parseCsvText(demoFile('leads-demo.csv'));
const mapping = detectLeadColumns(demo.headers);
const leads = leadsFromTable(demo, mapping, 0);

describe('import & mapping', () => {
  it('maps russian headers of the demo file', () => {
    expect(mapping).toMatchObject({ name: 'ФИО', company: 'Компания', title: 'Должность', email: 'Email', phone: 'Телефон', industry: 'Отрасль', companySize: 'Сотрудников', source: 'Источник', city: 'Город', website: 'Сайт', notes: 'Комментарий' });
    expect(leads).toHaveLength(64);
  });

  it('keeps unmapped columns as extra fields', () => {
    const t = parseCsvText('Имя,Бюджет\nАнна,100000');
    const m = detectLeadColumns(t.headers);
    const ls = leadsFromTable(t, m);
    expect(ls[0]!.fields.name).toBe('Анна');
    expect(ls[0]!.extra).toEqual({ 'Бюджет': '100000' });
  });

  it('skips fully empty rows', () => {
    const t = parseCsvText('Имя,Email\n,\nОлег,o@a.example');
    expect(leadsFromTable(t, detectLeadColumns(t.headers))).toHaveLength(1);
  });
});

describe('normalization & issues', () => {
  it('normalizes names, emails, phones and websites', () => {
    const r = normalizeLeadFields({ ...emptyFields(), name: 'иванова  мария', email: ' I.KOZLOV@FIRM.EXAMPLE ', phone: '8 (923) 2807270', website: 'https://www.firm.example/about', company: 'ООО "Ромашка"' });
    expect(r.fields.name).toBe('Иванова Мария');
    expect(r.fields.email).toBe('i.kozlov@firm.example');
    expect(r.fields.phone).toBe('+7 923 280-72-70');
    expect(r.fields.website).toBe('firm.example');
    expect(r.fields.company).toBe('ООО «Ромашка»');
    expect(r.changed).toEqual(expect.arrayContaining(['name', 'email', 'phone', 'website', 'company']));
  });

  it('does not destroy unparseable phones', () => {
    expect(normalizeLeadFields({ ...emptyFields(), phone: '12-34' }).fields.phone).toBe('12-34');
  });

  it('finds the problems injected into the demo file', () => {
    const c = countIssues(detectIssues(leads));
    expect(c.invalid_email).toBe(1);
    expect(c.invalid_phone).toBe(1);
    expect(c.no_contact).toBe(1);
    expect(c.missing_name).toBe(1);
    expect(c.missing_company).toBe(1);
    expect(c.free_email).toBeGreaterThanOrEqual(2);
    expect(c.unnormalized).toBeGreaterThan(10);
  });

  it('parses company size ranges', () => {
    expect(parseCompanySize('51-200')).toBe(126);
    expect(parseCompanySize('1 000')).toBe(1000);
    expect(parseCompanySize('500+')).toBe(500);
    expect(parseCompanySize('')).toBeNaN();
  });
});

describe('deduplication', () => {
  it('groups records sharing email (case-insensitive) or phone in different formats', () => {
    const ls = [lead({ email: 'A@x.example', name: 'Анна' }, '1'), lead({ email: 'a@x.example', phone: '8 900 111 22 33' }, '2'), lead({ phone: '+7 (900) 111-22-33' }, '3'), lead({ email: 'b@x.example' }, '4')];
    const groups = findDuplicateGroups(ls, DEFAULT_DEDUPE);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids.sort()).toEqual(['1', '2', '3']);
    expect(groups[0]!.reasons).toEqual(expect.arrayContaining(['одинаковый email', 'одинаковый телефон']));
  });

  it('respects disabled rules', () => {
    const ls = [lead({ email: 'a@x.example' }, '1'), lead({ email: 'a@x.example' }, '2')];
    expect(findDuplicateGroups(ls, { email: false, phone: true, companyAndName: true })).toHaveLength(0);
  });

  it('matches company+name ignoring legal form and case', () => {
    const ls = [lead({ company: 'ООО «Кодекс Софт»', name: 'Олег Титов' }, '1'), lead({ company: 'Кодекс Софт', name: 'олег титов' }, '2')];
    expect(findDuplicateGroups(ls, DEFAULT_DEDUPE)).toHaveLength(1);
  });

  it('merges keeping the most complete record and filling gaps', () => {
    const a = lead({ name: 'Анна', email: 'a@x.example', notes: 'первая' }, 'a');
    const b = lead({ name: 'Анна', email: 'a@x.example', phone: '+7 900 000-00-01', title: 'CEO', notes: 'вторая' }, 'b');
    const m = mergeGroup([a, b], 5);
    expect(m.id).toBe('b');
    expect(m.fields.phone).toBe('+7 900 000-00-01');
    expect(m.fields.notes).toBe('вторая · первая');
    expect(m.mergedCount).toBe(1);
    expect(m.history.at(-1)).toEqual({ at: 5, type: 'merge', text: 'Объединено записей: 2' });
  });

  it('finds and merges the 4 duplicates injected into the demo', () => {
    const groups = findDuplicateGroups(leads, DEFAULT_DEDUPE);
    const merged = mergeAllDuplicates(leads, groups);
    expect(merged.length).toBe(leads.length - groups.reduce((n, g) => n + g.ids.length - 1, 0));
    expect(merged.length).toBeLessThanOrEqual(60);
  });
});

describe('scoring', () => {
  const cfg: ScoringConfig = {
    thresholds: { a: 50, b: 20 },
    rules: [
      { id: 'dm', label: 'ЛПР', field: 'title', operator: 'contains_any', value: 'директор, ceo', points: 30, enabled: true },
      { id: 'corp', label: 'Корп. почта', field: 'email', operator: 'corporate_email', value: '', points: 20, enabled: true },
      { id: 'size', label: '50+', field: 'companySize', operator: 'number_gte', value: '50', points: 10, enabled: true },
      { id: 'off', label: 'Выключено', field: 'phone', operator: 'empty', value: '', points: 100, enabled: false },
      { id: 'neg', label: 'Стажёр', field: 'title', operator: 'contains_any', value: 'стажер', points: -40, enabled: true },
    ],
  };

  it('sums matched rules and explains factors', () => {
    const r = ruleScorer.score(lead({ title: 'Генеральный Директор', email: 'ceo@firm.example', companySize: '51-200' }), cfg);
    expect(r.score).toBe(60);
    expect(r.tier).toBe('A');
    expect(r.factors.map((f) => f.ruleId)).toEqual(['dm', 'corp', 'size']);
  });

  it('applies negative rules, clamps at 0 and ignores disabled rules', () => {
    const r = ruleScorer.score(lead({ title: 'Стажёр', email: 'me@gmail.com' }), cfg);
    expect(r.score).toBe(0);
    expect(r.tier).toBe('C');
    expect(r.factors.map((f) => f.ruleId)).toEqual(['neg']);
  });

  it('changes when the rules change (no randomness)', () => {
    const l = lead({ title: 'CEO', email: 'x@firm.example' });
    const s1 = ruleScorer.score(l, cfg).score;
    const s2 = ruleScorer.score(l, { ...cfg, rules: cfg.rules.map((r) => (r.id === 'dm' ? { ...r, points: 5 } : r)) }).score;
    expect(s1).toBe(50);
    expect(s2).toBe(25);
    expect(ruleScorer.score(l, cfg)).toEqual(ruleScorer.score(l, cfg));
  });

  it('computes tiers from thresholds', () => {
    expect(tierFor(65, { a: 65, b: 40 })).toBe('A');
    expect(tierFor(64, { a: 65, b: 40 })).toBe('B');
    expect(tierFor(39, { a: 65, b: 40 })).toBe('C');
  });

  it('supports all operators', () => {
    const l = lead({ industry: 'Производство', city: '' });
    expect(ruleMatches({ id: '', label: '', field: 'industry', operator: 'equals', value: 'производство', points: 1, enabled: true }, l)).toBe(true);
    expect(ruleMatches({ id: '', label: '', field: 'city', operator: 'empty', value: '', points: 1, enabled: true }, l)).toBe(true);
    expect(ruleMatches({ id: '', label: '', field: 'companySize', operator: 'number_lte', value: '10', points: 1, enabled: true }, lead({ companySize: '1-10' }))).toBe(true);
  });

  it('scores the demo base into all three tiers with the default rules', () => {
    const scores = scoreAll(leads, DEFAULT_SCORING);
    const tiers = new Set([...scores.values()].map((s) => s.tier));
    expect(tiers).toEqual(new Set(['A', 'B', 'C']));
  });
});

describe('templates & search', () => {
  it('renders placeholders with fallbacks and reports missing values', () => {
    const l = lead({ name: 'Мария Петрова', company: 'ООО «Бриз»' });
    expect(renderTemplate('Здравствуйте, {{имя}}! {{компания}} — {{отрасль|ваша сфера}}.', l)).toEqual({ text: 'Здравствуйте, Мария! ООО «Бриз» — ваша сфера.', missing: [] });
    expect(renderTemplate('Город: {{город}}.', l).missing).toEqual(['город']);
  });

  it('searches across fields with multiple words', () => {
    const found = searchLeads(leads, 'логистик казань');
    expect(found.every((l) => /логист/i.test(l.fields.industry + l.fields.company) && /казань/i.test(l.fields.city))).toBe(true);
    expect(searchLeads(leads, '')).toHaveLength(leads.length);
  });
});

describe('funnel stats', () => {
  it('counts stages as reached when status is at or beyond, excluding lost', async () => {
    const { funnel, groupStats } = await import('./stats');
    const ls = [lead({}, '1'), { ...lead({}, '2'), status: 'contacted' as const }, { ...lead({}, '3'), status: 'won' as const }, { ...lead({}, '4'), status: 'lost' as const }];
    const f = funnel(ls);
    expect(f.lost).toBe(1);
    expect(f.stages.map((s) => s.reached)).toEqual([3, 2, 2, 1, 1]);
    expect(f.stages.find((s) => s.status === 'contacted')!.current).toBe(1);
    const g = groupStats([lead({ source: 'Сайт' }, 'a'), lead({ source: '' }, 'b')], 'source', new Map());
    expect(g.map((x) => x.key).sort()).toEqual(['Не указано', 'Сайт']);
  });
});
