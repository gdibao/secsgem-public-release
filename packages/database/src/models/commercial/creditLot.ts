import type { CreditConsumeAllocation, CreditSourceType } from '@lobechat/types';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import {
  creditAccounts,
  creditDebts,
  creditLedgerEntries,
  creditLots,
  topUpOrders,
  userPlanSnapshots,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { addCalendarMonths } from './calendar';

type CreditLotModelOptions = {
  now?: () => Date;
};

const remainingAmount = (lot: typeof creditLots.$inferSelect) =>
  Math.max(
    0,
    Number(lot.grantedAmount) -
      Number(lot.consumedAmount) -
      Number(lot.expiredAmount) -
      Number(lot.refundedAmount),
  );

const CREDIT_SOURCE_PRIORITY: CreditSourceType[] = ['subscription', 'referral', 'topup', 'other'];

type CreditSourceReplay = Record<CreditSourceType, { available: number; consumed: number }>;

const createCreditSourceReplay = (): CreditSourceReplay => ({
  other: { available: 0, consumed: 0 },
  referral: { available: 0, consumed: 0 },
  subscription: { available: 0, consumed: 0 },
  topup: { available: 0, consumed: 0 },
});

const resolveGrantSource = (type: string): CreditSourceType => {
  switch (type) {
    case 'subscription_grant': {
      return 'subscription';
    }
    case 'referral_reward': {
      return 'referral';
    }
    case 'topup': {
      return 'topup';
    }
    default: {
      return 'other';
    }
  }
};

const normalizeConsumeAllocations = (value: unknown): CreditConsumeAllocation[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const amount = Number((item as { amount?: unknown }).amount);
    const source = (item as { source?: unknown }).source;
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      typeof source !== 'string' ||
      !CREDIT_SOURCE_PRIORITY.includes(source as CreditSourceType)
    ) {
      return [];
    }

    return [{ amount, source: source as CreditSourceType }];
  });
};

const applyConsumeAllocations = (
  replay: CreditSourceReplay,
  allocations: CreditConsumeAllocation[],
) => {
  for (const allocation of allocations) {
    replay[allocation.source].available -= allocation.amount;
    replay[allocation.source].consumed += allocation.amount;
  }
};

const allocateBySourcePriority = (replay: CreditSourceReplay, amount: number) => {
  const allocations: CreditConsumeAllocation[] = [];
  let remaining = amount;

  for (const source of CREDIT_SOURCE_PRIORITY) {
    if (remaining <= 0) break;
    const allocated = Math.min(Math.max(replay[source].available, 0), remaining);
    if (allocated <= 0) continue;
    allocations.push({ amount: allocated, source });
    remaining -= allocated;
  }

  if (remaining > 0) allocations.push({ amount: remaining, source: 'other' });
  return allocations;
};

const parseDate = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolveValidityMonths = (value: unknown) => {
  const months = Number(value);
  return Number.isInteger(months) && months > 0 ? Math.min(months, 1200) : 12;
};

export class CreditLotModel {
  private readonly now: () => Date;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    options: CreditLotModelOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  private ensureAccount = (tx: Transaction) =>
    tx.insert(creditAccounts).values({ userId: this.userId }).onConflictDoNothing();

