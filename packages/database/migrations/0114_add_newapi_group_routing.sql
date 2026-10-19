ALTER TABLE "admin_newapi_instances"
  ADD COLUMN IF NOT EXISTS "group_key" text NOT NULL DEFAULT 'default';
--> statement-breakpoint

ALTER TABLE "admin_newapi_instances"
  ADD COLUMN IF NOT EXISTS "group_name" text;
--> statement-breakpoint

ALTER TABLE "admin_newapi_instances"
  ADD COLUMN IF NOT EXISTS "group_multiplier" numeric(20, 6);
--> statement-breakpoint

ALTER TABLE "admin_newapi_instances"
  ADD COLUMN IF NOT EXISTS "usage_scope" jsonb;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_newapi_instances_group_enabled_priority_idx"
  ON "admin_newapi_instances" ("group_key", "enabled", "priority");
