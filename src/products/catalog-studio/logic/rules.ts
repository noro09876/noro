import { uid } from '../../../lib/id';
import { parsePrice } from '../../../lib/validators';
import { CATALOG_FIELDS, FIELD_LABELS, type CatalogField, type CellChange, type Product, type Rule, type RuleType } from './types';

const TEXT_FIELDS: CatalogField[] = ['sku', 'name', 'brand', 'category', 'description', 'seoTitle'];

export const RULE_META: Record<RuleType, { label: string; hint: string }> = {
  trim: { label: 'Очистить пробелы', hint: 'Убирает пробелы по краям и двойные пробелы во всех текстовых полях' },
  stripHtml: { label: 'Удалить HTML', hint: 'Убирает теги и HTML-сущности из текстовых полей' },
  normalizePrice: { label: 'Нормализовать цены', hint: '«1 299,00 руб.» → 1299 в полях цены и старой цены' },
  fixOldPrice: { label: 'Убрать неверные старые цены', hint: 'Очищает старую цену, если она не больше текущей' },
  markup: { label: 'Наценка', hint: 'Меняет цену на заданный процент (можно отрицательный)' },
  round: { label: 'Округление цен', hint: 'До целого, до 10 или «психологическая» цена …99' },
  replace: { label: 'Найти и заменить', hint: 'Замена текста в выбранном поле' },
  fillEmpty: { label: 'Заполнить пустые', hint: 'Подставляет значение в пустые ячейки поля' },
  nameCase: { label: 'Регистр названий', hint: 'Названия капсом → «Как в предложении»' },
  template: { label: 'Текст по шаблону', hint: 'Описание или SEO-заголовок из полей товара: {{Название}}, {{Бренд}}…' },
};

export function newRule(type: RuleType): Rule {
  const base: Rule = { id: uid('r'), type, enabled: true };
  switch (type) {
    case 'markup':
      return { ...base, field: 'price', num: 10 };
    case 'round':
      return { ...base, field: 'price', mode: '99' };
    case 'replace':
      return { ...base, field: 'name', find: '', replaceWith: '' };
    case 'fillEmpty':
      return { ...base, field: 'brand', replaceWith: 'Без бренда' };
    case 'template':
      return { ...base, field: 'seoTitle', template: '{{Название}} {{Бренд}} — купить за {{Цена}} ₽', onlyEmpty: true, maxLength: 70 };
    default:
      return base;
  }
}

export function fmtPlain(n: number): string {
  return String(Math.round(n * 100) / 100);
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"' };

/** Template tokens use Russian field labels: {{Название}}, {{Цена}}; optional fallback {{Бренд|NORO}}. */
export function renderProductTemplate(tpl: string, p: Product, maxLength?: number): string {
  const byLabel = new Map<string, CatalogField>(CATALOG_FIELDS.map((f) => [FIELD_LABELS[f].toLowerCase(), f]));
  let s = tpl.replace(/\{\{\s*([^}|]+?)\s*(?:\|([^}]*))?\}\}/g, (_m, name: string, fb?: string) => {
    const key = byLabel.get(name.toLowerCase()) ?? (CATALOG_FIELDS as readonly string[]).find((f) => f === name);
    const val = key ? (p.v[key as CatalogField] ?? '').trim() : '';
    return val || (fb ?? '');
  });
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?—])/g, (m, c: string) => (c === '—' ? m : c)).replace(/^[\s,—-]+|[\s,—-]+$/g, '');
  if (maxLength && s.length > maxLength) {
    const cut = s.slice(0, maxLength - 1);
    s = `${cut.slice(0, cut.lastIndexOf(' ') > maxLength * 0.6 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s,—-]+$/, '')}…`;
  }
  return s;
}

