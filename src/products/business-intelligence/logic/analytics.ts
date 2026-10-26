import { dayToIso } from './dataset';
import { DIMENSIONS, type Anomaly, type Dataset, type Dimension, type Filters, type Granularity, type Kpis, type Measure, type Period, type PresetKey } from './types';

/** Period presets are relative to the LAST date in the data, not to today. */
export function presetPeriod(ds: Dataset, key: PresetKey, custom?: Period): Period {
  if (key === 'custom' && custom) return { from: Math.max(ds.minDay, custom.from), to: Math.min(ds.maxDay, custom.to) };
  if (key === 'all' || key === 'custom') return { from: ds.minDay, to: ds.maxDay };
  const len = Number(key);
  return { from: Math.max(ds.minDay, ds.maxDay - len + 1), to: ds.maxDay };
}

/** Previous period of the same length right before; null if the data doesn't cover it. */
export function previousPeriod(ds: Dataset, p: Period): Period | null {
  const len = p.to - p.from + 1;
  const prev = { from: p.from - len, to: p.from - 1 };
  if (prev.to < ds.minDay) return null;
  return { from: Math.max(prev.from, ds.minDay), to: prev.to };
}

/** Row mask for dimension filters (independent of period). */
export function filterMask(ds: Dataset, filters: Filters, ignore?: Dimension): Uint8Array {
  const mask = new Uint8Array(ds.rows).fill(1);
  for (const d of DIMENSIONS) {
    const vals = filters[d];
    if (d === ignore || !vals?.length || !ds.dims[d]) continue;
    const allowed = new Set(vals.map((v) => ds.dims[d]!.dict.indexOf(v)).filter((c) => c >= 0));
    const codes = ds.dims[d]!.codes;
    for (let i = 0; i < ds.rows; i++) if (!allowed.has(codes[i]!)) mask[i] = 0;
  }
  return mask;
}

const has = (ds: Dataset, m: Measure) => Boolean(ds.measures[m]);

export function computeKpis(ds: Dataset, p: Period, mask: Uint8Array): Kpis {
  let revenue = 0;
  let units = 0;
  let cost = 0;
  let visits = 0;
  let leads = 0;
  let ordersAgg = 0;
  const orders = ds.orderCodes ? new Set<number>() : null;
  const customers = ds.customerCodes ? new Set<number>() : null;
  const M = ds.measures;
  for (let i = 0; i < ds.rows; i++) {
    const d = ds.day[i]!;
    if (d < p.from || d > p.to || !mask[i]) continue;
    revenue += M.revenue![i]!;
    if (M.quantity) units += M.quantity[i]!;
    if (M.cost) cost += M.cost[i]!;
    if (M.visits) visits += M.visits[i]!;
    if (M.leads) leads += M.leads[i]!;
    if (M.orders) ordersAgg += M.orders[i]!;
    if (orders && ds.orderCodes![i]! >= 0) orders.add(ds.orderCodes![i]!);
    if (customers && ds.customerCodes![i]! >= 0) customers.add(ds.customerCodes![i]!);
  }
  const orderCount = orders ? orders.size : has(ds, 'orders') ? ordersAgg : null;
  return {
    revenue,
    orders: orderCount,
    aov: orderCount ? revenue / orderCount : null,
    units: has(ds, 'quantity') ? units : null,
    customers: customers ? customers.size : null,
    margin: has(ds, 'cost') && revenue ? (revenue - cost) / revenue : null,
    visits: has(ds, 'visits') ? visits : null,
    leads: has(ds, 'leads') ? leads : null,
    convLead: has(ds, 'visits') && has(ds, 'leads') && visits ? leads / visits : null,
    convOrder: has(ds, 'visits') && orderCount != null && visits ? orderCount / visits : null,
  };
}

export function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Bucket key: start day of the day/ISO week (Monday)/month. */
export function bucketOf(day: number, g: Granularity): number {
  if (g === 'day') return day;
  if (g === 'week') return day - ((new Date(day * 86400000).getUTCDay() + 6) % 7);
  const d = new Date(day * 86400000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86400000);
}

