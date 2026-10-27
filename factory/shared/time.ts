/**
 * Time-zone helpers without external deps. Plans are expressed as "day offset + HH:MM"
 * in the campaign's IANA time zone; storage is always UTC.
 */

export const SCHEDULE_DEFAULT_TIMES = ['10:00', '18:00'];

/** Offset (ms) of `tz` at the given UTC instant: local = utc + offset. */
export function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to a UTC Date (handles DST by re-checking the offset). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMs(tz, new Date(guess));
  let utc = guess - off;
  const off2 = tzOffsetMs(tz, new Date(utc));
  if (off2 !== off) {
    off = off2;
    utc = guess - off;
  }
  return new Date(utc);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function planDate(startDate: string, day: number, time: string, tz: string): Date {
  return zonedToUtc(addDays(startDate, day), time, tz);
}

/** Formats a UTC date as local "YYYY-MM-DD HH:MM" in `tz`. */
export function formatInTz(d: Date | string, tz: string): { date: string; time: string } {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(dt).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
