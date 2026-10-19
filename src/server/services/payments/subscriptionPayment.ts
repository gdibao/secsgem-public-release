import {
  moduleAppNormalizedPaymentEventSchema,
  type PaymentMethodId,
  paymentMethodIdSchema,
  type PaymentProvider,
  paymentProviderSchema,
} from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import type { ModuleAppPaymentAdapter } from '@/business/server/module-apps/payments/contracts';
import { CommercialModel } from '@/database/models/commercial';
import { subscriptionPaymentEvents, subscriptionPaymentOrders } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

const MANUAL_REFUND_RESOLUTION_DELAY_MS = 60_000;

const assertManualRefundResolutionReady = (updatedAt: Date) => {
  if (Date.now() - updatedAt.getTime() < MANUAL_REFUND_RESOLUTION_DELAY_MS) {
    throw new Error('SUBSCRIPTION_PAYMENT_REFUND_RESOLUTION_TOO_EARLY');
  }
};

export class SubscriptionPaymentService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly adapterResolver?: (
      provider: PaymentProvider,
      method: PaymentMethodId,
    ) => ModuleAppPaymentAdapter | Promise<ModuleAppPaymentAdapter>,
  ) {}

  private resolveAdapter = async (provider: PaymentProvider, method: PaymentMethodId) => {
    if (!this.adapterResolver) throw new Error('SUBSCRIPTION_PAYMENT_ADAPTER_RESOLVER_REQUIRED');
    const adapter = await this.adapterResolver(provider, method);
    if (adapter.provider !== provider || adapter.method !== method) {
      throw new Error('SUBSCRIPTION_PAYMENT_ADAPTER_MISMATCH');
    }
    return adapter;
  };

  private resolveRefundRequestNo = (input: {
    adapter: ModuleAppPaymentAdapter;
    amount: string;
    externalOrderId: string;
    refundReference?: null | string;
  }) => {
    const generatedRefundRequestNo =
      input.refundReference ??
      input.adapter.createRefundRequestNo({
        outTradeNo: input.externalOrderId,
        refundAmount: input.amount,
      });
    if (typeof generatedRefundRequestNo !== 'string' || !generatedRefundRequestNo.trim()) {
      throw new Error('SUBSCRIPTION_PAYMENT_REFUND_REFERENCE_REQUIRED');
    }
    return generatedRefundRequestNo.trim();
  };

  private transitionRefundStatus = async (input: {
    commercial: CommercialModel;
    orderId: string;
    refundReference: string;
    status: 'failed' | 'pending' | 'succeeded';
  }) => {
    const updated = await input.commercial.updateSubscriptionPaymentRefundStatus({
      expectedRefundReference: input.refundReference,
      expectedStatus: 'pending',
      orderId: input.orderId,
      refundReference: input.refundReference,
      status: input.status,
    });
    if (
      updated.refundReference !== input.refundReference ||
      updated.refundStatus !== input.status
    ) {
      throw new Error('SUBSCRIPTION_PAYMENT_REFUND_RESOLUTION_CONFLICT');
    }
    return updated;
  };

  private requestRefund = async (input: {
    adapter: ModuleAppPaymentAdapter;
    amount: string;
    commercial: CommercialModel;
    externalOrderId: string;
    orderId: string;
    reason: string;
    refundRequestNo: string;
  }) => {
    let refund: Awaited<ReturnType<ModuleAppPaymentAdapter['refund']>>;
    try {
      refund = await input.adapter.refund({
        outTradeNo: input.externalOrderId,
        reason: input.reason,
        refundAmount: input.amount,
        refundRequestNo: input.refundRequestNo,
        totalAmount: input.amount,
      });
    } catch (error) {
      await this.transitionRefundStatus({
        commercial: input.commercial,
        orderId: input.orderId,
        refundReference: input.refundRequestNo,
        status: input.adapter.queryRefund ? 'pending' : 'failed',
      });
      throw error;
    }
    if (refund.providerRefundId !== input.refundRequestNo) {
      throw new Error('SUBSCRIPTION_PAYMENT_REFUND_REFERENCE_MISMATCH');
    }

    await this.transitionRefundStatus({
      commercial: input.commercial,
      orderId: input.orderId,
      refundReference: refund.providerRefundId,
      status: refund.status,
    });
    return refund;
  };

  private refundUncreditedOrder = async (input: {
    order: typeof subscriptionPaymentOrders.$inferSelect;
    reason: string;
  }) => {
    if (!input.order.externalOrderId) {
      throw new Error('SUBSCRIPTION_PAYMENT_ORDER_INVALID');
    }
    const commercial = new CommercialModel(this.db, input.order.userId);
    const amount = Number(input.order.amount).toFixed(6);
    const finalize = async (refundReference: string) => {
      const uncredited = await commercial.markUncreditedSubscriptionPaymentRefunded({
        orderId: input.order.id,
        refundReference,
      });
      if (uncredited) return uncredited;

      const current = await commercial.getSubscriptionPaymentOrder(input.order.id);
      if (current?.status === 'paid') {
        const reversed = await commercial.refundSubscriptionPaymentOrder({
          amount: Number(current.amount).toFixed(6),
          method: current.method,
          orderId: current.id,
          provider: current.provider,
          refundReference,
        });
        return reversed.order;
      }
      if (current?.status === 'refunded') return current;
      throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_REFUNDABLE');
    };
    if (input.order.status === 'refunded') {
      return {
        order: input.order,
        providerRefundId: input.order.refundReference ?? '',
        status: 'succeeded' as const,
      };
    }
    if (input.order.refundStatus === 'succeeded' && input.order.refundReference) {
      return {
        order: await finalize(input.order.refundReference),
        providerRefundId: input.order.refundReference,
        status: 'succeeded' as const,
      };
    }

    const adapter = await this.resolveAdapter(input.order.provider, input.order.method);
    const refundRequestNo = this.resolveRefundRequestNo({
      adapter,
      amount,
      externalOrderId: input.order.externalOrderId,
      refundReference: input.order.refundReference,
    });
    const claim = await commercial.claimUncreditedSubscriptionPaymentRefund({
      orderId: input.order.id,
      refundReference: refundRequestNo,
    });
    const order = claim.order;
    if (!order.externalOrderId) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_INVALID');
    if (claim.claimed && order.refundReference !== refundRequestNo) {
      throw new Error('SUBSCRIPTION_PAYMENT_REFUND_REFERENCE_MISMATCH');
    }

    if (!claim.claimed) {
      if (order.status === 'refunded') {
        return {
          order,
          providerRefundId: order.refundReference ?? '',
          status: 'succeeded' as const,
        };
      }
      if (order.refundStatus === 'succeeded' && order.refundReference) {
        return {
          order: await finalize(order.refundReference),
          providerRefundId: order.refundReference,
          status: 'succeeded' as const,
        };
      }
      if (order.refundStatus === 'pending') {
        if (!order.refundReference || !adapter.queryRefund) {
          return {
            order,
            providerRefundId: order.refundReference ?? '',
            status: 'pending' as const,
          };
        }
        const result = await adapter.queryRefund({
          outRequestNo: order.refundReference,
          outTradeNo: order.externalOrderId,
        });
        await this.transitionRefundStatus({
          commercial,
          orderId: order.id,
          refundReference: order.refundReference,
          status: result.status,
        });
        if (result.status === 'succeeded') {
          return {
            order: await finalize(order.refundReference),
            providerRefundId: order.refundReference,
            status: result.status,
          };
        }
        if (result.status === 'failed') {
          throw new Error('SUBSCRIPTION_PAYMENT_AUTO_REFUND_FAILED');
        }
        return { order, providerRefundId: order.refundReference, status: result.status };
      }
      throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_REFUNDABLE');
    }

    const refund = await this.requestRefund({
      adapter,
      amount,
      commercial,
      externalOrderId: order.externalOrderId,
      orderId: order.id,
      reason: input.reason,
      refundRequestNo,
    });
    if (refund.status === 'failed') throw new Error('SUBSCRIPTION_PAYMENT_AUTO_REFUND_FAILED');
    if (refund.status === 'succeeded') {
      return { order: await finalize(refund.providerRefundId), ...refund };
    }
    return { order, ...refund };
  };

  private recordEvent = async (
    event: ReturnType<typeof moduleAppNormalizedPaymentEventSchema.parse>,
  ) => {
    const [created] = await this.db
      .insert(subscriptionPaymentEvents)
      .values({
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        outTradeNo: event.outTradeNo,
        payload: { ...event, occurredAt: event.occurredAt.toISOString() },
        provider: event.provider,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return { duplicate: false, event: created };
    const existing = await this.db.query.subscriptionPaymentEvents.findFirst({
      where: and(
        eq(subscriptionPaymentEvents.provider, event.provider),
        eq(subscriptionPaymentEvents.eventId, event.eventId),
      ),
    });
    if (!existing) throw new Error('SUBSCRIPTION_PAYMENT_EVENT_RECORD_FAILED');
    return { duplicate: true, event: existing };
  };

  private updateEvent = async (input: {
    errorCode?: string;
    eventId: string;
    orderId?: string;
    provider: PaymentProvider;
    status: 'failed' | 'ignored' | 'processed' | 'rejected';
  }) => {
    const now = new Date();
    await this.db
      .update(subscriptionPaymentEvents)
      .set({
        errorCode: input.errorCode ?? null,
        orderId: input.orderId ?? null,
        processedAt: now,
        status: input.status,
        updatedAt: now,
      })
      .where(
        and(
          eq(subscriptionPaymentEvents.provider, input.provider),
          eq(subscriptionPaymentEvents.eventId, input.eventId),
        ),
      );
  };

  reconcilePayment = async (input: { idempotencyKey: string; userId: string }) => {
    const commercial = new CommercialModel(this.db, input.userId);
    const order = await commercial.getSubscriptionPaymentOrderByIdempotencyKey(
      input.idempotencyKey,
    );
    if (!order) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
    if (!order.externalOrderId) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_INVALID');
    const method = paymentMethodIdSchema.parse(order.method);
    const provider = paymentProviderSchema.parse(order.provider);
    const adapter = await this.resolveAdapter(provider, method);
    const event = await adapter.query({ outTradeNo: order.externalOrderId });
    if (event) await this.handleNormalizedEvent(event, method);
    else await commercial.expireSubscriptionPaymentOrder(order.id);

    const current = await commercial.getSubscriptionPaymentOrderByIdempotencyKey(
      input.idempotencyKey,
    );
    if (!current) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
    return {
      checkout: current.checkout ?? null,
      orderId: current.id,
      providerStatus: event?.eventType ?? ('pending' as const),
      recoveryRequired: current.status === 'pending' && !current.checkout,
      status: current.status,
    };
  };

  refundOrder = async (input: { orderId: string; reason: string; userId: string }) => {
    const commercial = new CommercialModel(this.db, input.userId);
    const existingOrder = await commercial.getSubscriptionPaymentOrder(input.orderId);
    if (!existingOrder) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
    if (existingOrder.status === 'refunded') {
      return { duplicate: true, status: existingOrder.status };
    }
    if (existingOrder.status !== 'paid' || !existingOrder.externalOrderId) {
      throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_REFUNDABLE');
    }
    const amount = Number(existingOrder.amount).toFixed(6);
    const finalizeLocalRefund = async (refundReference: string, duplicate: boolean) => {
      const reversed = await commercial.refundSubscriptionPaymentOrder({
        amount,
        method: existingOrder.method,
        orderId: existingOrder.id,
        provider: existingOrder.provider,
        refundReference,
      });
      return { debtAmount: reversed.debtAmount, duplicate, status: reversed.order.status };
    };
    if (existingOrder.refundStatus === 'succeeded' && existingOrder.refundReference) {
      return finalizeLocalRefund(existingOrder.refundReference, true);
    }

    const adapter = await this.resolveAdapter(existingOrder.provider, existingOrder.method);
    const refundRequestNo = this.resolveRefundRequestNo({
      adapter,
      amount,
      externalOrderId: existingOrder.externalOrderId,
      refundReference: existingOrder.refundReference,
    });
    const claimed = await commercial.claimSubscriptionPaymentRefund({
      orderId: input.orderId,
      refundReference: refundRequestNo,
    });
    const order = claimed.order;
    if (order.status === 'refunded') return { duplicate: true, status: order.status };
    if (order.status !== 'paid' || !order.externalOrderId) {
      throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_REFUNDABLE');
    }
    if (claimed.claimed && order.refundReference !== refundRequestNo) {
      throw new Error('SUBSCRIPTION_PAYMENT_REFUND_REFERENCE_MISMATCH');
    }

    if (!claimed.claimed) {
      if (order.refundStatus === 'succeeded' && order.refundReference) {
        return finalizeLocalRefund(order.refundReference, true);
      }
      if (order.refundStatus === 'pending') {
        if (!order.refundReference || !adapter.queryRefund) {
          return { duplicate: true, status: 'pending' as const };
        }
        const result = await adapter.queryRefund({
          outRequestNo: order.refundReference,
          outTradeNo: order.externalOrderId,
        });
        await this.transitionRefundStatus({
          commercial,
          orderId: order.id,
          refundReference: order.refundReference,
          status: result.status,
        });
        if (result.status === 'succeeded') {
          return finalizeLocalRefund(order.refundReference, true);
        }
        return { duplicate: true, status: result.status };
      }
      throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_REFUNDABLE');
    }

    const refund = await this.requestRefund({
      adapter,
      amount,
      commercial,
      externalOrderId: order.externalOrderId,
      orderId: order.id,
      reason: input.reason,
      refundRequestNo,
    });
    if (refund.status !== 'succeeded') {
      return { duplicate: false, status: refund.status };
    }
    return finalizeLocalRefund(refund.providerRefundId, false);
  };

  resolvePendingRefund = async (input: {
    orderId: string;
    resolution: 'failed' | 'succeeded';
    userId: string;
  }) => {
    const commercial = new CommercialModel(this.db, input.userId);
    let order = await commercial.getSubscriptionPaymentOrder(input.orderId);
    if (!order) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
    if (
      order.provider !== 'zpay' ||
      (order.method !== 'zpay_alipay' && order.method !== 'zpay_wechat')
    ) {
      throw new Error('SUBSCRIPTION_PAYMENT_MANUAL_REFUND_RESOLUTION_UNSUPPORTED');
    }
    if (!order.refundReference) {
      throw new Error('SUBSCRIPTION_PAYMENT_REFUND_REFERENCE_REQUIRED');
    }
    const refundReference = order.refundReference;

    if (input.resolution === 'failed') {
      if (order.refundStatus === 'failed') {
        return { duplicate: true, status: 'failed' as const };
      }
      if (order.refundStatus !== 'pending') {
        throw new Error('SUBSCRIPTION_PAYMENT_REFUND_NOT_PENDING');
      }
      assertManualRefundResolutionReady(order.updatedAt);
      order = await this.transitionRefundStatus({
        commercial,
        orderId: order.id,
        refundReference,
        status: 'failed',
      });
      if (order.refundStatus !== 'failed') {
        throw new Error('SUBSCRIPTION_PAYMENT_REFUND_RESOLUTION_CONFLICT');
      }
      return { duplicate: false, status: 'failed' as const };
    }

    const duplicate = order.refundStatus === 'succeeded';
    if (order.status === 'refunded' && duplicate) {
      return { debtAmount: 0, duplicate: true, status: 'refunded' as const };
    }
    if (order.refundStatus === 'pending') {
      assertManualRefundResolutionReady(order.updatedAt);
      order = await this.transitionRefundStatus({
        commercial,
        orderId: order.id,
        refundReference,
        status: 'succeeded',
      });
    }
    if (order.refundStatus !== 'succeeded') {
      throw new Error('SUBSCRIPTION_PAYMENT_REFUND_RESOLUTION_CONFLICT');
    }

    if (order.status === 'paid') {
      const reversed = await commercial.refundSubscriptionPaymentOrder({
        amount: Number(order.amount).toFixed(6),
        method: order.method,
        orderId: order.id,
        provider: order.provider,
        refundReference,
      });
      return {
        debtAmount: reversed.debtAmount,
        duplicate,
        status: reversed.order.status,
      };
    }

    const uncredited = await commercial.markUncreditedSubscriptionPaymentRefunded({
      orderId: order.id,
      refundReference,
    });
    if (uncredited) return { debtAmount: 0, duplicate, status: uncredited.status };
    const current = await commercial.getSubscriptionPaymentOrder(order.id);
    if (current?.status === 'refunded') {
      return { debtAmount: 0, duplicate: true, status: current.status };
    }
    throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_REFUNDABLE');
  };

  handleNormalizedEvent = async (input: unknown, method: PaymentMethodId) => {
    const event = moduleAppNormalizedPaymentEventSchema.parse(input);
    const recorded = await this.recordEvent(event);
    let finalized = false;
    let orderId: string | undefined;

    try {
      const order = await this.db.query.subscriptionPaymentOrders.findFirst({
        where: and(
          eq(subscriptionPaymentOrders.provider, event.provider),
          eq(subscriptionPaymentOrders.externalOrderId, event.outTradeNo),
        ),
      });
      if (!order) {
        finalized = true;
        await this.updateEvent({
          errorCode: 'SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND',
          eventId: event.eventId,
          provider: event.provider,
          status: 'rejected',
        });
        throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
      }
      orderId = order.id;
      if (
        order.method !== method ||
        order.currency !== event.currency ||
        Number(order.amount).toFixed(6) !== Number(event.totalAmount).toFixed(6) ||
        (event.orderId && event.orderId !== order.id)
      ) {
        throw new Error('SUBSCRIPTION_PAYMENT_VERIFICATION_FAILED');
      }
      if (
        recorded.duplicate &&
        ['ignored', 'processed', 'rejected'].includes(recorded.event.status)
      ) {
        return { duplicate: true, status: order.status };
      }

      const commercial = new CommercialModel(this.db, order.userId);
      if (event.eventType === 'refund_succeeded') {
        if (order.status === 'refunded') {
          finalized = true;
          await this.updateEvent({
            eventId: event.eventId,
            orderId: order.id,
            provider: event.provider,
            status: 'processed',
          });
          return { duplicate: true, status: order.status };
        }
        const refundReference =
          event.paymentReference ?? event.providerTransactionId ?? event.eventId;
        let refunded;
        if (order.status === 'paid') {
          refunded = await commercial.refundSubscriptionPaymentOrder({
            amount: event.totalAmount,
            method,
            orderId: order.id,
            provider: event.provider,
            refundReference,
          });
        } else {
          const uncredited = await commercial.markUncreditedSubscriptionPaymentRefunded({
            orderId: order.id,
            refundReference,
          });
          if (uncredited) {
            refunded = { order: uncredited };
          } else {
            const current = await commercial.getSubscriptionPaymentOrder(order.id);
            if (current?.status === 'paid') {
              refunded = await commercial.refundSubscriptionPaymentOrder({
                amount: event.totalAmount,
                method,
                orderId: order.id,
                provider: event.provider,
                refundReference,
              });
            } else if (current?.status === 'refunded') {
              refunded = { order: current };
            } else {
              throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_REFUNDABLE');
            }
          }
        }
        if (!refunded.order) throw new Error('SUBSCRIPTION_PAYMENT_REFUND_FAILED');
        finalized = true;
        await this.updateEvent({
          eventId: event.eventId,
          orderId: order.id,
          provider: event.provider,
          status: 'processed',
        });
        return { duplicate: recorded.duplicate, status: refunded.order.status };
      }

      if (event.eventType === 'payment_failed') {
        let status = order.status;
        if (order.status === 'pending') {
          const [failed] = await this.db
            .update(subscriptionPaymentOrders)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(
              and(
                eq(subscriptionPaymentOrders.id, order.id),
                eq(subscriptionPaymentOrders.status, 'pending'),
              ),
            )
            .returning({ status: subscriptionPaymentOrders.status });
          if (failed) {
            status = failed.status;
          } else {
            const current = await this.db.query.subscriptionPaymentOrders.findFirst({
              columns: { status: true },
              where: eq(subscriptionPaymentOrders.id, order.id),
            });
            status = current?.status ?? order.status;
          }
        }
        finalized = true;
        await this.updateEvent({
          eventId: event.eventId,
          orderId: order.id,
          provider: event.provider,
          status: 'processed',
        });
        return { duplicate: recorded.duplicate, status };
      }

      if (order.status === 'refunded') {
        finalized = true;
        await this.updateEvent({
          eventId: event.eventId,
          orderId: order.id,
          provider: event.provider,
          status: 'ignored',
        });
        return { duplicate: true, status: order.status };
      }
      if (order.status === 'canceled') {
        const refund = await this.refundUncreditedOrder({
          order,
          reason: 'Payment completed after local cancellation',
        });
        finalized = refund.status === 'succeeded';
        await this.updateEvent({
          ...(refund.status === 'pending'
            ? { errorCode: 'SUBSCRIPTION_PAYMENT_AUTO_REFUND_PENDING' }
            : {}),
          eventId: event.eventId,
          orderId: order.id,
          provider: event.provider,
          status: refund.status === 'succeeded' ? 'processed' : 'failed',
        });
        return {
          duplicate: recorded.duplicate,
          status: refund.order.status,
        };
      }

      const settled = await commercial.settleSubscriptionPaymentOrder({
        amount: event.totalAmount,
        currency: event.currency,
        externalOrderId: event.outTradeNo,
        method,
        orderId: order.id,
        paymentReference: event.paymentReference ?? event.providerTransactionId,
        provider: event.provider,
      });
      if (settled.status === 'canceled') {
        const refund = await this.refundUncreditedOrder({
          order: settled,
          reason: 'Duplicate lifetime payment completed after entitlement activation',
        });
        finalized = refund.status === 'succeeded';
        await this.updateEvent({
          ...(refund.status === 'pending'
            ? { errorCode: 'SUBSCRIPTION_PAYMENT_AUTO_REFUND_PENDING' }
            : {}),
          eventId: event.eventId,
          orderId: order.id,
          provider: event.provider,
          status: refund.status === 'succeeded' ? 'processed' : 'failed',
        });
        return { duplicate: recorded.duplicate, status: refund.order.status };
      }
      finalized = true;
      await this.updateEvent({
        eventId: event.eventId,
        orderId: order.id,
        provider: event.provider,
        status: 'processed',
      });
      return { duplicate: recorded.duplicate || order.status === 'paid', status: settled.status };
    } catch (error) {
      if (!finalized) {
        await this.updateEvent({
          errorCode:
            error instanceof Error
              ? error.message.slice(0, 240)
              : 'SUBSCRIPTION_PAYMENT_EVENT_PROCESSING_FAILED',
          eventId: event.eventId,
          orderId,
          provider: event.provider,
          status: 'failed',
        });
      }
      throw error;
    }
  };
}
