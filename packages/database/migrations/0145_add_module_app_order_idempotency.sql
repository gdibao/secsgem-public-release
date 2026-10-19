ALTER TABLE "module_app_orders"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
UPDATE "module_app_orders"
SET "idempotency_key" = "id"::text
WHERE "idempotency_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "module_app_orders"
  ALTER COLUMN "idempotency_key" SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN "idempotency_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_orders_purchaser_idempotency_unique"
  ON "module_app_orders" ("purchaser_user_id", "idempotency_key");
