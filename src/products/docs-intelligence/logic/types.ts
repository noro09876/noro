export type DocType = 'invoice' | 'act' | 'contract' | 'upd' | 'registry' | 'unknown';

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoice: 'Счёт на оплату',
  act: 'Акт',
  contract: 'Договор',
  upd: 'УПД / накладная',
  registry: 'Реестр (таблица)',
  unknown: 'Тип не определён',
};

export const FIELD_KEYS = [
  'number',
  'date',
  'seller',
  'sellerInn',
  'sellerKpp',
  'buyer',
  'buyerInn',
  'buyerKpp',
  'bik',
  'account',
  'corrAccount',
  'basis',
  'total',
  'vatRate',
  'vat',
  'totalWithVat',
  'dueDate',
  'startDate',
  'endDate',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  number: 'Номер',
  date: 'Дата',
  seller: 'Поставщик / исполнитель',
  sellerInn: 'ИНН поставщика',
  sellerKpp: 'КПП поставщика',
  buyer: 'Покупатель / заказчик',
  buyerInn: 'ИНН покупателя',
  buyerKpp: 'КПП покупателя',
  bik: 'БИК',
  account: 'Расчётный счёт',
  corrAccount: 'Корр. счёт',
  basis: 'Основание',
  total: 'Сумма (итого)',
  vatRate: 'Ставка НДС, %',
  vat: 'НДС',
  totalWithVat: 'Всего к оплате',
  dueDate: 'Оплатить до',
  startDate: 'Начало действия',
  endDate: 'Окончание действия',
};

export interface ExtractedField {
  value: string;
  /** the text line the value came from (for human review) */
  source: string;
  confidence: 'high' | 'medium' | 'low';
  edited?: boolean;
}

export interface LineItem {
  n: number;
  name: string;
  qty: number;
  price: number;
  sum: number;
  source: string;
}

export interface CustomRule {
  id: string;
  label: string;
  /** keyword after which the value follows, e.g. «Основание» */
  keyword: string;
  /** optional regular expression; the first group (or whole match) is the value */
  pattern?: string;
}

export interface RegistryRow {
  index: number;
  cells: Record<string, string>;
}

export type CheckLevel = 'error' | 'warning' | 'ok';

export interface Check {
  id: string;
  level: CheckLevel;
  field?: FieldKey | string;
  title: string;
  detail: string;
}

export type DocStatus = 'new' | 'review' | 'approved';
export const DOC_STATUS_LABELS: Record<DocStatus, string> = { new: 'Новый', review: 'На проверке', approved: 'Проверен' };

export interface DocRecord {
  id: string;
  fileName: string;
  sourceKind: 'txt' | 'csv' | 'pdf' | 'paste';
  type: DocType;
  typeReason: string;
  text: string;
  fields: Partial<Record<FieldKey, ExtractedField>>;
  custom: Record<string, ExtractedField>;
  items: LineItem[];
  vatIncluded: boolean;
  registry?: { headers: string[]; rows: RegistryRow[] };
  status: DocStatus;
  createdAt: number;
  updatedAt: number;
  note?: string;
  history: Array<{ at: number; text: string }>;
}
