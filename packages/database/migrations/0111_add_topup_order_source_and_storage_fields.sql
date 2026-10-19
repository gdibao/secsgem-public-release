ALTER TABLE "top_up_orders" ADD COLUMN "source" text;
--> statement-breakpoint
ALTER TABLE "top_up_orders" ADD COLUMN "redemption_code_id" text;
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD COLUMN "storage_used" numeric NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD COLUMN "storage_quota" numeric;
--> statement-breakpoint
CREATE INDEX "top_up_orders_source_idx" ON "top_up_orders" ("source");