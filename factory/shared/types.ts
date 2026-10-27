import type { PlatformId } from './platforms';

/** The content journey, shown as the pipeline rail across the product. */
export const STAGES = [
  'idea',
  'strategy',
  'generation',
  'design',
  'review',
  'approval',
  'scheduling',
  'publishing',
  'analytics',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  idea: 'Идея',
  strategy: 'Стратегия',
  generation: 'Генерация',
  design: 'Дизайн',
  review: 'Проверка',
  approval: 'Согласование',
  scheduling: 'Планирование',
  publishing: 'Публикация',
  analytics: 'Аналитика',
};

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'needs_input' | 'skipped';

export const CONTENT_KINDS = ['post', 'carousel', 'graphic', 'video_script', 'video'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const KIND_LABEL: Record<ContentKind, string> = {
  post: 'Пост',
  carousel: 'Карусель',
  graphic: 'Графика',
  video_script: 'Сценарий видео',
  video: 'Видео',
};

export type ItemStatus =
  | 'draft'
  | 'generating'
  | 'ready'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'failed';

export type PostStatus =
  | 'draft'
  | 'ready'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'manual_pending'
  | 'manual_done'
  | 'cancelled';

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Черновик',
  ready: 'Готово к планированию',
  scheduled: 'Запланировано',
  publishing: 'Публикуется',
  published: 'Опубликовано',
  failed: 'Ошибка',
  manual_pending: 'Ждёт ручной публикации',
  manual_done: 'Размещено вручную',
  cancelled: 'Отменено',
};

export type VersionSource = 'ai' | 'manual' | 'demo' | 'template' | 'test';

export const SOURCE_LABEL: Record<VersionSource, string> = {
  ai: 'Сгенерировано моделью',
  manual: 'Отредактировано вручную',
  demo: 'Демо-материал',
  template: 'Шаблонный рендер',
  test: 'Тестовый провайдер',
};

/* ---------- Brief and strategy ---------- */

export interface CampaignBrief {
  task: string;
  audience: string;
  goal: string;
  platforms: PlatformId[];
  formats: ContentKind[];
  /** Posts per week. */
  frequency: number;
  constraints: string;
  startDate: string; // YYYY-MM-DD
  weeks: number;
  timezone: string;
}

export interface StrategyData {
  summary: string;
  positioning: string;
  pillars: { name: string; description: string }[];
  keyMessages: string[];
  audienceInsights: string[];
  tone: string;
  kpis: string[];
}

export interface PlanEntry {
  day: number; // offset from start date
  time: string; // HH:MM in campaign timezone
  kind: ContentKind;
  pillar: string;
  topic: string;
  angle: string;
  platforms: PlatformId[];
}

/* ---------- Content payloads (stored in content_versions.data) ---------- */

export interface PostData {
  headline: string;
  body: string;
  cta: string;
  hashtags: string[];
  visualBrief?: string;
}

export interface Slide {
  kicker?: string;
  title: string;
  body: string;
  /** Optional structured visual: ui | chart | steps | quote | stat */
  visual?: SlideVisual;
}

export type SlideVisual =
  | { type: 'stat'; value: string; label: string }
  | { type: 'steps'; items: string[] }
  | { type: 'chart'; points: number[]; label: string }
  | { type: 'ui'; title: string; rows: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }[] }
  | { type: 'quote'; text: string; author: string };

export interface CarouselData {
  title: string;
  caption: string;
  hashtags: string[];
  slides: Slide[];
}

export interface GraphicData {
  headline: string;
  subline: string;
  caption: string;
  visual: SlideVisual;
  /** Optional AI image prompt when an image provider is configured. */
  imagePrompt?: string;
}

export type SceneKind = 'hook' | 'problem' | 'ui' | 'chart' | 'feature' | 'stat' | 'steps' | 'cta';

export interface Scene {
  id: string;
  kind: SceneKind;
  /** On-screen headline (short). */
  title: string;
  /** Supporting on-screen text. */
  text?: string;
  /** Narration for this scene (voiceover + subtitles). */
  voiceover: string;
  /** Requested duration in seconds; final duration follows the voiceover length. */
  durationSec: number;
  visual?: SlideVisual;
  transition?: 'slide' | 'fade' | 'wipe' | 'zoom';
}

export interface VideoScriptData {
  title: string;
  hook: string;
  scenes: Scene[];
  caption: string;
  hashtags: string[];
  musicMood?: string;
}

export interface VideoData extends VideoScriptData {
  /** Resolved timings after TTS. */
  timeline?: { sceneId: string; fromMs: number; durationMs: number; audioKey?: string }[];
  aspect: '9:16' | '1:1' | '16:9';
  voice?: { provider: string; voice: string };
}

export type ContentData = PostData | CarouselData | GraphicData | VideoScriptData | VideoData;

/* ---------- Brand ---------- */

export interface BrandVisual {
  colors: { primary: string; accent: string; background: string; text: string };
  fonts: { display: string; body: string };
  style: string;
}

export interface BrandProfile {
  name: string;
  description: string;
  product: string;
  audience: string;
  goals: string[];
  tone: string;
  vocabulary: { preferred: string[]; avoid: string[] };
  visual: BrandVisual;
  forbidden: string[];
  examplesGood: string[];
  examplesBad: string[];
}

/* ---------- Quality ---------- */

export type CheckLevel = 'ok' | 'warning' | 'error';

export interface CheckResult {
  code: string;
  level: CheckLevel;
  message: string;
  platform?: PlatformId;
}

export const ROLES = ['owner', 'admin', 'editor', 'approver', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  editor: 'Редактор',
  approver: 'Согласующий',
  viewer: 'Наблюдатель',
};
