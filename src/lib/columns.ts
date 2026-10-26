/** Header auto-detection shared by tabular products. */

export function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

/**
 * Maps each target field to the best matching header (or '' if none).
 * Exact synonym match beats prefix/contains; each header is used once.
 */
export function detectColumns<K extends string>(headers: string[], synonyms: Record<K, readonly string[]>): Record<K, string> {
  const normalized = headers.map((h) => ({ h, n: normHeader(h) }));
  const used = new Set<string>();
  const result = {} as Record<K, string>;
  const keys = Object.keys(synonyms) as K[];
  const candidates: Array<{ key: K; header: string; score: number }> = [];
  for (const key of keys) {
    for (const { h, n } of normalized) {
      let best = 0;
      for (const syn of synonyms[key]) {
        const s = normHeader(syn);
        if (n === s) best = Math.max(best, 100);
        else if (n.startsWith(s + ' ') || n.endsWith(' ' + s)) best = Math.max(best, 70);
        else if (s.length >= 4 && n.includes(s)) best = Math.max(best, 50);
      }
      if (best > 0) candidates.push({ key, header: h, score: best });
    }
  }
  candidates.sort((a, b) => b.score - a.score || keys.indexOf(a.key) - keys.indexOf(b.key));
  for (const key of keys) result[key] = '';
  const assigned = new Set<K>();
  for (const c of candidates) {
    if (assigned.has(c.key) || used.has(c.header)) continue;
    result[c.key] = c.header;
    assigned.add(c.key);
    used.add(c.header);
  }
  return result;
}
