export const CATALOG_FIELDS = ['sku', 'name', 'brand', 'category', 'price', 'oldPrice', 'stock', 'barcode', 'weight', 'description', 'seoTitle'] as const;
export type CatalogField = (typeof CATALOG_FIELDS)[number];

export const FIELD_LABELS: Record<CatalogField, string> = {
  sku: 'Артикул',
  name: 'Название',
  brand: 'Бренд',
  category: 'Категория',
  price: 'Цена',
  oldPrice: 'Старая цена',
  stock: 'Остаток',
  barcode: 'Штрихкод',
  weight: 'Вес, кг',
  description: 'Описание',
  seoTitle: 'SEO-заголовок',
};

export interface Product {
  id: string;
  /** values of mapped catalog fields */
  v: Partial<Record<CatalogField, string>>;
  /** unmapped source columns, preserved for export */
  extra: Record<string, string>;
}

export type IssueKind =
  | 'missing'
  | 'dup-sku'
  | 'dup-barcode'
  | 'price-format'
  | 'price-invalid'
  | 'old-price'
  | 'sku-pattern'
  | 'barcode'
  | 'html'
  | 'spaces'
  | 'long-name'
  | 'caps'
  | 'stock'
  | 'weight'
  | 'no-description';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  rowId: string;
  field: CatalogField;
  kind: IssueKind;
  severity: Severity;
  message: string;
}

export const ISSUE_META: Record<IssueKind, { label: string; severity: Severity; fix?: string }> = {
  missing: { label: 'Пустое обязательное поле', severity: 'error', fix: 'Заполнить вручную или правилом «Заполнить пустые»' },
  'dup-sku': { label: 'Дубль артикула', severity: 'error', fix: 'Проверить строки и удалить лишние' },
  'dup-barcode': { label: 'Дубль штрихкода', severity: 'warning' },
  'price-format': { label: 'Цена записана текстом', severity: 'warning', fix: 'Правило «Нормализовать цены»' },
  'price-invalid': { label: 'Некорректная цена', severity: 'error' },
  'old-price': { label: 'Старая цена не больше текущей', severity: 'warning', fix: 'Правило «Убрать неверные старые цены»' },
  'sku-pattern': { label: 'Артикул не по шаблону', severity: 'warning', fix: 'Правило «Очистить пробелы» или замена' },
  barcode: { label: 'Неверный штрихкод EAN', severity: 'error' },
  html: { label: 'HTML-теги в тексте', severity: 'warning', fix: 'Правило «Удалить HTML»' },
  spaces: { label: 'Лишние пробелы', severity: 'info', fix: 'Правило «Очистить пробелы»' },
  'long-name': { label: 'Слишком длинное название', severity: 'warning' },
  caps: { label: 'Название капсом', severity: 'info', fix: 'Правило «Регистр названий»' },
  stock: { label: 'Некорректный остаток', severity: 'warning' },
  weight: { label: 'Некорректный вес', severity: 'warning' },
  'no-description': { label: 'Нет описания', severity: 'info', fix: 'Правило «Описание по шаблону»' },
};

export interface CheckSettings {
  required: CatalogField[];
  skuPattern: string;
  maxNameLength: number;
}

export const DEFAULT_CHECKS: CheckSettings = {
  required: ['sku', 'name', 'price'],
  skuPattern: '^[A-Z]{3}-\\d{5}$',
  maxNameLength: 120,
};

export type RuleType = 'trim' | 'normalizePrice' | 'markup' | 'round' | 'replace' | 'fillEmpty' | 'stripHtml' | 'nameCase' | 'template' | 'fixOldPrice';

export interface Rule {
  id: string;
  type: RuleType;
  enabled: boolean;
  field?: CatalogField;
  /** markup percent, round step etc. */
  num?: number;
  mode?: string;
  find?: string;
  replaceWith?: string;
  template?: string;
  onlyEmpty?: boolean;
  maxLength?: number;
}

export interface CellChange {
  rowId: string;
  field: CatalogField;
  before: string;
  after: string;
  ruleId: string;
}
