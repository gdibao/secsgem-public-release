CREATE TABLE IF NOT EXISTS "module_app_payment_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "module_app_orders"("id") ON DELETE restrict,
  "provider" text NOT NULL,
  "out_trade_no" text NOT NULL,
  "subject" text NOT NULL,
  "total_amount" numeric(20,6) NOT NULL,
  "currency" varchar(16) NOT NULL,
  "return_url" text NOT NULL,
  "notify_url" text NOT NULL,
  "status" text DEFAULT 'created' NOT NULL,
  "provider_transaction_id" text,
  "last_error" text,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_payment_attempts_provider_check" CHECK ("provider" IN ('alipay')),
  CONSTRAINT "module_app_payment_attempts_status_check" CHECK ("status" IN ('created', 'pending', 'paid', 'failed', 'refunded')),
  CONSTRAINT "module_app_payment_attempts_amount_check" CHECK ("total_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_payment_attempts_provider_out_trade_no_unique"
  ON "module_app_payment_attempts" ("provider", "out_trade_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_payment_attempts_order_status_idx"
  ON "module_app_payment_attempts" ("order_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_payment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "provider_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "event_status" text DEFAULT 'received' NOT NULL,
  "order_id" uuid REFERENCES "module_app_orders"("id") ON DELETE set null,
  "out_trade_no" text NOT NULL,
  "payment_reference" text,
  "provider_transaction_id" text,
  "total_amount" numeric(20,6) NOT NULL,
  "currency" varchar(16) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "error_code" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "module_app_payment_events_provider_check" CHECK ("provider" IN ('alipay')),
  CONSTRAINT "module_app_payment_events_type_check" CHECK ("event_type" IN ('payment_succeeded', 'payment_failed', 'refund_succeeded')),
  CONSTRAINT "module_app_payment_events_status_check" CHECK ("event_status" IN ('received', 'processed', 'ignored', 'rejected')),
  CONSTRAINT "module_app_payment_events_amount_check" CHECK ("total_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_payment_events_provider_event_unique"
  ON "module_app_payment_events" ("provider", "provider_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_payment_events_out_trade_no_created_idx"
  ON "module_app_payment_events" ("out_trade_no", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_payment_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "module_app_orders"("id") ON DELETE restrict,
  "provider" text NOT NULL,
  "provider_refund_id" text NOT NULL,
  "refund_amount" numeric(20,6) NOT NULL,
  "currency" varchar(16) NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_payment_refunds_provider_check" CHECK ("provider" IN ('alipay')),
  CONSTRAINT "module_app_payment_refunds_status_check" CHECK ("status" IN ('requested', 'succeeded', 'failed')),
  CONSTRAINT "module_app_payment_refunds_amount_check" CHECK ("refund_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_payment_refunds_provider_refund_unique"
  ON "module_app_payment_refunds" ("provider", "provider_refund_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_payment_refunds_order_created_idx"
  ON "module_app_payment_refunds" ("order_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_app_payment_discrepancies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "discrepancy_key" text NOT NULL,
  "kind" text NOT NULL,
  "order_id" uuid REFERENCES "module_app_orders"("id") ON DELETE set null,
  "out_trade_no" text NOT NULL,
  "expected_amount" numeric(20,6),
  "actual_amount" numeric(20,6),
  "expected_currency" varchar(16),
  "actual_currency" varchar(16),
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "module_app_payment_discrepancies_provider_check" CHECK ("provider" IN ('alipay')),
  CONSTRAINT "module_app_payment_discrepancies_kind_check" CHECK ("kind" IN ('amount_mismatch', 'currency_mismatch', 'duplicate_event', 'local_paid_provider_unpaid', 'local_unpaid_provider_paid', 'order_not_found', 'provider_mismatch', 'refund_mismatch', 'settlement_failed', 'wrong_seller')),
  CONSTRAINT "module_app_payment_discrepancies_status_check" CHECK ("status" IN ('open', 'resolved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_payment_discrepancies_provider_key_unique"
  ON "module_app_payment_discrepancies" ("provider", "discrepancy_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_app_payment_discrepancies_status_created_idx"
  ON "module_app_payment_discrepancies" ("status", "created_at");
