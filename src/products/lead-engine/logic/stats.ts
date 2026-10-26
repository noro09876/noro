import { STATUSES, type Lead, type LeadField, type LeadStatus, type ScoreResult } from './types';

/** Funnel stages in order; "lost" is reported separately, not as a stage. */
export const FUNNEL_STAGES: LeadStatus[] = ['new', 'in_progress', 'contacted', 'qualified', 'won'];

export interface FunnelStage {
  status: LeadStatus;
  /** leads currently at this stage */
  current: number;
  /** leads that reached at least this stage (lost leads excluded) */
  reached: number;
}

export function funnel(leads: Lead[]): { stages: FunnelStage[]; lost: number } {
  const rank = (s: LeadStatus) => FUNNEL_STAGES.indexOf(s);
  const active = leads.filter((l) => l.status !== 'lost');
  const stages = FUNNEL_STAGES.map((status) => ({
    status,
    current: leads.filter((l) => l.status === status).length,
    reached: active.filter((l) => rank(l.status) >= rank(status)).length,
  }));
  return { stages, lost: leads.filter((l) => l.status === 'lost').length };
}

export interface GroupStat {
  key: string;
  count: number;
  avgScore: number;
  shareA: number;
}

export function groupStats(leads: Lead[], field: LeadField, scores: Map<string, ScoreResult>): GroupStat[] {
  const map = new Map<string, { count: number; sum: number; a: number }>();
  for (const l of leads) {
    const key = l.fields[field].trim() || 'Не указано';
    const s = scores.get(l.id);
    const g = map.get(key) ?? { count: 0, sum: 0, a: 0 };
    g.count++;
    g.sum += s?.score ?? 0;
    if (s?.tier === 'A') g.a++;
    map.set(key, g);
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, count: g.count, avgScore: g.sum / g.count, shareA: g.a / g.count }))
    .sort((a, b) => b.count - a.count);
}

export { STATUSES };
