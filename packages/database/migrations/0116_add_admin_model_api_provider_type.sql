ALTER TABLE "admin_newapi_instances"
  ADD COLUMN IF NOT EXISTS "provider_type" text NOT NULL DEFAULT 'newapi';
