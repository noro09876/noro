export interface Article {
  id: string;
  title: string;
  body: string;
  category: string;
  updatedAt: number;
}

export type Tone = 'friendly' | 'formal';

export interface SupportSettings {
  greeting: string;
  signature: string;
  tone: Tone;
  /** 0..1 — minimum share of the question's meaningful terms that must be covered by sources */
  threshold: number;
  maxSources: number;
  escalationKeywords: string[];
  stopTopics: string[];
  /** lines like "вернуть = возврат, вернуть деньги" */
  synonyms: string[];
  useModel: boolean;
}

export type Priority = 'high' | 'medium' | 'low';

export interface Classification {
  category: string;
  categoryReasons: string[];
  priority: Priority;
  priorityReasons: string[];
}

export interface SourceRef {
  articleId: string;
  title: string;
  snippet: string;
  score: number;
  coverage: number;
}

export type AnswerKind = 'answer' | 'insufficient' | 'escalate' | 'blocked';

export interface ComposedAnswer {
  kind: AnswerKind;
  text: string;
  sources: SourceRef[];
  confidence: number;
  engine: 'local' | 'model';
  note?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot' | 'operator';
  text: string;
  at: number;
  answer?: ComposedAnswer;
  classification?: Classification;
  /** ticket created for this bot answer, if any */
  ticketId?: string;
}

export interface Conversation {
  id: string;
  startedAt: number;
  messages: ChatMessage[];
}

export type TicketStatus = 'open' | 'pending' | 'resolved';

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = { open: 'Новая', pending: 'В работе', resolved: 'Решена' };
export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };

export interface Ticket {
  id: string;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  question: string;
  classification: Classification;
  status: TicketStatus;
  /** draft prepared by the system, editable by the operator */
  draft: string;
  sentAnswer?: string;
  reason: string;
  confidence: number;
}
