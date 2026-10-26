export const BI_FIELDS = ['date', 'revenue', 'orderId', 'orders', 'customerId', 'quantity', 'cost', 'visits', 'leads', 'category', 'channel', 'region'] as const;
export type BiField = (typeof BI_FIELDS)[number];

export const MEASURES = ['revenue', 'orders', 'quantity', 'cost', 'visits', 'leads'] as const;
export type Measure = (typeof MEASURES)[number];
export const DIMENSIONS = ['category', 'channel', 'region'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const FIELD_LABELS: Record<BiField, string> = {
  date: 'Дата',
  revenue: 'Выручка',
  orderId: 'Номер заказа',
  orders: 'Число заказов (агрегат)',
  customerId: 'Клиент',
  quantity: 'Количество',
  cost: 'Себестоимость',
  visits: 'Визиты / сессии',
  leads: 'Заявки / лиды',
  category: 'Категория',
  channel: 'Канал',
  region: 'Регион',
};

export const DIM_LABELS: Record<Dimension, string> = { category: 'Категории', channel: 'Каналы', region: 'Регионы' };

/** Column-oriented dataset: compact for IndexedDB and fast to scan. */
export interface Dataset {
  /** day number since 1970-01-01 (UTC) */
  day: number[];
  measures: Partial<Record<Measure, number[]>>;
  dims: Partial<Record<Dimension, { dict: string[]; codes: number[] }>>;
  orderCodes?: number[];
  customerCodes?: number[];
  rows: number;
  minDay: number;
  maxDay: number;
  skipped: { badDate: number; badAmount: number; samples: string[] };
}

export type Granularity = 'day' | 'week' | 'month';
export type PresetKey = '7' | '30' | '90' | '365' | 'all' | 'custom';

export interface Period {
  from: number;
  to: number;
}

export type Filters = Partial<Record<Dimension, string[]>>;

export interface Kpis {
  revenue: number;
  orders: number | null;
  aov: number | null;
  units: number | null;
  customers: number | null;
  margin: number | null;
  visits: number | null;
  leads: number | null;
  convLead: number | null;
  convOrder: number | null;
}

export interface Anomaly {
  day: number;
  value: number;
  expected: number;
  z: number;
  deltaPct: number;
  drivers: Array<{ dim: Dimension; key: string; delta: number }>;
}
