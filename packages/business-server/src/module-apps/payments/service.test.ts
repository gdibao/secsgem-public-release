// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ModuleAppCommerceModel } from '@/database/models/moduleAppCommerce';
import { ModuleAppPaymentModel } from '@/database/models/moduleAppPayment';
import {
  moduleAppAuditLogs,
  moduleAppInstallations,
  moduleAppLicenses,
  moduleAppOrders,
  moduleAppPaymentAttempts,
  moduleAppPaymentDiscrepancies,
  moduleAppPaymentEvents,
  moduleAppPaymentRefunds,
  moduleAppPrices,
  moduleAppProducts,
  moduleAppRevenueEntries,
  moduleApps,
  moduleAppSubscriptions,
  moduleAppVersions,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { ModuleAppOrderRevenueService } from '../revenue';
import type { ModuleAppPaymentAdapter } from './contracts';
import { ModuleAppPaymentService } from './service';

const APP_ID = '20000000-0000-4000-8000-000000000001';
const USER_ID = 'module-app-payment-user';
const serverDB: LobeChatDatabase = await getTestDB();

const createAdapter = (): ModuleAppPaymentAdapter => ({
  createOutTradeNo: ({ orderId }) => `out-${orderId}`,
  createRefundRequestNo: vi.fn(() => 'refund-1'),
  create: vi.fn(async ({ orderId }: Parameters<ModuleAppPaymentAdapter['create']>[0]) => ({
    checkout: {
      fields: { order_id: orderId },
      method: 'POST' as const,
      type: 'form' as const,
      url: 'https://pay.example.com/checkout',
    },
    method: 'alipay' as const,
    outTradeNo: `out-${orderId}`,
    provider: 'alipay' as const,
  })),
  method: 'alipay',
  provider: 'alipay',
  query: vi.fn(),
  refund: vi.fn(async (input: Parameters<ModuleAppPaymentAdapter['refund']>[0]) => ({
    providerRefundId: input.refundRequestNo ?? 'refund-1',
    status: 'succeeded' as const,
  })),
  verifyNotification: vi.fn(),
});

const createZPayAdapter = (): ModuleAppPaymentAdapter => ({
  ...createAdapter(),
  create: vi.fn(async ({ orderId }: Parameters<ModuleAppPaymentAdapter['create']>[0]) => ({
    checkout: {
      fields: { order_id: orderId },
      method: 'POST' as const,
      type: 'form' as const,
      url: 'https://pay.example.com/checkout',
    },
    method: 'zpay_alipay' as const,
    outTradeNo: `out-${orderId}`,
    provider: 'zpay' as const,
  })),
  method: 'zpay_alipay',
  provider: 'zpay',
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(moduleAppPaymentDiscrepancies);
  await serverDB.delete(moduleAppPaymentRefunds);
  await serverDB.delete(moduleAppPaymentEvents);
  await serverDB.delete(moduleAppPaymentAttempts);
  await serverDB.delete(moduleAppSubscriptions);
  await serverDB.delete(moduleAppLicenses);
  await serverDB.delete(moduleAppRevenueEntries);
  await serverDB.delete(moduleAppAuditLogs);
  await serverDB.delete(moduleAppOrders);
  await serverDB.delete(moduleAppInstallations);
  await serverDB.delete(moduleAppPrices);
  await serverDB.delete(moduleAppProducts);
  await serverDB.delete(moduleAppVersions);
  await serverDB.delete(moduleApps);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: USER_ID });
  await serverDB.insert(moduleApps).values({
    appType: 'standard_app',
    category: 'commerce',
    description: 'Payment test app',
    displayName: 'Payment test app',
    icon: 'CreditCard',
    id: APP_ID,
    slug: `payment-test-${crypto.randomUUID()}`,
    status: 'published',
  });
  const [publishedVersion] = await serverDB
    .insert(moduleAppVersions)
    .values({
      appId: APP_ID,
      publishedAt: new Date('2026-07-14T00:00:00.000Z'),
      version: '1.0.0',
    })
    .returning();
  await serverDB
    .update(moduleApps)
    .set({ currentPublishedVersionId: publishedVersion.id })
    .where(eq(moduleApps.id, APP_ID));
});

