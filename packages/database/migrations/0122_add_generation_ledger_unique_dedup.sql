CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_image_generation_unique_idx"
  ON "credit_ledger_entries" ("user_id", "reference_type", "reference_id", "type")
  WHERE "reference_type" = 'image_generation'
    AND "reference_id" IS NOT NULL
    AND "type" = 'consume';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_video_generation_unique_idx"
  ON "credit_ledger_entries" ("user_id", "reference_type", "reference_id", "type")
  WHERE "reference_type" = 'video_generation'
    AND "reference_id" IS NOT NULL
    AND "type" = 'consume';
