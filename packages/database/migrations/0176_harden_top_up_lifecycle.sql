ALTER TABLE top_up_orders
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS credits_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_amount numeric,
  ADD COLUMN IF NOT EXISTS refund_reference text,
  ADD COLUMN IF NOT EXISTS refund_status text;
--> statement-breakpoint
UPDATE top_up_orders
SET expires_at = created_at + INTERVAL '30 minutes'
WHERE expires_at IS NULL
  AND status = 'pending'
  AND provider IN ('alipay', 'wechat_pay', 'zpay');
--> statement-breakpoint
UPDATE top_up_orders
SET credits_expires_at = paid_at + make_interval(
  months => CASE
    WHEN metadata ->> 'validityMonths' ~ '^[1-9][0-9]{0,3}$'
      THEN LEAST((metadata ->> 'validityMonths')::integer, 1200)
    ELSE 12
  END
)
WHERE credits_expires_at IS NULL
  AND paid_at IS NOT NULL
  AND status IN ('paid', 'refunded');
--> statement-breakpoint
ALTER TABLE top_up_orders
  DROP CONSTRAINT IF EXISTS top_up_orders_refund_status_check;
--> statement-breakpoint
ALTER TABLE top_up_orders
  ADD CONSTRAINT top_up_orders_refund_status_check
  CHECK (refund_status IS NULL OR refund_status IN ('pending', 'succeeded', 'failed'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS top_up_orders_status_expires_at_idx
  ON top_up_orders (status, expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS top_up_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid REFERENCES top_up_orders(id) ON DELETE SET NULL,
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  out_trade_no text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  error_code text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT top_up_payment_events_type_check
    CHECK (event_type IN ('payment_succeeded', 'payment_failed', 'refund_succeeded')),
  CONSTRAINT top_up_payment_events_provider_check
    CHECK (provider IN ('alipay', 'wechat_pay', 'zpay')),
  CONSTRAINT top_up_payment_events_status_check
    CHECK (status IN ('received', 'processed', 'ignored', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS top_up_payment_events_provider_event_unique
  ON top_up_payment_events (provider, event_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS top_up_payment_events_status_created_idx
  ON top_up_payment_events (status, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS top_up_payment_events_order_id_idx
  ON top_up_payment_events (order_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_ledger_entry_id uuid NOT NULL UNIQUE REFERENCES credit_ledger_entries(id) ON DELETE CASCADE,
  source text NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  granted_amount numeric NOT NULL,
  consumed_amount numeric NOT NULL DEFAULT 0,
  expired_amount numeric NOT NULL DEFAULT 0,
  refunded_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_lots_source_check CHECK (source IN ('other', 'referral', 'subscription', 'topup')),
  CONSTRAINT credit_lots_status_check CHECK (status IN ('active', 'expired', 'refunded')),
  CONSTRAINT credit_lots_granted_amount_positive CHECK (granted_amount > 0),
  CONSTRAINT credit_lots_amounts_nonnegative
    CHECK (consumed_amount >= 0 AND expired_amount >= 0 AND refunded_amount >= 0),
  CONSTRAINT credit_lots_amounts_within_grant
    CHECK (consumed_amount + expired_amount + refunded_amount <= granted_amount)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS credit_lots_user_expiry_idx
  ON credit_lots (user_id, status, expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS credit_lots_reference_unique
  ON credit_lots (user_id, reference_type, reference_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS credit_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  reason text NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_debts_status_check CHECK (status IN ('open', 'resolved')),
  CONSTRAINT credit_debts_amount_positive CHECK (amount > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS credit_debts_reference_unique
  ON credit_debts (user_id, reference_type, reference_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS credit_debts_user_status_idx
  ON credit_debts (user_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_entries_credit_lot_expiry_unique
  ON credit_ledger_entries (user_id, reference_type, reference_id, type)
  WHERE reference_type = 'credit_lot_expiry' AND reference_id IS NOT NULL AND type = 'expire';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_entries_top_up_refund_unique
  ON credit_ledger_entries (user_id, reference_type, reference_id, type)
  WHERE reference_type = 'top_up_refund' AND reference_id IS NOT NULL AND type = 'refund';
