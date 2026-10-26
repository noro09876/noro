const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtInt(n: number): string {
  return Number.isFinite(n) ? nf0.format(n) : '—';
}

export function fmtNum(n: number, digits: 0 | 1 | 2 = 1): string {
  if (!Number.isFinite(n)) return '—';
  return digits === 0 ? nf0.format(n) : digits === 1 ? nf1.format(n) : nf2.format(n);
}

export function fmtMoney(n: number, currency = '₽'): string {
  if (!Number.isFinite(n)) return '—';
  return `${nf0.format(Math.round(n))} ${currency}`;
}

/** Compact money: 1,2 млн ₽ */
export function fmtMoneyCompact(n: number, currency = '₽'): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${nf1.format(n / 1e9)} млрд ${currency}`;
  if (abs >= 1e6) return `${nf1.format(n / 1e6)} млн ${currency}`;
  if (abs >= 1e4) return `${nf1.format(n / 1e3)} тыс. ${currency}`;
  return fmtMoney(n, currency);
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: digits })}%`;
}

export function fmtDelta(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  return `${sign}${Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function fmtDate(d: Date | number | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
}

export function fmtDateTime(d: Date | number | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date);
}

/** Russian plural: plural(5, ['строка', 'строки', 'строк']) */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function countLabel(n: number, forms: [string, string, string]): string {
  return `${fmtInt(n)} ${plural(n, forms)}`;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${nf1.format(bytes / 1024)} КБ`;
  return `${nf1.format(bytes / 1024 / 1024)} МБ`;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
