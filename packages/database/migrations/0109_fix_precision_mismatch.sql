-- Fix numeric precision mismatch: migration 0104 created columns as numeric(20,4)
-- but Drizzle schema defines amountNumeric as numeric(20,6).
-- This migration aligns the DB columns with the schema.

-- plan_catalog columns
ALTER TABLE "plan_catalog"
  ALTER COLUMN "monthly_credits" TYPE numeric(20, 6),
  ALTER COLUMN "monthly_price" TYPE numeric(20, 6),
  ALTER COLUMN "yearly_price" TYPE numeric(20, 6),
  ALTER COLUMN "sort_order" TYPE numeric(20, 6);
--> statement-breakpoint

-- topup_packages columns
ALTER TABLE "topup_packages"
  ALTER COLUMN "credits" TYPE numeric(20, 6),
  ALTER COLUMN "amount" TYPE numeric(20, 6),
  ALTER COLUMN "validity_months" TYPE numeric(20, 6),
  ALTER COLUMN "sort_order" TYPE numeric(20, 6);
