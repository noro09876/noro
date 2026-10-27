import type { CheckResult, ContentKind, PostStatus, Role, VersionSource, CampaignBrief, StrategyData, PlanEntry, BrandVisual } from '../../shared/types';
import type { PlatformId, PlatformSpec } from '../../shared/platforms';
import type { RuleConfig } from '../../shared/automation';

export type { CheckResult, ContentKind, PostStatus, Role, VersionSource, PlatformId, RuleConfig };

export interface Me {
  user: { id: string; email: string; name: string } | null;
  workspaces: { id: string; name: string; isDemo: boolean; role: Role }[];
  signupOpen?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  isDemo: boolean;
  role: Role;
  settings: Record<string, unknown>;
  limits: { dailyGenerationLimit: number; dailyRenderLimit: number; maxItemsPerCampaign: number; timezone?: string };
  used: { llm: number; render: number; tts: number; image: number };
}

export interface Brand {
  id: string;
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
  isDemo: boolean;
}

export interface Asset {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'subtitle' | 'archive' | 'other';
  role: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  source: VersionSource;
  meta: Record<string, unknown>;
  isDemo: boolean;
  url: string;
  versionId: string | null;
}

export interface QualityCheck {
  id: string;
  versionId: string;
  results: CheckResult[];
  passed: boolean;
  createdAt: string;
}

export interface ItemRow {
  id: string;
  campaignId: string;
  kind: ContentKind;
  title: string;
  pillar: string | null;
  status: 'draft' | 'generating' | 'ready' | 'in_review' | 'approved' | 'rejected' | 'failed';
  plannedAt: string | null;
  platforms: PlatformId[];
  currentVersionId: string | null;
  parentItemId: string | null;
  lastError: string | null;
  isDemo: boolean;
  updatedAt: string;
  version: { id: string; version: number; data: Record<string, unknown>; source: VersionSource; model?: string | null } | null;
  assets: Asset[];
  check?: QualityCheck | null;
  campaignTitle?: string;
}

export interface Version {
  id: string;
  version: number;
  data: Record<string, unknown>;
  source: VersionSource;
  provider: string | null;
  model: string | null;
  note: string | null;
  createdAt: string;
  assets: Asset[];
  check: QualityCheck | null;
}

export interface Post {
  id: string;
  campaignId: string;
  itemId: string;
  versionId: string;
  platform: PlatformId;
  accountId: string | null;
  title: string | null;
  text: string;
  hashtags: string[];
  assetIds: string[];
  status: PostStatus;
  scheduledAt: string | null;
  timezone: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  externalId: string | null;
  externalUrl: string | null;
  publishedAt: string | null;
  testMode: boolean;
  meta: Record<string, unknown>;
  isDemo: boolean;
  item?: { id: string; title: string; kind: ContentKind; status: string } | null;
}

export interface StageView {
  stage: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'needs_input' | 'skipped';
  detail: string;
  error?: string | null;
  done: number;
  total: number;
}

export interface Campaign {
  id: string;
  brandId: string;
  title: string;
  brief: CampaignBrief;
  strategy: StrategyData | null;
  plan: PlanEntry[] | null;
  strategySource: VersionSource | null;
  isDemo: boolean;
  ruleId: string | null;
  createdAt: string;
  items?: Record<string, number>;
}

export interface Account {
  id: string;
  platform: PlatformId;
  displayName: string;
  externalId: string | null;
  status: 'connected' | 'expired' | 'error' | 'disconnected';
  scopes: string[];
  tokenExpiresAt: string | null;
  meta: Record<string, unknown>;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface PlatformInfo extends PlatformSpec {
  connect: 'token' | 'oauth' | 'manual';
  fields: { key: string; label: string; placeholder?: string; secret?: boolean; help?: string }[];
  appFields: { key: string; label: string; secret?: boolean }[];
  setupSteps: string[];
  multiTarget: boolean;
  hasMetrics: boolean;
}

export interface ProviderInfo {
  id: string;
  kind: 'llm' | 'image' | 'tts';
  name: string;
  setup: string;
  docsUrl?: string;
  defaultModel?: string;
  models?: string[];
  needsKey: boolean;
  local?: boolean;
  testOnly?: boolean;
  fields: { key: string; label: string; placeholder?: string; secret?: boolean; required?: boolean; help?: string }[];
  pricing?: string;
  available: boolean;
}

export interface ProviderConfig {
  id: string;
  kind: 'llm' | 'image' | 'tts';
  provider: string;
  label: string;
  model: string;
  settings: Record<string, string>;
  hasKey: boolean;
  keyHint: string | null;
  isDefault: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: string | null;
}

export interface AuditRow {
  id: string;
  actorType: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  level: 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
}

export interface Rule {
  id: string;
  brandId: string;
  name: string;
  enabled: boolean;
  config: RuleConfig;
  status: string;
  pausedReason: string | null;
  consecutiveFailures: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runsToday: number;
  runs: number;
}
