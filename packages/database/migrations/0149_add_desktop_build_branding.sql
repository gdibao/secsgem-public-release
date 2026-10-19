CREATE TABLE IF NOT EXISTS "desktop_build_profile_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb NOT NULL,
	"asset_manifest" jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_build_profile_revisions_revision_check" CHECK ("desktop_build_profile_revisions"."revision" > 0),
	CONSTRAINT "desktop_build_profile_revisions_state_check" CHECK ("desktop_build_profile_revisions"."state" IN ('draft', 'frozen'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "desktop_build_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"current_draft_revision_id" uuid,
	"first_stable_release_at" timestamp with time zone,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_build_profiles_status_check" CHECK ("desktop_build_profiles"."status" IN ('active', 'archived')),
	CONSTRAINT "desktop_build_profiles_current_revision_check" CHECK ("desktop_build_profiles"."current_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "desktop_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"frozen_revision_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"version" varchar(64) NOT NULL,
	"release_notes" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_summary" varchar(1024),
	"dispatched_at" timestamp with time zone,
	"dispatched_by_user_id" text,
	"completed_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_releases_channel_check" CHECK ("desktop_releases"."channel" IN ('canary', 'stable')),
	CONSTRAINT "desktop_releases_status_check" CHECK ("desktop_releases"."status" IN ('queued', 'building', 'publishing', 'succeeded', 'failed'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profile_revisions_revision_check') THEN
    ALTER TABLE "desktop_build_profile_revisions" ADD CONSTRAINT "desktop_build_profile_revisions_revision_check" CHECK ("desktop_build_profile_revisions"."revision" > 0);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profile_revisions_state_check') THEN
    ALTER TABLE "desktop_build_profile_revisions" ADD CONSTRAINT "desktop_build_profile_revisions_state_check" CHECK ("desktop_build_profile_revisions"."state" IN ('draft', 'frozen'));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profiles_status_check') THEN
    ALTER TABLE "desktop_build_profiles" ADD CONSTRAINT "desktop_build_profiles_status_check" CHECK ("desktop_build_profiles"."status" IN ('active', 'archived'));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profiles_current_revision_check') THEN
    ALTER TABLE "desktop_build_profiles" ADD CONSTRAINT "desktop_build_profiles_current_revision_check" CHECK ("desktop_build_profiles"."current_revision" >= 0);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_releases_channel_check') THEN
    ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_channel_check" CHECK ("desktop_releases"."channel" IN ('canary', 'stable'));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_releases_status_check') THEN
    ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_status_check" CHECK ("desktop_releases"."status" IN ('queued', 'building', 'publishing', 'succeeded', 'failed'));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profile_revisions_profile_id_desktop_build_profiles_id_fk') THEN
    ALTER TABLE "desktop_build_profile_revisions" ADD CONSTRAINT "desktop_build_profile_revisions_profile_id_desktop_build_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."desktop_build_profiles"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profile_revisions_created_by_user_id_users_id_fk') THEN
    ALTER TABLE "desktop_build_profile_revisions" ADD CONSTRAINT "desktop_build_profile_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profiles_current_draft_revision_id_desktop_build_profile_revisions_id_fk') THEN
    ALTER TABLE "desktop_build_profiles" ADD CONSTRAINT "desktop_build_profiles_current_draft_revision_id_desktop_build_profile_revisions_id_fk" FOREIGN KEY ("current_draft_revision_id") REFERENCES "public"."desktop_build_profile_revisions"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profiles_created_by_user_id_users_id_fk') THEN
    ALTER TABLE "desktop_build_profiles" ADD CONSTRAINT "desktop_build_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_build_profiles_updated_by_user_id_users_id_fk') THEN
    ALTER TABLE "desktop_build_profiles" ADD CONSTRAINT "desktop_build_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_releases_profile_id_desktop_build_profiles_id_fk') THEN
    ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_profile_id_desktop_build_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."desktop_build_profiles"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_releases_frozen_revision_id_desktop_build_profile_revisions_id_fk') THEN
    ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_frozen_revision_id_desktop_build_profile_revisions_id_fk" FOREIGN KEY ("frozen_revision_id") REFERENCES "public"."desktop_build_profile_revisions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_releases_dispatched_by_user_id_users_id_fk') THEN
    ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_dispatched_by_user_id_users_id_fk" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_releases_created_by_user_id_users_id_fk') THEN
    ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "desktop_build_profile_revisions_profile_revision_unique" ON "desktop_build_profile_revisions" USING btree ("profile_id","revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_build_profile_revisions_profile_state_created_at_idx" ON "desktop_build_profile_revisions" USING btree ("profile_id","state","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_build_profiles_status_updated_at_idx" ON "desktop_build_profiles" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "desktop_releases_channel_version_unique" ON "desktop_releases" USING btree ("channel","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_releases_profile_created_at_idx" ON "desktop_releases" USING btree ("profile_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_releases_status_created_at_idx" ON "desktop_releases" USING btree ("status","created_at");
