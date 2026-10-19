CREATE TABLE "referral_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"code" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_profiles" ADD CONSTRAINT "referral_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_profiles_code_idx" ON "referral_profiles" USING btree ("code");