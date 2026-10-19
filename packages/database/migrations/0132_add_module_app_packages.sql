CREATE TABLE IF NOT EXISTS "module_app_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid REFERENCES "module_apps"("id") ON DELETE set null,
  "version_id" uuid REFERENCES "module_app_versions"("id") ON DELETE set null,
  "submitted_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "reviewed_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "review_status" text DEFAULT 'pending_review' NOT NULL,
  "archive" jsonb NOT NULL,
  "file_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "manifest_snapshot" jsonb NOT NULL,
  "validation_report" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rejection_reason" text,
  "reviewed_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_packages_review_status_created_at_idx"
  ON "module_app_packages" ("review_status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_packages_submitted_by_created_at_idx"
  ON "module_app_packages" ("submitted_by_user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_packages_app_id_created_at_idx"
  ON "module_app_packages" ("app_id", "created_at");
