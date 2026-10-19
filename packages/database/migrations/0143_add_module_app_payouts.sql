CREATE TABLE IF NOT EXISTS "module_app_payout_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "publisher_id" uuid NOT NULL REFERENCES "module_app_publishers"("id") ON DELETE restrict,
  "status" text DEFAULT 'pending' NOT NULL,
  "currency" varchar(16) NOT NULL,
  "total_amount" numeric(20,6) NOT NULL,
  "payment_method" text DEFAULT 'alipay' NOT NULL,
  "recipient_mask" text,
  "transaction_no" text,
  "evidence_reference" text,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "failure_reason" text,
  "processed_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_payout_batches_status_check" CHECK ("status" IN ('pending', 'eligible', 'processing', 'paid', 'failed', 'reversed')),
  CONSTRAINT "module_app_payout_batches_amount_check" CHECK ("total_amount" > 0),
  CONSTRAINT "module_app_payout_batches_method_check" CHECK ("payment_method" IN ('alipay'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_payout_batches_transaction_unique"
  ON "module_app_payout_batches" ("transaction_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_payout_batches_publisher_status_created_idx"
  ON "module_app_payout_batches" ("publisher_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_payout_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL REFERENCES "module_app_payout_batches"("id") ON DELETE cascade,
  "revenue_entry_id" uuid NOT NULL REFERENCES "module_app_revenue_entries"("id") ON DELETE restrict,
  "amount" numeric(20,6) NOT NULL,
  "status" text DEFAULT 'eligible' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_payout_entries_status_check" CHECK ("status" IN ('pending', 'eligible', 'processing', 'paid', 'failed', 'reversed')),
  CONSTRAINT "module_app_payout_entries_amount_check" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_payout_entries_revenue_unique"
  ON "module_app_payout_entries" ("revenue_entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_payout_entries_batch_status_idx"
  ON "module_app_payout_entries" ("batch_id", "status");
