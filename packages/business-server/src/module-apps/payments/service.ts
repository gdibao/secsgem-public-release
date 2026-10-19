import {
  recordModuleAppOperationalAge,
  recordModuleAppPaymentVerificationFailure,
} from '@lobechat/observability-otel/modules/module-app';
import {
  moduleAppNormalizedPaymentEventSchema,
  moduleAppOrderSnapshotSchema,
  type ModuleAppPaymentProvider,
  paymentCreateResultSchema,
  type PaymentMethodId,
} from '@lobechat/types';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { ModuleAppPaymentModel } from '@/database/models/moduleAppPayment';
import {
  moduleAppOrders,
  moduleAppPaymentDiscrepancies,
  moduleAppPaymentRefunds,
  moduleApps,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { assertModuleAppRolloutAllowed } from '../productionControls';
import { ModuleAppOrderRevenueService } from '../revenue';
import { canRecreatePaymentCheckout, type ModuleAppPaymentAdapter } from './contracts';

type ModuleAppPaymentMetrics = {
  recordOperationalAge: (kind: 'discrepancy' | 'refund', ageMs: number) => void;
  recordVerificationFailure: (reason: string) => void;
};

const getVerificationFailureReason = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('SIGNATURE')) return 'signature_invalid';
  if (message.includes('AMOUNT')) return 'amount_mismatch';
  if (message.includes('CURRENCY')) return 'currency_mismatch';
  if (message.includes('PROVIDER')) return 'provider_mismatch';
  if (message.includes('ORDER_NOT_FOUND')) return 'order_not_found';
  if (message.includes('SETTLEMENT')) return 'settlement_failed';
  if (message.includes('NOTIFICATION')) return 'invalid_notification';
  return 'other';
};

const formatAmount = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('MODULE_APP_PAYMENT_AMOUNT_INVALID');
  }
  return amount.toFixed(6);
};

const REFUND_OPERATION_DELAY_MS = 60_000;

const assertRefundCooldownElapsed = (updatedAt: Date, errorCode: string) => {
  if (Date.now() - updatedAt.getTime() < REFUND_OPERATION_DELAY_MS) {
    throw new Error(errorCode);
  }
};

const assertPaymentUrl = (value: string) => {
  const url = new URL(value);
  const localHttp =
    url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error('MODULE_APP_PAYMENT_URL_INVALID');
  return url.toString();
};