function applyOne(rule: Rule, p: Product): Partial<Record<CatalogField, string>> {
  const out: Partial<Record<CatalogField, string>> = {};
  const get = (f: CatalogField) => p.v[f] ?? '';
  switch (rule.type) {
    case 'trim':
      for (const f of TEXT_FIELDS) if (get(f)) out[f] = get(f).replace(/\s+/g, ' ').trim();
      break;
    case 'stripHtml':
      for (const f of TEXT_FIELDS)
        if (get(f))
          out[f] = get(f)
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/?[a-z][^>]*>/gi, '')
            .replace(/&(nbsp|amp|lt|gt|quot);/gi, (_m, e: string) => ENTITIES[e.toLowerCase()] ?? '')
            .replace(/\s{2,}/g, ' ')
            .trim();
      break;
    case 'normalizePrice':
      for (const f of ['price', 'oldPrice'] as const) {
        const n = parsePrice(get(f));
        if (get(f).trim() && Number.isFinite(n) && n > 0) out[f] = fmtPlain(n);
      }
      break;
    case 'fixOldPrice': {
      const price = parsePrice(get('price'));
      const old = parsePrice(get('oldPrice'));
      if (Number.isFinite(price) && Number.isFinite(old) && old <= price) out.oldPrice = '';
      break;
    }
    case 'markup': {
      const f = rule.field ?? 'price';
      const n = parsePrice(get(f));
      if (Number.isFinite(n) && n > 0) out[f] = fmtPlain(n * (1 + (rule.num ?? 0) / 100));
      break;
    }
    case 'round': {
      const f = rule.field ?? 'price';
      const n = parsePrice(get(f));
      if (!Number.isFinite(n) || n <= 0) break;
      const r = rule.mode === '10' ? Math.round(n / 10) * 10 : rule.mode === '99' ? Math.max(99, Math.ceil((n + 1) / 100) * 100 - 1) : Math.round(n);
      out[f] = String(r);
      break;
    }
    case 'replace': {
      const f = rule.field ?? 'name';
      if (!rule.find) break;
      const re = new RegExp(rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), rule.mode === 'case' ? 'g' : 'gi');
      if (get(f)) out[f] = get(f).replace(re, rule.replaceWith ?? '');
      break;
    }
    case 'fillEmpty': {
      const f = rule.field ?? 'brand';
      if (!get(f).trim() && rule.replaceWith) out[f] = rule.replaceWith;
      break;
    }
    case 'nameCase': {
      const s = get('name');
      if (s.length >= 8 && s === s.toUpperCase() && /[A-ZА-ЯЁ]{4}/.test(s)) {
        const lower = s.toLowerCase();
        out.name = lower[0]!.toUpperCase() + lower.slice(1);
      }
      break;
    }
    case 'template': {
      const f = rule.field ?? 'seoTitle';
      if (rule.onlyEmpty && get(f).trim()) break;
      if (!rule.template) break;
      out[f] = renderProductTemplate(rule.template, p, rule.maxLength);
      break;
    }
  }
  return out;
}

/**
 * Runs enabled rules in order over all rows. Returns new rows and a cell-level
 * change list for preview. Rows that are not changed keep their identity.
 */
export function applyRules(rows: Product[], rules: Rule[], onlyIds?: Set<string>): { rows: Product[]; changes: CellChange[] } {
  const changes: CellChange[] = [];
  const active = rules.filter((r) => r.enabled);
  const next = rows.map((row) => {
    if (onlyIds && !onlyIds.has(row.id)) return row;
    let cur = row;
    for (const rule of active) {
      const patch = applyOne(rule, cur);
      const changed = (Object.keys(patch) as CatalogField[]).filter((f) => (patch[f] ?? '') !== (cur.v[f] ?? ''));
      if (!changed.length) continue;
      for (const f of changed) changes.push({ rowId: row.id, field: f, before: cur.v[f] ?? '', after: patch[f] ?? '', ruleId: rule.id });
      cur = { ...cur, v: { ...cur.v, ...Object.fromEntries(changed.map((f) => [f, patch[f]])) } };
    }
    return cur;
  });
  return { rows: next, changes };
}

/** Collapses consecutive changes of the same cell into before → final after. */
export function netChanges(changes: CellChange[]): CellChange[] {
  const m = new Map<string, CellChange>();
  for (const c of changes) {
    const k = `${c.rowId}:${c.field}`;
    const prev = m.get(k);
    m.set(k, prev ? { ...c, before: prev.before } : c);
  }
  return [...m.values()].filter((c) => c.before !== c.after);
}
