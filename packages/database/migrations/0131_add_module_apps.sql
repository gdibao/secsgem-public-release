CREATE TABLE IF NOT EXISTS "module_apps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "display_name" text NOT NULL,
  "icon" text NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "app_type" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "billing" jsonb DEFAULT '{"chargeMode":"free","defaultMultiplier":1,"externalApiCostCredits":0,"failureFixedFeePolicy":"do_not_charge","fixedServiceFeeCredits":0}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_apps_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_apps_status_category_sort_idx"
  ON "module_apps" ("status", "category", "sort_order");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "version" text NOT NULL,
  "manifest_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "changelog" text DEFAULT '' NOT NULL,
  "published_at" timestamp with time zone,
  "rollback_source_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_versions_app_id_version_idx"
  ON "module_app_versions" ("app_id", "version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "version_id" uuid NOT NULL REFERENCES "module_app_versions"("id") ON DELETE cascade,
  "page_key" text NOT NULL,
  "title" text NOT NULL,
  "page_type" text NOT NULL,
  "route_path" text NOT NULL,
  "layout_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "data_source" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "action_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_pages_app_id_version_id_sort_order_idx"
  ON "module_app_pages" ("app_id", "version_id", "sort_order");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "version_id" uuid NOT NULL REFERENCES "module_app_versions"("id") ON DELETE cascade,
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
CREATE INDEX IF NOT EXISTS "module_app_actions_app_id_version_id_action_key_idx"
  ON "module_app_actions" ("app_id", "version_id", "action_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "plan" text NOT NULL,
  "visible" boolean DEFAULT false NOT NULL,
  "installable" boolean DEFAULT false NOT NULL,
  "runnable" boolean DEFAULT false NOT NULL,
  "free_quota_credits" integer DEFAULT 0 NOT NULL,
  "discount_percent" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_entitlements_app_id_plan_unique"
  ON "module_app_entitlements" ("app_id", "plan");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "version_id" uuid NOT NULL REFERENCES "module_app_versions"("id") ON DELETE cascade,
  "scope_type" text NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE cascade,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE cascade,
  "status" text DEFAULT 'installed' NOT NULL,
  "installed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "uninstalled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_installations_scope_owner_check" CHECK (
    (
      "scope_type" = 'personal'
      AND "user_id" IS NOT NULL
      AND "workspace_id" IS NULL
    )
    OR (
      "scope_type" = 'workspace'
      AND "workspace_id" IS NOT NULL
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_install_personal_unique"
  ON "module_app_installations" ("app_id", "user_id")
  WHERE "scope_type" = 'personal' AND "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_install_workspace_unique"
  ON "module_app_installations" ("app_id", "workspace_id")
  WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "collection_key" text NOT NULL,
  "scope_type" text NOT NULL,
  "owner_user_id" text REFERENCES "users"("id") ON DELETE cascade,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE cascade,
  "record_key" text,
  "title" text,
  "status" text DEFAULT 'active' NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "updated_by" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_records_scope_owner_check" CHECK (
    (
      "scope_type" = 'personal'
      AND "owner_user_id" IS NOT NULL
      AND "workspace_id" IS NULL
    )
    OR (
      "scope_type" = 'workspace'
      AND "workspace_id" IS NOT NULL
    )
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_records_personal_idx"
  ON "module_app_records" ("app_id", "scope_type", "owner_user_id", "collection_key", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_records_workspace_idx"
  ON "module_app_records" ("app_id", "scope_type", "workspace_id", "collection_key", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_records_record_key_idx"
  ON "module_app_records" ("app_id", "collection_key", "record_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_record_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "record_id" uuid NOT NULL REFERENCES "module_app_records"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "scope_type" text NOT NULL,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE set null,
  "before_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "after_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_record_events_record_id_created_at_idx"
  ON "module_app_record_events" ("record_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "version_id" uuid REFERENCES "module_app_versions"("id") ON DELETE set null,
  "action_id" uuid REFERENCES "module_app_actions"("id") ON DELETE set null,
  "record_id" uuid REFERENCES "module_app_records"("id") ON DELETE set null,
  "scope_type" text NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE set null,
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
CREATE INDEX IF NOT EXISTS "module_app_runs_user_id_created_at_idx"
  ON "module_app_runs" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_runs_workspace_id_created_at_idx"
  ON "module_app_runs" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_runs_app_id_created_at_idx"
  ON "module_app_runs" ("app_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL REFERENCES "module_app_runs"("id") ON DELETE cascade,
  "record_id" uuid REFERENCES "module_app_records"("id") ON DELETE set null,
  "scope_type" text NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE set null,
  "storage_key" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "expires_at" timestamp with time zone,
  "download_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_artifacts_run_id_idx"
  ON "module_app_artifacts" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "event_type" text NOT NULL,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_audit_logs_resource_type_resource_id_created_at_idx"
  ON "module_app_audit_logs" ("resource_type", "resource_id", "created_at");
