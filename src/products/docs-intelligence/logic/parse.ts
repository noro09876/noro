import { parseCsvText } from '../../../lib/csv';
import { uid } from '../../../lib/id';
import { applyCustomRules, detectType, extractFields, extractItems, normalizeText } from './extract';
import type { CustomRule, DocRecord } from './types';

/** Builds a document record from extracted text (TXT/PDF) or a CSV table. */
export function buildDocFromText(text: string, fileName: string, sourceKind: DocRecord['sourceKind'], rules: CustomRule[] = []): DocRecord {
  const clean = normalizeText(text).slice(0, 400000);
  const { type, reason } = detectType(clean);
  const { fields, vatIncluded } = extractFields(clean, type);
  const now = Date.now();
  return {
    id: uid('d'),
    fileName,
    sourceKind,
    type,
    typeReason: reason,
    text: clean,
    fields,
    custom: applyCustomRules(clean, rules),
    items: extractItems(clean),
    vatIncluded,
    status: 'new',
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, text: `Загружен файл ${fileName}` }],
  };
}

export function buildDocFromCsv(text: string, fileName: string): DocRecord {

  const table = parseCsvText(text);
  const now = Date.now();
  return {
    id: uid('d'),
    fileName,
    sourceKind: 'csv',
    type: 'registry',
    typeReason: `таблица: ${table.headers.length} колонок, ${table.rows.length} строк`,
    text: text.slice(0, 200000),
    fields: {},
    custom: {},
    items: [],
    vatIncluded: false,
    registry: { headers: table.headers, rows: table.rows.slice(0, 5000).map((cells, index) => ({ index, cells })) },
    status: 'new',
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, text: `Загружен файл ${fileName}` }],
  };
}
