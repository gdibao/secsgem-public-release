import type { ModuleAppPayoutStatus } from '@lobechat/types';
import { and, eq, inArray, lte } from 'drizzle-orm';

import {
  moduleAppPayoutBatches,
  moduleAppPayoutEntries,
  moduleAppPublishers,
  moduleAppRevenueEntries,
} from '../schemas';
import type { LobeChatDatabase } from '../type';

const roundMoney = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const DEFAULT_PAYOUT_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

const payoutTransitions: Record<ModuleAppPayoutStatus, ModuleAppPayoutStatus[]> = {
  eligible: ['processing', 'paid'],
  failed: ['processing'],
  paid: ['reversed'],
  pending: ['eligible'],
  processing: ['failed', 'paid'],
  reversed: [],
};

const isTransactionIdentityConflict = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { cause?: unknown; code?: unknown; constraint?: unknown };
  if (
    candidate.code === '23505' &&
    candidate.constraint === 'module_app_payout_batches_transaction_unique'
  ) {
    return true;
  }
  return isTransactionIdentityConflict(candidate.cause);
};

export class ModuleAppPayoutModel {
  private readonly settlementDelayMs: number;

  constructor(
    private readonly db: LobeChatDatabase,
    options: { settlementDelayMs?: number } = {},
  ) {
    this.settlementDelayMs = options.settlementDelayMs ?? DEFAULT_PAYOUT_DELAY_MS;
    if (this.settlementDelayMs < 0) throw new Error('MODULE_APP_PAYOUT_DELAY_INVALID');
  }

  getBatch = async (batchId: string) =>
    (await this.db.query.moduleAppPayoutBatches.findFirst({
      where: eq(moduleAppPayoutBatches.id, batchId),
    })) ?? null;

  createEligibleBatch = async (input: {
    publisherId: string;
    requestedAmount: number;
    revenueEntryIds: string[];
  }) =>
    this.db.transaction(async (tx) => {
      if (
        input.revenueEntryIds.length === 0 ||
        input.revenueEntryIds.length > 500 ||
        new Set(input.revenueEntryIds).size !== input.revenueEntryIds.length ||
        !Number.isFinite(input.requestedAmount) ||
        input.requestedAmount <= 0
      ) {
        throw new Error('MODULE_APP_PAYOUT_INPUT_INVALID');
      }
      const publisher = await tx.query.moduleAppPublishers.findFirst({
        where: and(
          eq(moduleAppPublishers.id, input.publisherId),
          eq(moduleAppPublishers.status, 'verified'),
        ),
      });
      if (!publisher?.recipientMask) throw new Error('MODULE_APP_PAYOUT_PUBLISHER_NOT_ELIGIBLE');
      const entries = await tx
        .select()
        .from(moduleAppRevenueEntries)
        .where(
          and(
            inArray(moduleAppRevenueEntries.id, input.revenueEntryIds),
            eq(moduleAppRevenueEntries.publisherId, publisher.id),
            eq(moduleAppRevenueEntries.status, 'pending'),
            eq(moduleAppRevenueEntries.type, 'accrual'),
            lte(moduleAppRevenueEntries.createdAt, new Date(Date.now() - this.settlementDelayMs)),
          ),
        )
        .for('update');
      if (entries.length !== input.revenueEntryIds.length) {
        throw new Error('MODULE_APP_PAYOUT_REVENUE_NOT_ELIGIBLE');
      }
      for (const entry of entries) {
        const reversal = await tx.query.moduleAppRevenueEntries.findFirst({
          where: and(
            eq(moduleAppRevenueEntries.orderId, entry.orderId),
            eq(moduleAppRevenueEntries.type, 'reversal'),
          ),
        });
        if (reversal) throw new Error('MODULE_APP_PAYOUT_REVENUE_NOT_ELIGIBLE');
      }
      const currencies = new Set(entries.map((entry) => entry.currency));
      if (currencies.size !== 1) throw new Error('MODULE_APP_PAYOUT_CURRENCY_MISMATCH');
      const eligibleAmount = roundMoney(
        entries.reduce((sum, entry) => sum + entry.developerAmount + entry.reserveAmount, 0),
      );
      if (input.requestedAmount > eligibleAmount) {
        throw new Error('MODULE_APP_PAYOUT_AMOUNT_EXCEEDS_ELIGIBLE');
      }
      if (roundMoney(input.requestedAmount) !== eligibleAmount) {
        throw new Error('MODULE_APP_PAYOUT_AMOUNT_MISMATCH');
      }
      const [batch] = await tx
        .insert(moduleAppPayoutBatches)
        .values({
          currency: entries[0].currency,
          publisherId: publisher.id,
          recipientMask: publisher.recipientMask,
          status: 'eligible',
          totalAmount: eligibleAmount,
        })
        .returning();
      if (!batch) throw new Error('MODULE_APP_PAYOUT_BATCH_CREATE_FAILED');
      await tx.insert(moduleAppPayoutEntries).values(
        entries.map((entry) => ({
          amount: roundMoney(entry.developerAmount + entry.reserveAmount),
          batchId: batch.id,
          revenueEntryId: entry.id,
          status: 'eligible' as const,
        })),
      );
      return batch;
    });

