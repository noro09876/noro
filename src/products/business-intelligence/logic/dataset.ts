import type { Table } from '../../../lib/csv';
import { detectColumns } from '../../../lib/columns';
import { parseDate, parseNumber } from '../../../lib/validators';
import { DIMENSIONS, MEASURES, type BiField, type Dataset, type Dimension } from './types';

export const BI_SYNONYMS: Record<BiField, readonly string[]> = {
  date: ['date', 'day', 'дата', 'день', 'дата заказа', 'order date', 'created at', 'дата продажи'],
  revenue: ['revenue', 'amount', 'sales', 'sum', 'total', 'выручка', 'сумма', 'продажи', 'оборот', 'сумма заказа', 'gmv'],
  orderId: ['order id', 'order_id', 'order', 'номер заказа', 'заказ id', 'id заказа', 'чек'],
  orders: ['orders', 'заказы', 'кол во заказов', 'число заказов', 'количество заказов', 'transactions'],
  customerId: ['customer id', 'customer_id', 'customer', 'client', 'клиент', 'покупатель', 'id клиента'],
  quantity: ['quantity', 'qty', 'units', 'количество', 'кол во', 'штук', 'единиц'],
  cost: ['cost', 'cogs', 'себестоимость', 'затраты', 'закупка'],
  visits: ['visits', 'sessions', 'визиты', 'сессии', 'посещения', 'трафик'],
  leads: ['leads', 'conversions', 'заявки', 'лиды', 'обращения', 'конверсии'],
  category: ['category', 'категория', 'группа товаров', 'раздел', 'product category'],
  channel: ['channel', 'source', 'канал', 'источник', 'канал продаж'],
  region: ['region', 'city', 'регион', 'город', 'область', 'филиал'],
};

export function detectBiColumns(headers: string[]): Record<BiField, string> {
  // aggregated tables: «Заказы» means a count, not an id
  const m = detectColumns(headers, BI_SYNONYMS);
  return m;
}

export const DAY_MS = 86400000;
export const toDay = (d: Date) => Math.floor(d.getTime() / DAY_MS);
export const dayToIso = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const dayToRu = (day: number) => {
  const iso = dayToIso(day);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
};

export class DatasetError extends Error {}

/** Parses a table into a column-oriented dataset, skipping rows with bad date/amount (counted). */
export function buildDataset(table: Table, mapping: Record<BiField, string>): Dataset {
  if (!mapping.date) throw new DatasetError('Не выбрана колонка с датой — без неё нельзя построить динамику.');
  if (!mapping.revenue) throw new DatasetError('Не выбрана колонка с суммой (выручкой).');
  const ds: Dataset = { day: [], measures: {}, dims: {}, rows: 0, minDay: Infinity, maxDay: -Infinity, skipped: { badDate: 0, badAmount: 0, samples: [] } };
  const measureCols = MEASURES.filter((m) => mapping[m]);
  for (const m of measureCols) ds.measures[m] = [];
  if (!ds.measures.revenue) ds.measures.revenue = [];
  const dimCols = DIMENSIONS.filter((d) => mapping[d]);
  const dictIndex: Partial<Record<Dimension, Map<string, number>>> = {};
  for (const d of dimCols) {
    ds.dims[d] = { dict: [], codes: [] };
    dictIndex[d] = new Map();
  }
  const orderMap = mapping.orderId ? new Map<string, number>() : null;
  const custMap = mapping.customerId ? new Map<string, number>() : null;
  if (orderMap) ds.orderCodes = [];
  if (custMap) ds.customerCodes = [];

  table.rows.forEach((row, i) => {
    const rawDate = row[mapping.date] ?? '';
    const date = parseDate(rawDate);
    if (!date) {
      ds.skipped.badDate++;
      if (ds.skipped.samples.length < 5) ds.skipped.samples.push(`строка ${i + 2}: дата «${rawDate}»`);
      return;
    }
    const rev = parseNumber(row[mapping.revenue] ?? '');
    if (!Number.isFinite(rev)) {
      ds.skipped.badAmount++;
      if (ds.skipped.samples.length < 5) ds.skipped.samples.push(`строка ${i + 2}: сумма «${row[mapping.revenue] ?? ''}»`);
      return;
    }
    const day = toDay(date);
    ds.day.push(day);
    if (day < ds.minDay) ds.minDay = day;
    if (day > ds.maxDay) ds.maxDay = day;
    for (const m of measureCols) {
      const v = m === 'revenue' ? rev : parseNumber(row[mapping[m]] ?? '');
      ds.measures[m]!.push(Number.isFinite(v) ? v : 0);
    }
    for (const d of dimCols) {
      const key = String(row[mapping[d]] ?? '').trim() || '(не указано)';
      let code = dictIndex[d]!.get(key);
      if (code === undefined) {
        code = ds.dims[d]!.dict.length;
        ds.dims[d]!.dict.push(key);
        dictIndex[d]!.set(key, code);
      }
      ds.dims[d]!.codes.push(code);
    }
    for (const [map, arr, col] of [
      [orderMap, ds.orderCodes, mapping.orderId],
      [custMap, ds.customerCodes, mapping.customerId],
    ] as const) {
      if (!map || !arr) continue;
      const key = String(row[col] ?? '').trim();
      let code = map.get(key);
      if (code === undefined) {
        code = key ? map.size : -1;
        if (key) map.set(key, code);
      }
      arr.push(code);
    }
    ds.rows++;
  });
  if (!ds.rows) throw new DatasetError(`Ни одна строка не распознана: проверьте колонки даты и суммы. ${ds.skipped.samples.join('; ')}`);
  return ds;
}
