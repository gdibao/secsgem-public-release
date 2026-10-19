import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';

import { ModuleAppCommerceModel } from '@/database/models/moduleAppCommerce';
import {
  moduleAppOrders,
  moduleAppPublishers,
  moduleAppRevenueEntries,
  moduleApps,
} from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

import { writeModuleAppAuditLog } from './audit';

const DEFAULT_SETTLEMENT_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const MONEY_SCALE = 1_000_000;

const roundMoney = (value: number) => Math.round(value * MONEY_SCALE) / MONEY_SCALE;

const parseRate = (value: string, name: string) => {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`MODULE_APP_REVENUE_${name}_INVALID`);
  }
  return rate;
};

export const calculateRevenue = ({
  gross,
  platformRate,
  refundableReserveRate,
}: {
  gross: number;
  platformRate: string;
  refundableReserveRate: string;
}) => {
  if (!Number.isFinite(gross) || gross < 0) throw new Error('MODULE_APP_REVENUE_GROSS_INVALID');
  const platformFee = roundMoney(gross * parseRate(platformRate, 'PLATFORM_RATE'));
  const afterPlatform = roundMoney(gross - platformFee);
  const reserve = roundMoney(afterPlatform * parseRate(refundableReserveRate, 'RESERVE_RATE'));
  return {
    developerPending: roundMoney(afterPlatform - reserve),
    platformFee,
    reserve,
  };
};

export class ModuleAppRevenueService {
  private readonly settlementDelayMs: number;

  constructor(
    private readonly db: LobeChatDatabase,
    options: { settlementDelayMs?: number } = {},
  ) {
    this.settlementDelayMs = options.settlementDelayMs ?? DEFAULT_SETTLEMENT_DELAY_MS;
    if (this.settlementDelayMs < 0) throw new Error('MODULE_APP_REVENUE_DELAY_INVALID');
  }

  accrueOrder = async ({
    orderId,
    publisherUserId,
    refundableReserveRate = '0.10',
  }: {
    orderId: string;
    publisherUserId?: string | null;
    refundableReserveRate?: string;
  }) =>
    this.db.transaction((tx) =>
      this.accrueOrderInTransaction(tx, {
        orderId,
        publisherUserId,
        refundableReserveRate,
      }),
    );

  accrueOrderInTransaction = async (
    tx: Transaction,
    {
      orderId,
      publisherUserId,
      refundableReserveRate = '0.10',
    }: {
      orderId: string;
      publisherUserId?: string | null;
      refundableReserveRate?: string;
    },
  ) => {
    const existing = await tx.query.moduleAppRevenueEntries.findFirst({
      where: and(
        eq(moduleAppRevenueEntries.orderId, orderId),
        eq(moduleAppRevenueEntries.type, 'accrual'),
      ),
    });
    if (existing) return existing;

    const order = await tx.query.moduleAppOrders.findFirst({
      where: and(eq(moduleAppOrders.id, orderId), eq(moduleAppOrders.status, 'paid')),
    });
    if (!order) throw new Error('MODULE_APP_REVENUE_ORDER_NOT_PAID');
    const app = await tx.query.moduleApps.findFirst({
      where: eq(moduleApps.id, order.appId),
    });
    const publisher = app?.publisherId
      ? await tx.query.moduleAppPublishers.findFirst({
          where: eq(moduleAppPublishers.id, app.publisherId),
        })
      : null;
    const resolvedPublisherUserId = publisher?.userId ?? publisherUserId ?? null;
    const gross = Number(order.snapshot.price);
    const revenueShareRate = String(order.snapshot.revenueShareRate ?? '0');
    const platformRate = String(roundMoney(1 - parseRate(revenueShareRate, 'SHARE_RATE')));
    const calculated = calculateRevenue({ gross, platformRate, refundableReserveRate });
    const [entry] = await tx
      .insert(moduleAppRevenueEntries)
      .values({
        appId: order.appId,
        currency: String(order.snapshot.currency),
        developerAmount: calculated.developerPending,
        grossAmount: gross,
        metadata: { platformRate, refundableReserveRate, revenueShareRate },
        orderId,
        platformFee: calculated.platformFee,
        publisherId: publisher?.id,
        publisherUserId: resolvedPublisherUserId,
        reserveAmount: calculated.reserve,
        type: 'accrual',
      })
      .returning();
    if (!entry) throw new Error('MODULE_APP_REVENUE_ACCRUAL_FAILED');
    return entry;
  };

  reverseOrder = async ({ orderId, reason }: { orderId: string; reason: string }) =>
    this.db.transaction((tx) => this.reverseOrderInTransaction(tx, { orderId, reason }));

  reverseOrderInTransaction = async (
    tx: Transaction,
    { orderId, reason }: { orderId: string; reason: string },
  ) => {
    if (!reason.trim()) throw new Error('MODULE_APP_REVENUE_REVERSAL_REASON_REQUIRED');
    const existing = await tx.query.moduleAppRevenueEntries.findFirst({
      where: and(
        eq(moduleAppRevenueEntries.orderId, orderId),
        eq(moduleAppRevenueEntries.type, 'reversal'),
      ),
    });
    if (existing) return existing;
    const accrual = await tx.query.moduleAppRevenueEntries.findFirst({
      where: and(
        eq(moduleAppRevenueEntries.orderId, orderId),
        eq(moduleAppRevenueEntries.type, 'accrual'),
      ),
    });
    if (!accrual) throw new Error('MODULE_APP_REVENUE_ACCRUAL_NOT_FOUND');
    const [entry] = await tx
      .insert(moduleAppRevenueEntries)
      .values({
        appId: accrual.appId,
        currency: accrual.currency,
        developerAmount: -accrual.developerAmount,
        grossAmount: -accrual.grossAmount,
        metadata: { accrualEntryId: accrual.id, reason },
        orderId,
        platformFee: -accrual.platformFee,
        publisherId: accrual.publisherId,
        publisherUserId: accrual.publisherUserId,
        reserveAmount: -accrual.reserveAmount,
        status: 'reversed',
        type: 'reversal',
      })
      .returning();
    if (!entry) throw new Error('MODULE_APP_REVENUE_REVERSAL_FAILED');
    return entry;
  };

