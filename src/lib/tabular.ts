import { parseCsvText, gridToTable, TableParseError, type ParsedTable } from './csv';
import { decodeText, looksBinary, readFileBuffer, validateFile } from './files';

export const TABULAR_EXTENSIONS = ['csv', 'tsv', 'txt', 'xlsx'] as const;

export interface LoadedTable extends ParsedTable {
  fileName: string;
  encoding?: string;
}

/** Loads CSV/TSV/TXT or XLSX (lazy-loaded parser) into a Table. All processing is local. */
export async function loadTabularFile(file: File, maxBytes = 15 * 1024 * 1024): Promise<LoadedTable> {
  const ext = validateFile(file, { extensions: TABULAR_EXTENSIONS, maxBytes });
  const buf = await readFileBuffer(file);
  if (ext === 'xlsx') {
    const { readSheet } = await import('read-excel-file/universal');
    let grid: unknown[][];
    try {
      grid = (await readSheet(buf)) as unknown[][];
    } catch {
      throw new TableParseError('Не удалось прочитать XLSX. Файл повреждён или защищён паролем. Сохраните его заново или экспортируйте в CSV.');
    }
    return { ...gridToTable(grid), fileName: file.name };
  }
  const { text, encoding } = decodeText(buf);
  if (looksBinary(text)) {
    throw new TableParseError('Файл похож на двоичный, а не на текстовую таблицу. Если это Excel, сохраните его как .xlsx или .csv.');
  }
  return { ...parseCsvText(text), fileName: file.name, encoding };
}
