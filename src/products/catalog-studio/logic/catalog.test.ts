import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../../../lib/csv';
import { detectCatalogColumns } from './columns';
import { exportHeaders, issuesToRecords, productsFromTable, productsToRecords } from './io';
import { detectIssues, issueSummary } from './issues';
import { applyRules, netChanges, newRule, renderProductTemplate } from './rules';
import { CATALOG_FIELDS, DEFAULT_CHECKS, type CatalogField } from './types';

const csv = readFileSync(join(process.cwd(), 'public', 'demo', 'catalog-demo.csv'), 'utf-8');
const table = parseCsvText(csv);
const mapping = detectCatalogColumns(table.headers);
const rows = productsFromTable(table, mapping);
const mapped = new Set(CATALOG_FIELDS.filter((f) => mapping[f]) as CatalogField[]);

describe('import', () => {
  it('maps demo columns', () => {
    expect(mapping.sku).toBe('Артикул');
    expect(mapping.name).toBe('Наименование');
    expect(mapping.oldPrice).toBe('Старая цена');
    expect(mapping.barcode).toBe('Штрихкод');
    expect(rows).toHaveLength(240);
  });
  it('reads xlsx first sheet', async () => {
    const { readSheet } = await import('read-excel-file/universal');
    const buf = readFileSync(join(process.cwd(), 'src', 'test', 'fixtures', 'catalog-small.xlsx'));
    const grid = (await readSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))) as unknown[][];
    expect(grid[0]).toEqual(['Артикул', 'Наименование', 'Цена', 'Штрихкод']);
    expect(grid).toHaveLength(3);
  });
});

describe('issues', () => {
  const issues = detectIssues(rows, DEFAULT_CHECKS, mapped);
  const kinds = new Set(issues.map((i) => i.kind));
  it('finds the injected problem types', () => {
    for (const k of ['dup-sku', 'price-format', 'barcode', 'html', 'spaces', 'old-price', 'missing', 'caps'] as const) expect(kinds.has(k), k).toBe(true);
    expect(issueSummary(issues)[0]!.kind).toMatch(/missing|dup-sku|barcode|price-invalid/);
  });
  it('sku pattern is configurable and bad regex is ignored', () => {
    expect(detectIssues(rows, { ...DEFAULT_CHECKS, skuPattern: '(' }, mapped).some((i) => i.kind === 'sku-pattern')).toBe(false);
  });
});

describe('rules', () => {
  it('normalizes prices and trims, with a cell diff', () => {
    const { rows: out, changes } = applyRules(rows, [newRule('normalizePrice'), newRule('trim')]);
    const after = detectIssues(out, DEFAULT_CHECKS, mapped);
    expect(after.some((i) => i.kind === 'price-format')).toBe(false);
    expect(after.some((i) => i.kind === 'spaces')).toBe(false);
    expect(changes.length).toBeGreaterThan(0);
    expect(out).toHaveLength(rows.length);
    expect(rows.find((r) => r.v.price?.includes('руб'))).toBeTruthy(); // input untouched
  });
  it('markup, rounding, replace, fill, template', () => {
    const p = { id: 'x', v: { name: 'Чайник', brand: '', price: '1000' }, extra: {} };
    const r = applyRules([p], [{ ...newRule('markup'), num: 15 }, { ...newRule('round'), mode: '99' }, { ...newRule('fillEmpty'), field: 'brand', replaceWith: 'NORO' }, newRule('template')]);
    expect(r.rows[0]!.v.price).toBe('1199');
    expect(r.rows[0]!.v.brand).toBe('NORO');
    expect(r.rows[0]!.v.seoTitle).toBe('Чайник NORO — купить за 1199 ₽');
    expect(netChanges(r.changes).find((c) => c.field === 'price')).toMatchObject({ before: '1000', after: '1199' });
    expect(renderProductTemplate('{{Название}} {{Бренд|без бренда}}', { id: 'y', v: { name: 'Лампа' }, extra: {} })).toBe('Лампа без бренда');
    expect(renderProductTemplate('{{Название}} очень длинный хвост текста', { id: 'y', v: { name: 'Лампа' }, extra: {} }, 20).length).toBeLessThanOrEqual(20);
  });
  it('disabled rules do nothing; fixOldPrice clears wrong old price', () => {
    expect(applyRules(rows, [{ ...newRule('trim'), enabled: false }]).changes).toHaveLength(0);
    const r = applyRules([{ id: 'a', v: { price: '500', oldPrice: '400' }, extra: {} }], [newRule('fixOldPrice')]);
    expect(r.rows[0]!.v.oldPrice).toBe('');
  });
});

describe('export', () => {
  it('keeps original headers and appends new fields', () => {
    const withSeo = applyRules(rows.slice(0, 3), [newRule('template')]).rows;
    const { headers, fieldOf } = exportHeaders(table.headers, mapping, withSeo);
    expect(headers.slice(0, table.headers.length)).toEqual(table.headers);
    expect(headers.at(-1)).toBe('SEO-заголовок');
    const recs = productsToRecords(withSeo, headers, fieldOf);
    expect(recs[0]!['Артикул']).toBe(withSeo[0]!.v.sku);
    expect(issuesToRecords(detectIssues(rows, DEFAULT_CHECKS, mapped), rows)[0]).toHaveProperty('Как исправить');
  });
});
