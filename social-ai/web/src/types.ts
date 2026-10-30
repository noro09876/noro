export type Platform = 'telegram' | 'vk' | 'instagram' | 'x';
export type Format = 'carousel' | 'post' | 'article';
export type ContentStatus = 'draft' | 'ready' | 'scheduled' | 'published' | 'partial' | 'failed' | 'archived';
export type PubStatus = 'scheduled' | 'publishing' | 'retrying' | 'published' | 'failed' | 'blocked' | 'needs_check' | 'cancelled';

export interface Slide { title: string; text: string }
export interface Review { checkedAt: string; errors: string[]; warnings: string[] }
export interface MediaItem { id: number; idx: number; url: string; width: number; height: number; bytes: number }

export interface Publication {
  id: number; contentId: number; accountId: number; scheduledAt: string; status: PubStatus; attempts: number;
  nextAttemptAt: string | null; externalId: string | null; externalUrl: string | null; lastError: string | null; publishedAt: string | null;
  account?: { id: number; name: string; platform: Platform } | null;
  title?: string; format?: Format; isDemo?: boolean; accountName?: string; platform?: Platform;
}

export interface Content {
  id: number; brandId: number; topic: string; title: string; body: string; summary: string; cta: string; hashtags: string[];
  format: Format; platforms: Platform[]; slides: Slide[]; status: ContentStatus; source: 'agent' | 'manual'; model: string | null;
  isDemo: boolean; generationCount: number; review: Review | null; createdAt: string; updatedAt: string;
  media?: MediaItem[]; publications?: Publication[]; thumb?: string | null; slideCount?: number;
}

export interface FieldSpec { key: string; label: string; secret: boolean; required: boolean; placeholder?: string; help?: string }
export interface IntegrationInfo {
  platform: Platform; label: string; requirements: string[]; cost: string; credentialFields: FieldSpec[]; configFields: FieldSpec[];
  oauth: boolean; metricsNote: string;
}
export type AccountStatus = 'pending' | 'connected' | 'needs_auth' | 'no_permission' | 'payment_required' | 'error' | 'disabled';
export interface Account {
  id: number; brandId: number; platform: Platform; name: string; status: AccountStatus; config: Record<string, string>;
  settings: { enabled: boolean; autoPublish: boolean; maxPerDay: number; useHashtags: boolean };
  remoteName: string | null; lastCheckAt: string | null; lastError: string | null;
  credentials: Record<string, { set: boolean; hint: string }>; authorized?: boolean;
}

export interface PlanItem { id: number; date: string; topic: string; angle: string; format: Format; status: string; contentId: number | null; attempts: number; note: string | null }
export interface EventRow { id: number; ts: string; level: 'info' | 'warn' | 'error'; scope: string; message: string; content_id: number | null; account_id: number | null; publication_id: number | null }

export interface Settings {
  ai: { provider: 'ollama' | 'openai' | 'offline'; baseUrl: string; model: string; temperature: number; timeoutMs: number; allowRemote: boolean };
  agent: {
    enabled: boolean; brandId: number | null; planDays: number; postsPerDay: number; postTimes: string[]; formats: Format[]; platforms: Platform[];
    tone: string; style: string; constraints: string; autoApprove: boolean; leadHours: number; maxGenerationsPerDay: number;
    maxAttemptsPerItem: number; maxConsecutiveFailures: number;
  };
  images: { size: '1080x1350' | '1080x1080'; maxSlides: number; showCounter: boolean; jpegQuality: number };
  limits: { maxPostsPerDayPerAccount: number; maxPublishAttempts: number; duplicateWindowDays: number };
  schedule: { timezone: string };
  backup: { enabled: boolean; hourLocal: number; keep: number };
  security: { sessionHours: number };
}

export interface Brand {
  id: number; name: string; handle: string; audience: string; voice: string; accent: string; background: string;
  defaultHashtags: string[]; defaultCta: string; bannedWords: string[]; isDefault: boolean;
  topics: { id: number; name: string; description: string; enabled: number; weight: number }[];
}