const createPendingOrder = async () => {
  const commerce = new ModuleAppCommerceModel(serverDB);
  const product = await commerce.createProduct({
    appId: APP_ID,
    licenseScope: 'personal',
    price: { amount: 1234, currency: 'CNY' },
    productKey: `payment-${crypto.randomUUID()}`,
    productType: 'one_time',
  });
  return commerce.createOrder({ productId: product.id, purchaserUserId: USER_ID });
};

describe('ModuleAppPaymentService', () => {
  it('fails payment creation closed outside the server-resolved rollout allowlist', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const input = {
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    };

    await expect(
      service.createPayment({ ...input, rollout: { appIds: [], publisherIds: [] } }),
    ).rejects.toThrow('MODULE_APP_ROLLOUT_NOT_ALLOWED');
    expect(adapter.create).not.toHaveBeenCalled();

    await expect(
      service.createPayment({ ...input, rollout: { appIds: [APP_ID], publisherIds: [] } }),
    ).resolves.toMatchObject({ outTradeNo: `out-${order.id}` });
  });

  it('locks an order to its first payment method before another provider is called', async () => {
    const firstAdapter = createAdapter();
    const order = await createPendingOrder();
    const input = {
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    };
    await new ModuleAppPaymentService(serverDB, firstAdapter).createPayment(input);

    const secondAdapter: ModuleAppPaymentAdapter = {
      ...createAdapter(),
      createOutTradeNo: ({ orderId }) => `wx-${orderId}`,
      method: 'wechat_pay',
      provider: 'wechat_pay',
    };
    await expect(
      new ModuleAppPaymentService(serverDB, secondAdapter).createPayment(input),
    ).rejects.toThrow('MODULE_APP_PAYMENT_ATTEMPT_CONFLICT');
    expect(secondAdapter.create).not.toHaveBeenCalled();
  });

  it('records the provider order reference before an uncertain create request fails', async () => {
    const adapter = createAdapter();
    (adapter.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network timeout'));
    const order = await createPendingOrder();

    await expect(
      new ModuleAppPaymentService(serverDB, adapter).createPayment({
        notifyUrl: 'https://app.example.com/notify',
        orderId: order.id,
        returnUrl: 'https://app.example.com/return',
      }),
    ).rejects.toThrow('network timeout');
    await expect(
      serverDB.query.moduleAppPaymentAttempts.findFirst({
        where: (attempt, { eq }) => eq(attempt.orderId, order.id),
      }),
    ).resolves.toMatchObject({
      outTradeNo: `out-${order.id}`,
      status: 'created',
    });
  });

  it('does not repeat an uncertain WeChat create request without a persisted checkout', async () => {
    const adapter: ModuleAppPaymentAdapter = {
      ...createAdapter(),
      createOutTradeNo: ({ orderId }) => `wx-${orderId}`,
      method: 'wechat_pay',
      provider: 'wechat_pay',
    };
    (adapter.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network timeout'));
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const input = {
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    };

    await expect(service.createPayment(input)).rejects.toThrow('network timeout');
    await expect(service.createPayment(input)).rejects.toThrow(
      'MODULE_APP_PAYMENT_CHECKOUT_RECOVERY_REQUIRED',
    );
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it('uses the server order snapshot and settles a verified event once', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'CNY',
        orderId: order.id,
        subject: 'Payment test app',
        totalAmount: '1234.000000',
      }),
    );
    await expect(
      service.createPayment({
        notifyUrl: 'https://app.example.com/notify',
        orderId: order.id,
        returnUrl: 'https://app.example.com/return',
      }),
    ).resolves.toMatchObject({ outTradeNo: payment.outTradeNo });
    expect(adapter.create).toHaveBeenCalledTimes(1);
    await expect(serverDB.query.moduleAppPaymentAttempts.findMany()).resolves.toHaveLength(1);
    await expect(
      serverDB.query.moduleAppPaymentAttempts.findFirst({
        where: (attempt, { eq }) => eq(attempt.orderId, order.id),
      }),
    ).resolves.toMatchObject({
      checkout: payment.checkout,
      status: 'pending',
      subject: 'Payment test app',
    });

    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-1',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-1',
      totalAmount: '1234.000000',
    });
    await expect(
      service.handleNotification({ body: 'signed', headers: {} }),
    ).resolves.toMatchObject({ duplicate: false, status: 'paid' });
    await expect(
      service.handleNotification({ body: 'signed', headers: {} }),
    ).resolves.toMatchObject({ duplicate: true, status: 'paid' });
  });

  it('repairs a received duplicate after settlement committed before payment bookkeeping', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    const event = {
      currency: 'CNY',
      eventId: 'notify-bookkeeping-recovery',
      eventType: 'payment_succeeded' as const,
      occurredAt: new Date('2026-07-27T08:00:00.000Z'),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay' as const,
      providerTransactionId: 'trade-bookkeeping-recovery',
      totalAmount: '1234.000000',
    };
    await new ModuleAppPaymentModel(serverDB).recordPaymentEvent(event);
    await new ModuleAppOrderRevenueService(serverDB).settleOrder({
      actorUserId: USER_ID,
      orderId: order.id,
      paymentReference: event.providerTransactionId,
    });

    await expect(service.handleNormalizedEvent(event)).resolves.toEqual({
      duplicate: true,
      status: 'paid',
    });
    await expect(serverDB.query.moduleAppPaymentAttempts.findFirst()).resolves.toMatchObject({
      paidAt: event.occurredAt,
      providerTransactionId: event.providerTransactionId,
      status: 'paid',
    });
    await expect(serverDB.query.moduleAppPaymentEvents.findFirst()).resolves.toMatchObject({
      eventStatus: 'processed',
      orderId: order.id,
    });
  });

  it('retries settlement when the same verified event previously failed to settle', async () => {
    const adapter = createAdapter();
    const settleOrder = vi
      .fn<ModuleAppOrderRevenueService['settleOrder']>()
      .mockRejectedValueOnce(new Error('temporary settlement failure'))
      .mockImplementation((input) => new ModuleAppOrderRevenueService(serverDB).settleOrder(input));
    const orderRevenueService = new ModuleAppOrderRevenueService(serverDB);
    const service = new ModuleAppPaymentService(serverDB, adapter, undefined, {
      refundOrder: orderRevenueService.refundOrder,
      settleOrder,
    });
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-retry-settlement',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-retry-settlement',
      totalAmount: '1234.000000',
    });
    await expect(service.handleNotification({ body: 'signed', headers: {} })).rejects.toThrow(
      'temporary settlement failure',
    );

    await expect(
      service.handleNotification({ body: 'signed', headers: {} }),
    ).resolves.toMatchObject({
      duplicate: true,
      status: 'paid',
    });
    expect(settleOrder).toHaveBeenCalledTimes(2);
    await expect(serverDB.query.moduleAppLicenses.findMany()).resolves.toHaveLength(1);
  });

  it('records an amount discrepancy without settling the order', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-mismatch',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      totalAmount: '99.000000',
    });

    await expect(service.handleNotification({ body: 'signed', headers: {} })).rejects.toThrow(
      'MODULE_APP_PAYMENT_AMOUNT_MISMATCH',
    );
    await expect(serverDB.query.moduleAppPaymentDiscrepancies.findMany()).resolves.toHaveLength(1);
    await expect(serverDB.query.moduleAppOrders.findFirst()).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('rejects a provider order id that does not match the server attempt', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-provider-mismatch',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      orderId: '40000000-0000-4000-8000-000000000001',
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      totalAmount: '1234.000000',
    });

    await expect(service.handleNotification({ body: 'signed', headers: {} })).rejects.toThrow(
      'MODULE_APP_PAYMENT_PROVIDER_MISMATCH',
    );
    await expect(serverDB.query.moduleAppPaymentDiscrepancies.findMany()).resolves.toHaveLength(1);
  });

  it('settles concurrent verified notifications into one license', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    const event = {
      currency: 'CNY',
      eventType: 'payment_succeeded' as const,
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay' as const,
      providerTransactionId: 'trade-concurrent',
      totalAmount: '1234.000000',
    };
    (adapter.verifyNotification as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...event, eventId: 'notify-concurrent-1' })
      .mockResolvedValueOnce({ ...event, eventId: 'notify-concurrent-2' });

    await expect(
      Promise.all([
        service.handleNotification({ body: 'signed-1', headers: {} }),
        service.handleNotification({ body: 'signed-2', headers: {} }),
      ]),
    ).resolves.toHaveLength(2);
    await expect(serverDB.query.moduleAppLicenses.findMany()).resolves.toHaveLength(1);
  });

  it('does not call the provider twice for a replayed refund', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-refund',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-refund',
      totalAmount: '1234.000000',
    });
    await service.handleNotification({ body: 'signed', headers: {} });
    await expect(
      service.refundOrder({ orderId: order.id, reason: 'customer request' }),
    ).resolves.toMatchObject({ status: 'refunded' });
    await expect(
      service.refundOrder({ orderId: order.id, reason: 'customer request' }),
    ).resolves.toMatchObject({ status: 'refunded' });
    expect(adapter.refund).toHaveBeenCalledOnce();
    expect(adapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        refundAmount: '1234.000000',
        totalAmount: '1234.000000',
      }),
    );
  });

  it('persists an idempotent refund claim before calling the provider', async () => {
    const adapter = createAdapter();
    (adapter.refund as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: Parameters<ModuleAppPaymentAdapter['refund']>[0]) => {
        const refundRequestNo = input.refundRequestNo;
        if (!refundRequestNo) throw new Error('refund request number missing');
        await expect(
          serverDB.query.moduleAppPaymentRefunds.findFirst({
            where: (refund, { eq }) => eq(refund.providerRefundId, refundRequestNo),
          }),
        ).resolves.toMatchObject({ status: 'requested' });
        return { providerRefundId: refundRequestNo, status: 'succeeded' as const };
      },
    );
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-refund-claim',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-refund-claim',
      totalAmount: '1234.000000',
    });
    await service.handleNotification({ body: 'signed', headers: {} });

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'customer request' }),
    ).resolves.toMatchObject({ status: 'refunded' });
    expect(adapter.refund).toHaveBeenCalledOnce();
  });

  it('finishes a succeeded refund without an adapter after local rollback fails', async () => {
    const adapter = createAdapter();
    const realRevenueService = new ModuleAppOrderRevenueService(serverDB);
    const refundOrder = vi
      .fn<ModuleAppOrderRevenueService['refundOrder']>()
      .mockRejectedValueOnce(new Error('LOCAL_REFUND_DOWN'))
      .mockImplementation(realRevenueService.refundOrder);
    const revenueService = {
      refundOrder,
      settleOrder: realRevenueService.settleOrder,
    };
    const service = new ModuleAppPaymentService(serverDB, adapter, undefined, revenueService);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-refund-local-recovery',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-refund-local-recovery',
      totalAmount: '1234.000000',
    });
    await service.handleNotification({ body: 'signed', headers: {} });

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'original customer request' }),
    ).rejects.toThrow('LOCAL_REFUND_DOWN');
    await expect(serverDB.query.moduleAppPaymentRefunds.findFirst()).resolves.toMatchObject({
      reason: 'original customer request',
      status: 'succeeded',
    });
    await expect(serverDB.query.moduleAppOrders.findFirst()).resolves.toMatchObject({
      status: 'paid',
    });

    const recoveryService = new ModuleAppPaymentService(
      serverDB,
      undefined,
      undefined,
      revenueService,
    );
    await expect(
      recoveryService.refundOrder({ orderId: order.id, reason: 'retry reason is ignored' }),
    ).resolves.toMatchObject({ status: 'refunded' });

    expect(adapter.refund).toHaveBeenCalledOnce();
    expect(refundOrder).toHaveBeenCalledTimes(2);
    expect(refundOrder).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'original customer request' }),
    );
    await expect(serverDB.query.moduleAppPaymentRefunds.findFirst()).resolves.toMatchObject({
      status: 'succeeded',
    });
    await expect(serverDB.query.moduleAppPaymentAttempts.findFirst()).resolves.toMatchObject({
      status: 'refunded',
    });
    await expect(serverDB.query.moduleAppOrders.findFirst()).resolves.toMatchObject({
      status: 'refunded',
    });
  });

  it('keeps an accepted asynchronous refund pending until reconciliation succeeds', async () => {
    const adapter = createAdapter();
    (adapter.createRefundRequestNo as ReturnType<typeof vi.fn>).mockReturnValue('refund-pending');
    adapter.queryRefund = vi.fn().mockResolvedValue({ status: 'succeeded' });
    (adapter.refund as ReturnType<typeof vi.fn>).mockResolvedValue({
      providerRefundId: 'refund-pending',
      status: 'pending',
    });
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-refund-pending',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-refund-pending',
      totalAmount: '1234.000000',
    });
    await service.handleNotification({ body: 'signed', headers: {} });

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'customer request' }),
    ).resolves.toEqual({ orderId: order.id, status: 'requested' });
    await expect(
      service.refundOrder({ orderId: order.id, reason: 'customer request' }),
    ).resolves.toEqual({ orderId: order.id, status: 'requested' });
    expect(adapter.refund).toHaveBeenCalledOnce();
    await expect(serverDB.query.moduleAppPaymentRefunds.findFirst()).resolves.toMatchObject({
      status: 'requested',
    });
    await expect(serverDB.query.moduleAppPaymentAttempts.findFirst()).resolves.toMatchObject({
      status: 'paid',
    });
    await expect(
      service.reconcileRefund({ actorUserId: USER_ID, orderId: order.id }),
    ).rejects.toThrow('MODULE_APP_PAYMENT_REFUND_RECONCILIATION_TOO_EARLY');
    expect(adapter.queryRefund).not.toHaveBeenCalled();
    await serverDB
      .update(moduleAppPaymentRefunds)
      .set({ updatedAt: new Date(Date.now() - 61_000) })
      .where(eq(moduleAppPaymentRefunds.orderId, order.id));
    await expect(
      service.reconcileRefund({ actorUserId: USER_ID, orderId: order.id }),
    ).resolves.toEqual({ status: 'succeeded' });
    await expect(serverDB.query.moduleAppOrders.findFirst()).resolves.toMatchObject({
      status: 'refunded',
    });
  });

  it('manually confirms a pending ZPay refund and reverses module commerce', async () => {
    const adapter = createZPayAdapter();
    (adapter.createRefundRequestNo as ReturnType<typeof vi.fn>).mockReturnValue(
      'refund-zpay-pending',
    );
    (adapter.refund as ReturnType<typeof vi.fn>).mockResolvedValue({
      providerRefundId: 'refund-zpay-pending',
      status: 'pending',
    });
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-zpay-manual-success',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'zpay',
      providerTransactionId: 'trade-zpay-manual-success',
      totalAmount: '1234.000000',
    });
    await service.handleNotification({ body: 'signed', headers: {} });
    await service.refundOrder({ orderId: order.id, reason: 'customer request' });
    await expect(
      new ModuleAppPaymentService(serverDB, undefined).resolvePendingRefund({
        actorUserId: USER_ID,
        orderId: order.id,
        resolution: 'succeeded',
      }),
    ).rejects.toThrow('MODULE_APP_PAYMENT_REFUND_RESOLUTION_TOO_EARLY');
    await serverDB
      .update(moduleAppPaymentRefunds)
      .set({ updatedAt: new Date(Date.now() - 61_000) })
      .where(eq(moduleAppPaymentRefunds.orderId, order.id));

    await expect(
      new ModuleAppPaymentService(serverDB, undefined).resolvePendingRefund({
        actorUserId: USER_ID,
        orderId: order.id,
        resolution: 'succeeded',
      }),
    ).resolves.toMatchObject({ duplicate: false, status: 'refunded' });
    await expect(serverDB.query.moduleAppPaymentRefunds.findFirst()).resolves.toMatchObject({
      status: 'succeeded',
    });
    await expect(serverDB.query.moduleAppOrders.findFirst()).resolves.toMatchObject({
      status: 'refunded',
    });
  });

  it('allows one module refund retry after ZPay is manually confirmed not refunded', async () => {
    const adapter = createZPayAdapter();
    (adapter.createRefundRequestNo as ReturnType<typeof vi.fn>).mockReturnValue(
      'refund-zpay-retry',
    );
    (adapter.refund as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ providerRefundId: 'refund-zpay-retry', status: 'pending' })
      .mockResolvedValueOnce({ providerRefundId: 'refund-zpay-retry', status: 'succeeded' });
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-zpay-manual-failure',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'zpay',
      providerTransactionId: 'trade-zpay-manual-failure',
      totalAmount: '1234.000000',
    });
    await service.handleNotification({ body: 'signed', headers: {} });
    await service.refundOrder({ orderId: order.id, reason: 'customer request' });
    await serverDB
      .update(moduleAppPaymentRefunds)
      .set({ updatedAt: new Date(Date.now() - 61_000) })
      .where(eq(moduleAppPaymentRefunds.orderId, order.id));
    await expect(
      new ModuleAppPaymentService(serverDB, undefined).resolvePendingRefund({
        actorUserId: USER_ID,
        orderId: order.id,
        resolution: 'failed',
      }),
    ).resolves.toEqual({ duplicate: false, orderId: order.id, status: 'failed' });

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'operator verified retry' }),
    ).resolves.toMatchObject({ status: 'refunded' });
    expect(adapter.refund).toHaveBeenCalledTimes(2);
    expect(adapter.refund).toHaveBeenLastCalledWith(
      expect.objectContaining({ refundRequestNo: 'refund-zpay-retry' }),
    );
  });

  it('rejects a pending order before calling the refund provider', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });

    await expect(
      service.refundOrder({ orderId: order.id, reason: 'customer request' }),
    ).rejects.toThrow('MODULE_APP_ORDER_NOT_REFUNDABLE');
    expect(adapter.refund).not.toHaveBeenCalled();
  });

  it('reconciles a provider-paid pending order and records the state mismatch', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'query-paid-1',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-query-1',
      totalAmount: '1234.000000',
    });

    await expect(
      service.reconcilePayment({ outTradeNo: payment.outTradeNo }),
    ).resolves.toMatchObject({
      status: 'paid',
    });
    await expect(serverDB.query.moduleAppPaymentDiscrepancies.findFirst()).resolves.toMatchObject({
      kind: 'local_unpaid_provider_paid',
    });
  });

  it('records local-paid provider-unpaid reconciliation drift', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-local-paid',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-local-paid',
      totalAmount: '1234.000000',
    });
    await service.handleNotification({ body: 'signed', headers: {} });
    (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      service.reconcilePayment({ outTradeNo: payment.outTradeNo }),
    ).resolves.toMatchObject({
      localStatus: 'paid',
      providerStatus: 'pending',
    });
    await expect(serverDB.query.moduleAppPaymentDiscrepancies.findFirst()).resolves.toMatchObject({
      kind: 'local_paid_provider_unpaid',
    });
  });

  it('keeps a paid attempt paid when reconciliation reports provider failure', async () => {
    const adapter = createAdapter();
    const service = new ModuleAppPaymentService(serverDB, adapter);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'notify-paid-before-provider-failure',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      providerTransactionId: 'trade-paid-before-provider-failure',
      totalAmount: '1234.000000',
    });
    await service.handleNotification({ body: 'signed', headers: {} });
    (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      currency: 'CNY',
      eventId: 'query-provider-failed-after-paid',
      eventType: 'payment_failed',
      occurredAt: new Date(),
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      totalAmount: '1234.000000',
    });

    await expect(
      service.reconcilePayment({ outTradeNo: payment.outTradeNo }),
    ).resolves.toMatchObject({
      providerStatus: 'payment_failed',
      status: 'paid',
    });
    await expect(
      serverDB.query.moduleAppPaymentDiscrepancies.findFirst({
        where: (discrepancy, { eq }) =>
          eq(discrepancy.discrepancyKey, 'provider-unpaid:query-provider-failed-after-paid'),
      }),
    ).resolves.toMatchObject({ kind: 'local_paid_provider_unpaid' });
    await expect(
      serverDB.query.moduleAppPaymentAttempts.findFirst({
        where: (attempt, { eq }) => eq(attempt.orderId, order.id),
      }),
    ).resolves.toMatchObject({ status: 'paid' });
  });

  it('records bounded notification verification failures', async () => {
    const adapter = createAdapter();
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('MODULE_APP_ALIPAY_SIGNATURE_INVALID'),
    );
    const metrics = {
      recordOperationalAge: vi.fn(),
      recordVerificationFailure: vi.fn(),
    };
    const service = new ModuleAppPaymentService(serverDB, adapter, metrics);

    await expect(service.handleNotification({ body: 'invalid', headers: {} })).rejects.toThrow(
      'MODULE_APP_ALIPAY_SIGNATURE_INVALID',
    );
    expect(metrics.recordVerificationFailure).toHaveBeenCalledWith('signature_invalid');
  });

  it('records a malformed normalized notification only once', async () => {
    const adapter = createAdapter();
    (adapter.verifyNotification as ReturnType<typeof vi.fn>).mockResolvedValue({ invalid: true });
    const metrics = {
      recordOperationalAge: vi.fn(),
      recordVerificationFailure: vi.fn(),
    };
    const service = new ModuleAppPaymentService(serverDB, adapter, metrics);

    await expect(service.handleNotification({ body: 'invalid', headers: {} })).rejects.toThrow(
      'MODULE_APP_PAYMENT_NOTIFICATION_INVALID',
    );
    expect(metrics.recordVerificationFailure).toHaveBeenCalledTimes(1);
    expect(metrics.recordVerificationFailure).toHaveBeenCalledWith('invalid_notification');
  });

  it('records the age of the oldest unresolved discrepancy and refund', async () => {
    const adapter = createAdapter();
    const metrics = {
      recordOperationalAge: vi.fn(),
      recordVerificationFailure: vi.fn(),
    };
    const service = new ModuleAppPaymentService(serverDB, adapter, metrics);
    const order = await createPendingOrder();
    const payment = await service.createPayment({
      notifyUrl: 'https://app.example.com/notify',
      orderId: order.id,
      returnUrl: 'https://app.example.com/return',
    });
    const createdAt = new Date('2026-07-12T00:00:00.000Z');
    await serverDB.insert(moduleAppPaymentDiscrepancies).values({
      createdAt,
      discrepancyKey: 'age-discrepancy',
      kind: 'refund_mismatch',
      orderId: order.id,
      outTradeNo: payment.outTradeNo,
      provider: 'alipay',
      status: 'open',
    });
    await serverDB.insert(moduleAppPaymentRefunds).values({
      createdAt,
      currency: 'CNY',
      orderId: order.id,
      provider: 'alipay',
      providerRefundId: 'age-refund',
      reason: 'age test',
      refundAmount: '1234.000000',
      status: 'requested',
    });

    await service.recordOperationalAges(new Date('2026-07-12T01:00:00.000Z'));
    expect(metrics.recordOperationalAge).toHaveBeenCalledWith('discrepancy', 3_600_000);
    expect(metrics.recordOperationalAge).toHaveBeenCalledWith('refund', 3_600_000);
  });
});
