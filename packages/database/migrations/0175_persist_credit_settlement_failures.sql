ALTER TABLE credit_reservations
  DROP CONSTRAINT IF EXISTS credit_reservations_status_check;
--> statement-breakpoint
ALTER TABLE credit_reservations
  ADD CONSTRAINT credit_reservations_status_check
  CHECK (status IN ('active', 'expired', 'released', 'settled', 'settlement_failed'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS credit_settlement_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  reservation_id uuid NOT NULL UNIQUE REFERENCES credit_reservations(id) ON DELETE CASCADE,
  actual_amount numeric NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  error_code text,
  error_message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  last_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_settlement_failures_status_check CHECK (status IN ('pending', 'resolved')),
  CONSTRAINT credit_settlement_failures_actual_amount_nonnegative CHECK (actual_amount >= 0),
  CONSTRAINT credit_settlement_failures_attempts_positive CHECK (attempts >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS credit_settlement_failures_status_updated_idx
  ON credit_settlement_failures (status, updated_at);