  listRevenue = async ({
    cursor = 0,
    limit = 50,
    publisherUserId,
    status,
  }: {
    cursor?: number;
    limit?: number;
    publisherUserId?: string;
    status?: 'pending' | 'reversed' | 'settled';
  } = {}) => {
    const boundedCursor = Math.max(0, Math.floor(cursor));
    const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const items = await this.db.query.moduleAppRevenueEntries.findMany({
      limit: boundedLimit + 1,
      offset: boundedCursor,
      orderBy: desc(moduleAppRevenueEntries.createdAt),
      where: and(
        publisherUserId ? eq(moduleAppRevenueEntries.publisherUserId, publisherUserId) : undefined,
        status ? eq(moduleAppRevenueEntries.status, status) : undefined,
      ),
    });
    const hasMore = items.length > boundedLimit;
    return {
      items: items.slice(0, boundedLimit),
      nextCursor: hasMore ? boundedCursor + boundedLimit : null,
    };
  };

  settleBatch = async ({ actorUserId, entryIds }: { actorUserId: string; entryIds: string[] }) =>
    this.db.transaction((tx) => this.settleBatchInTransaction(tx, { actorUserId, entryIds }));

  settleBatchInTransaction = async (
    tx: Transaction,
    { actorUserId, entryIds }: { actorUserId: string; entryIds: string[] },
  ) => {
    if (
      !actorUserId.trim() ||
      entryIds.length === 0 ||
      entryIds.length > 500 ||
      new Set(entryIds).size !== entryIds.length
    ) {
      throw new Error('MODULE_APP_REVENUE_SETTLEMENT_INPUT_INVALID');
    }
    const entries = await tx
      .select()
      .from(moduleAppRevenueEntries)
      .where(inArray(moduleAppRevenueEntries.id, entryIds))
      .for('update');
    if (entries.length !== new Set(entryIds).size) {
      throw new Error('MODULE_APP_REVENUE_NOT_SETTLEABLE');
    }
    const cutoff = Date.now() - this.settlementDelayMs;
    for (const entry of entries) {
      const reversal = await tx.query.moduleAppRevenueEntries.findFirst({
        where: and(
          eq(moduleAppRevenueEntries.orderId, entry.orderId),
          eq(moduleAppRevenueEntries.type, 'reversal'),
        ),
      });
      if (
        entry.type !== 'accrual' ||
        entry.status !== 'pending' ||
        entry.createdAt.getTime() > cutoff ||
        reversal
      ) {
        throw new Error('MODULE_APP_REVENUE_NOT_SETTLEABLE');
      }
    }
    const batchId = randomUUID();
    const settledAt = new Date();
    await tx
      .update(moduleAppRevenueEntries)
      .set({ settlementBatchId: batchId, settledAt, status: 'settled' })
      .where(inArray(moduleAppRevenueEntries.id, entryIds));
    return { batchId, count: entries.length, settledAt };
  };

  settleBatchWithAudit = async (input: { actorUserId: string; entryIds: string[] }) =>
    this.db.transaction(async (tx) => {
      const result = await this.settleBatchInTransaction(tx, input);
      await writeModuleAppAuditLog({
        actorUserId: input.actorUserId,
        db: tx,
        eventType: 'module_app.revenue_settled',
        metadata: { entryCount: result.count, entryIds: input.entryIds },
        resourceId: result.batchId,
        resourceType: 'moduleAppRevenueBatch',
      });
      return result;
    });
}

export class ModuleAppOrderRevenueService {
  constructor(private readonly db: LobeChatDatabase) {}

  settleOrder = async (input: { actorUserId: string; orderId: string; paymentReference: string }) =>
    this.db.transaction(async (tx) => {
      const commerce = new ModuleAppCommerceModel(this.db);
      const revenue = new ModuleAppRevenueService(this.db);
      const order = await commerce.settleOrderInTransaction(tx, input);
      await revenue.accrueOrderInTransaction(tx, { orderId: input.orderId });
      await writeModuleAppAuditLog({
        actorUserId: input.actorUserId,
        db: tx,
        eventType: 'module_app.order_settled',
        metadata: { paymentReference: input.paymentReference },
        resourceId: input.orderId,
        resourceType: 'moduleAppOrder',
      });
      return order;
    });

  refundOrder = async (input: {
    actorUserId: string;
    orderId: string;
    reason: string;
    refundReference: string;
  }) =>
    this.db.transaction(async (tx) => {
      const commerce = new ModuleAppCommerceModel(this.db);
      const revenue = new ModuleAppRevenueService(this.db);
      const order = await commerce.refundOrderInTransaction(tx, input);
      await revenue.reverseOrderInTransaction(tx, {
        orderId: input.orderId,
        reason: input.reason,
      });
      await writeModuleAppAuditLog({
        actorUserId: input.actorUserId,
        db: tx,
        eventType: 'module_app.order_refunded',
        metadata: { reason: input.reason, refundReference: input.refundReference },
        resourceId: input.orderId,
        resourceType: 'moduleAppOrder',
      });
      return order;
    });
}
