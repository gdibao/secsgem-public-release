CREATE TABLE IF NOT EXISTS "platform_plugins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "display_name" text NOT NULL,
  "icon" text NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "author" text DEFAULT 'ComHub' NOT NULL,
  "runtime_type" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "billing" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_plugins_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_plugins_status_category_sort_idx"
  ON "platform_plugins" ("status", "category", "sort_order");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "platform_plugins"("id") ON DELETE cascade,
  "version" text NOT NULL,
  "config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "changelog" text DEFAULT '' NOT NULL,
  "published_at" timestamp with time zone,
  "rollback_source_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_plugin_versions_plugin_id_version_idx"
  ON "platform_plugin_versions" ("plugin_id", "version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "platform_plugins"("id") ON DELETE cascade,
  "version_id" uuid NOT NULL REFERENCES "platform_plugin_versions"("id") ON DELETE cascade,
  "action_key" text NOT NULL,
  "runtime_type" text NOT NULL,
  "name" text NOT NULL,
  "input_schema" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
  "output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "module_multiplier" integer DEFAULT 1 NOT NULL,
  "runtime_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_plugin_actions_plugin_id_version_id_action_key_idx"
  ON "platform_plugin_actions" ("plugin_id", "version_id", "action_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_plan_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "platform_plugins"("id") ON DELETE cascade,
  "plan" text NOT NULL,
  "visible" boolean DEFAULT false NOT NULL,
  "installable" boolean DEFAULT false NOT NULL,
  "runnable" boolean DEFAULT false NOT NULL,
  "free_quota_credits" integer DEFAULT 0 NOT NULL,
  "discount_percent" integer DEFAULT 0 NOT NULL,
  "forced_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_plugin_plan_entitlements_plugin_id_plan_idx"
  ON "platform_plugin_plan_entitlements" ("plugin_id", "plan");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "platform_plugins"("id") ON DELETE cascade,
  "scope" text NOT NULL,
  "secret_key" text NOT NULL,
  "encrypted_value" text NOT NULL,
  "masked_value" text NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "updated_by" text REFERENCES "users"("id") ON DELETE set null,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "platform_plugins"("id") ON DELETE cascade,
  "version_id" uuid NOT NULL REFERENCES "platform_plugin_versions"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" text DEFAULT 'installed' NOT NULL,
  "installed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "uninstalled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_plugin_installations_plugin_id_user_id_unique"
  ON "platform_plugin_installations" ("plugin_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_agent_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "platform_plugins"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "agent_id" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_plugin_agent_bindings_plugin_id_user_id_agent_id_unique"
  ON "platform_plugin_agent_bindings" ("plugin_id", "user_id", "agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "platform_plugins"("id") ON DELETE cascade,
  "version_id" uuid REFERENCES "platform_plugin_versions"("id") ON DELETE set null,
  "action_id" uuid REFERENCES "platform_plugin_actions"("id") ON DELETE set null,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "agent_id" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "input_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "billing_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_type" text,
  "error_message" text,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_plugin_runs_user_id_created_at_idx"
  ON "platform_plugin_runs" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_plugin_runs_plugin_id_created_at_idx"
  ON "platform_plugin_runs" ("plugin_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "platform_plugins"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL REFERENCES "platform_plugin_runs"("id") ON DELETE cascade,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "storage_key" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "expires_at" timestamp with time zone,
  "download_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_plugin_artifacts_run_id_idx"
  ON "platform_plugin_artifacts" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_plugin_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "event_type" text NOT NULL,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "target_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_plugin_audit_logs_resource_type_resource_id_created_at_idx"
  ON "platform_plugin_audit_logs" ("resource_type", "resource_id", "created_at");
