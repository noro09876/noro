export type PlatformId = 'telegram' | 'vk' | 'dzen' | 'email' | 'youtube' | 'shorts';
export type Tone = 'friendly' | 'expert' | 'bold' | 'formal';
export type ItemStatus = 'idea' | 'draft' | 'review' | 'ready' | 'published';

export const TONE_LABELS: Record<Tone, string> = { friendly: 'Дружелюбный', expert: 'Экспертный', bold: 'Смелый', formal: 'Официальный' };
export const STATUS_LABELS: Record<ItemStatus, string> = { idea: 'Идея', draft: 'Черновик', review: 'На проверке', ready: 'Готово', published: 'Опубликовано' };
export const STATUSES: ItemStatus[] = ['idea', 'draft', 'review', 'ready', 'published'];

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  kind: string;
  /** hard limit of the body in characters */
  maxChars: number;
  /** comfortable range for the body */
  recommended: [number, number];
  titleMax?: number;
  /** default publishing offset in days from the project start */
  offsetDays: number;
}

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  telegram: { id: 'telegram', label: 'Telegram', kind: 'Пост в канал', maxChars: 4096, recommended: [500, 1500], offsetDays: 0 },
  vk: { id: 'vk', label: 'VK', kind: 'Пост в сообщество', maxChars: 16384, recommended: [600, 2000], offsetDays: 1 },
  dzen: { id: 'dzen', label: 'Дзен', kind: 'Статья', maxChars: 100000, recommended: [2000, 8000], titleMax: 120, offsetDays: 3 },
  email: { id: 'email', label: 'Email', kind: 'Рассылка', maxChars: 20000, recommended: [600, 2500], titleMax: 60, offsetDays: 2 },
  youtube: { id: 'youtube', label: 'YouTube', kind: 'План видео и описание', maxChars: 5000, recommended: [800, 3000], titleMax: 100, offsetDays: 5 },
  shorts: { id: 'shorts', label: 'Shorts / Reels / Клипы', kind: 'Сценарий до 60 секунд', maxChars: 1200, recommended: [300, 900], offsetDays: 4 },
};
export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

export interface Analysis {
  theses: string[];
  keywords: string[];
  facts: string[];
  questions: string[];
  headlines: string[];
  ctas: string[];
  description: string;
  /** first sentence of the last paragraph — usually the author's conclusion */
  conclusion: string;
  paragraphs: string[];
  stats: { chars: number; words: number; sentences: number; readingMinutes: number };
}

export interface ItemVersion {
  at: number;
  title: string;
  body: string;
  label: string;
}

export interface ContentItem {
  id: string;
  platform: PlatformId;
  title: string;
  body: string;
  status: ItemStatus;
  /** ISO day YYYY-MM-DD */
  date: string;
  versions: ItemVersion[];
  edited: boolean;
}

export interface Project {
  id: string;
  name: string;
  topic: string;
  audience: string;
  tone: Tone;
  platforms: PlatformId[];
  source: string;
  startDate: string;
  createdAt: number;
  updatedAt: number;
  analysis: Analysis | null;
  items: ContentItem[];
  variant: number;
}
