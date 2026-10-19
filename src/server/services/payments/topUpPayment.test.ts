// @vitest-environment node
import type { ModuleAppNormalizedPaymentEvent } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TopUpPaymentService } from './topUpPayment';

const commercialMocks = vi.hoisted(() => ({
  claimOnlineTopUpRefund: vi.fn(),
  claimUncreditedOnlineTopUpRefund: vi.fn(),
  expireOnlineTopUpOrder: vi.fn(),
  getOnlineTopUpOrderByIdempotencyKey: vi.fn(),
  markUncreditedOnlineTopUpRefunded: vi.fn(),
  refundOnlineTopUpOrder: vi.fn(),
  settleOnlineTopUpOrder: vi.fn(),
  updateOnlineTopUpRefundStatus: vi.fn(),
}));

vi.mock('@/database/models/commercial', () => ({
  CommercialModel: vi.fn(() => commercialMocks),
}));

const paymentEvent = (
  eventType: ModuleAppNormalizedPaymentEvent['eventType'],
): ModuleAppNormalizedPaymentEvent => ({
  currency: 'CNY',
  eventId: 'event-1',
  eventType,
  occurredAt: new Date('2026-07-27T00:00:00.000Z'),
  outTradeNo: 'wechat-order-1',
  paymentReference: 'wechat-transaction-1',
  provider: 'wechat_pay',
  totalAmount: '19.900000',
});

const createDb = (status: 'canceled' | 'failed' | 'paid' | 'pending' | 'refunded') => {
  const updates: Array<Record<string, unknown>> = [];
  const updateReturning = vi.fn().mockResolvedValue([{ status: 'failed' }]);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const eventRow = {
    eventId: 'event-1',
    provider: 'wechat_pay',
    status: 'received',
  };
  const order = {
    amount: 19.9,
    currency: 'CNY',
    externalOrderId: 'wechat-order-1',
    id: '00000000-0000-4000-8000-000000000001',
    metadata: { method: 'wechat_pay', paymentReference: 'wechat-transaction-1' },
    provider: 'wechat_pay',
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
      topUpOrders: { findFirst: vi.fn().mockResolvedValue(order) },
      topUpPaymentEvents: { findFirst: vi.fn().mockResolvedValue(eventRow) },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return { where: updateWhere };
      }),
    })),
  };

  return db as unknown as LobeChatDatabase & {
    __mocks: { updateReturning: typeof updateReturning; updates: typeof updates };
  };
};

