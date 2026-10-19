-- Add non-negative balance constraint to credit_accounts to prevent overdraft at DB level
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "credit_accounts" WHERE "balance" < 0) THEN
    RAISE EXCEPTION 'Cannot add credit_accounts_balance_nonneg: negative balances exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conname" = 'credit_accounts_balance_nonneg'
  ) THEN
    ALTER TABLE "credit_accounts"
      ADD CONSTRAINT "credit_accounts_balance_nonneg" CHECK ("balance" >= 0) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "credit_accounts"
  VALIDATE CONSTRAINT "credit_accounts_balance_nonneg";
