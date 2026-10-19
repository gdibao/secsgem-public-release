ALTER TABLE "module_app_records"
  ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "module_app_installations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "module_app_runs"
  ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "module_app_installations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "module_app_artifacts"
  ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "module_app_installations"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_migration_quarantine" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_table" text NOT NULL,
  "source_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_migration_quarantine_source_unique"
  ON "module_app_migration_quarantine" ("source_table", "source_id");
--> statement-breakpoint
WITH "record_matches" AS (
  SELECT
    "record"."id",
    min("installation"."id"::text)::uuid AS "installation_id",
    count("installation"."id") AS "match_count"
  FROM "module_app_records" AS "record"
  LEFT JOIN "module_app_installations" AS "installation"
    ON "installation"."app_id" = "record"."app_id"
    AND "installation"."scope_type" = "record"."scope_type"
    AND (
      ("record"."scope_type" = 'personal' AND "installation"."user_id" = "record"."owner_user_id")
      OR ("record"."scope_type" = 'workspace' AND "installation"."workspace_id" = "record"."workspace_id")
    )
  WHERE "record"."installation_id" IS NULL
  GROUP BY "record"."id"
)
UPDATE "module_app_records" AS "record"
SET "installation_id" = "record_matches"."installation_id"
FROM "record_matches"
WHERE "record"."id" = "record_matches"."id" AND "record_matches"."match_count" = 1;
--> statement-breakpoint
WITH "run_matches" AS (
  SELECT
    "run"."id",
    min("installation"."id"::text)::uuid AS "installation_id",
    count("installation"."id") AS "match_count"
  FROM "module_app_runs" AS "run"
  LEFT JOIN "module_app_installations" AS "installation"
    ON "installation"."app_id" = "run"."app_id"
    AND "installation"."scope_type" = "run"."scope_type"
    AND (
      ("run"."scope_type" = 'personal' AND "installation"."user_id" = "run"."user_id")
      OR ("run"."scope_type" = 'workspace' AND "installation"."workspace_id" = "run"."workspace_id")
    )
  WHERE "run"."installation_id" IS NULL
  GROUP BY "run"."id"
)
UPDATE "module_app_runs" AS "run"
SET "installation_id" = "run_matches"."installation_id"
FROM "run_matches"
WHERE "run"."id" = "run_matches"."id" AND "run_matches"."match_count" = 1;
--> statement-breakpoint
WITH "artifact_matches" AS (
  SELECT
    "artifact"."id",
    min("installation"."id"::text)::uuid AS "installation_id",
    count("installation"."id") AS "match_count"
  FROM "module_app_artifacts" AS "artifact"
  LEFT JOIN "module_app_installations" AS "installation"
    ON "installation"."app_id" = "artifact"."app_id"
    AND "installation"."scope_type" = "artifact"."scope_type"
    AND (
      ("artifact"."scope_type" = 'personal' AND "installation"."user_id" = "artifact"."user_id")
      OR ("artifact"."scope_type" = 'workspace' AND "installation"."workspace_id" = "artifact"."workspace_id")
    )
  WHERE "artifact"."installation_id" IS NULL
  GROUP BY "artifact"."id"
)
UPDATE "module_app_artifacts" AS "artifact"
SET "installation_id" = "artifact_matches"."installation_id"
FROM "artifact_matches"
WHERE "artifact"."id" = "artifact_matches"."id" AND "artifact_matches"."match_count" = 1;
--> statement-breakpoint
INSERT INTO "module_app_migration_quarantine" ("source_table", "source_id", "reason", "details")
SELECT
  'module_app_records',
  "id",
  'installation_not_unique',
  jsonb_build_object('appId', "app_id", 'scopeType', "scope_type")
