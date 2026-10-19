CREATE TABLE "auto_top_up_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"threshold" numeric(20, 6) DEFAULT 40000000 NOT NULL,
	"target_balance" numeric(20, 6) DEFAULT 120000000 NOT NULL,
	"monthly_limit" numeric(20, 6),
	"monthly_top_up_amount" numeric(20, 6) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_top_up_settings" ADD CONSTRAINT "auto_top_up_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_top_up_settings_updated_at_idx" ON "auto_top_up_settings" USING btree ("updated_at");
