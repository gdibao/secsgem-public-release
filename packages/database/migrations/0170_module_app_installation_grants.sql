ALTER TABLE "module_app_installations"
  ADD COLUMN IF NOT EXISTS "grant_snapshot" jsonb DEFAULT '{"functionKeys":[],"outboundHosts":[],"permissions":[],"secretKeys":[],"tableKeys":[],"workflowKeys":[]}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "module_app_installations"
  ADD COLUMN IF NOT EXISTS "data_purged_at" timestamp with time zone;
