import { emailDomain, FREE_EMAIL_DOMAINS, isValidEmail } from '../../../lib/validators';
import { parseCompanySize } from './normalize';
import type { Lead, ScoreResult, ScoringConfig, ScoringRule, Tier } from './types';

/**
 * Scorer abstraction. The default implementation is a transparent rule engine.
 * A model-based scorer (e.g. trained on closed deals) can implement the same
 * interface behind a server endpoint — see docs/architecture.md.
 */
export interface LeadScorer {
  readonly id: string;
  readonly label: string;
  score(lead: Lead, config: ScoringConfig): ScoreResult;
}

function listValues(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function ruleMatches(rule: ScoringRule, lead: Lead): boolean {
  const raw = lead.fields[rule.field] ?? '';
  const v = raw.trim().toLowerCase().replace(/ё/g, 'е');
  switch (rule.operator) {
    case 'not_empty':
      return v.length > 0;
    case 'empty':
      return v.length === 0;
    case 'equals':
      return v === rule.value.trim().toLowerCase().replace(/ё/g, 'е');
    case 'contains_any':
      return v.length > 0 && listValues(rule.value.replace(/ё/g, 'е')).some((needle) => v.includes(needle));
    case 'number_gte': {
      const n = parseCompanySize(raw);
      return Number.isFinite(n) && n >= Number(rule.value);
    }
    case 'number_lte': {
      const n = parseCompanySize(raw);
      return Number.isFinite(n) && n <= Number(rule.value);
    }
    case 'corporate_email': {
      const e = v;
      return isValidEmail(e) && !FREE_EMAIL_DOMAINS.has(emailDomain(e));
    }
    default:
      return false;
  }
}

export function tierFor(score: number, thresholds: ScoringConfig['thresholds']): Tier {
  if (score >= thresholds.a) return 'A';
  if (score >= thresholds.b) return 'B';
  return 'C';
}

export const ruleScorer: LeadScorer = {
  id: 'rules',
  label: 'Правила (локально)',
  score(lead, config) {
    const factors = config.rules
      .filter((r) => r.enabled && r.points !== 0 && ruleMatches(r, lead))
      .map((r) => ({ ruleId: r.id, label: r.label, points: r.points }));
    const raw = factors.reduce((s, f) => s + f.points, 0);
    const score = Math.max(0, Math.min(100, raw));
    return { score, tier: tierFor(score, config.thresholds), factors: factors.sort((a, b) => b.points - a.points) };
  },
};

export function scoreAll(leads: Lead[], config: ScoringConfig, scorer: LeadScorer = ruleScorer): Map<string, ScoreResult> {
  const out = new Map<string, ScoreResult>();
  for (const l of leads) out.set(l.id, scorer.score(l, config));
  return out;
}

export const DEFAULT_SCORING: ScoringConfig = {
  thresholds: { a: 65, b: 40 },
  rules: [
    { id: 'r-dm', label: 'Лицо, принимающее решение', field: 'title', operator: 'contains_any', value: 'генеральный, директор, ceo, cto, coo, cfo, founder, основатель, владелец, собственник, партнер', points: 25, enabled: true },
    { id: 'r-head', label: 'Руководитель направления', field: 'title', operator: 'contains_any', value: 'руководитель, head, начальник, lead, менеджер по закупкам', points: 12, enabled: true },
    { id: 'r-industry', label: 'Целевая отрасль', field: 'industry', operator: 'contains_any', value: 'производство, логистика, ритейл, e-commerce, интернет-магазин, дистрибуция, it, финансы', points: 20, enabled: true },
    { id: 'r-size', label: 'Компания от 50 сотрудников', field: 'companySize', operator: 'number_gte', value: '50', points: 15, enabled: true },
    { id: 'r-corp', label: 'Корпоративный email', field: 'email', operator: 'corporate_email', value: '', points: 15, enabled: true },
    { id: 'r-phone', label: 'Есть телефон', field: 'phone', operator: 'not_empty', value: '', points: 8, enabled: true },
    { id: 'r-src', label: 'Тёплый источник', field: 'source', operator: 'contains_any', value: 'рекомендация, вебинар, сайт, выставка', points: 10, enabled: true },
    { id: 'r-student', label: 'Нецелевая роль', field: 'title', operator: 'contains_any', value: 'студент, стажер, фрилансер', points: -20, enabled: true },
  ],
};
