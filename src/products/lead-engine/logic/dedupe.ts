import { normalizeEmail, normalizePhone } from '../../../lib/validators';
import { companyKey } from './normalize';
import { LEAD_FIELDS, type Lead } from './types';

export interface DedupeRules {
  email: boolean;
  phone: boolean;
  companyAndName: boolean;
}

export const DEFAULT_DEDUPE: DedupeRules = { email: true, phone: true, companyAndName: true };

export interface DuplicateGroup {
  ids: string[];
  reasons: string[];
}

/** Groups leads that share an email, phone or company+name (union-find, transitive). */
export function findDuplicateGroups(leads: Lead[], rules: DedupeRules): DuplicateGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const l of leads) parent.set(l.id, l.id);

  const reasons = new Map<string, Set<string>>();
  const addReason = (id: string, r: string) => {
    const s = reasons.get(id) ?? new Set<string>();
    s.add(r);
    reasons.set(id, s);
  };

  const index = (keyFn: (l: Lead) => string, label: string) => {
    const seen = new Map<string, string>();
    for (const l of leads) {
      const k = keyFn(l);
      if (!k) continue;
      const prev = seen.get(k);
      if (prev) {
        union(prev, l.id);
        addReason(prev, label);
        addReason(l.id, label);
      } else seen.set(k, l.id);
    }
  };

  if (rules.email) index((l) => normalizeEmail(l.fields.email), 'одинаковый email');
  if (rules.phone) index((l) => normalizePhone(l.fields.phone), 'одинаковый телефон');
  if (rules.companyAndName)
    index((l) => {
      const c = companyKey(l.fields.company);
      const n = l.fields.name.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я]/g, '');
      return c && n ? `${c}|${n}` : '';
    }, 'та же компания и имя');

  const groups = new Map<string, string[]>();
  for (const l of leads) {
    const r = find(l.id);
    const g = groups.get(r) ?? [];
    g.push(l.id);
    groups.set(r, g);
  }
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ({ ids, reasons: [...new Set(ids.flatMap((id) => [...(reasons.get(id) ?? [])]))] }));
}

function completeness(l: Lead): number {
  return LEAD_FIELDS.reduce((n, f) => n + (l.fields[f].trim() ? 1 : 0), 0);
}

/**
 * Merges a duplicate group: the most complete record wins, empty fields are
 * filled from the others, notes are concatenated, history is kept.
 */
export function mergeGroup(group: Lead[], now = Date.now()): Lead {
  if (group.length === 0) throw new Error('empty group');
  const sorted = [...group].sort((a, b) => completeness(b) - completeness(a));
  const primary = sorted[0]!;
  const fields = { ...primary.fields };
  for (const other of sorted.slice(1)) {
    for (const f of LEAD_FIELDS) {
      if (f === 'notes') continue;
      if (!fields[f].trim() && other.fields[f].trim()) fields[f] = other.fields[f];
    }
  }
  const notes = [...new Set(sorted.map((l) => l.fields.notes.trim()).filter(Boolean))];
  fields.notes = notes.join(' · ');
  const extra = Object.assign({}, ...[...sorted].reverse().map((l) => l.extra)) as Record<string, string>;
  const history = sorted.flatMap((l) => l.history).sort((a, b) => a.at - b.at);
  history.push({ at: now, type: 'merge', text: `Объединено записей: ${group.length}` });
  return {
    ...primary,
    fields,
    extra,
    history,
    mergedCount: sorted.reduce((n, l) => n + 1 + l.mergedCount, 0) - 1,
  };
}

/** Applies merging to all groups; returns the new lead list (order preserved by primary position). */
export function mergeAllDuplicates(leads: Lead[], groups: DuplicateGroup[], now = Date.now()): Lead[] {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const replaced = new Map<string, Lead>();
  const removed = new Set<string>();
  for (const g of groups) {
    const merged = mergeGroup(g.ids.map((id) => byId.get(id)!).filter(Boolean), now);
    for (const id of g.ids) removed.add(id);
    replaced.set(merged.id, merged);
    removed.delete(merged.id);
  }
  return leads.filter((l) => !removed.has(l.id)).map((l) => replaced.get(l.id) ?? l);
}
