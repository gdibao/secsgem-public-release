-- ComHub carry-forward of upstream v2.2.7 workspace/device/aiInfra rebuild.
-- Keep this as a new post-0128 migration because ComHub already owns 0111+
-- migration tags in production.

-- Part 1: ai_infra surrogate `_id` PK + workspace-scoped partial uniques.
UPDATE "ai_providers" SET "_id" = gen_random_uuid() WHERE "_id" IS NULL;--> statement-breakpoint
UPDATE "ai_models" SET "_id" = gen_random_uuid() WHERE "_id" IS NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ALTER COLUMN "_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ALTER COLUMN "_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" DROP CONSTRAINT IF EXISTS "ai_providers_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_id_provider_id_user_id_pk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("_id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_models'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_pkey" PRIMARY KEY ("_id");
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_id_user_id_unique" ON "ai_providers" USING btree ("id","user_id") WHERE "workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_id_user_id_workspace_id_unique" ON "ai_providers" USING btree ("id","user_id","workspace_id") WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_id_provider_id_user_id_unique" ON "ai_models" USING btree ("id","provider_id","user_id") WHERE "workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_id_provider_id_user_id_workspace_id_unique" ON "ai_models" USING btree ("id","provider_id","user_id","workspace_id") WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint

-- Part 2: workspace-scoped device unique + workspace freeze columns.
DROP INDEX IF EXISTS "devices_user_id_device_id_unique";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen_reason" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_workspace_id_device_id_unique" ON "devices" USING btree ("workspace_id","device_id") WHERE "devices"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_user_id_device_id_unique" ON "devices" USING btree ("user_id","device_id") WHERE "devices"."workspace_id" IS NULL;