  transitionBatch = async (input: {
    batchId: string;
    failureReason?: string;
    status: Exclude<ModuleAppPayoutStatus, 'paid'>;
  }) =>
    this.db.transaction(async (tx) => {
      const [batch] = await tx
        .select()
        .from(moduleAppPayoutBatches)
        .where(eq(moduleAppPayoutBatches.id, input.batchId))
        .for('update');
      if (!batch) throw new Error('MODULE_APP_PAYOUT_BATCH_NOT_FOUND');
      if (batch.status === input.status) return batch;
      if (!payoutTransitions[batch.status].includes(input.status)) {
        throw new Error('MODULE_APP_PAYOUT_TRANSITION_INVALID');
      }

      const failureReason = input.failureReason?.trim();
      if (input.status === 'failed' && !failureReason) {
        throw new Error('MODULE_APP_PAYOUT_FAILURE_REASON_REQUIRED');
      }
      const now = new Date();
      const [updated] = await tx
        .update(moduleAppPayoutBatches)
        .set({
          failureReason: input.status === 'failed' ? failureReason : null,
          processedAt: input.status === 'processing' ? now : batch.processedAt,
          status: input.status,
        })
        .where(
          and(
            eq(moduleAppPayoutBatches.id, batch.id),
            eq(moduleAppPayoutBatches.status, batch.status),
          ),
        )
        .returning();
      if (!updated) throw new Error('MODULE_APP_PAYOUT_TRANSITION_CONFLICT');

      await tx
        .update(moduleAppPayoutEntries)
        .set({ status: input.status })
        .where(eq(moduleAppPayoutEntries.batchId, batch.id));

      if (input.status === 'reversed') {
        const payoutEntries = await tx.query.moduleAppPayoutEntries.findMany({
          where: eq(moduleAppPayoutEntries.batchId, batch.id),
        });
        await tx
          .update(moduleAppRevenueEntries)
          .set({ settlementBatchId: null, settledAt: null, status: 'pending' })
          .where(
            inArray(
              moduleAppRevenueEntries.id,
              payoutEntries.map((entry) => entry.revenueEntryId),
            ),
          );
      }

      return updated;
    });

