CREATE TABLE IF NOT EXISTS "redemption_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"batch_id" varchar(64),
	"reward_type" varchar(32) NOT NULL,
	"plan_key" varchar(32),
	"plan_cycle" varchar(16),
	"plan_duration_months" numeric(20, 6),
	"credits_amount" numeric(20, 6),
	"topup_package_id" varchar(64),
	"note" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_user_id" text,
	"created_by_user_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemption_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "redemption_codes" ADD CONSTRAINT "redemption_codes_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "redemption_codes" ADD CONSTRAINT "redemption_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redemption_codes_status_idx" ON "redemption_codes" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redemption_codes_batch_idx" ON "redemption_codes" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redemption_codes_redeemed_user_idx" ON "redemption_codes" USING btree ("redeemed_by_user_id");
