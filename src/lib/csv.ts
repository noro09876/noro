import Papa from 'papaparse';

export interface Table {
  headers: string[];
  rows: Record<string, string>[];
}

export interface ParsedTable extends Table {
  delimiter: string;
  /** Non-fatal problems found while parsing (ragged rows etc.). */
  warnings: string[];
}

export class TableParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableParseError';
  }
}

/** Makes headers non-empty and unique: ['', 'a', 'a'] → ['Колонка 1', 'a', 'a (2)']. */
export function normalizeHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = String(h ?? '').replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim();
    if (!name) name = `Колонка ${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name} (${n})` : name;
  });
}

/** Converts a 2D grid (first row = header) into a Table, skipping fully empty rows. */
export function gridToTable(grid: unknown[][]): ParsedTable {
  const warnings: string[] = [];
  const nonEmpty = grid.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (nonEmpty.length === 0) throw new TableParseError('В файле нет данных: все строки пустые.');
  const headers = normalizeHeaders(nonEmpty[0] ?? []);
  if (nonEmpty.length === 1) throw new TableParseError('В файле есть только строка заголовков, но нет данных.');
  let ragged = 0;
  const rows = nonEmpty.slice(1).map((r) => {
    if (r.length !== headers.length) ragged++;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      const v = r[i];
      rec[h] = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    });
    return rec;
  });
  if (ragged > 0) warnings.push(`${ragged} строк(и) имеют другое число колонок, чем заголовок — лишние значения отброшены, недостающие оставлены пустыми.`);
  return { headers, rows, delimiter: ',', warnings };
}

export function parseCsvText(text: string): ParsedTable {
  const trimmed = text.replace(/^\uFEFF/, '');
  if (!trimmed.trim()) throw new TableParseError('Файл пустой: в нём нет ни одной строки.');
  const result = Papa.parse<string[]>(trimmed, {
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t', '|'],
  });
  const fatal = result.errors.find((e) => e.type === 'Quotes');
  if (fatal && result.data.length === 0) {
    throw new TableParseError(`Не удалось разобрать CSV: незакрытые кавычки (строка ${fatal.row ?? '?'}).`);
  }
  const table = gridToTable(result.data);
  table.delimiter = result.meta.delimiter;
  if (table.headers.length === 1 && table.rows.length > 0) {
    table.warnings.push('Найдена только одна колонка. Если в файле несколько полей, проверьте разделитель (поддерживаются , ; таб |).');
  }
  if (result.errors.some((e) => e.type === 'Quotes')) {
    table.warnings.push('В файле есть строки с некорректными кавычками — проверьте результат.');
  }
  return table;
}

function escapeCell(value: string, delimiter: string): string {
  // Neutralise spreadsheet formula injection (CSV injection) for exported files.
  let v = value;
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = `'${v}`;
  if (v.includes('"') || v.includes(delimiter) || /[\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export interface CsvOptions {
  delimiter?: ',' | ';' | '\t';
  /** Adds UTF-8 BOM so Excel opens Cyrillic correctly. */
  bom?: boolean;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>, opts: CsvOptions = {}): string {
  const d = opts.delimiter ?? ';';
  const lines = [headers.map((h) => escapeCell(h, d)).join(d)];
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCell(r[h] == null ? '' : String(r[h]), d)).join(d));
  }
  return (opts.bom === false ? '' : '\uFEFF') + lines.join('\r\n');
}