  recordManualAlipayPayout = async (input: {
    actorUserId: string;
    batchId: string;
    evidenceReference: string;
    recipientMask: string;
    transactionNo: string;
  }) =>
    this.db
      .transaction(async (tx) => {
        const [batch] = await tx
          .select()
          .from(moduleAppPayoutBatches)
          .where(eq(moduleAppPayoutBatches.id, input.batchId))
          .for('update');
        if (!batch) throw new Error('MODULE_APP_PAYOUT_BATCH_NOT_FOUND');
        if (batch.status === 'paid') {
          if (batch.transactionNo !== input.transactionNo) {
            throw new Error('MODULE_APP_PAYOUT_TRANSACTION_CONFLICT');
          }
          return batch;
        }
        if (!['eligible', 'processing'].includes(batch.status)) {
          throw new Error('MODULE_APP_PAYOUT_BATCH_NOT_PAYABLE');
        }
        if (
          !input.actorUserId.trim() ||
          !input.evidenceReference.trim() ||
          !input.transactionNo.trim() ||
          input.recipientMask !== batch.recipientMask
        ) {
          throw new Error('MODULE_APP_PAYOUT_EVIDENCE_INVALID');
        }
        const evidenceReference = input.evidenceReference.trim();
        const transactionNo = input.transactionNo.trim();
        const transactionOwner = await tx.query.moduleAppPayoutBatches.findFirst({
          where: eq(moduleAppPayoutBatches.transactionNo, transactionNo),
        });
        if (transactionOwner && transactionOwner.id !== batch.id) {
          throw new Error('MODULE_APP_PAYOUT_TRANSACTION_CONFLICT');
        }
        const now = new Date();
        const [paid] = await tx
          .update(moduleAppPayoutBatches)
          .set({
            actorUserId: input.actorUserId,
            evidenceReference,
            paidAt: now,
            processedAt: now,
            status: 'paid',
            transactionNo,
          })
          .where(eq(moduleAppPayoutBatches.id, batch.id))
          .returning();
        if (!paid) throw new Error('MODULE_APP_PAYOUT_UPDATE_FAILED');
        const payoutEntries = await tx.query.moduleAppPayoutEntries.findMany({
          where: eq(moduleAppPayoutEntries.batchId, batch.id),
        });
        const revenueEntries = await tx
          .select()
          .from(moduleAppRevenueEntries)
          .where(
            inArray(
              moduleAppRevenueEntries.id,
              payoutEntries.map((entry) => entry.revenueEntryId),
            ),
          )
          .for('update');
        if (
          revenueEntries.length !== payoutEntries.length ||
          revenueEntries.some((entry) => entry.status !== 'pending')
        ) {
          throw new Error('MODULE_APP_PAYOUT_REVENUE_NOT_ELIGIBLE');
        }
        for (const entry of revenueEntries) {
          const reversal = await tx.query.moduleAppRevenueEntries.findFirst({
            where: and(
              eq(moduleAppRevenueEntries.orderId, entry.orderId),
              eq(moduleAppRevenueEntries.type, 'reversal'),
            ),
          });
          if (reversal) throw new Error('MODULE_APP_PAYOUT_REVENUE_NOT_ELIGIBLE');
        }
        await tx
          .update(moduleAppPayoutEntries)
          .set({ status: 'paid' })
          .where(eq(moduleAppPayoutEntries.batchId, batch.id));
        await tx
          .update(moduleAppRevenueEntries)
          .set({ settlementBatchId: batch.id, settledAt: now, status: 'settled' })
          .where(
            inArray(
              moduleAppRevenueEntries.id,
              payoutEntries.map((entry) => entry.revenueEntryId),
            ),
          );
        return paid;
      })
      .catch((error) => {
        if (isTransactionIdentityConflict(error)) {
          throw new Error('MODULE_APP_PAYOUT_TRANSACTION_CONFLICT', { cause: error });
        }
        throw error;
      });

  listPayouts = async (
    input: {
      cursor?: number;
      limit?: number;
      publisherId?: string;
      status?: 'eligible' | 'failed' | 'paid' | 'pending' | 'processing' | 'reversed';
    } = {},
  ) => {
    const cursor = Math.max(0, Math.floor(input.cursor ?? 0));
    const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));
    const items = await this.db.query.moduleAppPayoutBatches.findMany({
      limit: limit + 1,
      offset: cursor,
      orderBy: (rows, { desc }) => [desc(rows.createdAt), desc(rows.id)],
      where: and(
        input.publisherId ? eq(moduleAppPayoutBatches.publisherId, input.publisherId) : undefined,
        input.status ? eq(moduleAppPayoutBatches.status, input.status) : undefined,
      ),
    });
    return {
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? cursor + limit : null,
    };
  };
}
