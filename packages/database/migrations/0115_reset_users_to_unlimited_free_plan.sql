UPDATE "user_plan_snapshots"
SET
  "cycle" = 'monthly',
  "monthly_credits" = 0,
  "monthly_price" = 0,
  "provider" = COALESCE("provider", 'system_default'),
  "renews_at" = NULL,
  "ends_at" = NULL,
  "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
    'source',
    'migration_reset_to_free_20260509',
    'unlimited',
    true
  ),
  "updated_at" = NOW()
WHERE "status" = 'active' AND "plan" = 'free';
--> statement-breakpoint

UPDATE "user_plan_snapshots"
SET
  "currency" = 'CNY',
  "updated_at" = NOW()
WHERE "plan" = 'free' AND "currency" <> 'CNY';
--> statement-breakpoint

UPDATE "user_plan_snapshots"
SET
  "status" = 'canceled',
  "ends_at" = COALESCE("ends_at", NOW()),
  "renews_at" = COALESCE("renews_at", NOW()),
  "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
    'resetToFreeAt',
    NOW(),
    'resetReason',
    'migration_reset_to_free_20260509'
  ),
  "updated_at" = NOW()
WHERE "status" = 'active' AND "plan" <> 'free';
--> statement-breakpoint

INSERT INTO "user_plan_snapshots" (
  "user_id",
  "plan",
  "status",
  "cycle",
  "monthly_credits",
  "monthly_price",
  "currency",
  "provider",
  "external_subscription_id",
  "metadata",
  "started_at",
  "renews_at",
  "ends_at"
)
SELECT
  "users"."id",
  'free',
  'active',
  'monthly',
  0,
  0,
  'CNY',
  'system_default',
  CONCAT('default-free-', "users"."id"),
  jsonb_build_object('source', 'migration_reset_to_free_20260509', 'unlimited', true),
  NOW(),
  NULL,
  NULL
FROM "users"
WHERE NOT EXISTS (
  SELECT 1
  FROM "user_plan_snapshots"
  WHERE
    "user_plan_snapshots"."user_id" = "users"."id"
    AND "user_plan_snapshots"."status" = 'active'
);
--> statement-breakpoint

INSERT INTO "app_settings" ("key", "value", "description")
SELECT
  'brand.loadingText',
  "value",
  'Dedicated loading screen copy, migrated from the previous brand.slogan field.'
FROM "app_settings"
WHERE
  "key" = 'brand.slogan'
  AND jsonb_typeof("value") = 'string'
  AND NULLIF(BTRIM("value" #>> '{}'), '') IS NOT NULL
ON CONFLICT ("key") DO NOTHING;
