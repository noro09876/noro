import type { Conversation, Priority, Ticket } from './types';

export interface SupportStats {
  questions: number;
  answered: number;
  insufficient: number;
  escalated: number;
  blocked: number;
  autoShare: number;
  byCategory: Array<{ label: string; value: number }>;
  byPriority: Record<Priority, number>;
  ticketsOpen: number;
  ticketsResolved: number;
  topSources: Array<{ label: string; value: number }>;
  unanswered: string[];
}

export function computeStats(conversations: Conversation[], tickets: Ticket[]): SupportStats {
  let questions = 0;
  let answered = 0;
  let insufficient = 0;
  let escalated = 0;
  let blocked = 0;
  const cat = new Map<string, number>();
  const src = new Map<string, number>();
  const byPriority: Record<Priority, number> = { high: 0, medium: 0, low: 0 };
  const unanswered: string[] = [];
  for (const c of conversations) {
    for (let i = 0; i < c.messages.length; i++) {
      const m = c.messages[i]!;
      if (m.role === 'user') {
        questions++;
        if (m.classification) {
          cat.set(m.classification.category, (cat.get(m.classification.category) ?? 0) + 1);
          byPriority[m.classification.priority]++;
        }
        continue;
      }
      if (m.role !== 'bot' || !m.answer) continue;
      const k = m.answer.kind;
      if (k === 'answer') answered++;
      else if (k === 'insufficient') {
        insufficient++;
        const q = c.messages[i - 1];
        if (q?.role === 'user') unanswered.push(q.text);
      } else if (k === 'escalate') escalated++;
      else blocked++;
      if (k === 'answer') for (const s of m.answer.sources) src.set(s.title, (src.get(s.title) ?? 0) + 1);
    }
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const total = answered + insufficient + escalated + blocked;
  return {
    questions,
    answered,
    insufficient,
    escalated,
    blocked,
    autoShare: total ? answered / total : 0,
    byCategory: sorted(cat),
    byPriority,
    ticketsOpen: tickets.filter((t) => t.status !== 'resolved').length,
    ticketsResolved: tickets.filter((t) => t.status === 'resolved').length,
    topSources: sorted(src).slice(0, 8),
    unanswered: [...new Set(unanswered)].slice(-10).reverse(),
  };
}
