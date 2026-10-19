import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  creditDebts,
  creditLedgerEntries,
  creditLots,
  creditSettlementFailures,
  subscriptionChangeRequests,
  subscriptionPaymentEvents,
  subscriptionPaymentOrders,
  topUpOrders,
  topUpPaymentEvents,
  userPlanSnapshots,
} from './commercial';

const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).indexes.map((index) => index.config.name);
const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map((constraint) => constraint.name);

describe('commercial database invariants', () => {
  it('declares partial unique indexes in the live Drizzle schema', () => {
    expect(indexNames(userPlanSnapshots)).toContain(
      'user_plan_snapshots_one_active_per_user_unique',
    );
    expect(indexNames(userPlanSnapshots)).toContain('user_plan_snapshots_status_ends_at_idx');
    expect(indexNames(subscriptionChangeRequests)).toContain(
      'subscription_change_requests_one_pending_per_user_unique',
    );
    expect(indexNames(creditLedgerEntries)).toContain(
      'credit_ledger_entries_subscription_period_unique',
    );
    expect(indexNames(creditLedgerEntries)).toContain(
      'credit_ledger_entries_ai_usage_reservation_unique_idx',
    );
    expect(indexNames(topUpOrders)).toContain('top_up_orders_redemption_code_unique');
  });

  it('ships a data-safe migration before creating the unique indexes', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0146_harden_commercial_invariants.sql'),
      'utf8',
    );

    expect(migration).toContain('user_plan_snapshots_one_active_per_user_unique');
    expect(migration).toContain('subscription_change_requests_one_pending_per_user_unique');
    expect(migration).toContain('credit_ledger_entries_subscription_period_unique');
    expect(migration).toContain("'subscription_snapshot_period_legacy_duplicate'");
    expect(migration).toContain("'legacyDuplicateReferenceType'");
    expect(migration).not.toContain('DELETE FROM "credit_ledger_entries"');

    const cleanupPosition = migration.indexOf('WITH ranked_active_snapshots');
    const activeIndexPosition = migration.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS "user_plan_snapshots_one_active_per_user_unique"',
    );
    expect(cleanupPosition).toBeGreaterThanOrEqual(0);
    expect(activeIndexPosition).toBeGreaterThan(cleanupPosition);
  });

  it('registers the commercial invariant migration in the journal', () => {
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(journal.entries.some(({ tag }) => tag === '0146_harden_commercial_invariants')).toBe(
      true,
    );
  });

  it('ships a non-destructive manual membership expiry repair', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0174_repair_manual_membership_expiry.sql'),
      'utf8',
    );
    expect(migration).toContain("provider IN ('admin_manual', 'manual_preview')");
    expect(migration).toContain('ends_at = renews_at');
    expect(migration).toContain('RAISE NOTICE');
    expect(migration).not.toContain('DELETE FROM');

    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries.some(({ tag }) => tag === '0174_repair_manual_membership_expiry')).toBe(
      true,
    );
  });

  it('keeps payment lifecycle constraints aligned with the live Drizzle schema', () => {
    expect(checkNames(creditSettlementFailures)).toEqual(
      expect.arrayContaining([
        'credit_settlement_failures_status_check',
        'credit_settlement_failures_actual_amount_nonnegative',
        'credit_settlement_failures_attempts_positive',
      ]),
    );
    expect(checkNames(creditLots)).toEqual(
      expect.arrayContaining(['credit_lots_source_check', 'credit_lots_status_check']),
    );
    expect(checkNames(creditDebts)).toContain('credit_debts_status_check');
    expect(checkNames(subscriptionPaymentOrders)).toEqual(
      expect.arrayContaining([
        'subscription_payment_orders_provider_check',
        'subscription_payment_orders_method_check',
        'subscription_payment_orders_provider_method_check',
      ]),
    );
    expect(checkNames(subscriptionPaymentEvents)).toContain(
      'subscription_payment_events_provider_check',
    );
    expect(checkNames(topUpPaymentEvents)).toContain('top_up_payment_events_provider_check');
  });

  it('ships and registers the settlement, top-up, and subscription payment migrations', () => {
    const migrations = [
      ['0175_persist_credit_settlement_failures', 'credit_settlement_failures_attempts_positive'],
      ['0176_harden_top_up_lifecycle', 'top_up_payment_events_provider_check'],
      ['0177_add_subscription_payments', 'subscription_payment_orders_provider_method_check'],
    ] as const;
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    for (const [tag, requiredConstraint] of migrations) {
      const migration = readFileSync(
        path.resolve(__dirname, `../../migrations/${tag}.sql`),
        'utf8',
      );
      expect(migration).toContain(requiredConstraint);
      expect(migration).not.toContain('DELETE FROM');
      expect(journal.entries.some((entry) => entry.tag === tag)).toBe(true);
    }
  });

  it('ships and registers the transaction integrity migration', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0147_harden_commercial_transactions.sql'),
      'utf8',
    );

    expect(migration).toContain('top_up_orders_redemption_code_unique');
    expect(migration).toContain('credit_ledger_entries_ai_usage_reservation_unique_idx');
    expect(migration).toContain("'legacyDuplicateRedemptionCodeId'");
    expect(migration).toContain("'ai_usage_reservation_legacy_duplicate'");
    expect(migration).not.toContain('DELETE FROM "top_up_orders"');
    expect(migration).not.toContain('DELETE FROM "credit_ledger_entries"');

    const cleanupPosition = migration.indexOf('WITH ranked_redemption_orders');
    const indexPosition = migration.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS "top_up_orders_redemption_code_unique"',
    );
    expect(cleanupPosition).toBeGreaterThanOrEqual(0);
    expect(indexPosition).toBeGreaterThan(cleanupPosition);

    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries.some(({ tag }) => tag === '0147_harden_commercial_transactions')).toBe(
      true,
    );
  });
});
