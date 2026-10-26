import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../../../lib/csv';
import { breakdown, bucketOf, computeKpis, contributions, detectAnomalies, filterMask, median, pctChange, presetPeriod, previousPeriod, series } from './analytics';
import { buildDataset, dayToIso, detectBiColumns, DatasetError } from './dataset';

const load = (f: string) => {
  const t = parseCsvText(readFileSync(join(process.cwd(), 'public', 'demo', f), 'utf-8'));
  const m = detectBiColumns(t.headers);
  return { t, m, ds: buildDataset(t, m) };
};
const sales = load('sales-demo.csv');
const funnel = load('funnel-demo.csv');

describe('dataset', () => {
  it('maps and parses sales demo', () => {
    expect(sales.m.date).toBe('date');
    expect(sales.m.orderId).toBe('order_id');
    expect(sales.m.revenue).toBe('revenue');
    expect(sales.ds.rows).toBe(10626);
    expect(dayToIso(sales.ds.maxDay)).toBe('2026-10-25');
    expect(dayToIso(sales.ds.minDay)).toBe('2025-10-26');
  });
  it('maps aggregated funnel demo with RU dates', () => {
    expect(funnel.m.orders).toBe('Заказы');
    expect(funnel.m.orderId).toBe('');
    expect(funnel.m.visits).toBe('Визиты');
    expect(funnel.m.leads).toBe('Заявки');
    expect(funnel.ds.rows).toBe(1460);
  });
  it('counts bad rows and fails without required columns', () => {
    const t = parseCsvText('date,amount\n2026-01-01,100\nвчера,50\n2026-01-02,abc\n');
    const ds = buildDataset(t, { ...detectBiColumns(t.headers) });
    expect(ds.rows).toBe(1);
    expect(ds.skipped.badDate).toBe(1);
    expect(ds.skipped.badAmount).toBe(1);
    expect(() => buildDataset(t, { ...detectBiColumns(t.headers), date: '' })).toThrow(DatasetError);
  });
});

describe('kpis', () => {
  const ds = sales.ds;
  const mask = filterMask(ds, {});
  const p = presetPeriod(ds, '90');
  it('periods are relative to the data', () => {
    expect(p.to).toBe(ds.maxDay);
    expect(p.to - p.from + 1).toBe(90);
    expect(previousPeriod(ds, p)?.to).toBe(p.from - 1);
    expect(previousPeriod(ds, presetPeriod(ds, 'all'))).toBeNull();
  });
  it('computes only the KPIs the data supports', () => {
    const k = computeKpis(ds, p, mask);
    expect(k.revenue).toBeGreaterThan(0);
    expect(k.orders).toBeGreaterThan(0);
    expect(k.aov).toBeCloseTo(k.revenue / k.orders!, 6);
    expect(k.margin).not.toBeNull();
    expect(k.visits).toBeNull();
    expect(k.convOrder).toBeNull();
    const f = computeKpis(funnel.ds, presetPeriod(funnel.ds, '30'), filterMask(funnel.ds, {}));
    expect(f.convLead).toBeGreaterThan(0);
    expect(f.customers).toBeNull();
  });
  it('series sum equals KPI revenue; weekly buckets start on Monday', () => {
    const k = computeKpis(ds, p, mask);
    const s = series(ds, p, 'week', mask);
    expect(s.values.reduce((a, b) => a + b, 0)).toBeCloseTo(k.revenue, 2);
    expect(new Date(bucketOf(p.from + 3, 'week') * 864e5).getUTCDay()).toBe(1);
  });
  it('filters and breakdown shares', () => {
    const rows = breakdown(ds, 'category', p, previousPeriod(ds, p), mask);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 6);
    const only = filterMask(ds, { category: [rows[0]!.key] });
    expect(computeKpis(ds, p, only).revenue).toBeCloseTo(rows[0]!.revenue, 2);
    const c = contributions(rows);
    const totalDelta = rows.reduce((s, r) => s + r.revenue - (r.prev ?? 0), 0);
    expect(c.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(totalDelta, 2);
  });
  it('helpers', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(1, 0)).toBeNull();
  });
});

describe('anomalies', () => {
  it('finds the injected drop and spike', () => {
    const ds = sales.ds;
    const a = detectAnomalies(ds, presetPeriod(ds, 'all'), filterMask(ds, {}));
    const days = a.map((x) => dayToIso(x.day));
    expect(days).toContain('2026-03-14');
    expect(days).toContain('2026-06-12');
    const drop = a.find((x) => dayToIso(x.day) === '2026-03-14')!;
    expect(drop.z).toBeLessThan(0);
    expect(drop.deltaPct).toBeLessThan(-30);
  });
});
