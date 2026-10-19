import type {
  ModuleAppPaymentProvider,
  PaymentCheckoutAction,
  PaymentMethodId,
} from '@lobechat/types';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import {
  moduleAppOrders,
  moduleAppPaymentAttempts,
  moduleAppPaymentDiscrepancies,
  moduleAppPaymentEvents,
  moduleAppPaymentRefunds,
} from '../schemas';
import type { LobeChatDatabase } from '../type';

export class ModuleAppPaymentModel {
  constructor(private readonly db: LobeChatDatabase) {}

  createPaymentAttempt = async (input: {
    currency: string;
    notifyUrl: string;
    orderId: string;
    outTradeNo: string;
    method: PaymentMethodId;
    provider: ModuleAppPaymentProvider;
    returnUrl: string;
    subject: string;
    totalAmount: string;
  }) =>
    this.db.transaction(async (tx) => {
      const [order] = await tx
        .select({ status: moduleAppOrders.status })
        .from(moduleAppOrders)
        .where(eq(moduleAppOrders.id, input.orderId))
        .for('update');
      if (!order) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
      if (order.status !== 'pending') throw new Error('MODULE_APP_ORDER_NOT_PAYABLE');

      const [attempt] = await tx
        .insert(moduleAppPaymentAttempts)
        .values(input)
        .onConflictDoNothing()
        .returning();
      if (attempt) return { attempt, created: true };
      const existing =
        (await tx.query.moduleAppPaymentAttempts.findFirst({
          where: and(
            eq(moduleAppPaymentAttempts.provider, input.provider),
            eq(moduleAppPaymentAttempts.outTradeNo, input.outTradeNo),
          ),
        })) ??
        (await tx.query.moduleAppPaymentAttempts.findFirst({
          orderBy: (attempts, { desc }) => [desc(attempts.createdAt)],
          where: eq(moduleAppPaymentAttempts.orderId, input.orderId),
        }));
      if (!existing) throw new Error('MODULE_APP_PAYMENT_ATTEMPT_CREATE_FAILED');
      if (
        existing.currency !== input.currency ||
        existing.method !== input.method ||
        existing.notifyUrl !== input.notifyUrl ||
        existing.orderId !== input.orderId ||
        existing.provider !== input.provider ||
        existing.returnUrl !== input.returnUrl ||
        existing.subject !== input.subject ||
        existing.totalAmount !== Number(input.totalAmount).toFixed(6)
      ) {
        throw new Error('MODULE_APP_PAYMENT_ATTEMPT_CONFLICT');
      }
      return { attempt: existing, created: false };
    });

  getPaymentAttemptByOrderId = (orderId: string) =>
    this.db.query.moduleAppPaymentAttempts.findFirst({
      orderBy: (attempts, { desc }) => [desc(attempts.createdAt)],
      where: eq(moduleAppPaymentAttempts.orderId, orderId),
    });

  getPaymentAttemptByOutTradeNo = (outTradeNo: string, provider?: ModuleAppPaymentProvider) =>
    this.db.query.moduleAppPaymentAttempts.findFirst({
      where: provider
        ? and(
            eq(moduleAppPaymentAttempts.provider, provider),
            eq(moduleAppPaymentAttempts.outTradeNo, outTradeNo),
          )
        : eq(moduleAppPaymentAttempts.outTradeNo, outTradeNo),
    });

  updatePaymentAttempt = async (input: {
    outTradeNo: string;
    paidAt?: Date;
    providerTransactionId?: string;
    provider?: ModuleAppPaymentProvider;
    status: 'created' | 'pending' | 'paid' | 'failed' | 'refunded';
  }) => {
    const [attempt] = await this.db
      .update(moduleAppPaymentAttempts)
      .set({
        ...(input.paidAt ? { paidAt: input.paidAt } : {}),
        ...(input.providerTransactionId
          ? { providerTransactionId: input.providerTransactionId }
          : {}),
        status: input.status,
      })
      .where(
        input.provider
          ? and(
              eq(moduleAppPaymentAttempts.provider, input.provider),
              eq(moduleAppPaymentAttempts.outTradeNo, input.outTradeNo),
            )
          : eq(moduleAppPaymentAttempts.outTradeNo, input.outTradeNo),
      )
      .returning();
    if (!attempt) throw new Error('MODULE_APP_PAYMENT_ATTEMPT_NOT_FOUND');
    return attempt;
  };

