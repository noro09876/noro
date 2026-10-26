import { emailDomain, FREE_EMAIL_DOMAINS, isValidEmail, normalizePhone } from '../../../lib/validators';
import { normalizeLeadFields } from './normalize';
import type { Issue, IssueKind, Lead } from './types';

export const ISSUE_LABELS: Record<IssueKind, string> = {
  no_contact: 'Нет ни email, ни телефона',
  invalid_email: 'Некорректный email',
  invalid_phone: 'Некорректный телефон',
  free_email: 'Личная почта вместо корпоративной',
  missing_name: 'Не указано имя',
  missing_company: 'Не указана компания',
  duplicate: 'Возможный дубликат',
  unnormalized: 'Требует нормализации',
};

/** Data-quality issues per lead (duplicates are added separately from dedupe groups). */
export function detectIssues(leads: Lead[]): Issue[] {
  const out: Issue[] = [];
  for (const l of leads) {
    const f = l.fields;
    const email = f.email.trim();
    const phone = f.phone.trim();
    if (!email && !phone) out.push({ leadId: l.id, kind: 'no_contact', message: ISSUE_LABELS.no_contact });
    if (email && !isValidEmail(email.toLowerCase())) out.push({ leadId: l.id, kind: 'invalid_email', field: 'email', message: `«${email}» — не похоже на email` });
    else if (email && FREE_EMAIL_DOMAINS.has(emailDomain(email))) out.push({ leadId: l.id, kind: 'free_email', field: 'email', message: `Домен ${emailDomain(email)} — личная почта` });
    if (phone && !normalizePhone(phone)) out.push({ leadId: l.id, kind: 'invalid_phone', field: 'phone', message: `«${phone}» — недостаточно цифр для номера` });
    if (!f.name.trim()) out.push({ leadId: l.id, kind: 'missing_name', field: 'name', message: ISSUE_LABELS.missing_name });
    if (!f.company.trim()) out.push({ leadId: l.id, kind: 'missing_company', field: 'company', message: ISSUE_LABELS.missing_company });
    const { changed } = normalizeLeadFields(f);
    if (changed.length > 0) out.push({ leadId: l.id, kind: 'unnormalized', message: `Поля: ${changed.length}` });
  }
  return out;
}

export function countIssues(issues: Issue[]): Record<IssueKind, number> {
  const res = { no_contact: 0, invalid_email: 0, invalid_phone: 0, free_email: 0, missing_name: 0, missing_company: 0, duplicate: 0, unnormalized: 0 } as Record<IssueKind, number>;
  for (const i of issues) res[i.kind]++;
  return res;
}
