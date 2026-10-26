/** Order-form model shared by the client and the /api/lead Netlify Function. */
export interface LeadFormData {
  name: string;
  contact: string;
  company: string;
  task: string;
  result: string;
  budget: string;
  extra: string;
  product: string;
  consent: boolean;
  /** honeypot — must stay empty */
  website: string;
}

export const BUDGETS = ['до 150 тыс. ₽', '150–400 тыс. ₽', '400 тыс. – 1 млн ₽', 'более 1 млн ₽', 'Пока не знаю'] as const;

export const PRODUCT_NAMES: Record<string, string> = {
  'lead-engine': 'Lead Engine — обработка лидов',
  support: 'Support — поддержка по базе знаний',
  'content-os': 'Content OS — контент',
  'docs-intelligence': 'Docs Intelligence — документы',
  'catalog-studio': 'Catalog Studio — каталоги',
  'business-intelligence': 'Business Intelligence — аналитика',
};

const LIMITS: Partial<Record<keyof LeadFormData, number>> = { name: 120, contact: 160, company: 160, task: 3000, result: 500, budget: 40, extra: 2000, product: 40 };

export function validateLead(d: Partial<LeadFormData>): Partial<Record<keyof LeadFormData, string>> {
  const e: Partial<Record<keyof LeadFormData, string>> = {};
  const name = (d.name ?? '').trim();
  const contact = (d.contact ?? '').trim();
  const task = (d.task ?? '').trim();
  if (name.length < 2) e.name = 'Укажите имя — хотя бы 2 символа';
  if (!contact) e.contact = 'Укажите, куда ответить';
  else if (!isPlausibleContact(contact)) e.contact = 'Похоже, контакт указан с ошибкой: нужен @username, телефон или email';
  if (task.length < 10) e.task = 'Опишите задачу хотя бы одним предложением';
  if (!d.consent) e.consent = 'Нужно согласие на обработку данных, чтобы мы могли ответить';
  for (const [k, max] of Object.entries(LIMITS)) {
    const v = d[k as keyof LeadFormData];
    if (typeof v === 'string' && v.length > max!) e[k as keyof LeadFormData] = `Слишком длинное значение (максимум ${max} символов)`;
  }
  return e;
}

export function isPlausibleContact(c: string): boolean {
  if (/^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(c)) return true; // telegram
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) return true; // email
  const digits = c.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 && /^[+\d\s()-]+$/.test(c);
}

export function buildLeadMessage(d: Partial<LeadFormData>): string {
  const lines = [
    'Заявка на разработку — NORO',
    '',
    `Имя: ${d.name?.trim() || '—'}`,
    `Контакт: ${d.contact?.trim() || '—'}`,
    `Компания / сфера: ${d.company?.trim() || '—'}`,
    `Продукт: ${(d.product && PRODUCT_NAMES[d.product]) || 'не выбран'}`,
    `Бюджет: ${d.budget || 'не указан'}`,
    '',
    'Задача:',
    d.task?.trim() || '—',
    '',
    `Желаемый результат: ${d.result?.trim() || '—'}`,
  ];
  if (d.extra?.trim()) lines.push('', 'Дополнительно:', d.extra.trim());
  return lines.join('\n');
}
