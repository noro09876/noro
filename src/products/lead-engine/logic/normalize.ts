import { formatPhone, normalizeEmail, normalizePhone } from '../../../lib/validators';
import type { LeadField } from './types';

function titleCaseWord(w: string): string {
  return w
    .split('-')
    .map((p) => (p ? p[0]!.toLocaleUpperCase('ru') + p.slice(1).toLocaleLowerCase('ru') : p))
    .join('-');
}

export function normalizeName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return s;
  const isAllLower = s === s.toLocaleLowerCase('ru');
  const isAllUpper = s === s.toLocaleUpperCase('ru') && /[a-zа-яё]/i.test(s);
  return isAllLower || isAllUpper ? s.split(' ').map(titleCaseWord).join(' ') : s;
}

export function normalizeWebsite(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return s;
  return s
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

export function normalizeCompany(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/["“”„]([^"“”„]+)["“”„]/g, '«$1»')
    .trim();
}

/** Parses "51-200", "1 000", "более 500", "~120" into a representative number. */
export function parseCompanySize(raw: string): number {
  const nums = (raw.replace(/(\d)[\s\u00a0](?=\d{3}\b)/g, '$1').match(/\d+/g) ?? []).map(Number);
  if (nums.length === 0) return NaN;
  if (nums.length >= 2) return Math.round((nums[0]! + nums[1]!) / 2);
  return nums[0]!;
}

export interface NormalizeResult {
  fields: Record<LeadField, string>;
  changed: LeadField[];
}

/** Normalises one lead; returns changed field names so the UI can show a diff. */
export function normalizeLeadFields(fields: Record<LeadField, string>): NormalizeResult {
  const next = { ...fields };
  const changed: LeadField[] = [];
  const set = (f: LeadField, v: string) => {
    if (v !== fields[f]) {
      next[f] = v;
      changed.push(f);
    }
  };
  set('name', normalizeName(fields.name));
  set('company', normalizeCompany(fields.company));
  set('title', fields.title.replace(/\s+/g, ' ').trim());
  set('industry', fields.industry.replace(/\s+/g, ' ').trim());
  set('city', normalizeName(fields.city));
  set('source', fields.source.trim());
  if (fields.email.trim()) set('email', normalizeEmail(fields.email));
  if (fields.phone.trim()) {
    const p = normalizePhone(fields.phone);
    if (p) set('phone', formatPhone(p));
  }
  if (fields.website.trim()) set('website', normalizeWebsite(fields.website));
  return { fields: next, changed };
}

/** Key used for duplicate detection by company + person. */
export function companyKey(company: string): string {
  return company
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(^|[^a-zа-я0-9])(ооо|оао|зао|пао|ао|ип|llc|ltd|inc|gmbh)(?=$|[^a-zа-я0-9])/g, '$1')
    .replace(/[^a-zа-я0-9]+/g, '');
}
