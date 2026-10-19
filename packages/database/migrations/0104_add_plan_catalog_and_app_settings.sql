CREATE TABLE IF NOT EXISTS "plan_catalog" (
  "plan" varchar(32) PRIMARY KEY NOT NULL,
  "display_name" text NOT NULL,
  "monthly_credits" numeric(20, 4) NOT NULL DEFAULT 0,
  "monthly_price" numeric(20, 4) NOT NULL DEFAULT 0,
  "yearly_price" numeric(20, 4) NOT NULL DEFAULT 0,
  "currency" varchar(16) NOT NULL DEFAULT 'USD',
  "features" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" numeric(20, 4) NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "topup_packages" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "display_name" text NOT NULL,
  "credits" numeric(20, 4) NOT NULL,
  "amount" numeric(20, 4) NOT NULL,
  "currency" varchar(16) NOT NULL DEFAULT 'USD',
  "validity_months" numeric(20, 4) NOT NULL DEFAULT 12,
  "recommended" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" numeric(20, 4) NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" varchar(128) PRIMARY KEY NOT NULL,
  "value" jsonb,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