export class ModuleAppPaymentService {
  private readonly model: ModuleAppPaymentModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly adapter: ModuleAppPaymentAdapter | undefined,
    private readonly metrics: ModuleAppPaymentMetrics = {
      recordOperationalAge: recordModuleAppOperationalAge,
      recordVerificationFailure: recordModuleAppPaymentVerificationFailure,
    },
    private readonly orderRevenueService: Pick<
      ModuleAppOrderRevenueService,
      'refundOrder' | 'settleOrder'
    > = new ModuleAppOrderRevenueService(db),
    private readonly adapterResolver?: (
      provider: ModuleAppPaymentProvider,
      method: PaymentMethodId,
    ) => ModuleAppPaymentAdapter | Promise<ModuleAppPaymentAdapter>,
  ) {
    this.model = new ModuleAppPaymentModel(db);
  }

  createPayment = async (input: {
    notifyUrl: string;
    orderId: string;
    purchaserUserId?: string;
    returnUrl: string;
    rollout?: { appIds: string[]; publisherIds: string[] };
  }) => {
    const adapter = this.requireDefaultAdapter();
    const order = await this.db.query.moduleAppOrders.findFirst({
      where: and(
        eq(moduleAppOrders.id, input.orderId),
        input.purchaserUserId
          ? eq(moduleAppOrders.purchaserUserId, input.purchaserUserId)
          : undefined,
      ),
    });
    if (!order) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
    if (order.status !== 'pending') throw new Error('MODULE_APP_ORDER_NOT_PAYABLE');
    const app = await this.db.query.moduleApps.findFirst({
      columns: { displayName: true, publisherId: true },
      where: eq(moduleApps.id, order.appId),
    });
    if (!app) throw new Error('MODULE_APP_NOT_FOUND');
    if (input.rollout) {
      assertModuleAppRolloutAllowed(
        { appId: order.appId, publisherId: app.publisherId },
        input.rollout,
      );
    }
    const snapshot = moduleAppOrderSnapshotSchema.parse(order.snapshot);
    const totalAmount = formatAmount(snapshot.price);
    if (Number(totalAmount) <= 0) throw new Error('MODULE_APP_ORDER_NOT_PAYABLE');
    const subject = app.displayName.trim().slice(0, 240);
    if (!subject) throw new Error('MODULE_APP_PAYMENT_SUBJECT_REQUIRED');
    const notifyUrl = assertPaymentUrl(input.notifyUrl);
    const returnUrl = assertPaymentUrl(input.returnUrl);
    const outTradeNo = adapter.createOutTradeNo({
      orderId: order.id,
      purpose: 'module_app',
    });
    const { attempt, created: attemptCreated } = await this.model.createPaymentAttempt({
      currency: snapshot.currency,
      method: adapter.method,
      notifyUrl,
      orderId: order.id,
      outTradeNo,
      provider: adapter.provider,
      returnUrl,
      subject,
      totalAmount,
    });
    if (attempt.checkout) {
      return paymentCreateResultSchema.parse({
        checkout: attempt.checkout,
        method: attempt.method,
        outTradeNo: attempt.outTradeNo,
        provider: attempt.provider,
      });
    }
    if (!attemptCreated && !canRecreatePaymentCheckout(attempt.method)) {
      throw new Error('MODULE_APP_PAYMENT_CHECKOUT_RECOVERY_REQUIRED');
    }
    const created = paymentCreateResultSchema.parse(
      await adapter.create({
        currency: snapshot.currency,
        notifyUrl,
        orderId: order.id,
        purpose: 'module_app',
        returnUrl,
        subject,
        totalAmount,
      }),
    );
    if (
      !created.checkout ||
      created.outTradeNo !== outTradeNo ||
      created.provider !== adapter.provider ||
      created.method !== adapter.method
    ) {
      throw new Error('MODULE_APP_PAYMENT_CREATE_INVALID');
    }
    const stored = await this.model.storePaymentCheckout({
      checkout: created.checkout,
      outTradeNo: created.outTradeNo,
      provider: created.provider,
    });
    return paymentCreateResultSchema.parse({
      checkout: stored.checkout,
      method: stored.method,
      outTradeNo: stored.outTradeNo,
      provider: stored.provider,
    });
  };

  handleNotification = async (input: { body: string; headers: Record<string, string> }) => {
    const adapter = this.requireDefaultAdapter();
    let verified: unknown;
    try {
      verified = await adapter.verifyNotification(input);
    } catch (error) {
      this.metrics.recordVerificationFailure(getVerificationFailureReason(error));
      throw error;
    }
    return this.handleNormalizedEvent(verified);
  };

  handleNormalizedEvent = async (input: unknown) => {
    const parsed = moduleAppNormalizedPaymentEventSchema.safeParse(input);
    if (!parsed.success) {
      this.metrics.recordVerificationFailure('invalid_notification');
      throw new Error('MODULE_APP_PAYMENT_NOTIFICATION_INVALID');
    }
    const event = parsed.data;
    const recorded = await this.model.recordPaymentEvent({
      currency: event.currency,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      outTradeNo: event.outTradeNo,
      paymentReference: event.paymentReference,
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
      totalAmount: event.totalAmount,
    });
    const attempt = await this.model.getPaymentAttemptByOutTradeNo(
      event.outTradeNo,
      event.provider,
    );
    if (!attempt) {
      await this.model.createDiscrepancy({
        actualAmount: event.totalAmount,
        actualCurrency: event.currency,
        discrepancyKey: event.eventId,
        kind: 'order_not_found',
        outTradeNo: event.outTradeNo,
        provider: event.provider,
      });
      await this.model.updatePaymentEvent({
        errorCode: 'MODULE_APP_PAYMENT_ORDER_NOT_FOUND',
        eventId: event.eventId,
        eventStatus: 'rejected',
        processedAt: new Date(),
        provider: event.provider,
      });
      throw new Error('MODULE_APP_PAYMENT_ORDER_NOT_FOUND');
    }
    const order = await this.db.query.moduleAppOrders.findFirst({
      where: eq(moduleAppOrders.id, attempt.orderId),
    });
    if (!order) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
    if (attempt.provider !== event.provider) {
      await this.rejectEvent({
        eventId: event.eventId,
        errorCode: 'MODULE_APP_PAYMENT_PROVIDER_MISMATCH',
        kind: 'provider_mismatch',
        orderId: order.id,
        outTradeNo: event.outTradeNo,
        provider: event.provider,
      });
      throw new Error('MODULE_APP_PAYMENT_PROVIDER_MISMATCH');
    }
    if (event.orderId && event.orderId !== order.id) {
      await this.rejectEvent({
        eventId: event.eventId,
        errorCode: 'MODULE_APP_PAYMENT_PROVIDER_MISMATCH',
        kind: 'provider_mismatch',
        orderId: order.id,
        outTradeNo: event.outTradeNo,
        provider: event.provider,
      });
      throw new Error('MODULE_APP_PAYMENT_PROVIDER_MISMATCH');
    }
    const snapshot = moduleAppOrderSnapshotSchema.parse(order.snapshot);
    const expectedAmount = formatAmount(snapshot.price);
    if (formatAmount(event.totalAmount) !== expectedAmount) {
      await this.rejectEvent({
        actualAmount: event.totalAmount,
        errorCode: 'MODULE_APP_PAYMENT_AMOUNT_MISMATCH',
        eventId: event.eventId,
        expectedAmount,
        kind: 'amount_mismatch',
        orderId: order.id,
        outTradeNo: event.outTradeNo,
        provider: event.provider,
      });
      throw new Error('MODULE_APP_PAYMENT_AMOUNT_MISMATCH');
    }
    if (event.currency !== snapshot.currency) {
      await this.rejectEvent({
        actualCurrency: event.currency,
        errorCode: 'MODULE_APP_PAYMENT_CURRENCY_MISMATCH',
        eventId: event.eventId,
        expectedCurrency: snapshot.currency,
        kind: 'currency_mismatch',
        orderId: order.id,
        outTradeNo: event.outTradeNo,
        provider: event.provider,
      });
      throw new Error('MODULE_APP_PAYMENT_CURRENCY_MISMATCH');
    }
    if (recorded.duplicate && order.status !== 'pending') {
      if (
        order.status === 'paid' &&
        event.eventType === 'payment_succeeded' &&
        recorded.event.eventStatus === 'received'
      ) {
        if (attempt.status !== 'paid' && attempt.status !== 'refunded') {
          await this.model.updatePaymentAttempt({
            outTradeNo: event.outTradeNo,
            paidAt: event.occurredAt,
            provider: event.provider,
            providerTransactionId: event.providerTransactionId,
            status: 'paid',
          });
        }
        await this.model.updatePaymentEvent({
          eventId: event.eventId,
          eventStatus: 'processed',
          orderId: order.id,
          processedAt: new Date(),
          provider: event.provider,
        });
      }
      return { duplicate: true, status: order.status };
    }
    if (event.eventType !== 'payment_succeeded') {
      if (event.eventType === 'payment_failed' && order.status === 'pending') {
        await this.model.updatePaymentAttempt({
          outTradeNo: event.outTradeNo,
          provider: event.provider,
          status: 'failed',
        });
      }
      await this.model.updatePaymentEvent({
        eventId: event.eventId,
        eventStatus: 'ignored',
        orderId: order.id,
        processedAt: new Date(),
        provider: event.provider,
      });
      return { duplicate: recorded.duplicate, status: order.status };
    }
    const paymentReference =
      event.paymentReference ?? event.providerTransactionId ?? event.outTradeNo;
    let settled: Awaited<ReturnType<ModuleAppOrderRevenueService['settleOrder']>>;
    try {
      settled = await this.orderRevenueService.settleOrder({
        actorUserId: order.purchaserUserId,
        orderId: order.id,
        paymentReference,
      });
    } catch (error) {
      await this.rejectEvent({
        errorCode: 'MODULE_APP_PAYMENT_SETTLEMENT_FAILED',
        eventId: event.eventId,
        kind: 'settlement_failed',
        orderId: order.id,
        outTradeNo: event.outTradeNo,
        provider: event.provider,
      });
      throw error;
    }
    await this.model.updatePaymentAttempt({
      outTradeNo: event.outTradeNo,
      paidAt: event.occurredAt,
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
      status: 'paid',
    });
    await this.model.updatePaymentEvent({
      eventId: event.eventId,
      eventStatus: 'processed',
      orderId: order.id,
      processedAt: new Date(),
      provider: event.provider,
    });
    return { duplicate: recorded.duplicate, status: settled.status };
  };

  reconcilePayment = async (input: { outTradeNo: string; provider?: ModuleAppPaymentProvider }) => {
    const attempt = await this.model.getPaymentAttemptByOutTradeNo(
      input.outTradeNo,
      input.provider,
    );
    if (!attempt) throw new Error('MODULE_APP_PAYMENT_ATTEMPT_NOT_FOUND');
    const order = await this.db.query.moduleAppOrders.findFirst({
      where: eq(moduleAppOrders.id, attempt.orderId),
    });
    if (!order) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
    const adapter = await this.resolveAdapter(attempt.provider, attempt.method);
    const event = await adapter.query({ outTradeNo: input.outTradeNo });
    if (!event) {
      if (order.status === 'paid') {
        await this.model.createDiscrepancy({
          discrepancyKey: `local-paid:${input.outTradeNo}`,
          kind: 'local_paid_provider_unpaid',
          orderId: order.id,
          outTradeNo: input.outTradeNo,
          provider: attempt.provider,
        });
      }
      return { localStatus: order.status, providerStatus: 'pending' as const };
    }
    if (event.eventType === 'payment_succeeded' && order.status === 'pending') {
      await this.model.createDiscrepancy({
        actualAmount: event.totalAmount,
        actualCurrency: event.currency,
        discrepancyKey: `provider-paid:${event.eventId}`,
        kind: 'local_unpaid_provider_paid',
        orderId: order.id,
        outTradeNo: input.outTradeNo,
        provider: attempt.provider,
      });
    } else if (event.eventType === 'payment_failed' && order.status === 'paid') {
      await this.model.createDiscrepancy({
        discrepancyKey: `provider-unpaid:${event.eventId}`,
        kind: 'local_paid_provider_unpaid',
        orderId: order.id,
        outTradeNo: input.outTradeNo,
        provider: attempt.provider,
      });
    }
    const result = await this.handleNormalizedEvent(event);
    return { ...result, providerStatus: event.eventType };
  };

  reconcilePendingPayments = async (input: { limit?: number } = {}) => {
    await this.recordOperationalAges();
    const attempts = await this.model.listPendingPaymentAttempts(input.limit ?? 100);
    const results = [];
    for (const attempt of attempts) {
      try {
        results.push({
          outTradeNo: attempt.outTradeNo,
          result: await this.reconcilePayment({
            outTradeNo: attempt.outTradeNo,
            provider: attempt.provider,
          }),
        });
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : 'MODULE_APP_PAYMENT_RECONCILE_FAILED',
          outTradeNo: attempt.outTradeNo,
        });
      }
    }
    return { count: attempts.length, results };
  };

  recordOperationalAges = async (now = new Date()) => {
    const [discrepancy, refund] = await Promise.all([
      this.db.query.moduleAppPaymentDiscrepancies.findFirst({
        orderBy: [asc(moduleAppPaymentDiscrepancies.createdAt)],
        where: eq(moduleAppPaymentDiscrepancies.status, 'open'),
      }),
      this.db.query.moduleAppPaymentRefunds.findFirst({
        orderBy: [asc(moduleAppPaymentRefunds.createdAt)],
        where: inArray(moduleAppPaymentRefunds.status, ['requested', 'failed']),
      }),
    ]);
    if (discrepancy) {
      this.metrics.recordOperationalAge(
        'discrepancy',
        Math.max(0, now.getTime() - discrepancy.createdAt.getTime()),
      );
    }
    if (refund) {
      this.metrics.recordOperationalAge(
        'refund',
        Math.max(0, now.getTime() - refund.createdAt.getTime()),
      );
    }
  };

  reconcileRefund = async (input: { actorUserId: string; orderId: string }) => {
    const [attempt, initialRefund, order] = await Promise.all([
      this.model.getPaymentAttemptByOrderId(input.orderId),
      this.model.getRefundByOrderId(input.orderId),
      this.db.query.moduleAppOrders.findFirst({ where: eq(moduleAppOrders.id, input.orderId) }),
    ]);
    if (!attempt || !initialRefund || !order) {
      throw new Error('MODULE_APP_PAYMENT_REFUND_NOT_FOUND');
    }
    let refund = initialRefund;
    if (refund.status === 'requested') {
      assertRefundCooldownElapsed(
        refund.updatedAt,
        'MODULE_APP_PAYMENT_REFUND_RECONCILIATION_TOO_EARLY',
      );
    }
    if (refund.status !== 'succeeded') {
      const adapter = await this.resolveAdapter(attempt.provider, attempt.method);
      if (!adapter.queryRefund) throw new Error('MODULE_APP_PAYMENT_REFUND_QUERY_UNSUPPORTED');
      const result = await adapter.queryRefund({
        outRequestNo: refund.providerRefundId,
        outTradeNo: attempt.outTradeNo,
      });
      if (result.status === 'pending') {
        if (refund.status === 'failed') {
          const pending = await this.model.transitionRefundStatus({
            expectedStatus: 'failed',
            orderId: order.id,
            status: 'requested',
          });
          if (!pending.transitioned && pending.refund.status !== 'requested') {
            throw new Error('MODULE_APP_PAYMENT_REFUND_RESOLUTION_CONFLICT');
          }
        }
        return result;
      }
      const resolved = await this.model.transitionRefundStatus({
        expectedStatus: refund.status,
        orderId: order.id,
        status: result.status,
      });
      refund = resolved.refund;
      if (!resolved.transitioned && refund.status !== result.status) {
        throw new Error('MODULE_APP_PAYMENT_REFUND_RESOLUTION_CONFLICT');
      }
      if (result.status === 'failed') {
        await this.model.createDiscrepancy({
          discrepancyKey: `refund:${refund.providerRefundId}:${result.status}`,
          kind: 'refund_mismatch',
          orderId: order.id,
          outTradeNo: attempt.outTradeNo,
          provider: attempt.provider,
        });
        return result;
      }
    }
    await this.model.updatePaymentAttempt({
      outTradeNo: attempt.outTradeNo,
      provider: attempt.provider,
      status: 'refunded',
    });
    if (order.status !== 'refunded') {
      await this.orderRevenueService.refundOrder({
        actorUserId: input.actorUserId,
        orderId: order.id,
        reason: refund.reason,
        refundReference: `${attempt.provider}:${refund.providerRefundId}`,
      });
    }
    return { status: 'succeeded' as const };
  };

  resolvePendingRefund = async (input: {
    actorUserId: string;
    orderId: string;
    resolution: 'failed' | 'succeeded';
  }) => {
    const [attempt, refund, order] = await Promise.all([
      this.model.getPaymentAttemptByOrderId(input.orderId),
      this.model.getRefundByOrderId(input.orderId),
      this.db.query.moduleAppOrders.findFirst({ where: eq(moduleAppOrders.id, input.orderId) }),
    ]);
    if (!attempt || !refund || !order) throw new Error('MODULE_APP_PAYMENT_REFUND_NOT_FOUND');
    if (
      attempt.provider !== 'zpay' ||
      refund.provider !== 'zpay' ||
      (attempt.method !== 'zpay_alipay' && attempt.method !== 'zpay_wechat')
    ) {
      throw new Error('MODULE_APP_PAYMENT_MANUAL_REFUND_RESOLUTION_UNSUPPORTED');
    }

    if (input.resolution === 'failed') {
      if (refund.status === 'failed') {
        return { duplicate: true, orderId: order.id, status: 'failed' as const };
      }
      if (refund.status !== 'requested') {
        throw new Error('MODULE_APP_PAYMENT_REFUND_NOT_PENDING');
      }
      assertRefundCooldownElapsed(
        refund.updatedAt,
        'MODULE_APP_PAYMENT_REFUND_RESOLUTION_TOO_EARLY',
      );
      const resolved = await this.model.transitionRefundStatus({
        expectedStatus: 'requested',
        orderId: order.id,
        status: 'failed',
      });
      if (resolved.refund.status !== 'failed') {
        throw new Error('MODULE_APP_PAYMENT_REFUND_RESOLUTION_CONFLICT');
      }
      return {
        duplicate: !resolved.transitioned,
        orderId: order.id,
        status: 'failed' as const,
      };
    }

    let duplicate = refund.status === 'succeeded';
    if (refund.status === 'requested') {
      assertRefundCooldownElapsed(
        refund.updatedAt,
        'MODULE_APP_PAYMENT_REFUND_RESOLUTION_TOO_EARLY',
      );
      const resolved = await this.model.transitionRefundStatus({
        expectedStatus: 'requested',
        orderId: order.id,
        status: 'succeeded',
      });
      if (resolved.refund.status !== 'succeeded') {
        throw new Error('MODULE_APP_PAYMENT_REFUND_RESOLUTION_CONFLICT');
      }
      duplicate = !resolved.transitioned;
    } else if (refund.status !== 'succeeded') {
      throw new Error('MODULE_APP_PAYMENT_REFUND_RESOLUTION_CONFLICT');
    }

    await this.model.updatePaymentAttempt({
      outTradeNo: attempt.outTradeNo,
      provider: attempt.provider,
      status: 'refunded',
    });
    if (order.status === 'refunded') {
      return { duplicate: true, orderId: order.id, status: 'refunded' as const };
    }
    const refunded = await this.orderRevenueService.refundOrder({
      actorUserId: input.actorUserId,
      orderId: order.id,
      reason: refund.reason,
      refundReference: `${attempt.provider}:${refund.providerRefundId}`,
    });
    return { ...refunded, duplicate };
  };

  refundOrder = async (input: { actorUserId?: string; orderId: string; reason: string }) => {
    const order = await this.db.query.moduleAppOrders.findFirst({
      where: eq(moduleAppOrders.id, input.orderId),
    });
    if (!order) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
    let refund = await this.model.getRefundByOrderId(order.id);
    const attempt = await this.model.getPaymentAttemptByOrderId(order.id);
    if (!attempt) throw new Error('MODULE_APP_PAYMENT_ATTEMPT_NOT_FOUND');
    if (refund?.status === 'succeeded') {
      await this.model.updatePaymentAttempt({
        outTradeNo: attempt.outTradeNo,
        provider: attempt.provider,
        status: 'refunded',
      });
      return this.orderRevenueService.refundOrder({
        actorUserId: input.actorUserId ?? order.purchaserUserId,
        orderId: order.id,
        reason: refund.reason,
        refundReference: `${attempt.provider}:${refund.providerRefundId}`,
      });
    }
    if (order.status === 'refunded') throw new Error('MODULE_APP_ORDER_NOT_REFUNDABLE');
    if (order.status !== 'paid') throw new Error('MODULE_APP_ORDER_NOT_REFUNDABLE');
    if (refund?.status === 'requested') {
      return { orderId: order.id, status: 'requested' as const };
    }

    const adapter = await this.resolveAdapter(attempt.provider, attempt.method);
    if (refund?.status === 'failed') {
      const claimed = await this.model.transitionRefundStatus({
        expectedStatus: 'failed',
        orderId: order.id,
        status: 'requested',
      });
      refund = claimed.refund;
      if (claimed.transitioned) {
        const snapshot = moduleAppOrderSnapshotSchema.parse(order.snapshot);
        const result = await adapter.refund({
          outTradeNo: attempt.outTradeNo,
          reason: refund.reason,
          refundAmount: formatAmount(snapshot.price),
          refundRequestNo: refund.providerRefundId,
          totalAmount: formatAmount(snapshot.price),
        });
        if (result.providerRefundId !== refund.providerRefundId) {
          throw new Error('MODULE_APP_PAYMENT_REFUND_REFERENCE_MISMATCH');
        }
        const refundStatus =
          result.status === 'succeeded'
            ? ('succeeded' as const)
            : result.status === 'pending'
              ? ('requested' as const)
              : ('failed' as const);
        const completed = await this.model.transitionRefundStatus({
          expectedStatus: 'requested',
          orderId: order.id,
          status: refundStatus,
        });
        refund = completed.refund;
        if (!completed.transitioned && refund.status !== refundStatus) {
          throw new Error('MODULE_APP_PAYMENT_REFUND_RESOLUTION_CONFLICT');
        }
        if (result.status === 'pending') {
          return { orderId: order.id, status: 'requested' as const };
        }
        if (result.status === 'failed') throw new Error('MODULE_APP_PAYMENT_REFUND_FAILED');
        await this.model.updatePaymentAttempt({
          outTradeNo: attempt.outTradeNo,
          provider: attempt.provider,
          status: 'refunded',
        });
      } else if (refund.status !== 'succeeded') {
        return { orderId: order.id, status: refund.status };
      }
    }
    if (!refund) {
      const snapshot = moduleAppOrderSnapshotSchema.parse(order.snapshot);
      const refundAmount = formatAmount(snapshot.price);
      const generatedRefundRequestNo = adapter.createRefundRequestNo({
        outTradeNo: attempt.outTradeNo,
        refundAmount,
      });
      if (typeof generatedRefundRequestNo !== 'string' || !generatedRefundRequestNo.trim()) {
        throw new Error('MODULE_APP_PAYMENT_REFUND_REFERENCE_REQUIRED');
      }
      const refundRequestNo = generatedRefundRequestNo.trim();
      const claimed = await this.model.createRefund({
        currency: snapshot.currency,
        orderId: order.id,
        provider: attempt.provider,
        providerRefundId: refundRequestNo,
        reason: input.reason,
        refundAmount,
        status: 'requested',
      });
      refund = claimed.refund;
      if (
        refund.orderId !== order.id ||
        refund.provider !== attempt.provider ||
        refund.currency !== snapshot.currency ||
        formatAmount(refund.refundAmount) !== refundAmount
      ) {
        throw new Error('MODULE_APP_PAYMENT_REFUND_CLAIM_CONFLICT');
      }
      if (claimed.duplicate && refund.status === 'requested') {
        return { orderId: order.id, status: 'requested' as const };
      }
      if (claimed.duplicate && refund.status === 'failed') {
        throw new Error('MODULE_APP_PAYMENT_REFUND_FAILED');
      }
      if (!claimed.duplicate) {
        const result = await adapter.refund({
          outTradeNo: attempt.outTradeNo,
          reason: input.reason,
          refundAmount,
          refundRequestNo,
          totalAmount: refundAmount,
        });
        if (result.providerRefundId !== refundRequestNo) {
          throw new Error('MODULE_APP_PAYMENT_REFUND_REFERENCE_MISMATCH');
        }
        const refundStatus =
          result.status === 'succeeded'
            ? ('succeeded' as const)
            : result.status === 'pending'
              ? ('requested' as const)
              : ('failed' as const);
        const completed = await this.model.transitionRefundStatus({
          expectedStatus: 'requested',
          orderId: order.id,
          status: refundStatus,
        });
        refund = completed.refund;
        if (!completed.transitioned && refund.status !== refundStatus) {
          throw new Error('MODULE_APP_PAYMENT_REFUND_RESOLUTION_CONFLICT');
        }
        if (result.status === 'pending') {
          return { orderId: order.id, status: 'requested' as const };
        }
        if (result.status === 'failed') throw new Error('MODULE_APP_PAYMENT_REFUND_FAILED');
      }
      await this.model.updatePaymentAttempt({
        outTradeNo: attempt.outTradeNo,
        provider: attempt.provider,
        status: 'refunded',
      });
    }
    return this.orderRevenueService.refundOrder({
      actorUserId: input.actorUserId ?? order.purchaserUserId,
      orderId: order.id,
      reason: refund.reason,
      refundReference: `${attempt.provider}:${refund.providerRefundId}`,
    });
  };

  private rejectEvent = async (input: {
    actualAmount?: string;
    actualCurrency?: string;
    errorCode: string;
    eventId: string;
    expectedAmount?: string;
    expectedCurrency?: string;
    kind: 'amount_mismatch' | 'currency_mismatch' | 'provider_mismatch' | 'settlement_failed';
    orderId: string;
    outTradeNo: string;
    provider: ModuleAppPaymentProvider;
  }) => {
    await this.model.createDiscrepancy({
      actualAmount: input.actualAmount,
      actualCurrency: input.actualCurrency,
      discrepancyKey: input.eventId,
      expectedAmount: input.expectedAmount,
      expectedCurrency: input.expectedCurrency,
      kind: input.kind,
      orderId: input.orderId,
      outTradeNo: input.outTradeNo,
      provider: input.provider,
    });
    await this.model.updatePaymentEvent({
      errorCode: input.errorCode,
      eventId: input.eventId,
      eventStatus: 'rejected',
      orderId: input.orderId,
      processedAt: new Date(),
      provider: input.provider,
    });
  };

  private requireDefaultAdapter = () => {
    if (!this.adapter) throw new Error('MODULE_APP_PAYMENT_ADAPTER_NOT_AVAILABLE');
    return this.adapter;
  };

  private resolveAdapter = async (provider: ModuleAppPaymentProvider, method: PaymentMethodId) => {
    if (this.adapter?.provider === provider && this.adapter.method === method) return this.adapter;
    if (!this.adapterResolver) throw new Error('MODULE_APP_PAYMENT_ADAPTER_NOT_AVAILABLE');
    const adapter = await this.adapterResolver(provider, method);
    if (adapter.provider !== provider || adapter.method !== method) {
      throw new Error('MODULE_APP_PAYMENT_ADAPTER_MISMATCH');
    }
    return adapter;
  };
}
