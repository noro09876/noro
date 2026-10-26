import { terms } from '../../../lib/text/tokenize';
import type { Classification, Priority } from './types';

interface CategoryRule {
  name: string;
  keywords: string[];
}

export const CATEGORY_RULES: CategoryRule[] = [
  { name: 'Возврат и обмен', keywords: ['возврат', 'вернуть', 'вернуть деньги', 'обмен', 'обменять', 'не подошел', 'не подошла'] },
  { name: 'Доставка', keywords: ['доставка', 'доставить', 'курьер', 'привезти', 'пункт выдачи', 'самовывоз', 'трек', 'когда придет', 'отправка'] },
  { name: 'Оплата', keywords: ['оплата', 'оплатить', 'платеж', 'списали', 'деньги', 'карта', 'чек', 'рассрочка', 'счет', 'сбп'] },
  { name: 'Заказ', keywords: ['заказ', 'статус', 'отменить', 'отмена', 'изменить заказ', 'номер заказа', 'оформить'] },
  { name: 'Гарантия и ремонт', keywords: ['гарантия', 'сломался', 'сломалась', 'брак', 'ремонт', 'неисправен', 'дефект'] },
  { name: 'Технический вопрос', keywords: ['сайт', 'приложение', 'ошибка', 'не работает', 'войти', 'пароль', 'личный кабинет', 'не грузится'] },
  { name: 'Бонусы и акции', keywords: ['бонус', 'баллы', 'промокод', 'скидка', 'акция', 'сертификат'] },
];

const URGENT = ['срочно', 'немедленно', 'сегодня', 'не работает', 'списали дважды', 'дважды', 'мошенн', 'украли', 'обман'];
const ANGRY = ['жалоба', 'претензия', 'суд', 'роспотребнадзор', 'возмутительно', 'безобразие', 'ужасно', 'верните деньги', 'позор', 'юрист'];
const MONEY = ['деньги', 'списали', 'оплата', 'возврат', 'платеж'];

function containsAny(text: string, list: string[]): string[] {
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  const stems = new Set(terms(text));
  return list.filter((k) => {
    const kTerms = terms(k);
    if (kTerms.length > 1 || k.includes(' ')) return lower.includes(k) || kTerms.every((t) => stems.has(t));
    return kTerms.length === 1 ? stems.has(kTerms[0]!) || lower.includes(k) : lower.includes(k);
  });
}

/** Rule-based classification with explanations (deterministic, testable). */
export function classify(text: string): Classification {
  let best = { name: 'Другое', hits: [] as string[] };
  for (const rule of CATEGORY_RULES) {
    const hits = containsAny(text, rule.keywords);
    if (hits.length > best.hits.length) best = { name: rule.name, hits };
  }
  const urgent = containsAny(text, URGENT);
  const angry = containsAny(text, ANGRY);
  const money = containsAny(text, MONEY);
  const exclaim = (text.match(/!/g) ?? []).length >= 2 || /[А-ЯA-Z]{6,}/.test(text);
  const reasons: string[] = [];
  let priority: Priority = 'low';
  if (urgent.length) reasons.push(`срочность: «${urgent.join('», «')}»`);
  if (angry.length) reasons.push(`негатив/претензия: «${angry.join('», «')}»`);
  if (exclaim) reasons.push('эмоциональный тон (восклицания или КАПС)');
  if (money.length && (urgent.length || angry.length)) reasons.push('вопрос касается денег');
  if (urgent.length || angry.length || (money.length && exclaim)) priority = 'high';
  else if (best.name === 'Оплата' || best.name === 'Заказ' || best.name === 'Возврат и обмен' || exclaim) {
    priority = 'medium';
    reasons.push(`тема «${best.name}» обычно требует ответа в течение дня`);
  }
  if (priority === 'low') reasons.push('информационный вопрос без признаков срочности');
  return {
    category: best.name,
    categoryReasons: best.hits.length ? best.hits.map((h) => `«${h}»`) : ['нет совпадений с правилами тем'],
    priority,
    priorityReasons: reasons,
  };
}
