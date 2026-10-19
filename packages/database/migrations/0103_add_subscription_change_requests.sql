CREATE TABLE "subscription_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"from_plan" text NOT NULL,
	"to_plan" text NOT NULL,
	"cycle" text DEFAULT 'monthly' NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_change_requests" ADD CONSTRAINT "subscription_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_change_requests_user_id_idx" ON "subscription_change_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_change_requests_user_status_idx" ON "subscription_change_requests" USING btree ("user_id","status");