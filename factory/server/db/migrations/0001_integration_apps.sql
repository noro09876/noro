CREATE TABLE "integration_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"client_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"secret_hint" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_apps" ADD CONSTRAINT "integration_apps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apps_ws_platform_uq" ON "integration_apps" USING btree ("workspace_id","platform");