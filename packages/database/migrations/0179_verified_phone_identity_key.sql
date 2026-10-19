-- Keep the immutable users.id as the primary key. A phone number becomes a
-- global identity match key only after ownership verification.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "users_phone_unique";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "users_verified_phone_unique"
  ON "users" ("phone")
  WHERE "phone_number_verified" = true AND "phone" IS NOT NULL;
