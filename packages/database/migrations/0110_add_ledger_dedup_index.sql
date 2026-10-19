-- Add composite index for deduplication lookups on credit_ledger_entries.
-- This speeds up the EXISTS check in consumeCreditsForAiUsage and subscription grant sync.
CREATE INDEX IF NOT EXISTS "credit_ledger_entries_dedup_idx"
  ON "credit_ledger_entries" ("user_id", "reference_type", "reference_id", "type");
