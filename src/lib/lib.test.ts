import { describe, expect, it } from 'vitest';
import { safeFilename } from './download';
import { normalizeHeaders, parseCsvText, TableParseError, toCsv } from './csv';
import { detectColumns } from './columns';
import { decodeText, FileValidationError, looksBinary, validateFile } from './files';
import { countLabel, plural } from './format';
import { stemRu } from './text/stem';
import { sentences, terms } from './text/tokenize';
import {
  formatPhone,
  isValidAccount,
  isValidBarcode,
  isValidEmail,
  isValidInn,
  normalizePhone,
  parseDate,
  parsePrice,
} from './validators';

describe('csv', () => {
  it('detects semicolon delimiter and keeps cyrillic headers', () => {
    const t = parseCsvText('Имя;Цена\nЧайник;1 299,00\nТостер;990');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['Имя', 'Цена']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toEqual({ 'Имя': 'Чайник', 'Цена': '1 299,00' });
  });

  it('handles quoted fields with delimiters and newlines', () => {
    const t = parseCsvText('a,b\n"x, y","line1\nline2"\n');
    expect(t.rows[0]).toEqual({ a: 'x, y', b: 'line1\nline2' });
  });

  it('rejects empty files and header-only files with clear errors', () => {
    expect(() => parseCsvText('')).toThrow(TableParseError);
    expect(() => parseCsvText('   \n  ')).toThrow(/пустой/);
    expect(() => parseCsvText('a;b;c\n')).toThrow(/только строка заголовков/);
  });

  it('warns on ragged rows instead of failing', () => {
    const t = parseCsvText('a,b,c\n1,2\n3,4,5,6');
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]!.c).toBe('');
    expect(t.warnings.join(' ')).toMatch(/другое число колонок/);
  });

  it('makes empty and duplicate headers unique', () => {
    expect(normalizeHeaders(['', 'Цена', 'Цена', ' a  b '])).toEqual(['Колонка 1', 'Цена', 'Цена (2)', 'a b']);
  });

  it('exports CSV with BOM, escaping and formula-injection protection', () => {
    const out = toCsv(['a', 'b'], [{ a: '=HYPERLINK("x")', b: 'с;точкой' }, { a: '-15', b: 'ok' }]);
    expect(out.startsWith('\uFEFF')).toBe(true);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain('"с;точкой"');
    expect(out).toContain('-15;ok');
    const roundTrip = parseCsvText(out);
    expect(roundTrip.rows[1]).toEqual({ a: '-15', b: 'ok' });
  });
});

describe('files', () => {
  it('validates extension and size', () => {
    expect(validateFile({ name: 'a.CSV', size: 10 }, { extensions: ['csv'], maxBytes: 100 })).toBe('csv');
    expect(() => validateFile({ name: 'a.exe', size: 10 }, { extensions: ['csv'], maxBytes: 100 })).toThrow(FileValidationError);
    expect(() => validateFile({ name: 'a.csv', size: 0 }, { extensions: ['csv'], maxBytes: 100 })).toThrow(/пустой/);
    expect(() => validateFile({ name: 'a.csv', size: 1000 }, { extensions: ['csv'], maxBytes: 100 })).toThrow(/слишком большой/);
  });

  it('decodes windows-1251 when bytes are not valid utf-8', () => {
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // "Привет"
    const r = decodeText(cp1251.buffer);
    expect(r.encoding).toBe('windows-1251');
    expect(r.text).toBe('Привет');
    const utf = new TextEncoder().encode('\uFEFFПривет');
    expect(decodeText(utf.buffer as ArrayBuffer)).toEqual({ text: 'Привет', encoding: 'utf-8' });
  });

  it('detects binary content', () => {
    expect(looksBinary('PK\u0003\u0004\u0000\u0000abc')).toBe(true);
    expect(looksBinary('обычный текст;1;2')).toBe(false);
  });
});

