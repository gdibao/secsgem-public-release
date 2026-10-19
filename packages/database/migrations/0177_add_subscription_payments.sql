CREATE TABLE IF NOT EXISTS subscription_payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  plan text NOT NULL,
  cycle text NOT NULL,
  amount numeric NOT NULL,
  currency varchar(16) NOT NULL,
  snapshot jsonb NOT NULL,
  activation jsonb,
  provider text NOT NULL,
  method text NOT NULL,
  external_order_id text,
  checkout jsonb,
  payment_reference text,
  activated_snapshot_id uuid REFERENCES user_plan_snapshots(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  refunded_at timestamptz,
  refund_reference text,
  refund_status text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_payment_orders_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'canceled', 'refunded')),
  CONSTRAINT subscription_payment_orders_cycle_check
    CHECK (cycle IN ('monthly', 'yearly', 'one_time', 'lifetime')),
  CONSTRAINT subscription_payment_orders_provider_check
    CHECK (provider IN ('alipay', 'wechat_pay', 'zpay')),
  CONSTRAINT subscription_payment_orders_method_check
    CHECK (method IN ('alipay', 'wechat_pay', 'zpay_alipay', 'zpay_wechat')),
  CONSTRAINT subscription_payment_orders_provider_method_check
    CHECK (
      (provider = 'alipay' AND method = 'alipay')
      OR (provider = 'wechat_pay' AND method = 'wechat_pay')
      OR (provider = 'zpay' AND method IN ('zpay_alipay', 'zpay_wechat'))
    ),
  CONSTRAINT subscription_payment_orders_refund_status_check
    CHECK (refund_status IS NULL OR refund_status IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT subscription_payment_orders_amount_positive CHECK (amount > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_orders_user_idempotency_unique
  ON subscription_payment_orders (user_id, idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_orders_provider_external_unique
  ON subscription_payment_orders (provider, external_order_id)
  WHERE external_order_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_payment_orders_status_expires_idx
  ON subscription_payment_orders (status, expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_payment_orders_user_created_idx
  ON subscription_payment_orders (user_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS subscription_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid REFERENCES subscription_payment_orders(id) ON DELETE SET NULL,
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
  CONSTRAINT subscription_payment_events_type_check
    CHECK (event_type IN ('payment_succeeded', 'payment_failed', 'refund_succeeded')),
  CONSTRAINT subscription_payment_events_provider_check
    CHECK (provider IN ('alipay', 'wechat_pay', 'zpay')),
  CONSTRAINT subscription_payment_events_status_check
    CHECK (status IN ('received', 'processed', 'ignored', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_events_provider_event_unique
  ON subscription_payment_events (provider, event_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_payment_events_status_created_idx
  ON subscription_payment_events (status, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_payment_events_order_id_idx
  ON subscription_payment_events (order_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_entries_subscription_refund_unique
  ON credit_ledger_entries (user_id, reference_type, reference_id, type)
  WHERE reference_type = 'subscription_refund' AND reference_id IS NOT NULL AND type = 'refund';
