CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_ppt_generation_unique_idx"
  ON "credit_ledger_entries" ("user_id", "reference_type", "reference_id", "type")
  WHERE "reference_type" = 'ppt_generation'
    AND "reference_id" IS NOT NULL
    AND "type" = 'consume';