FROM "module_app_records"
WHERE "installation_id" IS NULL
ON CONFLICT ("source_table", "source_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "module_app_migration_quarantine" ("source_table", "source_id", "reason", "details")
SELECT
  'module_app_runs',
  "id",
  'installation_not_unique',
  jsonb_build_object('appId', "app_id", 'scopeType', "scope_type")
FROM "module_app_runs"
WHERE "installation_id" IS NULL
ON CONFLICT ("source_table", "source_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "module_app_migration_quarantine" ("source_table", "source_id", "reason", "details")
SELECT
  'module_app_artifacts',
  "id",
  'installation_not_unique',
  jsonb_build_object('appId', "app_id", 'scopeType', "scope_type")
FROM "module_app_artifacts"
WHERE "installation_id" IS NULL
ON CONFLICT ("source_table", "source_id") DO NOTHING;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_records_installation_updated_at_idx"
  ON "module_app_records" ("installation_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_runs_installation_id_created_at_idx"
  ON "module_app_runs" ("installation_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_artifacts_installation_id_created_at_idx"
  ON "module_app_artifacts" ("installation_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_data_schemas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "module_app_installations"("id") ON DELETE cascade,
  "table_key" text NOT NULL,
  "version" integer NOT NULL,
  "schema_snapshot" jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_data_schemas_version_check" CHECK ("version" > 0),
  CONSTRAINT "module_app_data_schemas_status_check" CHECK ("status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_data_schemas_installation_table_version_unique"
  ON "module_app_data_schemas" ("installation_id", "table_key", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_data_schemas_installation_table_status_idx"
  ON "module_app_data_schemas" ("installation_id", "table_key", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_data_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "module_app_installations"("id") ON DELETE cascade,
  "table_key" text NOT NULL,
  "row_key" text NOT NULL,
  "schema_version" integer NOT NULL,
  "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "updated_by" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_data_rows_schema_version_check" CHECK ("schema_version" > 0),
  CONSTRAINT "module_app_data_rows_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "module_app_data_rows_schema_version_fk"
    FOREIGN KEY ("installation_id", "table_key", "schema_version")
    REFERENCES "module_app_data_schemas"("installation_id", "table_key", "version") ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_data_rows_installation_table_row_unique"
  ON "module_app_data_rows" ("installation_id", "table_key", "row_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_data_rows_installation_table_status_updated_idx"
  ON "module_app_data_rows" ("installation_id", "table_key", "status", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_workflow_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "module_app_installations"("id") ON DELETE cascade,
  "workflow_key" text NOT NULL,
  "workflow_version" integer NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "idempotency_key" text NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_code" text,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_workflow_runs_version_check" CHECK ("workflow_version" > 0),
  CONSTRAINT "module_app_workflow_runs_status_check"
    CHECK ("status" IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_workflow_runs_installation_workflow_idempotency_unique"
  ON "module_app_workflow_runs" ("installation_id", "workflow_key", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_workflow_runs_id_installation_unique"
  ON "module_app_workflow_runs" ("id", "installation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_workflow_runs_installation_status_created_idx"
  ON "module_app_workflow_runs" ("installation_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_workflow_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "module_app_installations"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL REFERENCES "module_app_workflow_runs"("id") ON DELETE cascade,
  "node_key" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 1 NOT NULL,
  "worker_id" text,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_code" text,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_workflow_nodes_status_check"
    CHECK ("status" IN ('pending', 'queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'skipped')),
  CONSTRAINT "module_app_workflow_nodes_attempt_check"
    CHECK ("attempt" >= 0 AND "max_attempts" BETWEEN 1 AND 10),
  CONSTRAINT "module_app_workflow_nodes_run_installation_fk"
    FOREIGN KEY ("run_id", "installation_id")
    REFERENCES "module_app_workflow_runs"("id", "installation_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_workflow_nodes_run_node_unique"
  ON "module_app_workflow_nodes" ("run_id", "node_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_workflow_nodes_status_available_lease_idx"
  ON "module_app_workflow_nodes" ("status", "available_at", "lease_expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_workflow_nodes_installation_status_idx"
  ON "module_app_workflow_nodes" ("installation_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "module_app_installations"("id") ON DELETE cascade,
  "schedule_key" text NOT NULL,
  "workflow_key" text NOT NULL,
  "workflow_version" integer NOT NULL,
  "schedule" text NOT NULL,
  "timezone" text NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_schedules_version_check" CHECK ("workflow_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_schedules_installation_key_unique"
  ON "module_app_schedules" ("installation_id", "schedule_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_schedules_enabled_next_run_idx"
  ON "module_app_schedules" ("enabled", "next_run_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "module_app_installations"("id") ON DELETE cascade,
  "webhook_key" text NOT NULL,
  "workflow_key" text NOT NULL,
  "workflow_version" integer NOT NULL,
  "secret_hash" text NOT NULL,
  "replay_window_seconds" integer DEFAULT 300 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_delivery_at" timestamp with time zone,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_webhooks_version_check" CHECK ("workflow_version" > 0),
  CONSTRAINT "module_app_webhooks_replay_window_check"
    CHECK ("replay_window_seconds" BETWEEN 30 AND 3600),
  CONSTRAINT "module_app_webhooks_status_check" CHECK ("status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_webhooks_installation_key_unique"
  ON "module_app_webhooks" ("installation_id", "webhook_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "webhook_id" uuid NOT NULL REFERENCES "module_app_webhooks"("id") ON DELETE cascade,
  "delivery_id" text NOT NULL,
  "payload_sha256" text NOT NULL,
  "status" text DEFAULT 'accepted' NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_webhook_deliveries_payload_sha256_check"
    CHECK ("payload_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "module_app_webhook_deliveries_status_check"
    CHECK ("status" IN ('accepted', 'processed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_webhook_deliveries_webhook_delivery_unique"
  ON "module_app_webhook_deliveries" ("webhook_id", "delivery_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_webhook_deliveries_received_at_idx"
  ON "module_app_webhook_deliveries" ("received_at");