describe('TopUpPaymentService', () => {
  beforeEach(() => {
    for (const mock of Object.values(commercialMocks)) mock.mockReset();
    commercialMocks.updateOnlineTopUpRefundStatus.mockImplementation(
      async (input: { refundReference?: string; status: string }) => ({
        refundReference: input.refundReference ?? null,
        refundStatus: input.status,
        status: 'paid',
      }),
    );
  });

  it('manually confirms a pending ZPay refund before reversing credited top-up funds', async () => {
    const order = {
      amount: 19.9,
      externalOrderId: 'zpay-order-1',
      id: '00000000-0000-4000-8000-000000000001',
      metadata: { method: 'zpay_alipay' },
      provider: 'zpay',
      refundReference: 'zr-request-1',
      refundStatus: 'pending',
      status: 'paid',
      updatedAt: new Date(),
      userId: 'user-1',
    };
    const db = createDb('paid');
    (db.query.topUpOrders.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(order);
    commercialMocks.updateOnlineTopUpRefundStatus.mockResolvedValue({
      ...order,
      refundStatus: 'succeeded',
    });
    commercialMocks.refundOnlineTopUpOrder.mockResolvedValue({
      debtAmount: 2,
      order: { ...order, refundStatus: 'succeeded', status: 'refunded' },
    });
    const service = new TopUpPaymentService(db);

    await expect(
      service.resolvePendingRefund({
        orderId: order.id,
        resolution: 'succeeded',
        userId: order.userId,
      }),
    ).rejects.toThrow('TOP_UP_PAYMENT_REFUND_RESOLUTION_TOO_EARLY');
    expect(commercialMocks.updateOnlineTopUpRefundStatus).not.toHaveBeenCalled();
    order.updatedAt = new Date(Date.now() - 61_000);

    await expect(
      service.resolvePendingRefund({
        orderId: order.id,
        resolution: 'succeeded',
        userId: order.userId,
      }),
    ).resolves.toEqual({ debtAmount: 2, duplicate: false, status: 'refunded' });
    expect(commercialMocks.updateOnlineTopUpRefundStatus).toHaveBeenCalledWith({
      expectedRefundReference: 'zr-request-1',
      expectedStatus: 'pending',
      orderId: order.id,
      refundReference: 'zr-request-1',
      status: 'succeeded',
    });
    expect(commercialMocks.refundOnlineTopUpOrder).toHaveBeenCalledWith({
      amount: '19.900000',
      method: 'zpay_alipay',
      orderId: order.id,
      provider: 'zpay',
      refundReference: 'zr-request-1',
    });
  });

  it('marks a verified missing ZPay refund as failed without reversing credits', async () => {
    const order = {
      amount: 19.9,
      externalOrderId: 'zpay-order-1',
      id: '00000000-0000-4000-8000-000000000001',
      metadata: { method: 'zpay_alipay' },
      provider: 'zpay',
      refundReference: 'zr-request-1',
      refundStatus: 'pending',
      status: 'paid',
      updatedAt: new Date(Date.now() - 61_000),
      userId: 'user-1',
    };
    const db = createDb('paid');
    (db.query.topUpOrders.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(order);
    commercialMocks.updateOnlineTopUpRefundStatus.mockResolvedValue({
      ...order,
      refundStatus: 'failed',
    });
    const service = new TopUpPaymentService(db);

    await expect(
      service.resolvePendingRefund({
        orderId: order.id,
        resolution: 'failed',
        userId: order.userId,
      }),
    ).resolves.toEqual({ duplicate: false, status: 'failed' });
    expect(commercialMocks.refundOnlineTopUpOrder).not.toHaveBeenCalled();

    const retryOrder = { ...order, refundStatus: 'failed' };
    (db.query.topUpOrders.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(retryOrder);
    commercialMocks.claimOnlineTopUpRefund.mockResolvedValue({
      claimed: true,
      order: { ...retryOrder, refundStatus: 'pending' },
    });
    commercialMocks.updateOnlineTopUpRefundStatus.mockImplementation(
      async (input: { refundReference?: string; status: string }) => ({
        ...retryOrder,
        refundReference: input.refundReference ?? retryOrder.refundReference,
        refundStatus: input.status,
      }),
    );
    commercialMocks.refundOnlineTopUpOrder.mockResolvedValue({
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
    const retryService = new TopUpPaymentService(db, vi.fn().mockResolvedValue(adapter) as any);

    await expect(
      retryService.refundOrder({
        orderId: order.id,
        reason: 'operator verified retry',
        userId: order.userId,
      }),
    ).resolves.toEqual({ debtAmount: 0, duplicate: false, status: 'refunded' });
    expect(adapter.createRefundRequestNo).not.toHaveBeenCalled();
    expect(commercialMocks.claimOnlineTopUpRefund).toHaveBeenCalledWith({
      orderId: order.id,
      refundReference: order.refundReference,
    });
    expect(adapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({ refundRequestNo: order.refundReference }),
    );
  });

  it('does not call the provider twice when local refund reversal is retried', async () => {
    const order = {
      amount: 19.9,
      externalOrderId: 'wechat-order-1',
      id: '00000000-0000-4000-8000-000000000001',
      metadata: { method: 'wechat_pay' },
      provider: 'wechat_pay',
      refundReference: null,
      refundStatus: null,
      status: 'paid',
      userId: 'user-1',
    };
    const claimedOrder = {
      ...order,
      refundReference: 'wr-request-1',
      refundStatus: 'pending',
    };
    commercialMocks.claimOnlineTopUpRefund.mockResolvedValue({
      claimed: true,
      order: claimedOrder,
    });
    commercialMocks.refundOnlineTopUpOrder
      .mockRejectedValueOnce(new Error('LOCAL_REVERSAL_DOWN'))
      .mockResolvedValueOnce({ debtAmount: 0, order: { ...order, status: 'refunded' } });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('wr-request-1'),
      method: 'wechat_pay',
      provider: 'wechat_pay',
      queryRefund: vi.fn(),
      refund: vi.fn().mockResolvedValue({
        providerRefundId: 'wr-request-1',
        status: 'succeeded',
      }),
    };
    const db = createDb('paid');
    (db.query.topUpOrders.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({
        ...order,
        refundReference: 'wr-request-1',
        refundStatus: 'succeeded',
      });
    const service = new TopUpPaymentService(db, vi.fn().mockResolvedValue(adapter) as any);

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'requested', userId: order.userId }),
    ).rejects.toThrow('LOCAL_REVERSAL_DOWN');
    await expect(
      new TopUpPaymentService(db).refundOrder({
        orderId: order.id,
        reason: 'requested',
        userId: order.userId,
      }),
    ).resolves.toEqual({ debtAmount: 0, duplicate: true, status: 'refunded' });

    expect(adapter.refund).toHaveBeenCalledOnce();
    expect(adapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({ refundRequestNo: 'wr-request-1' }),
    );
    expect(commercialMocks.claimOnlineTopUpRefund).toHaveBeenNthCalledWith(1, {
      orderId: order.id,
      refundReference: 'wr-request-1',
    });
    expect(commercialMocks.claimOnlineTopUpRefund.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.refund.mock.invocationCallOrder[0],
    );
    expect(commercialMocks.claimOnlineTopUpRefund).toHaveBeenCalledOnce();
    expect(adapter.createRefundRequestNo).toHaveBeenCalledOnce();
  });

  it('queries a pre-persisted refund request after an uncertain provider failure', async () => {
    const order = {
      amount: 19.9,
      externalOrderId: 'wechat-order-1',
      id: '00000000-0000-4000-8000-000000000001',
      metadata: { method: 'wechat_pay' },
      provider: 'wechat_pay',
      refundReference: null,
      refundStatus: null,
      status: 'paid',
      userId: 'user-1',
    };
    const claimedOrder = {
      ...order,
      refundReference: 'wr-request-1',
      refundStatus: 'pending',
    };
    commercialMocks.claimOnlineTopUpRefund
      .mockResolvedValueOnce({ claimed: true, order: claimedOrder })
      .mockResolvedValueOnce({
        claimed: false,
        order: { ...order, refundReference: 'wr-request-1', refundStatus: 'pending' },
      });
    commercialMocks.refundOnlineTopUpOrder.mockResolvedValue({
      debtAmount: 0,
      order: { ...order, status: 'refunded' },
    });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('wr-request-1'),
      method: 'wechat_pay',
      provider: 'wechat_pay',
      queryRefund: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      refund: vi.fn().mockRejectedValue(new Error('PROVIDER_RESPONSE_LOST')),
    };
    const db = createDb('paid');
    (db.query.topUpOrders.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({
        ...order,
        refundReference: 'wr-request-1',
        refundStatus: 'pending',
      });
    const service = new TopUpPaymentService(db, vi.fn().mockResolvedValue(adapter) as any);

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'requested', userId: order.userId }),
    ).rejects.toThrow('PROVIDER_RESPONSE_LOST');
    await expect(
      service.refundOrder({ orderId: order.id, reason: 'requested', userId: order.userId }),
    ).resolves.toEqual({ debtAmount: 0, duplicate: true, status: 'refunded' });

    expect(adapter.refund).toHaveBeenCalledOnce();
    expect(adapter.queryRefund).toHaveBeenCalledWith({
      outRequestNo: 'wr-request-1',
      outTradeNo: 'wechat-order-1',
    });
    expect(adapter.createRefundRequestNo).toHaveBeenCalledOnce();
    expect(commercialMocks.updateOnlineTopUpRefundStatus).toHaveBeenCalledWith({
      expectedRefundReference: 'wr-request-1',
      expectedStatus: 'pending',
      orderId: order.id,
      refundReference: 'wr-request-1',
      status: 'pending',
    });
  });

  it('does not overwrite a concurrent terminal top-up refund state', async () => {
    const order = {
      amount: 19.9,
      externalOrderId: 'wechat-order-1',
      id: '00000000-0000-4000-8000-000000000001',
      metadata: { method: 'wechat_pay' },
      provider: 'wechat_pay',
      refundReference: null,
      refundStatus: null,
      status: 'paid',
      userId: 'user-1',
    };
    commercialMocks.claimOnlineTopUpRefund.mockResolvedValue({
      claimed: true,
      order: { ...order, refundReference: 'wr-request-1', refundStatus: 'pending' },
    });
    commercialMocks.updateOnlineTopUpRefundStatus.mockResolvedValue({
      ...order,
      refundReference: 'wr-request-1',
      refundStatus: 'failed',
    });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('wr-request-1'),
      method: 'wechat_pay',
      provider: 'wechat_pay',
      refund: vi.fn().mockResolvedValue({
        providerRefundId: 'wr-request-1',
        status: 'succeeded',
      }),
    };
    const service = new TopUpPaymentService(
      createDb('paid'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'requested', userId: order.userId }),
    ).rejects.toThrow('TOP_UP_PAYMENT_REFUND_RESOLUTION_CONFLICT');
    expect(adapter.refund).toHaveBeenCalledOnce();
    expect(commercialMocks.refundOnlineTopUpOrder).not.toHaveBeenCalled();
    expect(commercialMocks.updateOnlineTopUpRefundStatus).toHaveBeenCalledWith({
      expectedRefundReference: 'wr-request-1',
      expectedStatus: 'pending',
      orderId: order.id,
      refundReference: 'wr-request-1',
      status: 'succeeded',
    });
  });

  it('queries the provider before reporting that a missing checkout still needs recovery', async () => {
    commercialMocks.getOnlineTopUpOrderByIdempotencyKey.mockResolvedValue({
      checkout: null,
      externalOrderId: 'wechat-order-1',
      id: '00000000-0000-4000-8000-000000000001',
      metadata: { method: 'wechat_pay' },
      provider: 'wechat_pay',
      status: 'pending',
      userId: 'user-1',
    });
    const adapter = {
      method: 'wechat_pay',
      provider: 'wechat_pay',
      query: vi.fn().mockResolvedValue(null),
    };
    const service = new TopUpPaymentService(
      createDb('pending'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      service.reconcilePayment({
        idempotencyKey: '00000000-0000-4000-8000-000000000002',
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      checkout: null,
      orderId: '00000000-0000-4000-8000-000000000001',
      providerStatus: 'pending',
      recoveryRequired: true,
      status: 'pending',
    });
    expect(adapter.query).toHaveBeenCalledWith({ outTradeNo: 'wechat-order-1' });
    expect(commercialMocks.expireOnlineTopUpOrder).toHaveBeenCalledOnce();
  });

  it('settles a late provider success while recovering a locally failed order', async () => {
    commercialMocks.getOnlineTopUpOrderByIdempotencyKey
      .mockResolvedValueOnce({
        checkout: null,
        externalOrderId: 'wechat-order-1',
        id: '00000000-0000-4000-8000-000000000001',
        metadata: { method: 'wechat_pay' },
        provider: 'wechat_pay',
        status: 'failed',
        userId: 'user-1',
      })
      .mockResolvedValueOnce({
        checkout: null,
        externalOrderId: 'wechat-order-1',
        id: '00000000-0000-4000-8000-000000000001',
        metadata: { method: 'wechat_pay' },
        provider: 'wechat_pay',
        status: 'paid',
        userId: 'user-1',
      });
    commercialMocks.settleOnlineTopUpOrder.mockResolvedValue({ status: 'paid' });
    const adapter = {
      method: 'wechat_pay',
      provider: 'wechat_pay',
      query: vi.fn().mockResolvedValue(paymentEvent('payment_succeeded')),
    };
    const service = new TopUpPaymentService(
      createDb('failed'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      service.reconcilePayment({
        idempotencyKey: '00000000-0000-4000-8000-000000000002',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({
      providerStatus: 'payment_succeeded',
      recoveryRequired: false,
      status: 'paid',
    });
    expect(commercialMocks.settleOnlineTopUpOrder).toHaveBeenCalledOnce();
  });

  it('revalidates successful duplicate callbacks before reporting them as duplicates', async () => {
    commercialMocks.settleOnlineTopUpOrder.mockResolvedValue({ status: 'paid' });
    const service = new TopUpPaymentService(createDb('paid'));

    await expect(
      service.handleNormalizedEvent(paymentEvent('payment_succeeded'), 'wechat_pay'),
    ).resolves.toEqual({ duplicate: true, status: 'paid' });
    expect(commercialMocks.settleOnlineTopUpOrder).toHaveBeenCalledOnce();
  });

  it('processes a refund callback for an uncredited pending top-up', async () => {
    commercialMocks.markUncreditedOnlineTopUpRefunded.mockResolvedValue({ status: 'refunded' });
    const service = new TopUpPaymentService(createDb('pending'));

    await expect(
      service.handleNormalizedEvent(paymentEvent('refund_succeeded'), 'wechat_pay'),
    ).resolves.toEqual({ duplicate: false, status: 'refunded' });
    expect(commercialMocks.markUncreditedOnlineTopUpRefunded).toHaveBeenCalledWith({
      orderId: '00000000-0000-4000-8000-000000000001',
      refundReference: 'wechat-transaction-1',
    });
  });

  it('claims a canceled late payment before requesting its automatic refund', async () => {
    const order = {
      amount: 19.9,
      currency: 'CNY',
      externalOrderId: 'wechat-order-1',
      id: '00000000-0000-4000-8000-000000000001',
      metadata: { method: 'wechat_pay' },
      provider: 'wechat_pay',
      refundReference: null,
      refundStatus: null,
      status: 'canceled',
      userId: 'user-1',
    };
    commercialMocks.claimUncreditedOnlineTopUpRefund.mockResolvedValue({
      claimed: true,
      order: { ...order, refundReference: 'wr-request-1', refundStatus: 'pending' },
    });
    commercialMocks.markUncreditedOnlineTopUpRefunded.mockResolvedValue({
      ...order,
      refundReference: 'wr-request-1',
      refundStatus: 'succeeded',
      status: 'refunded',
    });
    const adapter = {
      createRefundRequestNo: vi.fn().mockReturnValue('wr-request-1'),
      method: 'wechat_pay',
      provider: 'wechat_pay',
      refund: vi.fn().mockResolvedValue({
        providerRefundId: 'wr-request-1',
        status: 'succeeded',
      }),
    };
    const service = new TopUpPaymentService(
      createDb('canceled'),
      vi.fn().mockResolvedValue(adapter) as any,
    );

    await expect(
      service.handleNormalizedEvent(paymentEvent('payment_succeeded'), 'wechat_pay'),
    ).resolves.toEqual({ duplicate: false, status: 'refunded' });
    expect(commercialMocks.claimUncreditedOnlineTopUpRefund).toHaveBeenCalledWith({
      orderId: order.id,
      refundReference: 'wr-request-1',
    });
    expect(
      commercialMocks.claimUncreditedOnlineTopUpRefund.mock.invocationCallOrder[0],
    ).toBeLessThan(adapter.refund.mock.invocationCallOrder[0]);
    expect(commercialMocks.markUncreditedOnlineTopUpRefunded).toHaveBeenCalledWith({
      orderId: order.id,
      refundReference: 'wr-request-1',
    });
  });

  it('finishes a successful uncredited refund without resolving an adapter', async () => {
    const order = {
      amount: 19.9,
      currency: 'CNY',
      externalOrderId: 'wechat-order-1',
      id: '00000000-0000-4000-8000-000000000001',
      metadata: { method: 'wechat_pay' },
      provider: 'wechat_pay',
      refundReference: 'wr-request-1',
      refundStatus: 'succeeded',
      status: 'canceled',
      userId: 'user-1',
    };
    const db = createDb('canceled');
    (db.query.topUpOrders.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(order);
    commercialMocks.markUncreditedOnlineTopUpRefunded.mockResolvedValue({
      ...order,
      status: 'refunded',
    });

    await expect(
      new TopUpPaymentService(db).handleNormalizedEvent(
        paymentEvent('payment_succeeded'),
        'wechat_pay',
      ),
    ).resolves.toEqual({ duplicate: false, status: 'refunded' });
    expect(commercialMocks.claimUncreditedOnlineTopUpRefund).not.toHaveBeenCalled();
    expect(commercialMocks.markUncreditedOnlineTopUpRefunded).toHaveBeenCalledWith({
      orderId: order.id,
      refundReference: order.refundReference,
    });
  });

  it('persists a failed event when settlement throws', async () => {
    commercialMocks.settleOnlineTopUpOrder.mockRejectedValue(new Error('SETTLEMENT_DOWN'));
    const db = createDb('pending');
    const service = new TopUpPaymentService(db);

    await expect(
      service.handleNormalizedEvent(paymentEvent('payment_succeeded'), 'wechat_pay'),
    ).rejects.toThrow('SETTLEMENT_DOWN');
    expect(db.__mocks.updates).toContainEqual(
      expect.objectContaining({ errorCode: 'SETTLEMENT_DOWN', status: 'failed' }),
    );
  });

  it('rejects a failed provider event when its amount does not match the order', async () => {
    const service = new TopUpPaymentService(createDb('pending'));

    await expect(
      service.handleNormalizedEvent(
        { ...paymentEvent('payment_failed'), totalAmount: '19.910000' },
        'wechat_pay',
      ),
    ).rejects.toThrow('TOP_UP_PAYMENT_VERIFICATION_FAILED');
  });

  it('reports the committed order state when a stale failed event loses the update race', async () => {
    const db = createDb('pending');
    db.__mocks.updateReturning.mockResolvedValueOnce([]);
    (db.query.topUpOrders.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        amount: 19.9,
        currency: 'CNY',
        externalOrderId: 'wechat-order-1',
        id: '00000000-0000-4000-8000-000000000001',
        metadata: { method: 'wechat_pay' },
        provider: 'wechat_pay',
        status: 'pending',
        userId: 'user-1',
      })
      .mockResolvedValueOnce({ status: 'paid' });

    await expect(
      new TopUpPaymentService(db).handleNormalizedEvent(
        paymentEvent('payment_failed'),
        'wechat_pay',
      ),
    ).resolves.toEqual({ duplicate: false, status: 'paid' });
  });
});
