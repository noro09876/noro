import type { Lead, LeadField, Tier } from './types';

export interface MessageTemplate {
  id: string;
  name: string;
  tier: Tier | 'any';
  body: string;
}

export const PLACEHOLDERS: Array<{ key: string; field: LeadField | 'first_name'; label: string }> = [
  { key: 'имя', field: 'first_name', label: 'Имя (первое слово)' },
  { key: 'фио', field: 'name', label: 'Полное имя' },
  { key: 'компания', field: 'company', label: 'Компания' },
  { key: 'должность', field: 'title', label: 'Должность' },
  { key: 'отрасль', field: 'industry', label: 'Отрасль' },
  { key: 'город', field: 'city', label: 'Город' },
];

const PLACEHOLDER_RE = /\{\{\s*([a-zа-яё_]+)\s*(?:\|([^}]*))?\}\}/gi;

/**
 * Renders "Здравствуйте, {{имя|коллеги}}!" against a lead. Missing values use the
 * fallback after "|" or are reported in `missing`.
 */
export function renderTemplate(body: string, lead: Lead): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(PLACEHOLDER_RE, (_m, rawKey: string, fallback?: string) => {
    const key = rawKey.toLowerCase();
    const ph = PLACEHOLDERS.find((p) => p.key === key);
    if (!ph) {
      missing.push(key);
      return fallback ?? '';
    }
    let value = '';
    if (ph.field === 'first_name') value = lead.fields.name.trim().split(/\s+/)[0] ?? '';
    else value = lead.fields[ph.field].trim();
    if (!value) {
      if (fallback === undefined) missing.push(key);
      return fallback ?? '';
    }
    return value;
  });
  return { text: text.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.!?])/g, '$1'), missing };
}

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: 't-a',
    name: 'Приоритетный (A)',
    tier: 'A',
    body:
      'Здравствуйте, {{имя|коллеги}}!\n\nВидим, что {{компания|ваша компания}} работает в сфере «{{отрасль|вашей отрасли}}». Мы помогаем таким командам сократить ручную обработку заявок и документов. Готовы показать на ваших данных, как это выглядит, — 20 минут в удобное время.\n\nПодойдёт ли созвон на этой неделе?',
  },
  {
    id: 't-b',
    name: 'Прогрев (B)',
    tier: 'B',
    body:
      'Добрый день, {{имя|коллеги}}!\n\nПодготовили короткий разбор: какие операции в отделе «{{должность|вашем отделе}}» чаще всего автоматизируют в первую очередь. Прислать его для {{компания|вашей компании}}?',
  },
  {
    id: 't-c',
    name: 'Полезный материал (C)',
    tier: 'C',
    body: 'Здравствуйте, {{имя|коллеги}}! Делимся чек-листом по наведению порядка в базе клиентов — пригодится, даже если сейчас вы не планируете автоматизацию.',
  },
];
