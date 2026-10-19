ALTER TABLE "module_apps"
  ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'admin' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "module_apps"
  ADD CONSTRAINT "module_apps_source_check"
  CHECK ("source" IN ('system', 'admin', 'user', 'developer'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
