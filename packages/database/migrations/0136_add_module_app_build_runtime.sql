ALTER TABLE "module_app_versions"
  ADD COLUMN IF NOT EXISTS "runtime_artifact_key" text;
--> statement-breakpoint
ALTER TABLE "module_app_versions"
  ADD COLUMN IF NOT EXISTS "runtime_artifact_sha256" text;
--> statement-breakpoint
ALTER TABLE "module_app_versions"
  ADD COLUMN IF NOT EXISTS "runtime_manifest" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_installation_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "module_app_installations"("id") ON DELETE cascade,
  "secret_key" text NOT NULL,
  "encrypted_value" text NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_installation_secrets_installation_key_unique"
  ON "module_app_installation_secrets" ("installation_id", "secret_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_builds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "package_id" uuid NOT NULL REFERENCES "module_app_packages"("id") ON DELETE cascade,
  "version_id" uuid NOT NULL REFERENCES "module_app_versions"("id") ON DELETE cascade,
  "status" text DEFAULT 'queued' NOT NULL,
  "source_sha256" text NOT NULL,
  "artifact_key" text,
  "artifact_sha256" text,
  "build_profile" text NOT NULL,
  "worker_id" text,
  "claimed_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_builds_status_check"
    CHECK ("status" IN ('queued', 'building', 'ready', 'failed')),
  CONSTRAINT "module_app_builds_source_sha256_check"
    CHECK ("source_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "module_app_builds_artifact_sha256_check"
    CHECK ("artifact_sha256" IS NULL OR "artifact_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "module_app_builds_profile_check"
    CHECK ("build_profile" IN ('node22-static', 'python312-assets'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_builds_version_id_unique"
  ON "module_app_builds" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_builds_status_created_at_idx"
  ON "module_app_builds" ("status", "created_at");
