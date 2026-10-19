// @vitest-environment node
import type { ModuleAppNormalizedPaymentEvent } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { SubscriptionPaymentService } from './subscriptionPayment';

const commercialMocks = vi.hoisted(() => ({
  claimSubscriptionPaymentRefund: vi.fn(),
  claimUncreditedSubscriptionPaymentRefund: vi.fn(),
  expireSubscriptionPaymentOrder: vi.fn(),
  getSubscriptionPaymentOrder: vi.fn(),
  getSubscriptionPaymentOrderByIdempotencyKey: vi.fn(),
  markUncreditedSubscriptionPaymentRefunded: vi.fn(),
  refundSubscriptionPaymentOrder: vi.fn(),
  settleSubscriptionPaymentOrder: vi.fn(),
  updateSubscriptionPaymentRefundStatus: vi.fn(),
}));

vi.mock('@/database/models/commercial', () => ({
  CommercialModel: vi.fn(() => commercialMocks),
}));

const paymentEvent = (
  eventType: ModuleAppNormalizedPaymentEvent['eventType'],
): ModuleAppNormalizedPaymentEvent => ({
  currency: 'CNY',
  eventId: 'subscription-event-1',
  eventType,
  occurredAt: new Date('2026-07-27T00:00:00.000Z'),
  outTradeNo: 'subscription-order-1',
  paymentReference: 'provider-transaction-1',
  provider: 'alipay',
  totalAmount: '68.000000',
});

const createDb = (status: 'canceled' | 'failed' | 'paid' | 'pending' | 'refunded') => {
  const updates: Array<Record<string, unknown>> = [];
  const updateReturning = vi.fn().mockResolvedValue([{ status: 'failed' }]);
  const eventRow = {
    eventId: 'subscription-event-1',
    provider: 'alipay',
    status: 'received',
  };
  const order = {
    amount: 68,
    currency: 'CNY',
    externalOrderId: 'subscription-order-1',
    id: '00000000-0000-4000-8000-000000000010',
    method: 'alipay',
    provider: 'alipay',
    status,
    userId: 'user-1',
  };
  const db = {
    __mocks: { updateReturning, updates },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([eventRow]),
        })),
      })),
    })),
    query: {
      subscriptionPaymentEvents: { findFirst: vi.fn().mockResolvedValue(eventRow) },
      subscriptionPaymentOrders: { findFirst: vi.fn().mockResolvedValue(order) },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return { where: vi.fn(() => ({ returning: updateReturning })) };
      }),
    })),
  };

  return db as unknown as LobeChatDatabase & {
    __mocks: { updateReturning: typeof updateReturning; updates: typeof updates };
  };
};

