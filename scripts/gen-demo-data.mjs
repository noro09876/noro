#!/usr/bin/env node
/**
 * Generates deterministic demo datasets into public/demo/.
 * All companies, people, emails and numbers are fictional (emails use the
 * reserved .example TLD). Run: npm run demo-data
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'demo');
mkdirSync(out, { recursive: true });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261026);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

function csv(headers, rows, d = ';') {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /["\n\r]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers.map(esc).join(d), ...rows.map((r) => headers.map((h) => esc(r[h])).join(d))].join('\r\n') + '\r\n';
}

const translit = (s) =>
  s
    .toLowerCase()
    .replace(/[«»"]/g, '')
    .split('')
    .map((c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ' ': '' })[c] ?? c)
    .join('')
    .replace(/[^a-z0-9-]/g, '');

// ───────────────────────── Leads ─────────────────────────
const firstM = ['Алексей', 'Дмитрий', 'Сергей', 'Андрей', 'Михаил', 'Игорь', 'Павел', 'Роман', 'Олег', 'Артём', 'Кирилл', 'Максим'];
const firstF = ['Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Ирина', 'Татьяна', 'Юлия', 'Светлана', 'Дарья', 'Ксения', 'Вера'];
const lastM = ['Орлов', 'Соколов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Зайцев', 'Беляев', 'Громов', 'Крылов', 'Жуков', 'Титов', 'Фролов'];
const companies = [
  ['Северный Трейд', 'Дистрибуция'], ['Вектор Логистик', 'Логистика'], ['ТехноПласт', 'Производство'], ['Городской Маркет', 'Ритейл'],
  ['Лайтбокс', 'E-commerce'], ['Альфа Металл', 'Производство'], ['КлинСервис', 'Услуги'], ['Ромашка Агро', 'Сельское хозяйство'],
  ['Сигма Финанс', 'Финансы'], ['Ориентир Девелопмент', 'Недвижимость'], ['Кодекс Софт', 'IT'], ['Мебель Мастер', 'Производство'],
  ['Бриз Тур', 'Туризм'], ['ЭкоФуд', 'Ритейл'], ['Полюс Строй', 'Строительство'], ['Медлайн Клиник', 'Медицина'],
  ['Учебный Центр Прогресс', 'Образование'], ['Цифровая Полка', 'E-commerce'], ['Транзит Плюс', 'Логистика'], ['Арт Принт', 'Полиграфия'],
  ['Вершина Консалт', 'Консалтинг'], ['Нордик Фарм', 'Фармацевтика'], ['Байт Систем', 'IT'], ['Домашний Уют', 'Интернет-магазин'],
];
const titles = ['Генеральный директор', 'Коммерческий директор', 'Руководитель отдела продаж', 'Менеджер по закупкам', 'Директор по маркетингу', 'Основатель', 'Операционный директор', 'Специалист', 'Ассистент руководителя', 'Head of Sales', 'Маркетолог', 'Стажер', 'Финансовый директор', 'Руководитель IT'];
const sources = ['Сайт', 'Выставка', 'Рекомендация', 'Холодная база', 'Вебинар', 'Реклама', 'Партнёр'];
const cities = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Нижний Новгород', 'Краснодар', 'Самара'];
const sizes = ['1-10', '11-50', '51-200', '201-500', '500+', '25', '120', '1 000', ''];

const leads = [];
for (let i = 0; i < 60; i++) {
  const female = rnd() < 0.45;
  const fn = female ? pick(firstF) : pick(firstM);
  const ln = pick(lastM) + (female ? 'а' : '');
  const [co, ind] = companies[i % companies.length];
  const domain = translit(co) + '.example';
  const lt = translit(ln).slice(0, 10);
  const email = `${translit(fn)[0]}.${lt}@${domain}`;
  const phoneDigits = `9${int(10, 99)}${int(100, 999)}${int(10, 99)}${int(10, 99)}`;
  const phoneFormats = [`+7 ${phoneDigits.slice(0, 3)} ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6, 8)}-${phoneDigits.slice(8)}`, `8${phoneDigits}`, `8 (${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3)}`, `+7${phoneDigits}`];
  leads.push({
    'ФИО': `${fn} ${ln}`,
    'Компания': `ООО «${co}»`,
    'Должность': pick(titles),
    'Email': email,
    'Телефон': rnd() < 0.85 ? pick(phoneFormats) : '',
    'Отрасль': ind,
    'Сотрудников': pick(sizes),
    'Источник': pick(sources),
    'Город': pick(cities),
    'Сайт': rnd() < 0.6 ? `https://www.${domain}/` : '',
    'Комментарий': rnd() < 0.25 ? pick(['Просил перезвонить после 15:00', 'Интересует интеграция с CRM', 'Был на демо в прошлом году', 'Нужен расчёт под 3 филиала']) : '',
  });
}
// Inject realistic problems
leads[3]['Email'] = leads[3]['Email'].toUpperCase();
leads[5]['Email'] = 'info@gmail.com';
leads[7]['Email'] = 'sales.vector-logistik.example';
leads[9]['Телефон'] = '12-34';
leads[11]['ФИО'] = 'иванова мария';
leads[12]['ФИО'] = '';
leads[14]['Компания'] = '';
leads[16]['Email'] = '';
leads[16]['Телефон'] = '';
leads[18]['ФИО'] = 'ПЕТРОВ ГЛЕБ';
leads[20]['Email'] = 'olga.trade@mail.ru';
leads[22]['Должность'] = 'Студент';
// Duplicates: same person, different formatting
leads.push({ ...leads[2], 'Email': leads[2]['Email'].toUpperCase(), 'Телефон': '', 'Комментарий': 'Повторная заявка с сайта' });
leads.push({ ...leads[4], 'Email': '', 'Источник': 'Выставка', 'Сайт': '' });
leads.push({ ...leads[10], 'ФИО': leads[10]['ФИО'].toLowerCase(), 'Компания': leads[10]['Компания'].replace('ООО ', ''), 'Email': '', 'Телефон': leads[10]['Телефон'] || '+7 900 000-00-00' });
leads.push({ ...leads[30], 'Телефон': leads[30]['Телефон'], 'Email': `sales@${translit(companies[30 % companies.length][0])}.example`, 'ФИО': leads[30]['ФИО'] });
writeFileSync(join(out, 'leads-demo.csv'), csv(Object.keys(leads[0]), leads));

// ───────────────────────── Catalog ─────────────────────────
function ean13(base12) {
  const d = base12.split('').map(Number);
  let s = 0;
  for (let i = 0; i < 12; i++) s += d[i] * (i % 2 === 0 ? 1 : 3);
  return base12 + ((10 - (s % 10)) % 10);
}
const brands = ['Arkto', 'Velmo', 'Nordia', 'Kubrik', 'Solvi', 'Tempra'];
const cats = {
  'Кухня': ['Чайник электрический', 'Блендер погружной', 'Кофемолка', 'Тостер', 'Сковорода антипригарная', 'Набор ножей'],
  'Дом': ['Пылесос вертикальный', 'Увлажнитель воздуха', 'Утюг паровой', 'Обогреватель масляный', 'Светильник настольный'],
  'Спорт': ['Коврик для йоги', 'Гантели разборные', 'Бутылка для воды', 'Фитнес-резинка', 'Скакалка скоростная'],
  'Сад': ['Секатор', 'Шланг поливочный', 'Перчатки садовые', 'Опрыскиватель ручной'],
};
const colors = ['чёрный', 'белый', 'серый', 'графит', 'синий', 'зелёный'];
const catalog = [];
let n = 0;
for (const [cat, items] of Object.entries(cats)) {
  for (const item of items) {
    for (let k = 0; k < 13 && catalog.length < 240; k++) {
      n++;
      const brand = pick(brands);
      const price = Math.round((int(4, 180) * 100 - 10) / 10) * 10 - 1;
      const variant = `${pick(colors)}${rnd() < 0.5 ? `, ${int(1, 3)} шт.` : ''}`;
      catalog.push({
        'Артикул': `${brand.slice(0, 3).toUpperCase()}-${String(1000 + n).padStart(5, '0')}`,
        'Наименование': `${item} ${brand} ${variant}`,
        'Бренд': brand,
        'Категория': cat,
        'Цена': String(price),
        'Старая цена': rnd() < 0.3 ? String(Math.round(price * 1.2)) : '',
        'Остаток': String(int(0, 140)),
        'Штрихкод': ean13(`46${String(10000000000 + n * 7919).slice(-10)}`),
        'Вес, кг': (int(1, 60) / 10).toFixed(1).replace('.', ','),
        'Описание': rnd() < 0.7 ? `${item} от ${brand}. Цвет: ${variant.split(',')[0]}.` : '',
      });
    }
  }
}
while (catalog.length < 240) catalog.push({ ...catalog[catalog.length % 40], 'Артикул': `MSC-${90000 + catalog.length}` });
// Inject typical errors
const C = catalog;
C[1]['Цена'] = '1 299,00 руб.';
C[4]['Цена'] = '2 490 ₽';
C[6]['Цена'] = '';
C[8]['Цена'] = '-150';
C[10]['Цена'] = 'договорная';
C[12]['Старая цена'] = '100';
C[15]['Артикул'] = C[14]['Артикул'];
C[22]['Артикул'] = C[21]['Артикул'];
C[30]['Штрихкод'] = '4600000000001';
C[33]['Штрихкод'] = C[32]['Штрихкод'];
C[40]['Бренд'] = '';
C[41]['Бренд'] = '';
C[44]['Категория'] = '';
C[50]['Наименование'] = `  ${C[50]['Наименование']}   `;
C[52]['Артикул'] = C[52]['Артикул'].toLowerCase();
C[55]['Описание'] = '<p>Отличный товар <b>со скидкой</b></p>';
C[60]['Артикул'] = '';
C[63]['Цена'] = '3.490,50';
C[66]['Наименование'] = C[66]['Наименование'] + ' — ' + 'очень длинное название с перечислением всех характеристик товара, комплектации и совместимости для поисковой выдачи маркетплейса';
C[70]['Остаток'] = 'много';
C[90]['Цена'] = '15990.00';
C[120]['Вес, кг'] = '0';
C[75]['Наименование'] = C[75]['Наименование'].toUpperCase();
writeFileSync(join(out, 'catalog-demo.csv'), csv(Object.keys(C[0]), C));

// ───────────────────────── Sales (order level) ─────────────────────────
const salesCats = [['Электроника', 6200, 0.72], ['Дом и сад', 2400, 0.58], ['Одежда', 2900, 0.5], ['Спорт', 3100, 0.6], ['Красота', 1400, 0.45], ['Детские товары', 1900, 0.55]];
const channels = [['Сайт', 0.42], ['Маркетплейс', 0.38], ['Розница', 0.2]];
const regions = ['Москва', 'Санкт-Петербург', 'Поволжье', 'Урал', 'Сибирь', 'Юг'];
const start = Date.UTC(2025, 9, 26);
const days = 365;
const sales = [];
let order = 100000;
const customers = 2600;
for (let d = 0; d < days; d++) {
  const date = new Date(start + d * 86400000);
  const iso = date.toISOString().slice(0, 10);
  const dow = date.getUTCDay();
  const month = date.getUTCMonth();
  let base = 22 + d * 0.025; // gentle growth
  if (dow === 0 || dow === 6) base *= 1.25;
  if (month === 11) base *= 1.45; // December peak
  if (month === 0 && date.getUTCDate() < 9) base *= 0.55; // New Year holidays
  if (iso === '2026-03-14') base *= 0.1; // outage-like drop (anomaly)
  if (iso === '2026-06-12') base *= 2.4; // promo spike (anomaly)
  if (iso >= '2026-08-01' && iso <= '2026-08-07') base *= 1.15;
  const ordersToday = Math.max(1, Math.round(base * (0.85 + rnd() * 0.3)));
  for (let o = 0; o < ordersToday; o++) {
    order++;
    const [cat, avg, costShare] = salesCats[Math.floor(Math.pow(rnd(), 1.3) * salesCats.length)];
    let r = rnd();
    let ch = channels[0][0];
    for (const [c, w] of channels) {
      if (r < w) {
        ch = c;
        break;
      }
      r -= w;
    }
    // Marketplace share of Электроника drops in last 2 months (explainable change)
    if (iso >= '2026-09-01' && cat === 'Электроника' && ch === 'Маркетплейс' && rnd() < 0.35) continue;
    const qty = rnd() < 0.8 ? 1 : int(2, 4);
    const revenue = Math.round(avg * (0.45 + rnd() * 1.1) * qty);
    sales.push({
      date: iso,
      order_id: `ORD-${order}`,
      customer_id: `C${String(int(1, customers)).padStart(5, '0')}`,
      channel: ch,
      category: cat,
      region: pick(regions),
      quantity: qty,
      revenue,
      cost: Math.round(revenue * costShare * (0.9 + rnd() * 0.2)),
    });
  }
}
writeFileSync(join(out, 'sales-demo.csv'), csv(['date', 'order_id', 'customer_id', 'channel', 'category', 'region', 'quantity', 'revenue', 'cost'], sales, ','));

// Funnel / traffic (daily per channel)
const funnel = [];
for (let d = 0; d < days; d++) {
  const iso = new Date(start + d * 86400000).toISOString().slice(0, 10);
  for (const [ch, cr] of [['Поиск', 0.034], ['Соцсети', 0.018], ['Email', 0.052], ['Реклама', 0.022]]) {
    const visits = int(300, 900) + Math.round(d * 0.6);
    const leadsN = Math.round(visits * cr * 2.2 * (0.8 + rnd() * 0.4));
    const ordersN = Math.round(leadsN * (0.35 + rnd() * 0.15) * (iso >= '2026-09-15' && ch === 'Реклама' ? 0.5 : 1));
    funnel.push({ 'Дата': iso.split('-').reverse().join('.'), 'Канал': ch, 'Визиты': visits, 'Заявки': leadsN, 'Заказы': ordersN, 'Выручка': ordersN * int(2500, 4200) });
  }
}
writeFileSync(join(out, 'funnel-demo.csv'), csv(Object.keys(funnel[0]), funnel));

// ───────────────────────── Documents ─────────────────────────
function innLegal(base9) {
  const d = base9.split('').map(Number);
  const c = ([2, 4, 10, 3, 5, 9, 4, 6, 8].reduce((s, k, i) => s + k * d[i], 0) % 11) % 10;
  return base9 + c;
}
function accountFor(bik, base19) {
  // find check digit (position 9, index 8) making the BIK key valid
  for (let k = 0; k <= 9; k++) {
    const acc = base19.slice(0, 8) + k + base19.slice(8);
    const str = bik.slice(-3) + acc;
    const w = [7, 1, 3];
    let s = 0;
    for (let i = 0; i < str.length; i++) s += (Number(str[i]) * w[i % 3]) % 10;
    if (s % 10 === 0) return acc;
  }
  throw new Error('no account');
}
const sellerInn = innLegal('770812345');
const buyerInn = innLegal('502734561');
const bik = '044525999';
const account = accountFor(bik, '4070281000000041871');
const fmt = (v) => v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00a0/g, ' ');

const invoiceItems = [['Настройка интеграции с CRM', 1, 48000], ['Модуль импорта заявок', 1, 36500], ['Обучение сотрудников, час', 6, 3500]];
const invNet = invoiceItems.reduce((s, [, q, p]) => s + q * p, 0);
const invVat = Math.round(invNet * 0.2 * 100) / 100;
const invoice = `ООО «Вектор Логистик»
ИНН ${sellerInn} КПП 770801001
Адрес: 125009, г. Москва, ул. Примерная, д. 7, офис 12

Банк получателя: АО «Демо Банк», г. Москва
БИК ${bik}
Р/с ${account}
К/с 30101810600000000999

СЧЁТ НА ОПЛАТУ № 418 от 14.10.2026

Поставщик: ООО «Вектор Логистик», ИНН ${sellerInn}, КПП 770801001
Покупатель: ООО «Северный Трейд», ИНН ${buyerInn}, КПП 502701001
Основание: Договор № 57-У от 01.09.2026

№ | Наименование | Кол-во | Цена | Сумма
${invoiceItems.map(([name, q, p], i) => `${i + 1} | ${name} | ${q} | ${fmt(p)} | ${fmt(q * p)}`).join('\n')}

Итого: ${fmt(invNet)}
НДС 20%: ${fmt(invVat)}
Всего к оплате: ${fmt(invNet + invVat)} руб.

Оплатить до 24.10.2026
Руководитель ________ Орлов А. В.
Главный бухгалтер ________ Соколова Е. И.
`;
writeFileSync(join(out, 'invoice-418.txt'), invoice);

const actItems = [['Транспортно-экспедиционные услуги, рейс Москва — Казань', 2, 41000], ['Погрузо-разгрузочные работы', 1, 9500]];
const actNet = actItems.reduce((s, [, q, p]) => s + q * p, 0);
const act = `АКТ № 112 от 30.09.2026
об оказании услуг

Исполнитель: ООО «Транзит Плюс», ИНН ${innLegal('165912348')}, КПП 165901001
Заказчик: ООО «ТехноПласт», ИНН ${innLegal('631512347').slice(0, 9)}8, КПП 631501001
Основание: Договор № 23-ТЭ от 15.01.2026

№ | Наименование работ, услуг | Кол-во | Цена | Сумма
${actItems.map(([name, q, p], i) => `${i + 1} | ${name} | ${q} | ${fmt(p)} | ${fmt(q * p)}`).join('\n')}

Итого: ${fmt(actNet)}
В том числе НДС 20%: ${fmt(Math.round(actNet * 0.2) )}
Всего оказано услуг на сумму: ${fmt(actNet)} руб.

Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.

Исполнитель ________ Беляев Р. С.        Заказчик ________ Громова И. П.
`;
writeFileSync(join(out, 'act-112.txt'), act);

const contract = `ДОГОВОР ПОСТАВКИ № 88-П
г. Санкт-Петербург                                    05.08.2026

ООО «Нордик Фарм», именуемое в дальнейшем «Покупатель», в лице генерального директора Крыловой Т. А., действующей на основании Устава, с одной стороны, и ООО «Альфа Металл», именуемое в дальнейшем «Поставщик», в лице директора Жукова П. Н., с другой стороны, заключили настоящий договор о нижеследующем.

1. ПРЕДМЕТ ДОГОВОРА
1.1. Поставщик обязуется поставить, а Покупатель принять и оплатить металлические стеллажи согласно спецификации (Приложение № 1).

2. ЦЕНА И ПОРЯДОК РАСЧЁТОВ
2.1. Общая стоимость договора составляет 1 284 000,00 руб., в том числе НДС 20% — 214 000,00 руб.
2.2. Покупатель производит оплату в течение 10 банковских дней с даты подписания товарной накладной.

3. СРОК ДЕЙСТВИЯ
3.1. Договор вступает в силу с 05.08.2026 и действует до 31.07.2026.

4. РЕКВИЗИТЫ СТОРОН
Покупатель: ООО «Нордик Фарм», ИНН ${innLegal('781045672')}, КПП 781001001
Поставщик: ООО «Альфа Металл», ИНН ${innLegal('667312985')}
Р/с поставщика ${accountFor('044030999', '4070281050000000713')}, БИК 044030999
`;
writeFileSync(join(out, 'contract-88.txt'), contract);

const registry = [
  { 'Номер': '418', 'Дата': '14.10.2026', 'Контрагент': 'ООО «Вектор Логистик»', 'ИНН': sellerInn, 'Сумма': fmt(invNet + invVat), 'НДС': fmt(invVat) },
  { 'Номер': '419', 'Дата': '15.10.2026', 'Контрагент': 'ООО «Кодекс Софт»', 'ИНН': innLegal('772534981'), 'Сумма': '120 000,00', 'НДС': '20 000,00' },
  { 'Номер': '420', 'Дата': '15.10.2026', 'Контрагент': 'ИП Морозов', 'ИНН': '500100732259', 'Сумма': '18 400,00', 'НДС': '' },
  { 'Номер': '421', 'Дата': '16.10.2026', 'Контрагент': 'ООО «Байт Систем»', 'ИНН': '7712345670', 'Сумма': '64 800,00', 'НДС': '10 800,00' },
  { 'Номер': '', 'Дата': '17.10.2026', 'Контрагент': 'ООО «Арт Принт»', 'ИНН': innLegal('540398761'), 'Сумма': '9 990,00', 'НДС': '1 665,00' },
];
writeFileSync(join(out, 'payments-registry.csv'), csv(Object.keys(registry[0]), registry));

// PDF with a real text layer (DejaVu font for Cyrillic) via Python reportlab
try {
  execFileSync('python3', [join(root, 'scripts', 'make-demo-pdf.py'), join(out, 'invoice-418.txt'), join(out, 'invoice-418.pdf')], { stdio: 'inherit' });
} catch (e) {
  console.warn('PDF generation skipped:', e.message);
}

console.log(`demo data: leads=${leads.length} catalog=${catalog.length} sales=${sales.length} funnel=${funnel.length}`);
console.log(`seller INN ${sellerInn}, account ${account}`);
