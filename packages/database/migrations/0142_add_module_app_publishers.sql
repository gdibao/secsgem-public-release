CREATE TABLE IF NOT EXISTS "module_app_publishers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "display_name" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "recipient_mask" text,
  "verification_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "verified_at" timestamp with time zone,
  "suspended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_publishers_status_check" CHECK ("status" IN ('pending', 'verified', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_publishers_user_unique"
  ON "module_app_publishers" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_publishers_status_created_idx"
  ON "module_app_publishers" ("status", "created_at");
--> statement-breakpoint
ALTER TABLE "module_apps"
  ADD COLUMN "publisher_id" uuid REFERENCES "module_app_publishers"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "module_app_packages"
  ADD COLUMN "publisher_id" uuid REFERENCES "module_app_publishers"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "module_app_revenue_entries"
  ADD COLUMN "publisher_id" uuid REFERENCES "module_app_publishers"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_apps_publisher_status_idx"
  ON "module_apps" ("publisher_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_packages_publisher_review_idx"
  ON "module_app_packages" ("publisher_id", "review_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_revenue_entries_publisher_id_status_idx"
  ON "module_app_revenue_entries" ("publisher_id", "status");
