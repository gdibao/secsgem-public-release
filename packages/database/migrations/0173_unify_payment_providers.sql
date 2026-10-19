ALTER TABLE "module_app_payment_attempts"
  ADD COLUMN IF NOT EXISTS "method" text DEFAULT 'alipay' NOT NULL;
--> statement-breakpoint
ALTER TABLE "module_app_payment_attempts"
  ADD COLUMN IF NOT EXISTS "checkout" jsonb;
--> statement-breakpoint
ALTER TABLE "top_up_orders"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "top_up_orders"
  ADD COLUMN IF NOT EXISTS "checkout" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "top_up_orders_user_idempotency_unique"
  ON "top_up_orders" USING btree ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_payment_attempts_order_unique"
  ON "module_app_payment_attempts" USING btree ("order_id");
--> statement-breakpoint
ALTER TABLE "module_app_payment_attempts"
  DROP CONSTRAINT IF EXISTS "module_app_payment_attempts_provider_check";
--> statement-breakpoint
ALTER TABLE "module_app_payment_attempts"
  ADD CONSTRAINT "module_app_payment_attempts_provider_check"
  CHECK ("provider" IN ('alipay', 'wechat_pay', 'zpay'));
--> statement-breakpoint
ALTER TABLE "module_app_payment_attempts"
  DROP CONSTRAINT IF EXISTS "module_app_payment_attempts_method_check";
--> statement-breakpoint
ALTER TABLE "module_app_payment_attempts"
  ADD CONSTRAINT "module_app_payment_attempts_method_check"
  CHECK ("method" IN ('alipay', 'wechat_pay', 'zpay_alipay', 'zpay_wechat'));
--> statement-breakpoint
ALTER TABLE "module_app_payment_events"
  DROP CONSTRAINT IF EXISTS "module_app_payment_events_provider_check";
--> statement-breakpoint
ALTER TABLE "module_app_payment_events"
  ADD CONSTRAINT "module_app_payment_events_provider_check"
  CHECK ("provider" IN ('alipay', 'wechat_pay', 'zpay'));
--> statement-breakpoint
ALTER TABLE "module_app_payment_refunds"
  DROP CONSTRAINT IF EXISTS "module_app_payment_refunds_provider_check";
--> statement-breakpoint
ALTER TABLE "module_app_payment_refunds"
  ADD CONSTRAINT "module_app_payment_refunds_provider_check"
  CHECK ("provider" IN ('alipay', 'wechat_pay', 'zpay'));
--> statement-breakpoint
ALTER TABLE "module_app_payment_discrepancies"
  DROP CONSTRAINT IF EXISTS "module_app_payment_discrepancies_provider_check";
--> statement-breakpoint
ALTER TABLE "module_app_payment_discrepancies"
  ADD CONSTRAINT "module_app_payment_discrepancies_provider_check"
  CHECK ("provider" IN ('alipay', 'wechat_pay', 'zpay'));
