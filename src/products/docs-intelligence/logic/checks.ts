import { fmtMoney } from '../../../lib/format';
import { isValidAccount, isValidBik, isValidCorrAccount, isValidInn, isValidKpp, parsePrice } from '../../../lib/validators';
import { FIELD_LABELS, type Check, type DocRecord, type DocType, type FieldKey } from './types';

export const REQUIRED: Record<DocType, FieldKey[]> = {
  invoice: ['number', 'date', 'sellerInn', 'buyerInn', 'bik', 'account', 'totalWithVat'],
  act: ['number', 'date', 'seller', 'buyer', 'sellerInn', 'buyerInn', 'total'],
  contract: ['number', 'date', 'seller', 'buyer', 'startDate', 'endDate'],
  upd: ['number', 'date', 'sellerInn', 'buyerInn', 'total'],
  registry: [],
  unknown: ['number', 'date'],
};

/** Money comparisons tolerate rounding to the kopeck. */
const TOL = 0.011;
const n = (v?: string) => (v ? parsePrice(v) : NaN);

export function computeChecks(doc: Pick<DocRecord, 'type' | 'fields' | 'items' | 'vatIncluded' | 'registry'>): Check[] {
  const out: Check[] = [];
  const f = doc.fields;
  const v = (k: FieldKey) => f[k]?.value?.trim() ?? '';
  const add = (c: Check) => out.push(c);

  if (doc.type === 'registry' && doc.registry) return registryChecks(doc.registry);

  for (const key of REQUIRED[doc.type]) {
    if (!v(key)) add({ id: `req-${key}`, level: 'error', field: key, title: `Нет поля «${FIELD_LABELS[key]}»`, detail: 'Обязательное поле для этого типа документа не найдено. Заполните вручную или проверьте исходник.' });
  }

  for (const key of ['sellerInn', 'buyerInn'] as const) {
    if (!v(key)) continue;
    add(
      isValidInn(v(key))
        ? { id: `inn-${key}`, level: 'ok', field: key, title: `${FIELD_LABELS[key]}: контрольная сумма верна`, detail: v(key) }
        : { id: `inn-${key}`, level: 'error', field: key, title: `${FIELD_LABELS[key]}: неверная контрольная сумма`, detail: `${v(key)} — такой ИНН не может существовать. Вероятна опечатка.` },
    );
  }
  for (const key of ['sellerKpp', 'buyerKpp'] as const) {
    if (v(key) && !isValidKpp(v(key))) add({ id: `kpp-${key}`, level: 'error', field: key, title: `${FIELD_LABELS[key]}: неверный формат`, detail: 'КПП — 9 символов: 4 цифры, 2 цифры или буквы, 3 цифры.' });
  }
  if (v('sellerInn') && v('buyerInn') && v('sellerInn') === v('buyerInn')) {
    add({ id: 'same-inn', level: 'warning', field: 'buyerInn', title: 'ИНН сторон совпадают', detail: 'Поставщик и покупатель указаны с одним ИНН — проверьте реквизиты.' });
  }
  if (v('bik')) {
    if (!isValidBik(v('bik'))) add({ id: 'bik', level: 'error', field: 'bik', title: 'БИК: неверный формат', detail: 'БИК банка РФ — 9 цифр и начинается с «04».' });
    else if (v('account')) {
      add(
        isValidAccount(v('account'), v('bik'))
          ? { id: 'acc', level: 'ok', field: 'account', title: 'Расчётный счёт соответствует БИК', detail: 'Контрольный ключ счёта верен.' }
          : { id: 'acc', level: 'error', field: 'account', title: 'Расчётный счёт не соответствует БИК', detail: 'Контрольный ключ не сходится: ошибка в счёте или в БИК. Платёж может не пройти.' },
      );
    }
    if (v('corrAccount') && isValidBik(v('bik'))) {
      if (!isValidCorrAccount(v('corrAccount'), v('bik'))) add({ id: 'corr', level: 'warning', field: 'corrAccount', title: 'Корр. счёт не сходится с БИК', detail: 'Проверьте корреспондентский счёт банка.' });
    }
  } else if (v('account')) {
    add({ id: 'acc-nobik', level: 'warning', field: 'bik', title: 'Счёт без БИК', detail: 'Без БИК нельзя проверить расчётный счёт.' });
  }

  // arithmetic
  const total = n(v('total'));
  const vat = n(v('vat'));
  const withVat = n(v('totalWithVat'));
  const rate = n(v('vatRate'));
  if (doc.items.length) {
    const bad = doc.items.filter((i) => Math.abs(i.qty * i.price - i.sum) > TOL);
    for (const i of bad) add({ id: `item-${i.n}`, level: 'error', title: `Позиция ${i.n}: количество × цена ≠ сумма`, detail: `${i.qty} × ${fmtMoney(i.price)} = ${fmtMoney(i.qty * i.price)}, указано ${fmtMoney(i.sum)}` });
    const sum = doc.items.reduce((s, i) => s + i.sum, 0);
    const base = Number.isFinite(total) ? total : withVat;
    if (Number.isFinite(base)) {
      add(
        Math.abs(sum - base) <= TOL
          ? { id: 'items-total', level: 'ok', field: 'total', title: 'Сумма позиций равна итогу', detail: fmtMoney(sum) }
          : { id: 'items-total', level: 'error', field: 'total', title: 'Сумма позиций не равна итогу', detail: `Позиции: ${fmtMoney(sum)}, итог: ${fmtMoney(base)}, разница ${fmtMoney(sum - base)}` },
      );
    }
  }
  if (Number.isFinite(vat) && Number.isFinite(rate) && rate > 0) {
    if (doc.vatIncluded) {
      const base = Number.isFinite(withVat) ? withVat : total;
      if (Number.isFinite(base)) {
        const expected = Math.round(((base * rate) / (100 + rate)) * 100) / 100;
        add(
          Math.abs(expected - vat) <= TOL
            ? { id: 'vat', level: 'ok', field: 'vat', title: `НДС ${rate}% (в том числе) рассчитан верно`, detail: fmtMoney(vat) }
            : { id: 'vat', level: 'error', field: 'vat', title: `НДС ${rate}% не сходится`, detail: `Из суммы ${fmtMoney(base)} НДС ${rate}% «в том числе» = ${fmtMoney(expected)}, указано ${fmtMoney(vat)}. Возможно, НДС начислен сверху, а не выделен.` },
        );
      }
    } else if (Number.isFinite(total)) {
      const expected = Math.round(total * rate) / 100;
      add(
        Math.abs(expected - vat) <= TOL
          ? { id: 'vat', level: 'ok', field: 'vat', title: `НДС ${rate}% рассчитан верно`, detail: `${fmtMoney(total)} × ${rate}% = ${fmtMoney(vat)}` }
          : { id: 'vat', level: 'error', field: 'vat', title: `НДС ${rate}% не сходится`, detail: `${fmtMoney(total)} × ${rate}% = ${fmtMoney(expected)}, указано ${fmtMoney(vat)}` },
      );
      if (Number.isFinite(withVat)) {
        if (Math.abs(total + vat - withVat) > TOL) add({ id: 'with-vat', level: 'error', field: 'totalWithVat', title: 'Итог + НДС ≠ всего к оплате', detail: `${fmtMoney(total)} + ${fmtMoney(vat)} = ${fmtMoney(total + vat)}, указано ${fmtMoney(withVat)}` });
      }
    }
  } else if (Number.isFinite(rate) && rate > 0 && !Number.isFinite(vat)) {
    add({ id: 'vat-missing', level: 'warning', field: 'vat', title: 'Указана ставка НДС, но нет суммы НДС', detail: 'Проверьте строку с НДС.' });
  }

  // dates
  const date = v('date');
  if (v('dueDate') && date && v('dueDate') < date) add({ id: 'due', level: 'error', field: 'dueDate', title: 'Срок оплаты раньше даты документа', detail: `${v('dueDate')} < ${date}` });
  if (v('startDate') && v('endDate')) {
    add(
      v('endDate') < v('startDate')
        ? { id: 'term', level: 'error', field: 'endDate', title: 'Срок действия заканчивается раньше, чем начинается', detail: `Начало ${v('startDate')}, окончание ${v('endDate')}. Вероятна опечатка в годе.` }
        : { id: 'term', level: 'ok', field: 'endDate', title: 'Порядок дат действия верный', detail: `${v('startDate')} → ${v('endDate')}` },
    );
  }
  if (date && date > new Date(Date.now() + 366 * 864e5).toISOString().slice(0, 10)) add({ id: 'future', level: 'warning', field: 'date', title: 'Дата документа больше чем через год', detail: date });
  return out;
}

