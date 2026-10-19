ALTER TABLE IF EXISTS "desktop_releases" ADD COLUMN IF NOT EXISTS "workflow_run_attempt" integer;--> statement-breakpoint
ALTER TABLE IF EXISTS "desktop_releases" ADD COLUMN IF NOT EXISTS "workflow_run_attempt_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "desktop_releases"
SET
  "status" = 'failed',
  "error_summary" = 'Desktop release must be retried after workflow provenance upgrade.',
  "workflow_run_attempt_pending" = false,
  "completed_at" = CURRENT_TIMESTAMP,
  "updated_at" = CURRENT_TIMESTAMP
WHERE
  "status" IN ('building', 'publishing')
  AND "workflow_run_attempt" IS NULL;
