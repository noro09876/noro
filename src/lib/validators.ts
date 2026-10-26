/** Shared validators used by several products (pure functions, unit-tested). */

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-zа-яё]{2,}$/i;

export function normalizeEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, '').toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && !email.includes('..');
}

export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yandex.ru', 'ya.ru', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru',
  'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com',
]);

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

/**
 * Normalises a phone number to +<digits>. Russian 8XXXXXXXXXX / 7XXXXXXXXXX /
 * 10-digit 9XXXXXXXXX become +7XXXXXXXXXX. Returns '' if not plausible.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/(доб|ext|x)\.?\s*\d+$/i, '').replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) return `+7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('9')) return `+7${digits}`;
  if (trimmed.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return '';
}

export function formatPhone(e164: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164;
}

/** Russian taxpayer number (ИНН) checksum for 10 (legal entity) and 12 (individual) digits. */
export function isValidInn(inn: string): boolean {
  if (!/^\d{10}$|^\d{12}$/.test(inn)) return false;
  const d = inn.split('').map(Number);
  const check = (coeffs: number[]) => (coeffs.reduce((s, c, i) => s + c * d[i]!, 0) % 11) % 10;
  if (d.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  const c11 = check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
  const c12 = check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
  return c11 === d[10] && c12 === d[11];
}

export function isValidBik(bik: string): boolean {
  return /^04\d{7}$/.test(bik);
}

/** Checks a settlement account (р/с, 20 digits) against the bank BIK control key. */
export function isValidAccount(account: string, bik: string): boolean {
  if (!/^\d{20}$/.test(account) || !/^\d{9}$/.test(bik)) return false;
  const str = bik.slice(-3) + account;
  const w = [7, 1, 3];
  let sum = 0;
  for (let i = 0; i < str.length; i++) sum += (Number(str[i]) * w[i % 3]!) % 10;
  return sum % 10 === 0;
}

/** Checks a correspondent account (к/с, 20 digits, starts with 301) against the BIK. */
export function isValidCorrAccount(account: string, bik: string): boolean {
  if (!/^301\d{17}$/.test(account) || !/^\d{9}$/.test(bik)) return false;
  const str = '0' + bik.slice(4, 6) + account;
  const w = [7, 1, 3];
  let sum = 0;
  for (let i = 0; i < str.length; i++) sum += (Number(str[i]) * w[i % 3]!) % 10;
  return sum % 10 === 0;
}

export function isValidKpp(kpp: string): boolean {
  return /^\d{4}[\dA-Z]{2}\d{3}$/.test(kpp);
}

/** EAN-13 / EAN-8 / UPC-A (12) checksum. */
export function isValidBarcode(code: string): boolean {
  if (!/^\d{8}$|^\d{12,13}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((n, i) => {
    sum += n * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Parses a human price like "1 299,90 ₽", "$1,299.90", "1299 руб." → 1299.9.
 * Returns NaN when the value is not a price.
 */
export function parsePrice(raw: string): number {
  if (raw == null) return NaN;
  let s = String(raw).trim().toLowerCase();
  if (!s) return NaN;
  s = s.replace(/(руб(лей|ля|ль)?\.?|р\.|₽|rub|usd|eur|\$|€|£)/g, '').replace(/[\s\u00a0\u202f']/g, '');
  if (!/^-?[\d.,]+$/.test(s)) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // the later separator is the decimal one
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    s = (s.match(/,/g)!.length === 1 && decimals !== 3) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0 && s.match(/\./g)!.length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Parses numbers in tables, tolerant to spaces and comma decimals. */
export function parseNumber(raw: string): number {
  return parsePrice(raw);
}

/**
 * Parses common date formats: ISO (2026-03-05), RU (05.03.2026, 5.3.26),
 * "05/03/2026" (treated as DD/MM), ISO datetime. Returns null if unparseable.
 */
export function parseDate(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return mk(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(s);
  if (m) {
    let y = +m[3]!;
    if (y < 100) y += 2000;
    return mk(y, +m[2]!, +m[1]!);
  }
  const months: Record<string, number> = { янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12 };
  m = /^(\d{1,2})\s+([а-я]+)\.?\s+(\d{4})/i.exec(s);
  if (m) {
    const mon = months[m[2]!.toLowerCase().slice(0, 3)];
    if (mon) return mk(+m[3]!, mon, +m[1]!);
  }
  return null;
}

function mk(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 ? date : null;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
