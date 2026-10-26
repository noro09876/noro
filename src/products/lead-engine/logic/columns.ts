import { detectColumns } from '../../../lib/columns';
import type { LeadField } from './types';

export const LEAD_SYNONYMS: Record<LeadField, readonly string[]> = {
  name: ['name', 'full name', 'contact', 'contact name', 'имя', 'фио', 'контакт', 'контактное лицо', 'имя фамилия', 'клиент'],
  company: ['company', 'organization', 'organisation', 'account', 'компания', 'организация', 'название компании', 'юрлицо'],
  title: ['title', 'job title', 'position', 'role', 'должность', 'позиция', 'роль'],
  email: ['email', 'e-mail', 'mail', 'почта', 'электронная почта', 'емейл', 'e mail'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'телефон', 'тел', 'мобильный', 'номер телефона'],
  industry: ['industry', 'sector', 'vertical', 'отрасль', 'сфера', 'индустрия', 'сфера деятельности'],
  companySize: ['company size', 'employees', 'size', 'headcount', 'сотрудников', 'численность', 'размер компании', 'кол-во сотрудников', 'штат'],
  source: ['source', 'lead source', 'channel', 'utm source', 'источник', 'канал', 'откуда'],
  city: ['city', 'location', 'region', 'город', 'регион', 'локация'],
  website: ['website', 'site', 'url', 'domain', 'сайт', 'веб-сайт', 'домен'],
  notes: ['notes', 'comment', 'comments', 'description', 'заметки', 'комментарий', 'примечание', 'описание'],
};

export function detectLeadColumns(headers: string[]): Record<LeadField, string> {
  return detectColumns(headers, LEAD_SYNONYMS);
}
