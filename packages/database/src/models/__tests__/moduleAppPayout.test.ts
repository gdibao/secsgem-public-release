// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppOrders,
  moduleAppPayoutBatches,
  moduleAppPayoutEntries,
  moduleAppPrices,
  moduleAppProducts,
  moduleAppPublishers,
  moduleAppRevenueEntries,
  moduleApps,
  moduleAppVersions,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppCommerceModel } from '../moduleAppCommerce';
import { ModuleAppPayoutModel } from '../moduleAppPayout';

const serverDB: LobeChatDatabase = await getTestDB();
const PUBLISHER_USER_ID = 'module-app-payout-publisher';
const ADMIN_USER_ID = 'module-app-payout-admin';

beforeEach(async () => {
  await serverDB.delete(moduleAppPayoutEntries);
  await serverDB.delete(moduleAppPayoutBatches);
  await serverDB.delete(moduleAppRevenueEntries);
  await serverDB.delete(moduleAppOrders);
  await serverDB.delete(moduleAppPrices);
  await serverDB.delete(moduleAppProducts);
  await serverDB.delete(moduleApps);
  await serverDB.delete(moduleAppPublishers);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: PUBLISHER_USER_ID }, { id: ADMIN_USER_ID }]);
});

const createEligibleRevenue = async ({
  createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
  reserveAmount = 0,
}: { createdAt?: Date; reserveAmount?: number } = {}) => {
  const [publisher] = await serverDB
    .insert(moduleAppPublishers)
    .values({
      displayName: 'Payout Studio',
      recipientMask: 'ali***@example.com',
      status: 'verified',
      userId: PUBLISHER_USER_ID,
    })
    .returning();
  const [app] = await serverDB
    .insert(moduleApps)
    .values({
      appType: 'standard_app',
      category: 'commerce',
      description: 'Payout app',
      displayName: 'Payout app',
      icon: 'Store',
      publisherId: publisher.id,
      slug: `payout-${crypto.randomUUID()}`,
      status: 'published',
    })
    .returning();
  const [publishedVersion] = await serverDB
    .insert(moduleAppVersions)
    .values({ appId: app.id, publishedAt: createdAt, version: '1.0.0' })
    .returning();
  await serverDB
    .update(moduleApps)
    .set({ currentPublishedVersionId: publishedVersion.id })
    .where(eq(moduleApps.id, app.id));
  const commerce = new ModuleAppCommerceModel(serverDB);
  const product = await commerce.createProduct({
    appId: app.id,
    licenseScope: 'personal',
    price: { amount: 100, currency: 'CNY' },
    productKey: `payout-${crypto.randomUUID()}`,
    productType: 'one_time',
  });
  const order = await commerce.createOrder({
    productId: product.id,
    purchaserUserId: ADMIN_USER_ID,
  });
  const [revenue] = await serverDB
    .insert(moduleAppRevenueEntries)
    .values({
      appId: app.id,
      currency: 'CNY',
      createdAt,
      developerAmount: 80,
      grossAmount: 100,
      orderId: order.id,
      platformFee: 20,
      publisherId: publisher.id,
      publisherUserId: PUBLISHER_USER_ID,
      reserveAmount,
      type: 'accrual',
    })
    .returning();
  return { app, publisher, revenue };
};