  storePaymentCheckout = async (input: {
    checkout: PaymentCheckoutAction;
    outTradeNo: string;
    provider: ModuleAppPaymentProvider;
  }) => {
    const [attempt] = await this.db
      .update(moduleAppPaymentAttempts)
      .set({ checkout: input.checkout, status: 'pending' })
      .where(
        and(
          eq(moduleAppPaymentAttempts.provider, input.provider),
          eq(moduleAppPaymentAttempts.outTradeNo, input.outTradeNo),
          isNull(moduleAppPaymentAttempts.checkout),
        ),
      )
      .returning();
    if (attempt) return attempt;

    const existing = await this.getPaymentAttemptByOutTradeNo(input.outTradeNo, input.provider);
    if (!existing) throw new Error('MODULE_APP_PAYMENT_ATTEMPT_NOT_FOUND');
    if (!existing.checkout) throw new Error('MODULE_APP_PAYMENT_CHECKOUT_STORE_FAILED');
    return existing;
  };

  recordPaymentEvent = async (input: {
    currency: string;
    eventId: string;
    eventType: 'payment_succeeded' | 'payment_failed' | 'refund_succeeded';
    occurredAt?: Date;
    orderId?: string;
    outTradeNo: string;
    paymentReference?: string;
    provider: ModuleAppPaymentProvider;
    providerTransactionId?: string;
    totalAmount: string;
  }) => {
    const [event] = await this.db
      .insert(moduleAppPaymentEvents)
      .values({
        currency: input.currency,
        eventType: input.eventType,
        occurredAt: input.occurredAt ?? new Date(),
        orderId: input.orderId,
        outTradeNo: input.outTradeNo,
        paymentReference: input.paymentReference,
        provider: input.provider,
        providerEventId: input.eventId,
        providerTransactionId: input.providerTransactionId,
        totalAmount: input.totalAmount,
      })
      .onConflictDoNothing({
        target: [moduleAppPaymentEvents.provider, moduleAppPaymentEvents.providerEventId],
      })
      .returning();
    if (event) return { duplicate: false, event };
    const existing = await this.db.query.moduleAppPaymentEvents.findFirst({
      where: and(
        eq(moduleAppPaymentEvents.provider, input.provider),
        eq(moduleAppPaymentEvents.providerEventId, input.eventId),
      ),
    });
    if (!existing) throw new Error('MODULE_APP_PAYMENT_EVENT_NOT_FOUND');
    const normalizedAmount = Number(input.totalAmount).toFixed(6);
    if (
      existing.currency !== input.currency ||
      existing.eventType !== input.eventType ||
      existing.outTradeNo !== input.outTradeNo ||
      existing.paymentReference !== (input.paymentReference ?? null) ||
      existing.providerTransactionId !== (input.providerTransactionId ?? null) ||
      existing.totalAmount !== normalizedAmount
    ) {
      throw new Error('MODULE_APP_PAYMENT_EVENT_CONFLICT');
    }
    return { duplicate: true, event: existing };
  };

