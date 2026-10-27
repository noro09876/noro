CREATE TYPE "public"."account_status" AS ENUM('connected', 'expired', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('image', 'video', 'audio', 'subtitle', 'archive', 'other');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('draft', 'generating', 'ready', 'in_review', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."content_kind" AS ENUM('post', 'carousel', 'graphic', 'video_script', 'video');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'ready', 'scheduled', 'publishing', 'published', 'failed', 'manual_pending', 'manual_done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('llm', 'image', 'tts');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'editor', 'approver', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."version_source" AS ENUM('ai', 'manual', 'demo', 'template', 'test');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('idea', 'strategy', 'generation', 'design', 'review', 'approval', 'scheduling', 'publishing', 'analytics');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('pending', 'running', 'done', 'failed', 'needs_input', 'skipped');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"item_id" uuid,
	"version_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"role" text,
	"mime" text NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"source" "version_source" DEFAULT 'template' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"paused_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"runs_today" integer DEFAULT 0 NOT NULL,
	"runs_day" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"product" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"vocabulary" jsonb DEFAULT '{"preferred":[],"avoid":[]}'::jsonb NOT NULL,
	"visual" jsonb NOT NULL,
	"forbidden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples_good" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples_bad" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"title" text NOT NULL,
	"brief" jsonb NOT NULL,
	"strategy" jsonb,
	"plan" jsonb,
	"strategy_source" "version_source",
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "content_kind" NOT NULL,
	"title" text NOT NULL,
	"pillar" text,
	"status" "item_status" DEFAULT 'draft' NOT NULL,
	"plan_index" integer,
	"planned_at" timestamp with time zone,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_version_id" uuid,
	"parent_item_id" uuid,
	"last_error" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"source" "version_source" NOT NULL,
	"provider" text,
	"model" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"code_verifier" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"stage" "stage" NOT NULL,
	"status" "stage_status" DEFAULT 'pending' NOT NULL,
	"detail" text,
	"error" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"account_id" uuid,
	"title" text,
	"text" text DEFAULT '' NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 4 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"last_error_code" text,
	"external_id" text,
	"external_url" text,
	"published_at" timestamp with time zone,
	"test_mode" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"values" jsonb NOT NULL,
	"unavailable" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_enc" text,
	"secret_hint" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'unchecked' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"message" text,
	"response" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version_id" uuid,
	"results" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"display_name" text NOT NULL,
	"external_id" text,
	"status" "account_status" DEFAULT 'connected' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credentials_enc" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_posts" ADD CONSTRAINT "platform_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_posts" ADD CONSTRAINT "platform_posts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_posts" ADD CONSTRAINT "platform_posts_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_posts" ADD CONSTRAINT "platform_posts_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_posts" ADD CONSTRAINT "platform_posts_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_post_id_platform_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."platform_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_post_id_platform_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."platform_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_item_idx" ON "approvals" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "assets_item_idx" ON "assets" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "assets_version_idx" ON "assets" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "audit_ws_time_idx" ON "audit_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "brands_ws_idx" ON "brands" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "campaigns_ws_idx" ON "campaigns" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "items_campaign_idx" ON "content_items" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "items_ws_status_idx" ON "content_items" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_item_version_uq" ON "content_versions" USING btree ("item_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_campaign_stage_uq" ON "pipeline_stages" USING btree ("campaign_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_idem_uq" ON "platform_posts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "posts_ws_sched_idx" ON "platform_posts" USING btree ("workspace_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "posts_status_idx" ON "platform_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "metrics_post_idx" ON "post_metrics" USING btree ("post_id","collected_at");--> statement-breakpoint
CREATE INDEX "providers_ws_idx" ON "provider_configs" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "attempts_post_idx" ON "publish_attempts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "checks_item_idx" ON "quality_checks" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_ws_idx" ON "social_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "usage_ws_time_idx" ON "usage" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));