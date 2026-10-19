ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ban_expires_at" timestamp with time zone;
--> statement-breakpoint

UPDATE "users"
SET "ban_expires_at" = "ban_expires"
WHERE "ban_expires_at" IS DISTINCT FROM "ban_expires";
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "sync_users_ban_expires_compat"()
RETURNS trigger AS $$
BEGIN
  IF NEW."ban_expires" IS DISTINCT FROM OLD."ban_expires"
    AND NEW."ban_expires_at" IS NOT DISTINCT FROM OLD."ban_expires_at" THEN
    NEW."ban_expires_at" := NEW."ban_expires";
  ELSIF NEW."ban_expires_at" IS DISTINCT FROM OLD."ban_expires_at"
    AND NEW."ban_expires" IS NOT DISTINCT FROM OLD."ban_expires" THEN
    NEW."ban_expires" := NEW."ban_expires_at";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "users_ban_expires_compat_sync" ON "users";
--> statement-breakpoint

CREATE TRIGGER "users_ban_expires_compat_sync"
BEFORE UPDATE ON "users"
FOR EACH ROW
EXECUTE FUNCTION "sync_users_ban_expires_compat"();