  private ensureLegacyExpiringLotsTracked = async (tx: Transaction) => {
    const eligibleGrant = or(
      and(
        eq(creditLedgerEntries.type, 'subscription_grant'),
        eq(creditLedgerEntries.referenceType, 'subscription_snapshot_period'),
      ),
      and(
        eq(creditLedgerEntries.type, 'topup'),
        eq(creditLedgerEntries.referenceType, 'top_up_order'),
      ),
    );
    const [missingGrant] = await tx
      .select({ id: creditLedgerEntries.id })
      .from(creditLedgerEntries)
      .leftJoin(creditLots, eq(creditLots.grantLedgerEntryId, creditLedgerEntries.id))
      .where(and(eq(creditLedgerEntries.userId, this.userId), eligibleGrant, isNull(creditLots.id)))
      .limit(1);
    if (!missingGrant) return;

    const ledgerEntries = await tx
      .select({
        amount: creditLedgerEntries.amount,
        createdAt: creditLedgerEntries.createdAt,
        id: creditLedgerEntries.id,
        metadata: creditLedgerEntries.metadata,
        referenceId: creditLedgerEntries.referenceId,
        referenceType: creditLedgerEntries.referenceType,
        type: creditLedgerEntries.type,
      })
      .from(creditLedgerEntries)
      .where(eq(creditLedgerEntries.userId, this.userId))
      .orderBy(asc(creditLedgerEntries.createdAt), asc(creditLedgerEntries.id));
    const trackedLots = await tx
      .select()
      .from(creditLots)
      .where(eq(creditLots.userId, this.userId))
      .for('update');
    const trackedGrantIds = new Set(trackedLots.map((lot) => lot.grantLedgerEntryId));

    const replay = createCreditSourceReplay();
    for (const entry of ledgerEntries) {
      const amount = Number(entry.amount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      if (amount > 0) {
        replay[resolveGrantSource(entry.type)].available += amount;
        continue;
      }

      const debitAmount = Math.abs(amount);
      const allocations = normalizeConsumeAllocations(entry.metadata?.allocations);
      const explicitlyAllocated = allocations.reduce((total, item) => total + item.amount, 0);
      applyConsumeAllocations(replay, allocations);
      if (explicitlyAllocated < debitAmount) {
        const fallbackAllocations = allocateBySourcePriority(
          replay,
          debitAmount - explicitlyAllocated,
        );
        applyConsumeAllocations(replay, fallbackAllocations);
      }
    }

    const trackedRemoved: Record<'subscription' | 'topup', number> = {
      subscription: 0,
      topup: 0,
    };
    for (const lot of trackedLots) {
      if (lot.source !== 'subscription' && lot.source !== 'topup') continue;
      trackedRemoved[lot.source] +=
        Number(lot.consumedAmount) + Number(lot.expiredAmount) + Number(lot.refundedAmount);
    }

    const untrackedGrants = ledgerEntries.filter((entry) => {
      if (trackedGrantIds.has(entry.id) || Number(entry.amount) <= 0) return false;
      const source = resolveGrantSource(entry.type);
      return source === 'subscription' || source === 'topup';
    });
    const topUpReferenceIds = untrackedGrants.flatMap((entry) =>
      entry.type === 'topup' && entry.referenceType === 'top_up_order' && entry.referenceId
        ? [entry.referenceId]
        : [],
    );
    const topUpRows =
      topUpReferenceIds.length > 0
        ? await tx
            .select({
              creditsExpiresAt: topUpOrders.creditsExpiresAt,
              id: topUpOrders.id,
              metadata: topUpOrders.metadata,
              paidAt: topUpOrders.paidAt,
            })
            .from(topUpOrders)
            .where(
              and(eq(topUpOrders.userId, this.userId), inArray(topUpOrders.id, topUpReferenceIds)),
            )
        : [];
    const topUpById = new Map(topUpRows.map((order) => [order.id, order]));
    const snapshotIds = untrackedGrants.flatMap((entry) => {
      const snapshotId = entry.metadata?.snapshotId;
      return entry.type === 'subscription_grant' && typeof snapshotId === 'string'
        ? [snapshotId]
        : [];
    });
    const snapshotRows =
      snapshotIds.length > 0
        ? await tx
            .select({ endsAt: userPlanSnapshots.endsAt, id: userPlanSnapshots.id })
            .from(userPlanSnapshots)
            .where(
              and(
                eq(userPlanSnapshots.userId, this.userId),
                inArray(userPlanSnapshots.id, snapshotIds),
              ),
            )
        : [];
    const snapshotById = new Map(snapshotRows.map((snapshot) => [snapshot.id, snapshot]));

    const legacyGrants = untrackedGrants.map((entry) => {
      const source = resolveGrantSource(entry.type) as 'subscription' | 'topup';
      let expiresAt: Date | null = null;
      let shouldTrack = false;

      if (entry.referenceType === 'top_up_order' && entry.referenceId) {
        shouldTrack = true;
        const order = topUpById.get(entry.referenceId);
        expiresAt =
          order?.creditsExpiresAt ??
          parseDate(entry.metadata?.creditsExpiresAt) ??
          addCalendarMonths(
            order?.paidAt ?? entry.createdAt,
            resolveValidityMonths(order?.metadata?.validityMonths),
          );
      } else if (entry.referenceType === 'subscription_snapshot_period' && entry.referenceId) {
        shouldTrack = true;
        const periodStart = parseDate(entry.metadata?.periodStart) ?? entry.createdAt;
        const periodEnd = addCalendarMonths(periodStart, 1);
        const snapshotId = entry.metadata?.snapshotId;
        const snapshot = typeof snapshotId === 'string' ? snapshotById.get(snapshotId) : undefined;
        expiresAt = snapshot?.endsAt && snapshot.endsAt < periodEnd ? snapshot.endsAt : periodEnd;
      }

      return {
        amount: Number(entry.amount),
        consumedAmount: 0,
        createdAt: entry.createdAt,
        expiresAt,
        grantLedgerEntryId: entry.id,
        referenceId: entry.referenceId,
        referenceType: entry.referenceType,
        shouldTrack,
        source,
      };
    });

    for (const source of ['subscription', 'topup'] as const) {
      let remainingConsumed = Math.max(0, replay[source].consumed - trackedRemoved[source]);
      const grants = legacyGrants
        .filter((grant) => grant.source === source)
        .sort((left, right) => {
          if (left.expiresAt && right.expiresAt) {
            const expiryDifference = left.expiresAt.getTime() - right.expiresAt.getTime();
            if (expiryDifference !== 0) return expiryDifference;
          } else if (left.expiresAt) {
            return -1;
          } else if (right.expiresAt) {
            return 1;
          }
          const createdDifference = left.createdAt.getTime() - right.createdAt.getTime();
          return (
            createdDifference || left.grantLedgerEntryId.localeCompare(right.grantLedgerEntryId)
          );
        });

      for (const grant of grants) {
        if (remainingConsumed <= 0) break;
        grant.consumedAmount = Math.min(grant.amount, remainingConsumed);
        remainingConsumed -= grant.consumedAmount;
      }
      if (remainingConsumed > 0) {
        throw new Error('CREDIT_LOT_LEGACY_RECONSTRUCTION_FAILED');
      }
    }

    const lotsToCreate = legacyGrants.filter(
      (grant) =>
        grant.shouldTrack &&
        grant.referenceId &&
        grant.referenceType &&
        Number.isFinite(grant.amount) &&
        grant.amount > 0,
    );
    if (lotsToCreate.length === 0) return;

    await tx
      .insert(creditLots)
      .values(
        lotsToCreate.map((grant) => ({
          consumedAmount: grant.consumedAmount,
          expiresAt: grant.expiresAt,
          grantLedgerEntryId: grant.grantLedgerEntryId,
          grantedAmount: grant.amount,
          referenceId: grant.referenceId!,
          referenceType: grant.referenceType!,
          source: grant.source,
          userId: this.userId,
        })),
      )
      .onConflictDoNothing();
  };

  assertNoOpenDebt = async (db: LobeChatDatabase | Transaction = this.db) => {
    const debt = await db.query.creditDebts.findFirst({
      columns: { id: true },
      where: and(eq(creditDebts.userId, this.userId), eq(creditDebts.status, 'open')),
    });
    if (debt) throw new Error('COMMERCIAL_CREDIT_DEBT_OUTSTANDING');
  };

  createLot = async (
    input: {
      amount: number;
      expiresAt?: Date | null;
      grantLedgerEntryId: string;
      referenceId: string;
      referenceType: string;
      source: CreditSourceType;
    },
    tx: Transaction,
  ) => {
    const [created] = await tx
      .insert(creditLots)
      .values({
        expiresAt: input.expiresAt ?? null,
        grantLedgerEntryId: input.grantLedgerEntryId,
        grantedAmount: input.amount,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        source: input.source,
        userId: this.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    const existing = await tx.query.creditLots.findFirst({
      where: and(
        eq(creditLots.userId, this.userId),
        eq(creditLots.referenceType, input.referenceType),
        eq(creditLots.referenceId, input.referenceId),
      ),
    });
    if (!existing) throw new Error('CREDIT_LOT_CREATE_FAILED');
    if (
      Number(existing.grantedAmount) !== input.amount ||
      existing.grantLedgerEntryId !== input.grantLedgerEntryId ||
      existing.source !== input.source ||
      existing.expiresAt?.getTime() !== input.expiresAt?.getTime()
    ) {
      throw new Error('CREDIT_LOT_IDEMPOTENCY_CONFLICT');
    }
    return existing;
  };

  expireDueLots = async (tx: Transaction) => {
    await this.ensureAccount(tx);
    const [account] = await tx
      .select({ balance: creditAccounts.balance })
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, this.userId))
      .for('update');
    if (!account) throw new Error('CREDIT_ACCOUNT_NOT_FOUND');

    await this.ensureLegacyExpiringLotsTracked(tx);

    const now = this.now();
    const lots = await tx
      .select()
      .from(creditLots)
      .where(
        and(
          eq(creditLots.userId, this.userId),
          eq(creditLots.status, 'active'),
          lte(creditLots.expiresAt, now),
          gt(
            sql`${creditLots.grantedAmount} - ${creditLots.consumedAmount} - ${creditLots.expiredAmount} - ${creditLots.refundedAmount}`,
            0,
          ),
        ),
      )
      .orderBy(asc(creditLots.expiresAt), asc(creditLots.createdAt))
      .for('update');

    let balance = Number(account.balance);
    let expiredTotal = 0;
    for (const lot of lots) {
      const amount = remainingAmount(lot);
      if (amount <= 0) continue;
      if (balance < amount) throw new Error('CREDIT_LOT_BALANCE_INCONSISTENT');

      balance -= amount;
      expiredTotal += amount;
      await tx
        .update(creditAccounts)
        .set({
          balance,
          totalDebited: sql`${creditAccounts.totalDebited} + ${amount}`,
          updatedAt: now,
        })
        .where(eq(creditAccounts.userId, this.userId));
      await tx.insert(creditLedgerEntries).values({
        amount: -amount,
        balanceAfter: balance,
        description: `Expired ${amount} credits`,
        metadata: {
          allocations: [{ amount, source: lot.source }],
          creditLotId: lot.id,
          expiresAt: lot.expiresAt?.toISOString(),
        },
        referenceId: lot.id,
        referenceType: 'credit_lot_expiry',
        title: 'Credits Expired',
        type: 'expire',
        userId: this.userId,
      });
      await tx
        .update(creditLots)
        .set({
          expiredAmount: sql`${creditLots.expiredAmount} + ${amount}`,
          status: 'expired',
          updatedAt: now,
        })
        .where(eq(creditLots.id, lot.id));
    }

    return expiredTotal;
  };

  consumeExpiringLots = async (
    tx: Transaction,
    amount: number,
    source?: CreditSourceType,
  ): Promise<CreditConsumeAllocation[]> => {
    if (!Number.isFinite(amount) || amount <= 0) return [];
    await this.ensureLegacyExpiringLotsTracked(tx);
    const now = this.now();
    const lots = await tx
      .select()
      .from(creditLots)
      .where(
        and(
          eq(creditLots.userId, this.userId),
          eq(creditLots.status, 'active'),
          source ? eq(creditLots.source, source) : undefined,
          or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, now)),
          gt(
            sql`${creditLots.grantedAmount} - ${creditLots.consumedAmount} - ${creditLots.expiredAmount} - ${creditLots.refundedAmount}`,
            0,
          ),
        ),
      )
      .orderBy(asc(creditLots.expiresAt), asc(creditLots.createdAt))
      .for('update');

