// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppInstallations,
  moduleAppOrders,
  moduleAppPaymentAttempts,
  moduleAppPaymentDiscrepancies,
  moduleAppPaymentEvents,
  moduleAppPaymentRefunds,
  moduleAppPrices,
  moduleAppProducts,
  moduleApps,
  moduleAppVersions,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppCommerceModel } from '../moduleAppCommerce';
import { ModuleAppPaymentModel } from '../moduleAppPayment';

const APP_ID = '30000000-0000-4000-8000-000000000001';
const USER_ID = 'module-app-payment-model-user';
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(moduleAppPaymentDiscrepancies);
  await serverDB.delete(moduleAppPaymentRefunds);
  await serverDB.delete(moduleAppPaymentEvents);
  await serverDB.delete(moduleAppPaymentAttempts);
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
    description: 'Payment model test app',
    displayName: 'Payment model test app',
    icon: 'CreditCard',
    id: APP_ID,
    slug: `payment-model-${crypto.randomUUID()}`,
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

const createOrder = async () => {
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

describe('ModuleAppPaymentModel', () => {
  it('rejects creating a payment attempt after the order is cancelled', async () => {
    const commerce = new ModuleAppCommerceModel(serverDB);
    const model = new ModuleAppPaymentModel(serverDB);
    const order = await createOrder();
    await commerce.cancelOrder({ orderId: order.id, purchaserUserId: USER_ID });

    await expect(
      model.createPaymentAttempt({
        currency: 'CNY',
        method: 'alipay',
        notifyUrl: 'https://app.example.com/api/webhooks/payments/alipay',
        orderId: order.id,
        outTradeNo: `cancelled-${order.id}`,
        provider: 'alipay',
        returnUrl: 'https://app.example.com/apps',
        subject: 'Payment model test app',
        totalAmount: '1234.000000',
      }),
    ).rejects.toThrow('MODULE_APP_ORDER_NOT_PAYABLE');
    await expect(serverDB.query.moduleAppPaymentAttempts.findMany()).resolves.toEqual([]);
  });

  it('deduplicates provider events by provider-scoped event id', async () => {
    const model = new ModuleAppPaymentModel(serverDB);
    const input = {
      currency: 'CNY',
      eventId: 'notify-1',
      eventType: 'payment_succeeded' as const,
      outTradeNo: 'order-1',
      paymentReference: 'trade-1',
      provider: 'alipay' as const,
      totalAmount: '12.340000',
    };

    await expect(model.recordPaymentEvent(input)).resolves.toMatchObject({ duplicate: false });
    await expect(model.recordPaymentEvent(input)).resolves.toMatchObject({ duplicate: true });
    await expect(model.recordPaymentEvent({ ...input, totalAmount: '99.000000' })).rejects.toThrow(
      'MODULE_APP_PAYMENT_EVENT_CONFLICT',
    );
    await expect(serverDB.query.moduleAppPaymentEvents.findMany()).resolves.toHaveLength(1);
  });

  it('keeps refund creation idempotent by provider refund id', async () => {
    const model = new ModuleAppPaymentModel(serverDB);
    const order = await createOrder();
    const input = {
      currency: 'CNY',
      orderId: order.id,
      provider: 'alipay' as const,
      providerRefundId: 'refund-1',
      reason: 'customer request',
      refundAmount: '12.340000',
      status: 'succeeded' as const,
    };

    await expect(model.createRefund(input)).resolves.toMatchObject({ duplicate: false });
    await expect(model.createRefund(input)).resolves.toMatchObject({ duplicate: true });
  });

  it('lists and acknowledges bounded reconciliation discrepancies', async () => {
    const model = new ModuleAppPaymentModel(serverDB);
    const discrepancy = await model.createDiscrepancy({
      discrepancyKey: 'local-paid:out-1',
      kind: 'local_paid_provider_unpaid',
      outTradeNo: 'out-1',
      provider: 'alipay',
    });

    await expect(model.listDiscrepancies({ limit: 500, status: 'open' })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: discrepancy.id, status: 'open' })],
      nextCursor: null,
    });
    await expect(
      model.acknowledgeDiscrepancy({ discrepancyId: discrepancy.id }),
    ).resolves.toMatchObject({ status: 'resolved' });
    await expect(model.acknowledgeDiscrepancy({ discrepancyId: discrepancy.id })).rejects.toThrow(
      'MODULE_APP_PAYMENT_DISCREPANCY_NOT_OPEN',
    );
  });
});
