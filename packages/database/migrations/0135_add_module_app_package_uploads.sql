CREATE TABLE IF NOT EXISTS "module_app_package_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "package_id" uuid REFERENCES "module_app_packages"("id") ON DELETE set null,
  "storage_key" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "declared_size_bytes" integer NOT NULL,
  "actual_size_bytes" integer,
  "sha256" text,
  "status" text DEFAULT 'issued' NOT NULL,
  "scan_status" text DEFAULT 'pending' NOT NULL,
  "scan_report" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "failure_code" text,
  "storage_released_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_package_uploads_status_check"
    CHECK ("status" IN ('issued', 'processing', 'submitted', 'rejected', 'failed', 'cleaning', 'expired')),
  CONSTRAINT "module_app_package_uploads_scan_status_check"
    CHECK ("scan_status" IN ('pending', 'clean', 'blocked', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_package_uploads_storage_key_unique"
  ON "module_app_package_uploads" ("storage_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_package_uploads_package_id_unique"
  ON "module_app_package_uploads" ("package_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_package_uploads_user_status_created_at_idx"
  ON "module_app_package_uploads" ("user_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_package_uploads_status_expires_at_idx"
  ON "module_app_package_uploads" ("status", "expires_at");
