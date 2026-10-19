CREATE TABLE IF NOT EXISTS "module_app_artifact_cleanup_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL,
  "installation_id" uuid,
  "artifact_id" uuid NOT NULL,
  "storage_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "claimed_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_artifact_cleanup_jobs_status_check"
    CHECK ("status" IN ('pending', 'processing', 'released', 'failed')),
  CONSTRAINT "module_app_artifact_cleanup_jobs_attempt_count_check"
    CHECK ("attempt_count" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_artifact_cleanup_jobs_storage_key_unique"
  ON "module_app_artifact_cleanup_jobs" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_artifact_cleanup_jobs_status_updated_idx"
  ON "module_app_artifact_cleanup_jobs" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_artifact_cleanup_jobs_installation_idx"
  ON "module_app_artifact_cleanup_jobs" USING btree ("installation_id");