describe('ModuleAppPayoutModel', () => {
  it('runs the payout state machine and records one manual Alipay transaction', async () => {
    const { publisher, revenue } = await createEligibleRevenue();
    const model = new ModuleAppPayoutModel(serverDB);
    await expect(
      model.createEligibleBatch({
        publisherId: publisher.id,
        requestedAmount: 81,
        revenueEntryIds: [revenue.id],
      }),
    ).rejects.toThrow('MODULE_APP_PAYOUT_AMOUNT_EXCEEDS_ELIGIBLE');

    const batch = await model.createEligibleBatch({
      publisherId: publisher.id,
      requestedAmount: 80,
      revenueEntryIds: [revenue.id],
    });
    await expect(
      model.transitionBatch({ batchId: batch.id, status: 'processing' }),
    ).resolves.toMatchObject({ status: 'processing' });
    await expect(
      model.transitionBatch({
        batchId: batch.id,
        failureReason: 'bank_review',
        status: 'failed',
      }),
    ).resolves.toMatchObject({ failureReason: 'bank_review', status: 'failed' });
    await expect(
      model.transitionBatch({ batchId: batch.id, status: 'processing' }),
    ).resolves.toMatchObject({ failureReason: null, status: 'processing' });
    await expect(
      model.recordManualAlipayPayout({
        actorUserId: ADMIN_USER_ID,
        batchId: batch.id,
        evidenceReference: 's3://evidence/payout-1.pdf',
        recipientMask: 'ali***@example.com',
        transactionNo: 'alipay-txn-1',
      }),
    ).resolves.toMatchObject({ status: 'paid', transactionNo: 'alipay-txn-1' });
    await expect(
      model.recordManualAlipayPayout({
        actorUserId: ADMIN_USER_ID,
        batchId: batch.id,
        evidenceReference: 's3://evidence/payout-1.pdf',
        recipientMask: 'ali***@example.com',
        transactionNo: 'alipay-txn-1',
      }),
    ).resolves.toMatchObject({ status: 'paid' });
    await expect(
      model.transitionBatch({ batchId: batch.id, status: 'reversed' }),
    ).resolves.toMatchObject({ status: 'reversed' });
    await expect(
      serverDB.query.moduleAppRevenueEntries.findFirst({
        where: (rows, { eq }) => eq(rows.id, revenue.id),
      }),
    ).resolves.toMatchObject({ settlementBatchId: null, settledAt: null, status: 'pending' });
    await expect(
      serverDB.query.moduleAppPayoutEntries.findFirst({
        where: (rows, { eq }) => eq(rows.batchId, batch.id),
      }),
    ).resolves.toMatchObject({ status: 'reversed' });
    const secondBatch = await model.createEligibleBatch({
      publisherId: publisher.id,
      requestedAmount: 80,
      revenueEntryIds: [revenue.id],
    });
    await expect(
      model.recordManualAlipayPayout({
        actorUserId: ADMIN_USER_ID,
        batchId: secondBatch.id,
        evidenceReference: 's3://evidence/payout-2.pdf',
        recipientMask: 'ali***@example.com',
        transactionNo: 'alipay-txn-1',
      }),
    ).rejects.toThrow('MODULE_APP_PAYOUT_TRANSACTION_CONFLICT');
  });

  it('rejects revenue that already has a reversal entry', async () => {
    const { publisher, revenue } = await createEligibleRevenue();
    await serverDB.insert(moduleAppRevenueEntries).values({
      appId: revenue.appId,
      currency: revenue.currency,
      developerAmount: -revenue.developerAmount,
      grossAmount: -revenue.grossAmount,
      orderId: revenue.orderId,
      platformFee: -revenue.platformFee,
      publisherId: revenue.publisherId,
      publisherUserId: revenue.publisherUserId,
      reserveAmount: -revenue.reserveAmount,
      status: 'reversed',
      type: 'reversal',
    });

    await expect(
      new ModuleAppPayoutModel(serverDB).createEligibleBatch({
        publisherId: publisher.id,
        requestedAmount: revenue.developerAmount,
        revenueEntryIds: [revenue.id],
      }),
    ).rejects.toThrow('MODULE_APP_PAYOUT_REVENUE_NOT_ELIGIBLE');
  });

  it('enforces the payout delay and releases refundable reserve when eligible', async () => {
    const fresh = await createEligibleRevenue({ createdAt: new Date(), reserveAmount: 10 });
    const model = new ModuleAppPayoutModel(serverDB);

    await expect(
      model.createEligibleBatch({
        publisherId: fresh.publisher.id,
        requestedAmount: 90,
        revenueEntryIds: [fresh.revenue.id],
      }),
    ).rejects.toThrow('MODULE_APP_PAYOUT_REVENUE_NOT_ELIGIBLE');

    await serverDB
      .update(moduleAppRevenueEntries)
      .set({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(moduleAppRevenueEntries.id, fresh.revenue.id));

    const batch = await model.createEligibleBatch({
      publisherId: fresh.publisher.id,
      requestedAmount: 90,
      revenueEntryIds: [fresh.revenue.id],
    });
    expect(batch.totalAmount).toBe(90);
    await expect(
      serverDB.query.moduleAppPayoutEntries.findFirst({
        where: (rows, { eq }) => eq(rows.batchId, batch.id),
      }),
    ).resolves.toMatchObject({ amount: 90 });
  });
});
