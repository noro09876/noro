/**
 * Light Russian stemmer (Snowball-inspired suffix stripping, RV region).
 * Good enough for search matching: "доставки", "доставкой", "доставку" → "доставк".
 */
const VOWELS = 'аеиоуыэюя';

const PERFECTIVE_GERUND_1 = ['вшись', 'вши', 'в'];
const PERFECTIVE_GERUND_2 = ['ывшись', 'ившись', 'ывши', 'ивши', 'ив', 'ыв'];
const REFLEXIVE = ['ся', 'сь'];
const ADJECTIVE = ['ими', 'ыми', 'его', 'ого', 'ему', 'ому', 'ее', 'ие', 'ые', 'ое', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом', 'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею'];
const PARTICIPLE_1 = ['ем', 'нн', 'вш', 'ющ', 'щ'];
const PARTICIPLE_2 = ['ивш', 'ывш', 'ующ'];
const VERB_1 = ['ла', 'на', 'ете', 'йте', 'ли', 'й', 'л', 'ем', 'н', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'ешь', 'нно'];
const VERB_2 = ['ила', 'ыла', 'ена', 'ейте', 'уйте', 'ите', 'или', 'ыли', 'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен', 'ило', 'ыло', 'ено', 'ят', 'ует', 'уют', 'ит', 'ыт', 'ены', 'ить', 'ыть', 'ишь', 'ую', 'ю'];
const NOUN = ['иями', 'ями', 'ами', 'иях', 'ией', 'иям', 'ием', 'ах', 'ях', 'ев', 'ов', 'ие', 'ье', 'еи', 'ии', 'ей', 'ой', 'ий', 'ям', 'ем', 'ам', 'ом', 'ию', 'ью', 'ия', 'ья', 'а', 'е', 'и', 'й', 'о', 'у', 'ы', 'ь', 'ю', 'я'];
const SUPERLATIVE = ['ейше', 'ейш'];
const DERIVATIONAL = ['ость', 'ост'];

function byLength(list: string[]) {
  return [...list].sort((a, b) => b.length - a.length);
}

const L = {
  pg1: byLength(PERFECTIVE_GERUND_1),
  pg2: byLength(PERFECTIVE_GERUND_2),
  refl: byLength(REFLEXIVE),
  adj: byLength(ADJECTIVE),
  p1: byLength(PARTICIPLE_1),
  p2: byLength(PARTICIPLE_2),
  v1: byLength(VERB_1),
  v2: byLength(VERB_2),
  noun: byLength(NOUN),
  sup: byLength(SUPERLATIVE),
  der: byLength(DERIVATIONAL),
};

function rvIndex(word: string): number {
  for (let i = 0; i < word.length; i++) if (VOWELS.includes(word[i]!)) return i + 1;
  return word.length;
}

/** Removes the longest matching suffix; group-1 suffixes need a preceding а/я. */
function strip(rv: string, group1: string[], group2: string[] = []): string | null {
  for (const s of group2) if (rv.endsWith(s)) return rv.slice(0, -s.length);
  for (const s of group1) {
    if (rv.endsWith(s)) {
      const prev = rv[rv.length - s.length - 1];
      if (prev === 'а' || prev === 'я') return rv.slice(0, -s.length);
    }
  }
  return null;
}

function stripAny(rv: string, list: string[]): string | null {
  for (const s of list) if (rv.endsWith(s)) return rv.slice(0, -s.length);
  return null;
}

export function stemRu(input: string): string {
  const word = input.toLowerCase().replace(/ё/g, 'е');
  if (word.length < 4 || !/[а-я]/.test(word)) return word;
  const idx = rvIndex(word);
  const pre = word.slice(0, idx);
  let rv = word.slice(idx);

  const pg = strip(rv, L.pg1, L.pg2);
  if (pg !== null) {
    rv = pg;
  } else {
    rv = stripAny(rv, L.refl) ?? rv;
    const adj = stripAny(rv, L.adj);
    if (adj !== null) {
      rv = strip(adj, L.p1, L.p2) ?? adj;
    } else {
      const verb = strip(rv, L.v1, L.v2);
      if (verb !== null) rv = verb;
      else rv = stripAny(rv, L.noun) ?? rv;
    }
  }
  if (rv.endsWith('и')) rv = rv.slice(0, -1);
  const der = stripAny(rv, L.der);
  if (der !== null && der.length > 1) rv = der;
  if (rv.endsWith('нн')) rv = rv.slice(0, -1);
  else rv = stripAny(rv, L.sup) ?? (rv.endsWith('ь') ? rv.slice(0, -1) : rv);
  const out = pre + rv;
  return out.length >= 2 ? out : word;
}

/** Very light English stemmer for mixed-language bases. */
export function stemEn(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 4) return w;
  for (const s of ['ations', 'ation', 'ings', 'ing', 'ies', 'edly', 'ed', 'es', 's']) {
    if (w.endsWith(s) && w.length - s.length >= 3) return s === 'ies' ? w.slice(0, -3) + 'y' : w.slice(0, -s.length);
  }
  return w;
}
