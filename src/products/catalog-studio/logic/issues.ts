import { isValidBarcode, parsePrice } from '../../../lib/validators';
import { FIELD_LABELS, ISSUE_META, type CatalogField, type CheckSettings, type Issue, type IssueKind, type Product } from './types';

const HTML_RE = /<\/?[a-z][^>]*>|&(nbsp|amp|lt|gt|quot);/i;
const TEXT_FIELDS: CatalogField[] = ['sku', 'name', 'brand', 'category', 'description', 'seoTitle'];

/** A price that is already a plain number (what marketplaces and CMS expect). */
export const isPlainNumber = (s: string) => /^-?\d+(\.\d{1,2})?$/.test(s.trim());

export function safeRegex(pattern: string): RegExp | null {
  if (!pattern.trim()) return null;
  try {
    return new RegExp(pattern.slice(0, 200));
  } catch {
    return null;
  }
}

export function detectIssues(rows: Product[], cfg: CheckSettings, mapped: Set<CatalogField>): Issue[] {
  const out: Issue[] = [];
  const add = (rowId: string, field: CatalogField, kind: IssueKind, message: string) => out.push({ rowId, field, kind, severity: ISSUE_META[kind].severity, message });
  const skuRe = safeRegex(cfg.skuPattern);

  const skuCount = new Map<string, number>();
  const eanCount = new Map<string, number>();
  for (const r of rows) {
    const sku = (r.v.sku ?? '').trim().toUpperCase();
    if (sku) skuCount.set(sku, (skuCount.get(sku) ?? 0) + 1);
    const ean = (r.v.barcode ?? '').trim();
    if (ean) eanCount.set(ean, (eanCount.get(ean) ?? 0) + 1);
  }

  for (const r of rows) {
    const v = (f: CatalogField) => r.v[f] ?? '';
    for (const f of cfg.required) if (mapped.has(f) && !v(f).trim()) add(r.id, f, 'missing', `Поле «${FIELD_LABELS[f]}» пустое`);

    const sku = v('sku').trim();
    if (sku && (skuCount.get(sku.toUpperCase()) ?? 0) > 1) add(r.id, 'sku', 'dup-sku', `Артикул ${sku} встречается ${skuCount.get(sku.toUpperCase())} раз`);
    if (sku && skuRe && !skuRe.test(v('sku'))) add(r.id, 'sku', 'sku-pattern', `«${v('sku')}» не соответствует шаблону`);

    for (const f of ['price', 'oldPrice'] as const) {
      const raw = v(f).trim();
      if (!raw) continue;
      const n = parsePrice(raw);
      if (!Number.isFinite(n)) add(r.id, f, 'price-invalid', `«${raw}» не распознаётся как цена`);
      else if (n <= 0) add(r.id, f, 'price-invalid', `Цена должна быть больше нуля: ${raw}`);
      else if (!isPlainNumber(raw)) add(r.id, f, 'price-format', `«${raw}» → ${n}`);
    }
    const price = parsePrice(v('price'));
    const old = parsePrice(v('oldPrice'));
    if (Number.isFinite(price) && Number.isFinite(old) && old > 0 && old <= price) add(r.id, 'oldPrice', 'old-price', `Старая цена ${old} не больше текущей ${price}`);

    const ean = v('barcode').trim();
    if (ean) {
      if (!isValidBarcode(ean)) add(r.id, 'barcode', 'barcode', /^\d+$/.test(ean) ? `Контрольная цифра ${ean} не сходится` : `«${ean}» — не цифровой код`);
      else if ((eanCount.get(ean) ?? 0) > 1) add(r.id, 'barcode', 'dup-barcode', `Штрихкод ${ean} у нескольких товаров`);
    }
    for (const f of TEXT_FIELDS) {
      const s = v(f);
      if (!s) continue;
      if (HTML_RE.test(s)) add(r.id, f, 'html', 'Есть HTML-теги или сущности');
      if (/^\s|\s$|\s{2,}/.test(s)) add(r.id, f, 'spaces', 'Пробелы в начале, в конце или двойные');
    }
    const name = v('name').trim();
    if (name.length > cfg.maxNameLength) add(r.id, 'name', 'long-name', `${name.length} символов, лимит ${cfg.maxNameLength}`);
    if (name.length >= 8 && name === name.toUpperCase() && /[A-ZА-ЯЁ]{4}/.test(name)) add(r.id, 'name', 'caps', 'Название целиком заглавными');
    const stock = v('stock').trim();
    if (stock && !/^\d+$/.test(stock.replace(/\s/g, ''))) add(r.id, 'stock', 'stock', `Остаток «${stock}» — не целое неотрицательное число`);
    const w = v('weight').trim();
    if (w && !(parsePrice(w) > 0)) add(r.id, 'weight', 'weight', `Вес «${w}» не распознан`);
    if (mapped.has('description') && !v('description').trim()) add(r.id, 'description', 'no-description', 'Описание пустое');
  }
  return out;
}

export function issueSummary(issues: Issue[]): Array<{ kind: IssueKind; count: number; rows: number }> {
  const m = new Map<IssueKind, { count: number; rows: Set<string> }>();
  for (const i of issues) {
    const e = m.get(i.kind) ?? { count: 0, rows: new Set<string>() };
    e.count++;
    e.rows.add(i.rowId);
    m.set(i.kind, e);
  }
  const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
  return [...m.entries()]
    .map(([kind, e]) => ({ kind, count: e.count, rows: e.rows.size }))
    .sort((a, b) => order[ISSUE_META[a.kind].severity]! - order[ISSUE_META[b.kind].severity]! || b.count - a.count);
}
