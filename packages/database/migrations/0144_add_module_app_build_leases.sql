ALTER TABLE "module_app_builds" ADD COLUMN IF NOT EXISTS "claim_token" text;
--> statement-breakpoint
ALTER TABLE "module_app_builds" ADD COLUMN IF NOT EXISTS "claim_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "module_app_builds" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "module_app_builds" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "module_app_builds"
SET
  "claim_token" = COALESCE("claim_token", 'legacy-' || "id"::text),
  "claim_expires_at" = COALESCE("claim_expires_at", now())
WHERE "status" = 'building'
  AND ("claim_token" IS NULL OR "claim_expires_at" IS NULL);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'module_app_builds_attempt_count_check'
      AND conrelid = 'module_app_builds'::regclass
  ) THEN
    ALTER TABLE "module_app_builds" ADD CONSTRAINT "module_app_builds_attempt_count_check" CHECK ("attempt_count" >= 0 AND "attempt_count" <= 4);
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_builds_claimable_idx"
  ON "module_app_builds" ("status", "next_attempt_at", "claim_expires_at", "created_at");