describe('SubscriptionPaymentService', () => {
  beforeEach(() => {
    for (const mock of Object.values(commercialMocks)) mock.mockReset();
    commercialMocks.updateSubscriptionPaymentRefundStatus.mockImplementation(
      async (input: { refundReference?: string; status: string }) => ({
        refundReference: input.refundReference ?? null,
        refundStatus: input.status,
        status: 'paid',
      }),
    );
  });

  it('manually confirms a pending ZPay refund before reversing subscription benefits', async () => {
    const order = {
      amount: 68,
      externalOrderId: 'zpay-subscription-order-1',
      id: '00000000-0000-4000-8000-000000000010',
      method: 'zpay_wechat',
      provider: 'zpay',
      refundReference: 'zr-request-1',
      refundStatus: 'pending',
      status: 'paid',
      updatedAt: new Date(),
      userId: 'user-1',
    };
    commercialMocks.getSubscriptionPaymentOrder.mockResolvedValue(order);
    commercialMocks.updateSubscriptionPaymentRefundStatus.mockResolvedValue({
      ...order,
      refundStatus: 'succeeded',
    });
    commercialMocks.refundSubscriptionPaymentOrder.mockResolvedValue({
      debtAmount: 4,
      order: { ...order, refundStatus: 'succeeded', status: 'refunded' },
    });
    const service = new SubscriptionPaymentService(createDb('paid'));

    await expect(
      service.resolvePendingRefund({
        orderId: order.id,
        resolution: 'succeeded',
        userId: order.userId,
      }),
    ).rejects.toThrow('SUBSCRIPTION_PAYMENT_REFUND_RESOLUTION_TOO_EARLY');
    expect(commercialMocks.updateSubscriptionPaymentRefundStatus).not.toHaveBeenCalled();
    order.updatedAt = new Date(Date.now() - 61_000);

    await expect(
      service.resolvePendingRefund({
        orderId: order.id,
        resolution: 'succeeded',
        userId: order.userId,
      }),
    ).resolves.toEqual({ debtAmount: 4, duplicate: false, status: 'refunded' });
    expect(commercialMocks.updateSubscriptionPaymentRefundStatus).toHaveBeenCalledWith({
      expectedRefundReference: 'zr-request-1',
      expectedStatus: 'pending',
      orderId: order.id,
      refundReference: 'zr-request-1',
      status: 'succeeded',
    });
    expect(commercialMocks.refundSubscriptionPaymentOrder).toHaveBeenCalledWith({
      amount: '68.000000',
      method: 'zpay_wechat',
      orderId: order.id,
      provider: 'zpay',
      refundReference: 'zr-request-1',
    });
  });

  it('marks a verified missing ZPay refund as failed without reversing plan benefits', async () => {
    const order = {
      amount: 68,
      externalOrderId: 'zpay-subscription-order-1',
      id: '00000000-0000-4000-8000-000000000010',
      method: 'zpay_alipay',
      provider: 'zpay',
      refundReference: 'zr-request-1',
      refundStatus: 'pending',
      status: 'paid',
      updatedAt: new Date(Date.now() - 61_000),
      userId: 'user-1',
    };
    commercialMocks.getSubscriptionPaymentOrder.mockResolvedValue(order);
    commercialMocks.updateSubscriptionPaymentRefundStatus.mockResolvedValue({
      ...order,
      refundStatus: 'failed',
    });
    const service = new SubscriptionPaymentService(createDb('paid'));

    await expect(
      service.resolvePendingRefund({
        orderId: order.id,
        resolution: 'failed',
        userId: order.userId,
      }),
    ).resolves.toEqual({ duplicate: false, status: 'failed' });
    expect(commercialMocks.refundSubscriptionPaymentOrder).not.toHaveBeenCalled();

    const retryOrder = { ...order, refundStatus: 'failed' };
    commercialMocks.getSubscriptionPaymentOrder.mockResolvedValue(retryOrder);
    commercialMocks.claimSubscriptionPaymentRefund.mockResolvedValue({
      claimed: true,
      order: { ...retryOrder, refundStatus: 'pending' },
    });
    commercialMocks.updateSubscriptionPaymentRefundStatus.mockImplementation(
      async (input: { refundReference?: string; status: string }) => ({
        ...retryOrder,
        refundReference: input.refundReference ?? retryOrder.refundReference,
        refundStatus: input.status,
      }),
    );
    commercialMocks.refundSubscriptionPaymentOrder.mockResolvedValue({
      debtAmount: 0,
      order: { ...retryOrder, refundStatus: 'succeeded', status: 'refunded' },
    });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('unexpected-new-reference'),
      method: 'zpay_alipay',
      provider: 'zpay',
      refund: vi.fn().mockResolvedValue({
        providerRefundId: order.refundReference,
        status: 'succeeded',
      }),
    };
    const retryService = new SubscriptionPaymentService(
      createDb('paid'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      retryService.refundOrder({
        orderId: order.id,
        reason: 'operator verified retry',
        userId: order.userId,
      }),
    ).resolves.toEqual({ debtAmount: 0, duplicate: false, status: 'refunded' });
    expect(adapter.createRefundRequestNo).not.toHaveBeenCalled();
    expect(commercialMocks.claimSubscriptionPaymentRefund).toHaveBeenCalledWith({
      orderId: order.id,
      refundReference: order.refundReference,
    });
    expect(adapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({ refundRequestNo: order.refundReference }),
    );
  });

  it('does not call the provider twice when subscription reversal is retried', async () => {
    const order = {
      amount: 68,
      externalOrderId: 'subscription-order-1',
      id: '00000000-0000-4000-8000-000000000010',
      method: 'alipay',
      provider: 'alipay',
      refundReference: null,
      refundStatus: null,
      status: 'paid',
      userId: 'user-1',
    };
    const claimedOrder = {
      ...order,
      refundReference: 'refund-request-1',
      refundStatus: 'pending',
    };
    commercialMocks.getSubscriptionPaymentOrder.mockResolvedValueOnce(order).mockResolvedValueOnce({
      ...order,
      refundReference: 'refund-request-1',
      refundStatus: 'succeeded',
    });
    commercialMocks.claimSubscriptionPaymentRefund.mockResolvedValue({
      claimed: true,
      order: claimedOrder,
    });
    commercialMocks.refundSubscriptionPaymentOrder
      .mockRejectedValueOnce(new Error('LOCAL_BENEFIT_REVERSAL_DOWN'))
      .mockResolvedValueOnce({ debtAmount: 0, order: { ...order, status: 'refunded' } });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('refund-request-1'),
      method: 'alipay',
      provider: 'alipay',
      queryRefund: vi.fn(),
      refund: vi.fn().mockResolvedValue({
        providerRefundId: 'refund-request-1',
        status: 'succeeded',
      }),
    };
    const service = new SubscriptionPaymentService(
      createDb('paid'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'requested', userId: order.userId }),
    ).rejects.toThrow('LOCAL_BENEFIT_REVERSAL_DOWN');
    await expect(
      new SubscriptionPaymentService(createDb('paid')).refundOrder({
        orderId: order.id,
        reason: 'requested',
        userId: order.userId,
      }),
    ).resolves.toEqual({ debtAmount: 0, duplicate: true, status: 'refunded' });

    expect(adapter.refund).toHaveBeenCalledOnce();
    expect(adapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({ refundRequestNo: 'refund-request-1' }),
    );
    expect(commercialMocks.claimSubscriptionPaymentRefund).toHaveBeenNthCalledWith(1, {
      orderId: order.id,
      refundReference: 'refund-request-1',
    });
    expect(commercialMocks.claimSubscriptionPaymentRefund.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.refund.mock.invocationCallOrder[0],
    );
    expect(commercialMocks.claimSubscriptionPaymentRefund).toHaveBeenCalledOnce();
    expect(adapter.createRefundRequestNo).toHaveBeenCalledOnce();
  });

  it('does not overwrite a concurrent terminal subscription refund state', async () => {
    const order = {
      amount: 68,
      externalOrderId: 'subscription-order-1',
      id: '00000000-0000-4000-8000-000000000010',
      method: 'alipay',
      provider: 'alipay',
      refundReference: null,
      refundStatus: null,
      status: 'paid',
      userId: 'user-1',
    };
    commercialMocks.getSubscriptionPaymentOrder.mockResolvedValue(order);
    commercialMocks.claimSubscriptionPaymentRefund.mockResolvedValue({
      claimed: true,
      order: { ...order, refundReference: 'refund-request-1', refundStatus: 'pending' },
    });
    commercialMocks.updateSubscriptionPaymentRefundStatus.mockResolvedValue({
      ...order,
      refundReference: 'refund-request-1',
      refundStatus: 'failed',
    });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('refund-request-1'),
      method: 'alipay',
      provider: 'alipay',
      refund: vi.fn().mockResolvedValue({
        providerRefundId: 'refund-request-1',
        status: 'succeeded',
      }),
    };
    const service = new SubscriptionPaymentService(
      createDb('paid'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'requested', userId: order.userId }),
    ).rejects.toThrow('SUBSCRIPTION_PAYMENT_REFUND_RESOLUTION_CONFLICT');
    expect(adapter.refund).toHaveBeenCalledOnce();
    expect(commercialMocks.refundSubscriptionPaymentOrder).not.toHaveBeenCalled();
    expect(commercialMocks.updateSubscriptionPaymentRefundStatus).toHaveBeenCalledWith({
      expectedRefundReference: 'refund-request-1',
      expectedStatus: 'pending',
      orderId: order.id,
      refundReference: 'refund-request-1',
      status: 'succeeded',
    });
  });

  it('recovers a canceled late payment through the uncredited refund state machine', async () => {
    const order = {
      amount: 68,
      currency: 'CNY',
      externalOrderId: 'subscription-order-1',
      id: '00000000-0000-4000-8000-000000000010',
      method: 'alipay',
      provider: 'alipay',
      refundReference: null,
      refundStatus: null,
      status: 'canceled',
      userId: 'user-1',
    };
    commercialMocks.claimUncreditedSubscriptionPaymentRefund.mockResolvedValue({
      claimed: true,
      order: { ...order, refundReference: 'refund-request-1', refundStatus: 'pending' },
    });
    commercialMocks.markUncreditedSubscriptionPaymentRefunded.mockResolvedValue({
      ...order,
      refundReference: 'refund-request-1',
      refundStatus: 'succeeded',
      status: 'refunded',
    });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('refund-request-1'),
      method: 'alipay',
      provider: 'alipay',
      refund: vi.fn().mockResolvedValue({
        providerRefundId: 'refund-request-1',
        status: 'succeeded',
      }),
    };
    const service = new SubscriptionPaymentService(
      createDb('canceled'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      service.handleNormalizedEvent(paymentEvent('payment_succeeded'), 'alipay'),
    ).resolves.toEqual({ duplicate: false, status: 'refunded' });
    expect(commercialMocks.claimUncreditedSubscriptionPaymentRefund).toHaveBeenCalledWith({
      orderId: order.id,
      refundReference: 'refund-request-1',
    });
    expect(
      commercialMocks.claimUncreditedSubscriptionPaymentRefund.mock.invocationCallOrder[0],
    ).toBeLessThan(adapter.refund.mock.invocationCallOrder[0]);
    expect(commercialMocks.markUncreditedSubscriptionPaymentRefunded).toHaveBeenCalledWith({
      orderId: order.id,
      refundReference: 'refund-request-1',
    });
  });

  it('settles a verified subscription success event', async () => {
    commercialMocks.settleSubscriptionPaymentOrder.mockResolvedValue({ status: 'paid' });
    const service = new SubscriptionPaymentService(createDb('pending'));

    await expect(
      service.handleNormalizedEvent(paymentEvent('payment_succeeded'), 'alipay'),
    ).resolves.toEqual({ duplicate: false, status: 'paid' });
    expect(commercialMocks.settleSubscriptionPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '68.000000',
        method: 'alipay',
        provider: 'alipay',
      }),
    );
  });

  it('automatically refunds a duplicate lifetime payment rejected during settlement', async () => {
    const canceledOrder = {
      amount: 68,
      currency: 'CNY',
      externalOrderId: 'subscription-order-1',
      id: '00000000-0000-4000-8000-000000000010',
      method: 'alipay',
      provider: 'alipay',
      refundReference: null,
      refundStatus: null,
      status: 'canceled',
      userId: 'user-1',
    };
    commercialMocks.settleSubscriptionPaymentOrder.mockResolvedValue(canceledOrder);
    commercialMocks.claimUncreditedSubscriptionPaymentRefund.mockResolvedValue({
      claimed: true,
      order: {
        ...canceledOrder,
        refundReference: 'refund-request-1',
        refundStatus: 'pending',
      },
    });
    commercialMocks.markUncreditedSubscriptionPaymentRefunded.mockResolvedValue({
      ...canceledOrder,
      refundReference: 'refund-request-1',
      refundStatus: 'succeeded',
      status: 'refunded',
    });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('refund-request-1'),
      method: 'alipay',
      provider: 'alipay',
      refund: vi.fn().mockResolvedValue({
        providerRefundId: 'refund-request-1',
        status: 'succeeded',
      }),
    };
    const service = new SubscriptionPaymentService(
      createDb('pending'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      service.handleNormalizedEvent(paymentEvent('payment_succeeded'), 'alipay'),
    ).resolves.toEqual({ duplicate: false, status: 'refunded' });
    expect(adapter.refund).toHaveBeenCalledOnce();
    expect(commercialMocks.markUncreditedSubscriptionPaymentRefunded).toHaveBeenCalledWith({
      orderId: canceledOrder.id,
      refundReference: 'refund-request-1',
    });
  });

  it('finishes a successful uncredited refund without resolving an adapter', async () => {
    const order = {
      amount: 68,
      currency: 'CNY',
      externalOrderId: 'subscription-order-1',
      id: '00000000-0000-4000-8000-000000000010',
      method: 'alipay',
      provider: 'alipay',
      refundReference: 'refund-request-1',
      refundStatus: 'succeeded',
      status: 'canceled',
      userId: 'user-1',
    };
    const db = createDb('canceled');
    (db.query.subscriptionPaymentOrders.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      order,
    );
    commercialMocks.markUncreditedSubscriptionPaymentRefunded.mockResolvedValue({
      ...order,
      status: 'refunded',
    });

    await expect(
      new SubscriptionPaymentService(db).handleNormalizedEvent(
        paymentEvent('payment_succeeded'),
        'alipay',
      ),
    ).resolves.toEqual({ duplicate: false, status: 'refunded' });
    expect(commercialMocks.claimUncreditedSubscriptionPaymentRefund).not.toHaveBeenCalled();
    expect(commercialMocks.markUncreditedSubscriptionPaymentRefunded).toHaveBeenCalledWith({
      orderId: order.id,
      refundReference: order.refundReference,
    });
  });

  it('persists a failed event when subscription activation throws', async () => {
    commercialMocks.settleSubscriptionPaymentOrder.mockRejectedValue(
      new Error('SUBSCRIPTION_ACTIVATION_FAILED'),
    );
    const db = createDb('pending');
    const service = new SubscriptionPaymentService(db);

    await expect(
      service.handleNormalizedEvent(paymentEvent('payment_succeeded'), 'alipay'),
    ).rejects.toThrow('SUBSCRIPTION_ACTIVATION_FAILED');
    expect(db.__mocks.updates).toContainEqual(
      expect.objectContaining({
        errorCode: 'SUBSCRIPTION_ACTIVATION_FAILED',
        status: 'failed',
      }),
    );
  });

  it('reverses paid subscription benefits on a refund callback', async () => {
    commercialMocks.refundSubscriptionPaymentOrder.mockResolvedValue({
      order: { status: 'refunded' },
    });
    const service = new SubscriptionPaymentService(createDb('paid'));

    await expect(
      service.handleNormalizedEvent(paymentEvent('refund_succeeded'), 'alipay'),
    ).resolves.toEqual({ duplicate: false, status: 'refunded' });
    expect(commercialMocks.refundSubscriptionPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ refundReference: 'provider-transaction-1' }),
    );
  });

  it('reports the committed order state when a stale failed event loses the update race', async () => {
    const db = createDb('pending');
    db.__mocks.updateReturning.mockResolvedValueOnce([]);
    (db.query.subscriptionPaymentOrders.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        amount: 68,
        currency: 'CNY',
        externalOrderId: 'subscription-order-1',
        id: '00000000-0000-4000-8000-000000000010',
        method: 'alipay',
        provider: 'alipay',
        status: 'pending',
        userId: 'user-1',
      })
      .mockResolvedValueOnce({ status: 'paid' });

    await expect(
      new SubscriptionPaymentService(db).handleNormalizedEvent(
        paymentEvent('payment_failed'),
        'alipay',
      ),
    ).resolves.toEqual({ duplicate: false, status: 'paid' });
  });
});
