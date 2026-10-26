import { parseDate, parsePrice } from '../../../lib/validators';
import type { CustomRule, DocType, ExtractedField, FieldKey, LineItem } from './types';

const AMOUNT = String.raw`(\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const DATE = String.raw`(\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4})`;

export function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[ \t]+\n/g, '\n');
}

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Document type by title keywords; returns the reason for transparency. */
export function detectType(text: string): { type: DocType; reason: string } {
  const head = lines(text).slice(0, 15).join('\n').toLowerCase();
  const all = text.toLowerCase();
  const rules: Array<[DocType, RegExp, string]> = [
    ['upd', /универсальный передаточный документ|(^|[^а-яё])упд([^а-яё]|$)|товарная накладная|торг-12/, 'заголовок «УПД / накладная»'],
    ['invoice', /сч[её]т\s+на\s+оплату|сч[её]т\s*№/, 'заголовок «Счёт на оплату»'],
    ['act', /(^|[^а-яё])акт[^а-яё][^\n]{0,40}(№|об оказании|выполненных)/, 'заголовок «Акт»'],
    ['contract', /(^|[^а-яё])договор([^а-яё][^\n]{0,40})?№/, 'заголовок «Договор»'],
  ];
  for (const [type, re, reason] of rules) if (re.test(head)) return { type, reason };
  for (const [type, re, reason] of rules) if (re.test(all)) return { type, reason: `${reason} (найден не в шапке)` };
  return { type: 'unknown', reason: 'не найдено характерных заголовков' };
}

function field(value: string, source: string, confidence: ExtractedField['confidence'] = 'high'): ExtractedField {
  return { value: value.trim(), source: source.trim().slice(0, 300), confidence };
}

function money(s: string): string {
  const n = parsePrice(s);
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

function isoFromRu(s: string): string {
  const d = parseDate(s);
  return d ? d.toISOString().slice(0, 10) : '';
}

const SELLER_RE = /^(поставщик|исполнитель|продавец|получатель)(?=[\s:,—-]|$)/i;
const BUYER_RE = /^(покупатель|заказчик|плательщик)(?=[\s:,—-]|$)/i;

function partyFrom(line: string): { name: string; inn?: string; kpp?: string } {
  const name = /[:—-]\s*((?:ООО|АО|ПАО|ЗАО|ИП|ОАО)\s*«?[^,«»]+»?|[^,]+)/.exec(line)?.[1] ?? '';
  const inn = /ИНН\s*:?\s*(\d{10,12})/i.exec(line)?.[1];
  const kpp = /КПП\s*:?\s*(\d{9})/i.exec(line)?.[1];
  return { name: name.replace(/,?\s*именуем.*$/i, '').trim(), inn, kpp };
}

/**
 * Rule-based field extraction. Each value keeps the line it came from,
 * so a person can verify it during review.
 */
export function extractFields(raw: string, type: DocType): { fields: Partial<Record<FieldKey, ExtractedField>>; vatIncluded: boolean } {
  const text = normalizeText(raw);
  const ls = lines(text);
  const f: Partial<Record<FieldKey, ExtractedField>> = {};

  // number + date from the title line
  const title = ls.find((l) => /(сч[её]т|акт|договор|упд|накладная)[^\n]*№/i.test(l));
  if (title) {
    const num = /№\s*([\p{L}\p{N}\-/.]+)/u.exec(title)?.[1];
    if (num) f.number = field(num.replace(/\.$/, ''), title);
    const d = new RegExp(String.raw`от\s+${DATE}`, 'i').exec(title)?.[1];
    if (d) f.date = field(isoFromRu(d), title);
  }
  if (!f.date) {
    // contracts often put the date on the "city ... date" line
    const cityLine = ls.find((l) => /^г\.\s/.test(l) && new RegExp(DATE).test(l));
    const anyLine = cityLine ?? ls.find((l) => new RegExp(DATE).test(l));
    const d = anyLine ? new RegExp(DATE).exec(anyLine)?.[1] : undefined;
    if (d && anyLine) f.date = field(isoFromRu(d), anyLine, cityLine ? 'high' : 'low');
  }

  // parties: role-labelled lines win; for contracts use the requisites section (last occurrence)
  const roleLines = (re: RegExp) => ls.filter((l) => re.test(l) && /ИНН/i.test(l));
  const sellerLine = roleLines(SELLER_RE).at(-1);
  const buyerLine = roleLines(BUYER_RE).at(-1);
  if (sellerLine) {
    const p = partyFrom(sellerLine);
    if (p.name) f.seller = field(p.name, sellerLine);
    if (p.inn) f.sellerInn = field(p.inn, sellerLine);
    if (p.kpp) f.sellerKpp = field(p.kpp, sellerLine);
  }
  if (buyerLine) {
    const p = partyFrom(buyerLine);
    if (p.name) f.buyer = field(p.name, buyerLine);
    if (p.inn) f.buyerInn = field(p.inn, buyerLine);
    if (p.kpp) f.buyerKpp = field(p.kpp, buyerLine);
  }
  if (!f.sellerInn) {
    // header of an invoice: first INN in the document belongs to the issuer
    const innLine = ls.find((l) => /ИНН\s*:?\s*\d{10,12}/i.test(l));
    if (innLine) {
      f.sellerInn = field(/ИНН\s*:?\s*(\d{10,12})/i.exec(innLine)![1]!, innLine, 'medium');
      const kpp = /КПП\s*:?\s*(\d{9})/i.exec(innLine)?.[1];
      if (kpp && !f.sellerKpp) f.sellerKpp = field(kpp, innLine, 'medium');
    }
  }

  // bank details
  const grab = (key: FieldKey, re: RegExp) => {
    const line = ls.find((l) => re.test(l));
    const v = line ? re.exec(line)?.[1] : undefined;
    if (v && line) f[key] = field(v, line);
  };
  grab('bik', /БИК\s*:?\s*(\d{9})/i);
  grab('account', /(?:р\/с|р\.с\.|расч[её]тный сч[её]т|сч[её]т получателя)[^\d]{0,20}(\d{20})/i);
  grab('corrAccount', /(?:к\/с|корр?\.?\s*сч[её]т)[^\d]{0,20}(\d{20})/i);
  grab('basis', /основание\s*:?\s*(.+)$/i);

  // amounts
  const amountAfter = (key: FieldKey, re: RegExp) => {
    const line = ls.find((l) => re.test(l));
    if (!line) return;
    const m = new RegExp(re.source + String.raw`[^\d]{0,40}?` + AMOUNT, 'i').exec(line);
    const v = m?.[m.length - 1];
    if (v) f[key] = field(money(v), line);
  };
  amountAfter('total', /^итого(?! к оплате)\s*:?/i);
  amountAfter('totalWithVat', /(всего к оплате|всего оказано услуг на сумму|итого к оплате|всего на сумму)/i);
  const vatLine = ls.find((l) => /ндс/i.test(l) && /\d/.test(l) && !/без ндс/i.test(l));
  let vatIncluded = false;
  if (vatLine) {
    const rate = /ндс\s*(?:\()?(\d{1,2})\s*%/i.exec(vatLine)?.[1];
    if (rate) f.vatRate = field(rate, vatLine);
    const amounts = [...vatLine.matchAll(new RegExp(AMOUNT, 'g'))].map((m) => m[1]!).filter((a) => a !== rate);
    const vat = amounts.at(-1);
    if (vat) f.vat = field(money(vat), vatLine);
    vatIncluded = /в\s+том\s+числе|в т\.\s?ч\./i.test(vatLine);
  } else if (/без ндс|ндс не облагается/i.test(text)) {
    const l = ls.find((x) => /без ндс|ндс не облагается/i.test(x))!;
    f.vatRate = field('0', l);
  }
  if (type === 'contract') {
    const costLine = ls.find((l) => /(стоимость|цена)\s+договора/i.test(l));
    if (costLine) {
      const m = new RegExp(String.raw`составляет\s*` + AMOUNT, 'i').exec(costLine);
      if (m?.[1]) f.totalWithVat = field(money(m[1]), costLine);
      if (/в\s+том\s+числе/i.test(costLine)) vatIncluded = true;
    }
    const term = ls.find((l) => /(вступает в силу|действует)/i.test(l));
    if (term) {
      const ds = [...term.matchAll(new RegExp(DATE, 'g'))].map((m) => isoFromRu(m[1]!));
      if (ds[0]) f.startDate = field(ds[0], term);
      if (ds[1]) f.endDate = field(ds[1], term);
    }
  }
  const due = ls.find((l) => /(оплатить до|срок оплаты)/i.test(l));
  if (due) {
    const d = new RegExp(DATE).exec(due)?.[1];
    if (d) f.dueDate = field(isoFromRu(d), due);
  }
  if (/всего (оказано|на сумму)/i.test(text) && f.totalWithVat && f.total && f.total.value === f.totalWithVat.value) vatIncluded = true;
  return { fields: f, vatIncluded };
}

/** Table rows "1 | Name | qty | price | sum" (also tab- or ;-separated). */
export function extractItems(raw: string): LineItem[] {
  const out: LineItem[] = [];
  for (const line of lines(normalizeText(raw))) {
    const cells = line.split(/\s*[|\t;]\s*/).map((c) => c.trim());
    if (cells.length < 5 || !/^\d{1,3}$/.test(cells[0]!)) continue;
    const [n, name, qty, price, sum] = [cells[0]!, cells[1]!, cells.at(-3)!, cells.at(-2)!, cells.at(-1)!];
    const q = parsePrice(qty);
    const p = parsePrice(price);
    const s = parsePrice(sum);
    if ([q, p, s].some((x) => !Number.isFinite(x))) continue;
    out.push({ n: Number(n), name, qty: q, price: p, sum: s, source: line });
  }
  return out;
}

/** Applies user rules: value after a keyword on the same line, or a regex (first group). */
export function applyCustomRules(raw: string, rules: CustomRule[]): Record<string, ExtractedField> {
  const text = normalizeText(raw);
  const out: Record<string, ExtractedField> = {};
  for (const r of rules) {
    if (r.pattern) {
      let re: RegExp;
      try {
        re = new RegExp(r.pattern.slice(0, 200), 'im');
      } catch {
        continue;
      }
      const m = re.exec(text.slice(0, 200000));
      if (m) {
        const line = text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index) === -1 ? undefined : text.indexOf('\n', m.index));
        out[r.id] = field((m[1] ?? m[0]).slice(0, 300), line, 'medium');
      }
      continue;
    }
    const kw = r.keyword.trim().toLowerCase();
    if (!kw) continue;
    const line = lines(text).find((l) => l.toLowerCase().includes(kw));
    if (!line) continue;
    const after = line.slice(line.toLowerCase().indexOf(kw) + kw.length).replace(/^[\s:—–-]+/, '');
    if (after) out[r.id] = field(after.slice(0, 300), line, 'medium');
  }
  return out;
}

export function isScanLike(text: string, pages: number): boolean {
  const letters = (text.match(/[\p{L}\d]/gu) ?? []).length;
  return letters < Math.max(40, pages * 40);
}