    let remaining = amount;
    const allocations: CreditConsumeAllocation[] = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const allocated = Math.min(remainingAmount(lot), remaining);
      if (allocated <= 0) continue;
      await tx
        .update(creditLots)
        .set({
          consumedAmount: sql`${creditLots.consumedAmount} + ${allocated}`,
          updatedAt: now,
        })
        .where(eq(creditLots.id, lot.id));
      allocations.push({ amount: allocated, lotId: lot.id, source: lot.source });
      remaining -= allocated;
    }
    return allocations;
  };

  getAvailableTrackedAmount = async (tx: Transaction) => {
    const now = this.now();
    const [row] = await tx
      .select({
        amount: sql<number>`COALESCE(SUM(
          ${creditLots.grantedAmount} - ${creditLots.consumedAmount} - ${creditLots.expiredAmount} - ${creditLots.refundedAmount}
        ), 0)`,
      })
      .from(creditLots)
      .where(
        and(
          eq(creditLots.userId, this.userId),
          eq(creditLots.status, 'active'),
          or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, now)),
        ),
      );
    return Number(row?.amount ?? 0);
  };

  listRefundableSubscriptionLotReferences = async (
    input: { periodStartsAt: Date; snapshotId: string },
    tx: Transaction,
  ) => {
    await this.ensureLegacyExpiringLotsTracked(tx);

    const rows = await tx
      .select({
        metadata: creditLedgerEntries.metadata,
        referenceId: creditLots.referenceId,
      })
      .from(creditLots)
      .innerJoin(creditLedgerEntries, eq(creditLedgerEntries.id, creditLots.grantLedgerEntryId))
      .where(
        and(
          eq(creditLots.userId, this.userId),
          eq(creditLots.source, 'subscription'),
          eq(creditLots.referenceType, 'subscription_snapshot_period'),
          eq(creditLedgerEntries.type, 'subscription_grant'),
          eq(creditLedgerEntries.referenceType, 'subscription_snapshot_period'),
        ),
      )
      .orderBy(asc(creditLedgerEntries.createdAt), asc(creditLedgerEntries.id));

    return rows.flatMap((row) => {
      if (row.metadata?.snapshotId !== input.snapshotId) return [];
      const periodStart = parseDate(row.metadata?.periodStart);
      if (!periodStart || periodStart < input.periodStartsAt) return [];
      return [row.referenceId];
    });
  };

  refundLot = async (
    input: {
      debtReason?: string;
      metadata?: Record<string, unknown>;
      referenceId: string;
      referenceType: string;
      refundLedgerReferenceType?: string;
    },
    tx: Transaction,
  ) => {
    await this.ensureAccount(tx);
    const [account] = await tx
      .select({ balance: creditAccounts.balance })
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, this.userId))
      .for('update');
    if (!account) throw new Error('CREDIT_ACCOUNT_NOT_FOUND');

    await this.ensureLegacyExpiringLotsTracked(tx);

    const [lot] = await tx
      .select()
      .from(creditLots)
      .where(
        and(
          eq(creditLots.userId, this.userId),
          eq(creditLots.referenceType, input.referenceType),
          eq(creditLots.referenceId, input.referenceId),
        ),
      )
      .for('update');
    if (!lot) throw new Error('CREDIT_LOT_NOT_FOUND');
    if (lot.status === 'refunded') {
      return {
        debtAmount: Number(lot.consumedAmount),
        removedAmount: Number(lot.refundedAmount),
      };
    }

    const now = this.now();
    const removedAmount = remainingAmount(lot);
    const debtAmount = Number(lot.consumedAmount);
    if (removedAmount > Number(account.balance)) {
      throw new Error('CREDIT_LOT_BALANCE_INCONSISTENT');
    }
    if (removedAmount > 0) {
      const balanceAfter = Number(account.balance) - removedAmount;
      await tx
        .update(creditAccounts)
        .set({
          balance: balanceAfter,
          totalDebited: sql`${creditAccounts.totalDebited} + ${removedAmount}`,
          updatedAt: now,
        })
        .where(eq(creditAccounts.userId, this.userId));
      await tx.insert(creditLedgerEntries).values({
        amount: -removedAmount,
        balanceAfter,
        description: `Reversed credits for refunded ${
          input.refundLedgerReferenceType === 'subscription_refund' ? 'subscription' : 'top-up'
        } ${input.referenceId}`,
        metadata: {
          ...input.metadata,
          allocations: [{ amount: removedAmount, source: lot.source }],
          creditLotId: lot.id,
        },
        referenceId: input.referenceId,
        referenceType: input.refundLedgerReferenceType ?? 'top_up_refund',
        title:
          input.refundLedgerReferenceType === 'subscription_refund'
            ? 'Subscription Refund'
            : 'Top-up Refund',
        type: 'refund',
        userId: this.userId,
      });
    }

    await tx
      .update(creditLots)
      .set({ refundedAmount: removedAmount, status: 'refunded', updatedAt: now })
      .where(eq(creditLots.id, lot.id));

    if (debtAmount > 0) {
      await tx
        .insert(creditDebts)
        .values({
          amount: debtAmount,
          metadata: input.metadata ?? {},
          reason: input.debtReason ?? 'refunded_credits_already_consumed',
          referenceId: input.referenceId,
          referenceType: input.referenceType,
          userId: this.userId,
        })
        .onConflictDoUpdate({
          set: {
            amount: debtAmount,
            metadata: input.metadata ?? {},
            resolvedAt: null,
            status: 'open',
            updatedAt: now,
          },
          target: [creditDebts.userId, creditDebts.referenceType, creditDebts.referenceId],
        });
    }

    return { debtAmount, removedAmount };
  };
}
