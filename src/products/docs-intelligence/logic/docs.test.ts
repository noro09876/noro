import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidCorrAccount } from '../../../lib/validators';
import { computeChecks } from './checks';
import { applyCustomRules, detectType, extractItems, isScanLike } from './extract';
import { buildDocFromCsv, buildDocFromText } from './parse';

const demo = (f: string) => readFileSync(join(process.cwd(), 'public', 'demo', f), 'utf-8');
const errs = (c: ReturnType<typeof computeChecks>) => c.filter((x) => x.level === 'error').map((x) => x.id);

describe('invoice 418', () => {
  const doc = buildDocFromText(demo('invoice-418.txt'), 'invoice-418.txt', 'txt');
  it('detects type and extracts fields', () => {
    expect(doc.type).toBe('invoice');
    expect(doc.fields.number?.value).toBe('418');
    expect(doc.fields.date?.value).toBe('2026-10-14');
    expect(doc.fields.sellerInn?.value).toBe('7708123450');
    expect(doc.fields.buyerInn?.value).toBe('5027345611');
    expect(doc.fields.bik?.value).toBe('044525999');
    expect(doc.fields.account?.value).toBe('40702810200000041871');
    expect(doc.fields.total?.value).toBe('105500.00');
    expect(doc.fields.vat?.value).toBe('21100.00');
    expect(doc.fields.vatRate?.value).toBe('20');
    expect(doc.fields.totalWithVat?.value).toBe('126600.00');
    expect(doc.fields.dueDate?.value).toBe('2026-10-24');
    expect(doc.items).toHaveLength(3);
    expect(doc.vatIncluded).toBe(false);
  });
  it('passes all checks', () => {
    const c = computeChecks(doc);
    expect(errs(c)).toEqual([]);
    expect(c.find((x) => x.id === 'acc')?.level).toBe('ok');
    expect(c.find((x) => x.id === 'vat')?.level).toBe('ok');
    expect(c.find((x) => x.id === 'items-total')?.level).toBe('ok');
  });
  it('re-checks after a manual edit', () => {
    const edited = { ...doc, fields: { ...doc.fields, account: { ...doc.fields.account!, value: '40702810200000041872', edited: true } } };
    expect(errs(computeChecks(edited))).toContain('acc');
  });
});

describe('act 112', () => {
  const doc = buildDocFromText(demo('act-112.txt'), 'act-112.txt', 'txt');
  it('finds invalid buyer INN and VAT mismatch (VAT included)', () => {
    expect(doc.type).toBe('act');
    expect(doc.vatIncluded).toBe(true);
    expect(doc.fields.seller?.value).toContain('Транзит Плюс');
    const e = errs(computeChecks(doc));
    expect(e).toContain('inn-buyerInn');
    expect(e).toContain('vat');
    expect(e).not.toContain('inn-sellerInn');
  });
});

describe('contract 88', () => {
  const doc = buildDocFromText(demo('contract-88.txt'), 'contract-88.txt', 'txt');
  it('detects reversed term dates and takes parties from requisites', () => {
    expect(doc.type).toBe('contract');
    expect(doc.fields.number?.value).toBe('88-П');
    expect(doc.fields.date?.value).toBe('2026-08-05');
    expect(doc.fields.startDate?.value).toBe('2026-08-05');
    expect(doc.fields.endDate?.value).toBe('2026-07-31');
    expect(doc.fields.buyerInn?.value).toBe('7810456725');
    expect(doc.fields.totalWithVat?.value).toBe('1284000.00');
    const c = computeChecks(doc);
    expect(errs(c)).toContain('term');
    expect(c.find((x) => x.id === 'vat')?.level).toBe('ok');
  });
});

describe('registry csv', () => {
  it('checks rows', () => {
    const doc = buildDocFromCsv(demo('payments-registry.csv'), 'payments-registry.csv');
    expect(doc.registry?.rows).toHaveLength(5);
    const c = computeChecks(doc);
    expect(c.some((x) => x.id === 'r4-num')).toBe(true);
    expect(c.some((x) => x.id === 'r2-vat')).toBe(true);
  });
});

describe('helpers', () => {
  it('type detection, items, custom rules, scan detection', () => {
    expect(detectType('Просто письмо без заголовков').type).toBe('unknown');
    expect(extractItems('1 | Товар | 2 | 10,00 | 20,00\nне строка')).toHaveLength(1);
    const custom = applyCustomRules('Основание: Договор № 5\nМенеджер: Иванов', [
      { id: 'a', label: 'Менеджер', keyword: 'менеджер' },
      { id: 'b', label: 'Договор', keyword: '', pattern: 'Договор № (\\d+)' },
      { id: 'c', label: 'Плохой', keyword: '', pattern: '([' },
    ]);
    expect(custom.a?.value).toBe('Иванов');
    expect(custom.b?.value).toBe('5');
    expect(custom.c).toBeUndefined();
    expect(isScanLike('   \n  ', 2)).toBe(true);
    expect(isScanLike(demo('invoice-418.txt'), 1)).toBe(false);
  });
  it('validates correspondent account against BIK', () => {
    expect(isValidCorrAccount('30101810400000000225', '044525225')).toBe(true);
    expect(isValidCorrAccount('30101810400000000226', '044525225')).toBe(false);
  });
});
