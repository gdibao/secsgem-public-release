CREATE TABLE IF NOT EXISTS "heterogeneous_runtime_tenants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "provider" varchar(32) NOT NULL,
  "partition_key" text NOT NULL,
  "runtime_ref" text,
  "workspace_ref" text NOT NULL,
  "state_ref" text NOT NULL,
  "credential_ref" text,
  "status" varchar(32) DEFAULT 'provisioning' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "heterogeneous_runtime_tenants_provider_supported"
    CHECK ("provider" IN ('codex', 'dsh', 'openclaw', 'hermes')),
  CONSTRAINT "heterogeneous_runtime_tenants_partition_not_empty" CHECK (length("partition_key") > 0),
  CONSTRAINT "heterogeneous_runtime_tenants_workspace_ref_not_empty" CHECK (length("workspace_ref") > 0),
  CONSTRAINT "heterogeneous_runtime_tenants_state_ref_not_empty" CHECK (length("state_ref") > 0)
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "heterogeneous_runtime_tenants_partition_key_unique"
  ON "heterogeneous_runtime_tenants" ("partition_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heterogeneous_runtime_tenants_personal_unique"
  ON "heterogeneous_runtime_tenants" ("user_id", "provider") WHERE "workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heterogeneous_runtime_tenants_workspace_unique"
  ON "heterogeneous_runtime_tenants" ("user_id", "workspace_id", "provider") WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heterogeneous_runtime_tenants_workspace_idx"
  ON "heterogeneous_runtime_tenants" ("workspace_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "heterogeneous_runtime_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "heterogeneous_runtime_tenants"("id") ON DELETE CASCADE,
  "topic_id" text REFERENCES "topics"("id") ON DELETE SET NULL,
  "native_session_id" text NOT NULL,
  "native_thread_id" text,
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "heterogeneous_runtime_sessions_native_session_not_empty"
    CHECK (length("native_session_id") > 0)
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "heterogeneous_runtime_sessions_tenant_native_unique"
  ON "heterogeneous_runtime_sessions" ("tenant_id", "native_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heterogeneous_runtime_sessions_tenant_topic_status_idx"
  ON "heterogeneous_runtime_sessions" ("tenant_id", "topic_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heterogeneous_runtime_sessions_topic_idx"
  ON "heterogeneous_runtime_sessions" ("topic_id");
