ALTER TABLE "module_app_actions"
  ALTER COLUMN "module_multiplier" TYPE numeric(10,4)
  USING "module_multiplier"::numeric(10,4);
--> statement-breakpoint
ALTER TABLE "module_app_actions"
  DROP CONSTRAINT IF EXISTS "module_app_actions_multiplier_check";
--> statement-breakpoint
ALTER TABLE "module_app_actions"
  ADD CONSTRAINT "module_app_actions_multiplier_check"
  CHECK ("module_multiplier" >= 0 AND "module_multiplier" <= 100);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_credit_accounts" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "balance" numeric(20,6) DEFAULT 0 NOT NULL,
  "total_credited" numeric(20,6) DEFAULT 0 NOT NULL,
  "total_debited" numeric(20,6) DEFAULT 0 NOT NULL,
  "currency" varchar(16) DEFAULT 'CREDITS' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_credit_accounts_balance_nonnegative" CHECK ("balance" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_credit_accounts_updated_at_idx"
  ON "workspace_credit_accounts" ("updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_credit_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "amount" numeric(20,6) NOT NULL,
  "balance_after" numeric(20,6) NOT NULL,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "title" text,
  "description" text,
  "reference_type" text,
  "reference_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_credit_ledger_entries_type_check"
    CHECK ("type" IN ('adjustment', 'consume', 'funding', 'refund'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_credit_ledger_entries_workspace_created_idx"
  ON "workspace_credit_ledger_entries" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_credit_ledger_entries_reference_unique"
  ON "workspace_credit_ledger_entries" ("workspace_id", "reference_type", "reference_id", "type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payer_scope_type" text NOT NULL,
  "payer_user_id" text REFERENCES "users"("id") ON DELETE cascade,
  "payer_workspace_id" text REFERENCES "workspaces"("id") ON DELETE cascade,
  "amount" numeric(20,6) NOT NULL,
  "actual_amount" numeric(20,6),
  "released_amount" numeric(20,6) DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "settlement_ledger_entry_id" uuid,
  "release_reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "settled_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_reservations_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "credit_reservations_payer_scope_check" CHECK (
    ("payer_scope_type" = 'personal' AND "payer_user_id" IS NOT NULL AND "payer_workspace_id" IS NULL)
    OR ("payer_scope_type" = 'workspace' AND "payer_workspace_id" IS NOT NULL AND "payer_user_id" IS NULL)
  ),
  CONSTRAINT "credit_reservations_status_check"
    CHECK ("status" IN ('active', 'expired', 'released', 'settled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_reservations_user_status_expires_idx"
  ON "credit_reservations" ("payer_user_id", "status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_reservations_workspace_status_expires_idx"
  ON "credit_reservations" ("payer_workspace_id", "status", "expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_module_app_reservation_unique_idx"
  ON "credit_ledger_entries" ("user_id", "reference_type", "reference_id", "type")
  WHERE "reference_type" = 'module_app_credit_reservation' AND "reference_id" IS NOT NULL AND "type" = 'consume';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_module_app_workspace_transfer_unique_idx"
  ON "credit_ledger_entries" ("user_id", "reference_type", "reference_id", "type")
  WHERE "reference_type" = 'module_app_workspace_transfer' AND "reference_id" IS NOT NULL AND "type" = 'consume';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE cascade,
  "product_key" text NOT NULL,
  "product_type" text NOT NULL,
  "license_scope" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_products_app_key_unique"
  ON "module_app_products" ("app_id", "product_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "module_app_products"("id") ON DELETE cascade,
  "currency" varchar(16) NOT NULL,
  "amount" numeric(20,6) NOT NULL,
  "billing_period" text,
  "trial_days" integer DEFAULT 0 NOT NULL,
  "promotion" jsonb,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_prices_product_active_idx"
  ON "module_app_prices" ("product_id", "active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE restrict,
  "product_id" uuid NOT NULL REFERENCES "module_app_products"("id") ON DELETE restrict,
  "price_id" uuid NOT NULL REFERENCES "module_app_prices"("id") ON DELETE restrict,
  "purchaser_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE restrict,
  "status" text DEFAULT 'pending' NOT NULL,
  "payment_reference" text,
  "snapshot" jsonb NOT NULL,
  "paid_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_orders_payment_reference_unique"
  ON "module_app_orders" ("payment_reference") WHERE "payment_reference" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_orders_purchaser_created_idx"
  ON "module_app_orders" ("purchaser_user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_licenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE restrict,
  "order_id" uuid NOT NULL REFERENCES "module_app_orders"("id") ON DELETE restrict,
  "license_scope" text NOT NULL,
  "owner_user_id" text REFERENCES "users"("id") ON DELETE restrict,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE restrict,
  "seat_count" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "starts_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ends_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_licenses_app_user_status_idx"
  ON "module_app_licenses" ("app_id", "owner_user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_licenses_app_workspace_status_idx"
  ON "module_app_licenses" ("app_id", "workspace_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "license_id" uuid NOT NULL REFERENCES "module_app_licenses"("id") ON DELETE restrict,
  "order_id" uuid NOT NULL REFERENCES "module_app_orders"("id") ON DELETE restrict,
  "status" text NOT NULL,
  "current_period_start" timestamp with time zone NOT NULL,
  "current_period_end" timestamp with time zone NOT NULL,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_subscriptions_status_period_end_idx"
  ON "module_app_subscriptions" ("status", "current_period_end");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_revenue_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "module_apps"("id") ON DELETE restrict,
  "order_id" uuid NOT NULL REFERENCES "module_app_orders"("id") ON DELETE restrict,
  "publisher_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "type" text NOT NULL,
  "gross_amount" numeric(20,6) NOT NULL,
  "platform_fee" numeric(20,6) NOT NULL,
  "reserve_amount" numeric(20,6) NOT NULL,
  "developer_amount" numeric(20,6) NOT NULL,
  "currency" varchar(16) NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "settlement_batch_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_revenue_entries_publisher_status_created_idx"
  ON "module_app_revenue_entries" ("publisher_user_id", "status", "created_at");
