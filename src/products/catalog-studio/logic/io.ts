import type { Table } from '../../../lib/csv';
import { uid } from '../../../lib/id';
import { CATALOG_FIELDS, FIELD_LABELS, ISSUE_META, type CatalogField, type Issue, type Product } from './types';

export function productsFromTable(table: Table, mapping: Record<CatalogField, string>): Product[] {
  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
  const out: Product[] = [];
  for (const row of table.rows) {
    if (Object.values(row).every((x) => !String(x ?? '').trim())) continue;
    const v: Partial<Record<CatalogField, string>> = {};
    for (const f of CATALOG_FIELDS) if (mapping[f]) v[f] = String(row[mapping[f]] ?? '');
    const extra: Record<string, string> = {};
    for (const h of table.headers) if (!mappedHeaders.has(h)) extra[h] = String(row[h] ?? '');
    out.push({ id: uid('p'), v, extra });
  }
  return out;
}

/** Export keeps the user's original column names and order; new fields are appended. */
export function exportHeaders(sourceHeaders: string[], mapping: Record<CatalogField, string>, rows: Product[]): { headers: string[]; fieldOf: Map<string, CatalogField> } {
  const fieldOf = new Map<string, CatalogField>();
  for (const f of CATALOG_FIELDS) if (mapping[f]) fieldOf.set(mapping[f], f);
  const headers = [...sourceHeaders];
  for (const f of CATALOG_FIELDS) {
    if (mapping[f]) continue;
    if (rows.some((r) => (r.v[f] ?? '') !== '')) {
      headers.push(FIELD_LABELS[f]);
      fieldOf.set(FIELD_LABELS[f], f);
    }
  }
  return { headers, fieldOf };
}

export function productsToRecords(rows: Product[], headers: string[], fieldOf: Map<string, CatalogField>): Record<string, string>[] {
  return rows.map((r) => Object.fromEntries(headers.map((h) => [h, fieldOf.has(h) ? (r.v[fieldOf.get(h)!] ?? '') : (r.extra[h] ?? '')])));
}

export function issuesToRecords(issues: Issue[], rows: Product[]): Record<string, string>[] {
  const pos = new Map(rows.map((r, i) => [r.id, i]));
  return issues.map((i) => {
    const r = rows[pos.get(i.rowId) ?? -1];
    return {
      Строка: String((pos.get(i.rowId) ?? 0) + 2),
      Артикул: r?.v.sku ?? '',
      Поле: FIELD_LABELS[i.field],
      Проблема: ISSUE_META[i.kind].label,
      Важность: i.severity === 'error' ? 'Ошибка' : i.severity === 'warning' ? 'Предупреждение' : 'Совет',
      Детали: i.message,
      'Как исправить': ISSUE_META[i.kind].fix ?? '',
    };
  });
}
