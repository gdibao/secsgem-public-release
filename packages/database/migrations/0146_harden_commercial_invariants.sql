WITH ranked_active_snapshots AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "started_at" DESC, "created_at" DESC, "id" DESC
    ) AS "row_number"
  FROM "user_plan_snapshots"
  WHERE "status" = 'active'
)
UPDATE "user_plan_snapshots" AS "snapshot"
SET
  "status" = 'canceled',
  "ends_at" = COALESCE("snapshot"."ends_at", NOW()),
  "renews_at" = COALESCE("snapshot"."renews_at", NOW()),
  "metadata" = COALESCE("snapshot"."metadata", '{}'::jsonb) || jsonb_build_object(
    'commercialInvariantCleanupAt',
    NOW(),
    'commercialInvariantCleanupReason',
    'duplicate_active_snapshot'
  ),
  "updated_at" = NOW()
FROM ranked_active_snapshots AS "ranked"
WHERE "snapshot"."id" = "ranked"."id" AND "ranked"."row_number" > 1;
--> statement-breakpoint

WITH ranked_pending_requests AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS "row_number"
  FROM "subscription_change_requests"
  WHERE "status" = 'pending'
)
UPDATE "subscription_change_requests" AS "request"
SET "status" = 'canceled', "updated_at" = NOW()
FROM ranked_pending_requests AS "ranked"
WHERE "request"."id" = "ranked"."id" AND "ranked"."row_number" > 1;
--> statement-breakpoint

WITH ranked_subscription_grants AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "reference_type", "reference_id", "type"
      ORDER BY "created_at", "id"
    ) AS "row_number"
  FROM "credit_ledger_entries"
  WHERE
    "reference_type" = 'subscription_snapshot_period'
    AND "reference_id" IS NOT NULL
    AND "type" = 'subscription_grant'
)
UPDATE "credit_ledger_entries" AS "entry"
SET
  "reference_type" = 'subscription_snapshot_period_legacy_duplicate',
  "metadata" = COALESCE("entry"."metadata", '{}'::jsonb) || jsonb_build_object(
    'legacyDuplicateReferenceType',
    "entry"."reference_type",
    'legacyDuplicateReferenceId',
    "entry"."reference_id",
    'commercialInvariantCleanupAt',
    NOW()
  ),
  "updated_at" = NOW()
FROM ranked_subscription_grants AS "ranked"
WHERE "entry"."id" = "ranked"."id" AND "ranked"."row_number" > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_plan_snapshots_one_active_per_user_unique"
  ON "user_plan_snapshots" ("user_id")
  WHERE "status" = 'active';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_change_requests_one_pending_per_user_unique"
  ON "subscription_change_requests" ("user_id")
  WHERE "status" = 'pending';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_subscription_period_unique"
  ON "credit_ledger_entries" ("user_id", "reference_type", "reference_id", "type")
  WHERE
    "reference_type" = 'subscription_snapshot_period'
    AND "reference_id" IS NOT NULL
    AND "type" = 'subscription_grant';
