DO $$
DECLARE
  affected_count bigint;
BEGIN
  SELECT COUNT(*)
  INTO affected_count
  FROM user_plan_snapshots
  WHERE status = 'active'
    AND provider IN ('admin_manual', 'manual_preview')
    AND cycle IN ('monthly', 'yearly')
    AND ends_at IS NULL
    AND renews_at IS NOT NULL;

  RAISE NOTICE 'Repairing % manual monthly/yearly membership snapshots with missing ends_at', affected_count;
END $$;
--> statement-breakpoint
UPDATE user_plan_snapshots
SET
  ends_at = renews_at,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'expiryRepair', '0174_repair_manual_membership_expiry',
    'expiryRepairedAt', NOW()
  ),
  updated_at = NOW()
WHERE status = 'active'
  AND provider IN ('admin_manual', 'manual_preview')
  AND cycle IN ('monthly', 'yearly')
  AND ends_at IS NULL
  AND renews_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_plan_snapshots_status_ends_at_idx
  ON user_plan_snapshots (status, ends_at);