function registryChecks(reg: NonNullable<DocRecord['registry']>): Check[] {
  const out: Check[] = [];
  const h = reg.headers;
  const col = (re: RegExp) => h.find((x) => re.test(x.toLowerCase()));
  const innCol = col(/инн/);
  const sumCol = col(/сумм|итог/);
  const vatCol = col(/ндс/);
  const numCol = col(/номер|№/);
  for (const r of reg.rows) {
    const row = r.index + 2; // + header line, 1-based
    if (numCol && !r.cells[numCol]?.trim()) out.push({ id: `r${r.index}-num`, level: 'error', field: `row:${r.index}`, title: `Строка ${row}: нет номера документа`, detail: 'Без номера платёж нельзя сопоставить со счётом.' });
    const inn = innCol ? r.cells[innCol]?.trim() ?? '' : '';
    if (innCol && inn && !isValidInn(inn)) out.push({ id: `r${r.index}-inn`, level: 'error', field: `row:${r.index}`, title: `Строка ${row}: неверный ИНН ${inn}`, detail: 'Контрольная сумма не сходится.' });
    const sum = sumCol ? parsePrice(r.cells[sumCol] ?? '') : NaN;
    const vat = vatCol ? parsePrice(r.cells[vatCol] ?? '') : NaN;
    if (vatCol && Number.isFinite(sum)) {
      if (!Number.isFinite(vat)) out.push({ id: `r${r.index}-vat`, level: 'warning', field: `row:${r.index}`, title: `Строка ${row}: НДС не указан`, detail: inn.length === 12 ? 'Контрагент — ИП: возможно, работает без НДС. Уточните.' : 'Проверьте, облагается ли операция НДС.' });
      else {
        const exp = Math.round((sum * 20) / 120 * 100) / 100;
        if (Math.abs(exp - vat) > TOL) out.push({ id: `r${r.index}-vatcalc`, level: 'warning', field: `row:${r.index}`, title: `Строка ${row}: НДС не равен 20/120 суммы`, detail: `Ожидалось ${fmtMoney(exp)}, указано ${fmtMoney(vat)}. Возможна другая ставка.` });
      }
    }
  }
  if (!out.length) out.push({ id: 'reg-ok', level: 'ok', title: 'Строки реестра прошли проверки', detail: `${reg.rows.length} строк` });
  return out;
}
