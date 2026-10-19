WITH ranked_redemption_orders AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "redemption_code_id"
      ORDER BY
        CASE WHEN "status" = 'paid' THEN 0 ELSE 1 END,
        "paid_at" NULLS LAST,
        "created_at",
        "id"
    ) AS "row_number"
  FROM "top_up_orders"
  WHERE "redemption_code_id" IS NOT NULL
)
UPDATE "top_up_orders" AS "order"
SET
  "metadata" = COALESCE("order"."metadata", '{}'::jsonb) || jsonb_build_object(
    'legacyDuplicateRedemptionCodeId',
    "order"."redemption_code_id",
    'commercialTransactionCleanupAt',
    NOW()
  ),
  "redemption_code_id" = NULL,
  "updated_at" = NOW()
FROM ranked_redemption_orders AS "ranked"
WHERE "order"."id" = "ranked"."id" AND "ranked"."row_number" > 1;
--> statement-breakpoint

WITH ranked_ai_usage_entries AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "reference_type", "reference_id", "type"
      ORDER BY "created_at", "id"
    ) AS "row_number"
  FROM "credit_ledger_entries"
  WHERE
    "reference_type" = 'ai_usage_reservation'
    AND "reference_id" IS NOT NULL
    AND "type" = 'consume'
)
UPDATE "credit_ledger_entries" AS "entry"
SET
  "reference_type" = 'ai_usage_reservation_legacy_duplicate',
  "metadata" = COALESCE("entry"."metadata", '{}'::jsonb) || jsonb_build_object(
    'legacyDuplicateReferenceType',
    "entry"."reference_type",
    'legacyDuplicateReferenceId',
    "entry"."reference_id",
    'commercialTransactionCleanupAt',
    NOW()
  ),
  "updated_at" = NOW()
FROM ranked_ai_usage_entries AS "ranked"
WHERE "entry"."id" = "ranked"."id" AND "ranked"."row_number" > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "top_up_orders_redemption_code_unique"
  ON "top_up_orders" ("redemption_code_id")
  WHERE "redemption_code_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_ai_usage_reservation_unique_idx"
  ON "credit_ledger_entries" ("user_id", "reference_type", "reference_id", "type")
  WHERE
    "reference_type" = 'ai_usage_reservation'
    AND "reference_id" IS NOT NULL
    AND "type" = 'consume';
--> statement-breakpoint

ALTER TABLE "module_app_orders"
  ADD COLUMN IF NOT EXISTS "refund_reference" text;
--> statement-breakpoint

ALTER TABLE "module_app_subscriptions"
  ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;
--> statement-breakpoint

DROP INDEX IF EXISTS "module_app_payout_entries_revenue_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "module_app_payout_entries_revenue_unique"
  ON "module_app_payout_entries" ("revenue_entry_id")
  WHERE "status" <> 'reversed';
--> statement-breakpoint

ALTER TABLE "module_apps"
  ADD COLUMN IF NOT EXISTS "current_published_version_id" uuid;
--> statement-breakpoint

WITH latest_published_versions AS (
  SELECT DISTINCT ON ("app_id")
    "app_id",
    "id"
  FROM "module_app_versions"
  WHERE "published_at" IS NOT NULL
  ORDER BY "app_id", "published_at" DESC, "created_at" DESC, "id" DESC
)
UPDATE "module_apps" AS "app"
SET "current_published_version_id" = "version"."id"
FROM latest_published_versions AS "version"
WHERE
  "app"."id" = "version"."app_id"
  AND "app"."status" = 'published'
  AND "app"."current_published_version_id" IS NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'module_apps_current_published_version_id_module_app_versions_id_fk'
      AND conrelid = 'public.module_apps'::regclass
      AND confrelid = 'public.module_app_versions'::regclass
  ) THEN
    ALTER TABLE "module_apps"
      ADD CONSTRAINT "module_apps_current_published_version_id_module_app_versions_id_fk"
      FOREIGN KEY ("current_published_version_id")
      REFERENCES "public"."module_app_versions"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "module_apps_current_published_version_idx"
  ON "module_apps" ("current_published_version_id");
