import { uid } from '../../../lib/id';
import type { Table } from '../../../lib/csv';
import { LEAD_FIELDS, type Lead, type LeadField } from './types';

export function emptyFields(): Record<LeadField, string> {
  return Object.fromEntries(LEAD_FIELDS.map((f) => [f, ''])) as Record<LeadField, string>;
}

/** Builds Lead records from an imported table using the column mapping. */
export function leadsFromTable(table: Table, mapping: Record<LeadField, string>, now = Date.now()): Lead[] {
  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
  return table.rows
    .map((row) => {
      const fields = emptyFields();
      for (const f of LEAD_FIELDS) {
        const h = mapping[f];
        if (h) fields[f] = (row[h] ?? '').trim();
      }
      const extra: Record<string, string> = {};
      for (const h of table.headers) if (!mappedHeaders.has(h) && row[h]) extra[h] = row[h]!;
      return {
        id: uid('l'),
        fields,
        extra,
        status: 'new' as const,
        nextAction: '',
        dueDate: '',
        history: [{ at: now, type: 'import' as const, text: 'Импортирован из файла' }],
        mergedCount: 0,
      };
    })
    .filter((l) => LEAD_FIELDS.some((f) => l.fields[f] !== ''));
}

export function searchLeads(leads: Lead[], query: string): Lead[] {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е');
  if (!q) return leads;
  const parts = q.split(/\s+/);
  return leads.filter((l) => {
    const hay = (Object.values(l.fields).join(' ') + ' ' + Object.values(l.extra).join(' ')).toLowerCase().replace(/ё/g, 'е');
    return parts.every((p) => hay.includes(p));
  });
}