describe('validators', () => {
  it('validates INN checksums', () => {
    expect(isValidInn('7708123450')).toBe(true);
    expect(isValidInn('7708123451')).toBe(false);
    expect(isValidInn('500100732259')).toBe(true);
    expect(isValidInn('500100732258')).toBe(false);
    expect(isValidInn('12345')).toBe(false);
  });

  it('validates account against BIK', () => {
    expect(isValidAccount('40702810200000041871', '044525999')).toBe(true);
    expect(isValidAccount('40702810200000041872', '044525999')).toBe(false);
  });

  it('validates EAN-13 barcodes', () => {
    expect(isValidBarcode('4006381333931')).toBe(true);
    expect(isValidBarcode('4006381333932')).toBe(false);
    expect(isValidBarcode('abc')).toBe(false);
  });

  it('parses prices in many formats', () => {
    expect(parsePrice('1 299,00 руб.')).toBe(1299);
    expect(parsePrice('2 490 ₽')).toBe(2490);
    expect(parsePrice('3.490,50')).toBe(3490.5);
    expect(parsePrice('$1,299.90')).toBe(1299.9);
    expect(parsePrice('15990.00')).toBe(15990);
    expect(parsePrice('1,5')).toBe(1.5);
    expect(parsePrice('договорная')).toBeNaN();
    expect(parsePrice('')).toBeNaN();
  });

  it('normalizes russian phone numbers', () => {
    expect(normalizePhone('8 (923) 2807270')).toBe('+79232807270');
    expect(normalizePhone('+7 932 536-84-67')).toBe('+79325368467');
    expect(normalizePhone('9325368467')).toBe('+79325368467');
    expect(normalizePhone('12-34')).toBe('');
    expect(formatPhone('+79232807270')).toBe('+7 923 280-72-70');
  });

  it('validates emails', () => {
    expect(isValidEmail('a.b@firm.example')).toBe(true);
    expect(isValidEmail('sales.firm.example')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });

  it('parses dates in ISO and Russian formats', () => {
    expect(parseDate('2026-03-05')?.toISOString().slice(0, 10)).toBe('2026-03-05');
    expect(parseDate('05.03.2026')?.toISOString().slice(0, 10)).toBe('2026-03-05');
    expect(parseDate('5.3.26')?.toISOString().slice(0, 10)).toBe('2026-03-05');
    expect(parseDate('14 октября 2026')?.toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('завтра')).toBeNull();
  });
});

describe('text', () => {
  it('stems russian word forms to a common stem', () => {
    const forms = ['доставка', 'доставки', 'доставку', 'доставкой'].map(stemRu);
    expect(new Set(forms).size).toBe(1);
    expect(stemRu('возврата')).toBe(stemRu('возврат'));
    expect(stemRu('оплатить')).toBe(stemRu('оплата').slice(0, stemRu('оплатить').length));
  });

  it('drops stopwords', () => {
    expect(terms('Как мне вернуть товар?')).toEqual(['вернут', 'товар']);
  });

  it('splits sentences', () => {
    expect(sentences('Первое. Второе! Третье?\nЧетвёртое')).toHaveLength(4);
  });
});

describe('columns & format', () => {
  it('detects columns by synonyms without reusing headers', () => {
    const m = detectColumns(['ФИО', 'E-mail', 'Тел.', 'Компания'], { name: ['фио', 'имя'], email: ['email', 'e-mail'], phone: ['телефон', 'тел'], company: ['компания'] });
    expect(m).toEqual({ name: 'ФИО', email: 'E-mail', phone: 'Тел.', company: 'Компания' });
  });

  it('pluralizes russian nouns', () => {
    expect(plural(1, ['строка', 'строки', 'строк'])).toBe('строка');
    expect(plural(3, ['строка', 'строки', 'строк'])).toBe('строки');
    expect(plural(11, ['строка', 'строки', 'строк'])).toBe('строк');
    expect(countLabel(21, ['строка', 'строки', 'строк'])).toBe('21 строка');
  });
});

describe('safeFilename', () => {
  it('transliterates Cyrillic and strips unsafe characters', () => {
    expect(safeFilename('Демо: контент-план «Пекарня»')).toBe('demo-kontent-plan-pekarnya');
    expect(safeFilename('a/b\\c?.csv')).toBe('a-b-c-.csv');
    expect(safeFilename('«»')).toBe('noro-export');
  });
});
