export const LEAD_FIELDS = ['name', 'company', 'title', 'email', 'phone', 'industry', 'companySize', 'source', 'city', 'website', 'notes'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export const FIELD_LABELS: Record<LeadField, string> = {
  name: 'Имя',
  company: 'Компания',
  title: 'Должность',
  email: 'Email',
  phone: 'Телефон',
  industry: 'Отрасль',
  companySize: 'Сотрудников',
  source: 'Источник',
  city: 'Город',
  website: 'Сайт',
  notes: 'Заметки',
};

export const STATUSES = ['new', 'in_progress', 'contacted', 'qualified', 'won', 'lost'] as const;
export type LeadStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  contacted: 'Связались',
  qualified: 'Квалифицирован',
  won: 'Сделка',
  lost: 'Отказ',
};

export type HistoryType = 'import' | 'normalize' | 'merge' | 'status' | 'edit' | 'task' | 'note' | 'message';

export interface HistoryEntry {
  at: number;
  type: HistoryType;
  text: string;
}

export interface Lead {
  id: string;
  fields: Record<LeadField, string>;
  /** Columns from the file that are not mapped to known fields. */
  extra: Record<string, string>;
  status: LeadStatus;
  nextAction: string;
  dueDate: string;
  history: HistoryEntry[];
  /** How many records were merged into this one. */
  mergedCount: number;
}

export type IssueKind =
  | 'no_contact'
  | 'invalid_email'
  | 'invalid_phone'
  | 'free_email'
  | 'missing_name'
  | 'missing_company'
  | 'duplicate'
  | 'unnormalized';

export interface Issue {
  leadId: string;
  kind: IssueKind;
  field?: LeadField;
  message: string;
}

export type RuleOperator = 'contains_any' | 'equals' | 'not_empty' | 'empty' | 'number_gte' | 'number_lte' | 'corporate_email';

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  contains_any: 'содержит одно из',
  equals: 'равно',
  not_empty: 'заполнено',
  empty: 'не заполнено',
  number_gte: 'число ≥',
  number_lte: 'число ≤',
  corporate_email: 'корпоративный домен',
};

export interface ScoringRule {
  id: string;
  label: string;
  field: LeadField;
  operator: RuleOperator;
  /** Comma-separated list for contains_any; number for comparisons. */
  value: string;
  points: number;
  enabled: boolean;
}

export type Tier = 'A' | 'B' | 'C';

export interface ScoringConfig {
  rules: ScoringRule[];
  /** score ≥ a → A, ≥ b → B, otherwise C */
  thresholds: { a: number; b: number };
}

export interface Factor {
  ruleId: string;
  label: string;
  points: number;
}

export interface ScoreResult {
  score: number;
  tier: Tier;
  factors: Factor[];
}
