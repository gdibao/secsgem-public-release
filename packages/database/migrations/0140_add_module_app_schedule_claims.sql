ALTER TABLE "module_app_schedules"
  ADD COLUMN "claim_token" text,
  ADD COLUMN "claim_expires_at" timestamptz;
