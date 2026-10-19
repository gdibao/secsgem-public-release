CREATE TABLE IF NOT EXISTS "ppt_usage_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "session_id" varchar(64) NOT NULL,
  "docmee_uid" text NOT NULL,
  "upstream_task_id" text,
  "status" varchar(32) NOT NULL DEFAULT 'created',
  "title" text,
  "plan" varchar(32),
  "credit_cost" numeric NOT NULL DEFAULT 0,
  "quota_cost" numeric NOT NULL DEFAULT 0,
  "charged_ledger_entry_id" uuid REFERENCES "credit_ledger_entries"("id") ON DELETE set null,
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ppt_usage_records_user_created_at_idx"
  ON "ppt_usage_records" ("user_id", "created_at");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ppt_usage_records_user_session_idx"
  ON "ppt_usage_records" ("user_id", "session_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ppt_usage_records_user_upstream_task_idx"
  ON "ppt_usage_records" ("user_id", "upstream_task_id")
  WHERE "upstream_task_id" IS NOT NULL;