  updatePaymentEvent = async (input: {
    errorCode?: string;
    eventId: string;
    eventStatus: 'received' | 'processed' | 'ignored' | 'rejected';
    orderId?: string;
    processedAt?: Date;
    provider: ModuleAppPaymentProvider;
  }) => {
    const [event] = await this.db
      .update(moduleAppPaymentEvents)
      .set({
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        eventStatus: input.eventStatus,
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.processedAt ? { processedAt: input.processedAt } : {}),
      })
      .where(
        and(
          eq(moduleAppPaymentEvents.provider, input.provider),
          eq(moduleAppPaymentEvents.providerEventId, input.eventId),
        ),
      )
      .returning();
    if (!event) throw new Error('MODULE_APP_PAYMENT_EVENT_NOT_FOUND');
    return event;
  };

  createRefund = async (input: {
    currency: string;
    orderId: string;
    provider: ModuleAppPaymentProvider;
    providerRefundId: string;
    reason: string;
    refundAmount: string;
    status: 'requested' | 'succeeded' | 'failed';
  }) => {
    const [refund] = await this.db
      .insert(moduleAppPaymentRefunds)
      .values(input)
      .onConflictDoNothing({
        target: [moduleAppPaymentRefunds.provider, moduleAppPaymentRefunds.providerRefundId],
      })
      .returning();
    if (refund) return { duplicate: false, refund };
    const existing = await this.db.query.moduleAppPaymentRefunds.findFirst({
      where: and(
        eq(moduleAppPaymentRefunds.provider, input.provider),
        eq(moduleAppPaymentRefunds.providerRefundId, input.providerRefundId),
      ),
    });
    if (!existing) throw new Error('MODULE_APP_PAYMENT_REFUND_NOT_FOUND');
    return { duplicate: true, refund: existing };
  };

  getRefundByOrderId = (orderId: string) =>
    this.db.query.moduleAppPaymentRefunds.findFirst({
      orderBy: (refunds, { desc }) => [desc(refunds.createdAt)],
      where: eq(moduleAppPaymentRefunds.orderId, orderId),
    });

  updateRefundStatus = async (input: {
    orderId: string;
    status: 'requested' | 'succeeded' | 'failed';
  }) => {
    const now = new Date();
    const [refund] = await this.db
      .update(moduleAppPaymentRefunds)
      .set({ status: input.status, updatedAt: now })
      .where(eq(moduleAppPaymentRefunds.orderId, input.orderId))
      .returning();
    if (!refund) throw new Error('MODULE_APP_PAYMENT_REFUND_NOT_FOUND');
    return refund;
  };

  transitionRefundStatus = async (input: {
    expectedStatus: 'requested' | 'succeeded' | 'failed';
    orderId: string;
    status: 'requested' | 'succeeded' | 'failed';
  }) => {
    const [refund] = await this.db
      .update(moduleAppPaymentRefunds)
      .set({ status: input.status, updatedAt: new Date() })
      .where(
        and(
          eq(moduleAppPaymentRefunds.orderId, input.orderId),
          eq(moduleAppPaymentRefunds.status, input.expectedStatus),
        ),
      )
      .returning();
    if (refund) return { refund, transitioned: true as const };
    const existing = await this.getRefundByOrderId(input.orderId);
    if (!existing) throw new Error('MODULE_APP_PAYMENT_REFUND_NOT_FOUND');
    return { refund: existing, transitioned: false as const };
  };

  listPendingPaymentAttempts = (limit = 100) =>
    this.db
      .select({
        method: moduleAppPaymentAttempts.method,
        orderId: moduleAppPaymentAttempts.orderId,
        outTradeNo: moduleAppPaymentAttempts.outTradeNo,
        provider: moduleAppPaymentAttempts.provider,
      })
      .from(moduleAppPaymentAttempts)
      .innerJoin(moduleAppOrders, eq(moduleAppOrders.id, moduleAppPaymentAttempts.orderId))
      .where(
        and(
          eq(moduleAppOrders.status, 'pending'),
          inArray(moduleAppPaymentAttempts.status, ['created', 'pending']),
        ),
      )
      .orderBy(asc(moduleAppPaymentAttempts.createdAt))
      .limit(Math.min(200, Math.max(1, limit)));

  listDiscrepancies = async (
    input: {
      cursor?: number;
      limit?: number;
      status?: 'open' | 'resolved';
    } = {},
  ) => {
    const cursor = Math.max(0, Math.floor(input.cursor ?? 0));
    const limit = Math.min(500, Math.max(1, Math.floor(input.limit ?? 50)));
    const items = await this.db.query.moduleAppPaymentDiscrepancies.findMany({
      limit: limit + 1,
      offset: cursor,
      orderBy: (rows, { desc }) => [desc(rows.createdAt), desc(rows.id)],
      where: input.status ? eq(moduleAppPaymentDiscrepancies.status, input.status) : undefined,
    });
    return {
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? cursor + limit : null,
    };
  };

  acknowledgeDiscrepancy = async (input: { discrepancyId: string; resolvedAt?: Date }) => {
    const [discrepancy] = await this.db
      .update(moduleAppPaymentDiscrepancies)
      .set({ resolvedAt: input.resolvedAt ?? new Date(), status: 'resolved' })
      .where(
        and(
          eq(moduleAppPaymentDiscrepancies.id, input.discrepancyId),
          eq(moduleAppPaymentDiscrepancies.status, 'open'),
        ),
      )
      .returning();
    if (!discrepancy) throw new Error('MODULE_APP_PAYMENT_DISCREPANCY_NOT_OPEN');
    return discrepancy;
  };

  createDiscrepancy = async (input: {
    actualAmount?: string;
    actualCurrency?: string;
    details?: Record<string, unknown>;
    discrepancyKey: string;
    expectedAmount?: string;
    expectedCurrency?: string;
    kind:
      | 'amount_mismatch'
      | 'currency_mismatch'
      | 'duplicate_event'
      | 'local_paid_provider_unpaid'
      | 'local_unpaid_provider_paid'
      | 'order_not_found'
      | 'provider_mismatch'
      | 'refund_mismatch'
      | 'settlement_failed'
      | 'wrong_seller';
    orderId?: string;
    outTradeNo: string;
    provider: ModuleAppPaymentProvider;
  }) => {
    const [discrepancy] = await this.db
      .insert(moduleAppPaymentDiscrepancies)
      .values(input)
      .onConflictDoNothing({
        target: [
          moduleAppPaymentDiscrepancies.provider,
          moduleAppPaymentDiscrepancies.discrepancyKey,
        ],
      })
      .returning();
    if (discrepancy) return discrepancy;
    const existing = await this.db.query.moduleAppPaymentDiscrepancies.findFirst({
      where: and(
        eq(moduleAppPaymentDiscrepancies.provider, input.provider),
        eq(moduleAppPaymentDiscrepancies.discrepancyKey, input.discrepancyKey),
      ),
    });
    if (!existing) throw new Error('MODULE_APP_PAYMENT_DISCREPANCY_NOT_FOUND');
    return existing;
  };
}
