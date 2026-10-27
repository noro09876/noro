import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ['owner', 'admin', 'editor', 'approver', 'viewer']);
export const stageEnum = pgEnum('stage', ['idea', 'strategy', 'generation', 'design', 'review', 'approval', 'scheduling', 'publishing', 'analytics']);
export const stageStatusEnum = pgEnum('stage_status', ['pending', 'running', 'done', 'failed', 'needs_input', 'skipped']);
export const kindEnum = pgEnum('content_kind', ['post', 'carousel', 'graphic', 'video_script', 'video']);
export const itemStatusEnum = pgEnum('item_status', ['draft', 'generating', 'ready', 'in_review', 'approved', 'rejected', 'failed']);
export const postStatusEnum = pgEnum('post_status', ['draft', 'ready', 'scheduled', 'publishing', 'published', 'failed', 'manual_pending', 'manual_done', 'cancelled']);
export const sourceEnum = pgEnum('version_source', ['ai', 'manual', 'demo', 'template', 'test']);
export const providerKindEnum = pgEnum('provider_kind', ['llm', 'image', 'tts']);
export const accountStatusEnum = pgEnum('account_status', ['connected', 'expired', 'error', 'disconnected']);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'cancelled']);
export const assetKindEnum = pgEnum('asset_kind', ['image', 'video', 'audio', 'subtitle', 'archive', 'other']);

/* ---------------- Identity ---------------- */

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)]);

export const sessions = pgTable('sessions', {
  /** sha256 of the cookie token; the raw token never touches the database. */
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  /** Limits and system parameters (see services/limits.ts for defaults). */
  settings: jsonb('settings').$type<WorkspaceSettings>().notNull().default({}),
  createdAt: createdAt(),
});

export interface WorkspaceSettings {
  dailyGenerationLimit?: number;
  dailyRenderLimit?: number;
  maxItemsPerCampaign?: number;
  timezone?: string;
  retentionDays?: number;
}

export const memberships = pgTable('memberships', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]);

/* ---------------- Brands ---------------- */

export const brands = pgTable('brands', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  product: text('product').notNull().default(''),
  audience: text('audience').notNull().default(''),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  tone: text('tone').notNull().default(''),
  vocabulary: jsonb('vocabulary').$type<{ preferred: string[]; avoid: string[] }>().notNull().default({ preferred: [], avoid: [] }),
  visual: jsonb('visual').$type<{ colors: { primary: string; accent: string; background: string; text: string }; fonts: { display: string; body: string }; style: string }>().notNull(),
  forbidden: jsonb('forbidden').$type<string[]>().notNull().default([]),
  examplesGood: jsonb('examples_good').$type<string[]>().notNull().default([]),
  examplesBad: jsonb('examples_bad').$type<string[]>().notNull().default([]),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('brands_ws_idx').on(t.workspaceId)]);

/* ---------------- Providers ---------------- */

export const providerConfigs = pgTable('provider_configs', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: providerKindEnum('kind').notNull(),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  model: text('model').notNull().default(''),
  settings: jsonb('settings').$type<Record<string, string>>().notNull().default({}),
  /** Encrypted API key (AES-256-GCM). Null for keyless local providers. */
  secretEnc: text('secret_enc'),
  secretHint: text('secret_hint'),
  isDefault: boolean('is_default').notNull().default(false),
  status: text('status').notNull().default('unchecked'),
  lastError: text('last_error'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('providers_ws_idx').on(t.workspaceId, t.kind)]);

/* ---------------- Campaigns & content ---------------- */