export function bucketLabel(b: number, g: Granularity): string {
  const iso = dayToIso(b);
  if (g === 'month') return `${['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/** Ordered buckets covering the period (empty buckets included as zero). */
export function bucketsFor(p: Period, g: Granularity): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (let d = p.from; d <= p.to; d++) {
    const b = bucketOf(d, g);
    if (b !== last) {
      out.push(b);
      last = b;
    }
  }
  return out;
}

export function series(ds: Dataset, p: Period, g: Granularity, mask: Uint8Array, measure: Measure = 'revenue'): { buckets: number[]; values: number[] } {
  const buckets = bucketsFor(p, g);
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const values = new Array<number>(buckets.length).fill(0);
  const arr = ds.measures[measure];
  if (!arr) return { buckets, values };
  for (let i = 0; i < ds.rows; i++) {
    const d = ds.day[i]!;
    if (d < p.from || d > p.to || !mask[i]) continue;
    values[idx.get(bucketOf(d, g))!]! += arr[i]!;
  }
  return { buckets, values };
}

export interface BreakdownRow {
  key: string;
  revenue: number;
  prev: number | null;
  orders: number | null;
  share: number;
  delta: number | null;
}

export function breakdown(ds: Dataset, dim: Dimension, p: Period, prevP: Period | null, mask: Uint8Array): BreakdownRow[] {
  const col = ds.dims[dim];
  if (!col) return [];
  const n = col.dict.length;
  const cur = new Float64Array(n);
  const prev = new Float64Array(n);
  const orderSets: Array<Set<number>> | null = ds.orderCodes ? Array.from({ length: n }, () => new Set<number>()) : null;
  const ordersAgg = ds.measures.orders ? new Float64Array(n) : null;
  const rev = ds.measures.revenue!;
  for (let i = 0; i < ds.rows; i++) {
    if (!mask[i]) continue;
    const d = ds.day[i]!;
    const c = col.codes[i]!;
    if (d >= p.from && d <= p.to) {
      cur[c]! += rev[i]!;
      if (orderSets && ds.orderCodes![i]! >= 0) orderSets[c]!.add(ds.orderCodes![i]!);
      if (ordersAgg) ordersAgg[c]! += ds.measures.orders![i]!;
    } else if (prevP && d >= prevP.from && d <= prevP.to) prev[c]! += rev[i]!;
  }
  const total = cur.reduce((s, v) => s + v, 0);
  return col.dict
    .map((key, c) => ({
      key,
      revenue: cur[c]!,
      prev: prevP ? prev[c]! : null,
      orders: orderSets ? orderSets[c]!.size : ordersAgg ? ordersAgg[c]! : null,
      share: total ? cur[c]! / total : 0,
      delta: prevP ? pctChange(cur[c]!, prev[c]!) : null,
    }))
    .filter((r) => r.revenue !== 0 || (r.prev ?? 0) !== 0)
    .sort((a, b) => b.revenue - a.revenue);
}

/** Which dimension values explain the change between periods (sum of contributions = total change). */
export function contributions(rows: BreakdownRow[]): Array<{ key: string; delta: number; shareOfChange: number }> {
  const items = rows.filter((r) => r.prev != null).map((r) => ({ key: r.key, delta: r.revenue - (r.prev ?? 0) }));
  const total = items.reduce((s, i) => s + i.delta, 0);
  return items
    .map((i) => ({ ...i, shareOfChange: total ? i.delta / Math.abs(total) : 0 }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Daily anomalies by robust z-score: for each day, the baseline is the median
 * of the surrounding ±14 days (excluding the day), the scale is MAD × 1.4826.
 * |z| ≥ threshold is flagged. Drivers: dimension values with the largest
 * deviation from their own baseline on that day.
 */
export function detectAnomalies(ds: Dataset, p: Period, mask: Uint8Array, threshold = 3.5, window = 14): Anomaly[] {
  const full = { from: Math.max(ds.minDay, p.from - window), to: Math.min(ds.maxDay, p.to + window) };
  const { buckets, values } = series(ds, full, 'day', mask);
  const out: Anomaly[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const day = buckets[i]!;
    if (day < p.from || day > p.to) continue;
    const neigh: number[] = [];
    for (let j = Math.max(0, i - window); j <= Math.min(buckets.length - 1, i + window); j++) if (j !== i) neigh.push(values[j]!);
    if (neigh.length < 10) continue;
    const med = median(neigh);
    const mad = median(neigh.map((v) => Math.abs(v - med))) * 1.4826;
    if (!mad) continue;
    const z = (values[i]! - med) / mad;
    if (Math.abs(z) >= threshold) out.push({ day, value: values[i]!, expected: med, z, deltaPct: med ? ((values[i]! - med) / med) * 100 : 0, drivers: [] });
  }
  // drivers per anomaly
  for (const a of out) {
    for (const dim of DIMENSIONS) {
      const col = ds.dims[dim];
      if (!col) continue;
      const onDay = new Float64Array(col.dict.length);
      const around = new Map<number, Float64Array>();
      for (let i = 0; i < ds.rows; i++) {
        if (!mask[i]) continue;
        const d = ds.day[i]!;
        if (Math.abs(d - a.day) > window) continue;
        const c = col.codes[i]!;
        const v = ds.measures.revenue![i]!;
        if (d === a.day) onDay[c]! += v;
        else {
          const arr = around.get(d) ?? new Float64Array(col.dict.length);
          arr[c]! += v;
          around.set(d, arr);
        }
      }
      const days = [...around.values()];
      col.dict.forEach((key, c) => {
        const base = median(days.map((arr) => arr[c]!));
        const delta = onDay[c]! - base;
        if (Number.isFinite(delta) && Math.abs(delta) > Math.abs(a.value - a.expected) * 0.25) a.drivers.push({ dim, key, delta });
      });
    }
    a.drivers.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    a.drivers = a.drivers.slice(0, 3);
  }
  return out.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
}
