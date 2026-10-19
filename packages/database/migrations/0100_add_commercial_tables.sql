CREATE TABLE "credit_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" numeric(20, 6) DEFAULT 0 NOT NULL,
	"total_credited" numeric(20, 6) DEFAULT 0 NOT NULL,
	"total_debited" numeric(20, 6) DEFAULT 0 NOT NULL,
	"currency" varchar(16) DEFAULT 'CREDITS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"balance_after" numeric(20, 6) NOT NULL,
	"title" text,
	"description" text,
	"reference_type" text,
	"reference_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_user_id" text NOT NULL,
	"invitee_user_id" text NOT NULL,
	"code" text,
	"status" text DEFAULT 'registered' NOT NULL,
	"reward_credits" numeric(20, 6) DEFAULT 0 NOT NULL,
	"rewarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relation_id" uuid NOT NULL,
	"reward_user_id" text NOT NULL,
	"role" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT 0 NOT NULL,
	"ledger_entry_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "top_up_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credits" numeric(20, 6) DEFAULT 0 NOT NULL,
	"amount" numeric(20, 6) DEFAULT 0 NOT NULL,
	"currency" varchar(16) DEFAULT 'USD' NOT NULL,
	"provider" text,
	"external_order_id" text,
	"metadata" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_plan_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cycle" text DEFAULT 'monthly' NOT NULL,
	"monthly_credits" numeric(20, 6) DEFAULT 0 NOT NULL,
	"monthly_price" numeric(20, 6) DEFAULT 0 NOT NULL,
	"currency" varchar(16) DEFAULT 'USD' NOT NULL,
	"provider" text,
	"external_subscription_id" text,
	"metadata" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"renews_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_relations" ADD CONSTRAINT "referral_relations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_relations" ADD CONSTRAINT "referral_relations_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_relation_id_referral_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."referral_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_reward_user_id_users_id_fk" FOREIGN KEY ("reward_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_ledger_entry_id_credit_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."credit_ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_up_orders" ADD CONSTRAINT "top_up_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plan_snapshots" ADD CONSTRAINT "user_plan_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_accounts_updated_at_idx" ON "credit_accounts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_entries_user_id_idx" ON "credit_ledger_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_entries_user_created_at_idx" ON "credit_ledger_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_relations_inviter_user_id_idx" ON "referral_relations" USING btree ("inviter_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_relations_invitee_user_id_idx" ON "referral_relations" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_relation_id_idx" ON "referral_rewards" USING btree ("relation_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_reward_user_id_idx" ON "referral_rewards" USING btree ("reward_user_id");--> statement-breakpoint
CREATE INDEX "top_up_orders_user_id_idx" ON "top_up_orders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "top_up_orders_external_order_id_idx" ON "top_up_orders" USING btree ("provider","external_order_id");--> statement-breakpoint
CREATE INDEX "user_plan_snapshots_user_id_idx" ON "user_plan_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_plan_snapshots_user_started_at_idx" ON "user_plan_snapshots" USING btree ("user_id","started_at");