export const campaigns = pgTable('campaigns', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  brief: jsonb('brief').$type<import('../../shared/types').CampaignBrief>().notNull(),
  strategy: jsonb('strategy').$type<import('../../shared/types').StrategyData | null>(),
  plan: jsonb('plan').$type<import('../../shared/types').PlanEntry[] | null>(),
  strategySource: sourceEnum('strategy_source'),
  status: text('status').notNull().default('active'),
  isDemo: boolean('is_demo').notNull().default(false),
  /** Automation rule that created this campaign (null for manual campaigns). */
  ruleId: uuid('rule_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('campaigns_ws_idx').on(t.workspaceId)]);

export const pipelineStages = pgTable('pipeline_stages', {
  id: id(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  stage: stageEnum('stage').notNull(),
  status: stageStatusEnum('status').notNull().default('pending'),
  detail: text('detail'),
  error: text('error'),
  progress: integer('progress').notNull().default(0),
  total: integer('total').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('stages_campaign_stage_uq').on(t.campaignId, t.stage)]);

export const contentItems = pgTable('content_items', {
  id: id(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: kindEnum('kind').notNull(),
  title: text('title').notNull(),
  pillar: text('pillar'),
  status: itemStatusEnum('status').notNull().default('draft'),
  /** Plan slot this item came from (index into campaigns.plan). */
  planIndex: integer('plan_index'),
  plannedAt: timestamp('planned_at', { withTimezone: true }),
  platforms: jsonb('platforms').$type<string[]>().notNull().default([]),
  currentVersionId: uuid('current_version_id'),
  /** Script item a video was rendered from. */
  parentItemId: uuid('parent_item_id'),
  lastError: text('last_error'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('items_campaign_idx').on(t.campaignId), index('items_ws_status_idx').on(t.workspaceId, t.status)]);

export const contentVersions = pgTable('content_versions', {
  id: id(),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  source: sourceEnum('source').notNull(),
  provider: text('provider'),
  model: text('model'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('versions_item_version_uq').on(t.itemId, t.version)]);

export const assets = pgTable('assets', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => contentItems.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').references(() => contentVersions.id, { onDelete: 'set null' }),
  kind: assetKindEnum('kind').notNull(),
  role: text('role'), // slide-1, cover, voiceover, subtitles-vtt, final …
  mime: text('mime').notNull(),
  storageKey: text('storage_key').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  source: sourceEnum('source').notNull().default('template'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index('assets_item_idx').on(t.itemId), index('assets_version_idx').on(t.versionId)]);

export const qualityChecks = pgTable('quality_checks', {
  id: id(),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').references(() => contentVersions.id, { onDelete: 'cascade' }),
  results: jsonb('results').$type<import('../../shared/types').CheckResult[]>().notNull(),
  passed: boolean('passed').notNull(),
  createdAt: createdAt(),
}, (t) => [index('checks_item_idx').on(t.itemId)]);

export const approvals = pgTable('approvals', {
  id: id(),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => contentVersions.id, { onDelete: 'cascade' }),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  status: approvalStatusEnum('status').notNull().default('pending'),
  comment: text('comment'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('approvals_item_idx').on(t.itemId)]);

/* ---------------- Social ---------------- */

export const socialAccounts = pgTable('social_accounts', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  displayName: text('display_name').notNull(),
  externalId: text('external_id'),
  status: accountStatusEnum('status').notNull().default('connected'),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  /** Encrypted credential bundle: { accessToken, refreshToken?, botToken?, ... } */
  credentialsEnc: text('credentials_enc').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  /** Non-secret settings: chat id, group id, privacy level … */
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: createdAt(),
}, (t) => [index('accounts_ws_idx').on(t.workspaceId)]);

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  codeVerifier: text('code_verifier'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const platformPosts = pgTable('platform_posts', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  /** Version that was adapted; publishing always uses exactly this version. */
  versionId: uuid('version_id').notNull().references(() => contentVersions.id, { onDelete: 'restrict' }),
  platform: text('platform').notNull(),
  accountId: uuid('account_id').references(() => socialAccounts.id, { onDelete: 'set null' }),
  title: text('title'),
  text: text('text').notNull().default(''),
  hashtags: jsonb('hashtags').$type<string[]>().notNull().default([]),
  assetIds: jsonb('asset_ids').$type<string[]>().notNull().default([]),
  status: postStatusEnum('status').notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  timezone: text('timezone').notNull().default('Europe/Moscow'),
  /** Unique per (post, version, account). Publishing is skipped if a confirmed result exists. */
  idempotencyKey: text('idempotency_key').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(4),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastErrorCode: text('last_error_code'),
  externalId: text('external_id'),
  externalUrl: text('external_url'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  /** Explicit test publication (e.g. to a private test channel or SELF_ONLY). */
  testMode: boolean('test_mode').notNull().default(false),
  /** In-flight marker used to detect a crash between "sent" and "recorded". */
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('posts_idem_uq').on(t.idempotencyKey),
  index('posts_ws_sched_idx').on(t.workspaceId, t.scheduledAt),
  index('posts_status_idx').on(t.status),
]);

export const publishAttempts = pgTable('publish_attempts', {
  id: id(),
  postId: uuid('post_id').notNull().references(() => platformPosts.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(),
  outcome: text('outcome').notNull(), // success | error | skipped_duplicate | test
  errorCode: text('error_code'),
  message: text('message'),
  response: jsonb('response').$type<Record<string, unknown>>(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('attempts_post_idx').on(t.postId)]);

export const postMetrics = pgTable('post_metrics', {
  id: id(),
  postId: uuid('post_id').notNull().references(() => platformPosts.id, { onDelete: 'cascade' }),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
  /** Only values the platform actually returned. */
  values: jsonb('values').$type<Record<string, number>>().notNull(),
  /** Metrics the platform does not expose through its API, with a reason. */
  unavailable: jsonb('unavailable').$type<Record<string, string>>().notNull().default({}),
}, (t) => [index('metrics_post_idx').on(t.postId, t.collectedAt)]);

/* ---------------- Automation ---------------- */

export const automationRules = pgTable('automation_rules', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  config: jsonb('config').$type<import('../../shared/automation').RuleConfig>().notNull(),
  status: text('status').notNull().default('idle'),
  pausedReason: text('paused_reason'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  runsToday: integer('runs_today').notNull().default(0),
  runsDay: text('runs_day'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ---------------- Audit & usage ---------------- */

export const auditLog = pgTable('audit_log', {
  id: id(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  actorType: text('actor_type').notNull(), // user | worker | system
  actorId: text('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  level: text('level').notNull().default('info'), // info | warn | error
  message: text('message').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index('audit_ws_time_idx').on(t.workspaceId, t.createdAt)]);

export const usage = pgTable('usage', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // llm | image | tts | render
  provider: text('provider').notNull(),
  units: integer('units').notNull().default(1),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: createdAt(),
}, (t) => [index('usage_ws_time_idx').on(t.workspaceId, t.createdAt)]);

/** OAuth application credentials per platform (client id + encrypted secret), per workspace. */
export const integrationApps = pgTable('integration_apps', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  clientId: text('client_id').notNull(),
  secretEnc: text('secret_enc').notNull(),
  secretHint: text('secret_hint'),
  meta: jsonb('meta').$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('apps_ws_platform_uq').on(t.workspaceId, t.platform)]);
