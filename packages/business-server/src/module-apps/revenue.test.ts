// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ModuleAppCommerceModel } from '@/database/models/moduleAppCommerce';
import {
  moduleAppLicenses,
  moduleAppOrders,
  moduleAppPackages,
  moduleAppPrices,
  moduleAppProducts,
  moduleAppPublishers,
  moduleAppRevenueEntries,
  moduleApps,
  moduleAppSubscriptions,
  moduleAppVersions,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { calculateRevenue, ModuleAppOrderRevenueService, ModuleAppRevenueService } from './revenue';

const APP_ID = '20000000-0000-4000-8000-000000000001';
const ORDER_ID = '20000000-0000-4000-8000-000000000002';
const PRODUCT_ID = '20000000-0000-4000-8000-000000000003';
const PRICE_ID = '20000000-0000-4000-8000-000000000004';
const USER_ID = 'module-app-revenue-user';
const PUBLISHER_ID = 'module-app-revenue-publisher';
const PUBLISHER_RECORD_ID = '20000000-0000-4000-8000-000000000005';
const serverDB: LobeChatDatabase = await getTestDB();

describe('module app revenue', () => {
  beforeEach(async () => {
    await serverDB.delete(moduleAppRevenueEntries);
    await serverDB.delete(moduleAppSubscriptions);
    await serverDB.delete(moduleAppLicenses);
    await serverDB.delete(moduleAppPackages);
    await serverDB.delete(moduleAppOrders);
    await serverDB.delete(moduleAppPrices);
    await serverDB.delete(moduleAppProducts);
    await serverDB.delete(moduleAppVersions);
    await serverDB.delete(moduleApps);
    await serverDB.delete(moduleAppPublishers);
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: USER_ID }, { id: PUBLISHER_ID }]);
    await serverDB.insert(moduleApps).values({
      appType: 'standard_app',
      category: 'productivity',
      description: 'Revenue test app',
      displayName: 'Revenue test app',
      icon: 'R',
      id: APP_ID,
      slug: 'revenue-test-app',
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
    await serverDB.insert(moduleAppProducts).values({
      appId: APP_ID,
      id: PRODUCT_ID,
      licenseScope: 'personal',
      productKey: 'revenue-product',
      productType: 'one_time',
    });
    await serverDB.insert(moduleAppPrices).values({
      active: true,
      amount: 10_000,
      currency: 'CNY',
      id: PRICE_ID,
      productId: PRODUCT_ID,
    });
    await serverDB.insert(moduleAppOrders).values({
      appId: APP_ID,
      id: ORDER_ID,
      priceId: PRICE_ID,
      productId: PRODUCT_ID,
      purchaserUserId: USER_ID,
      snapshot: { currency: 'CNY', price: 10_000, revenueShareRate: '0.80' },
      status: 'paid',
    });
  });

  it('calculates platform fee, refundable reserve, and developer pending exactly', () => {
    expect(
      calculateRevenue({ gross: 10_000, platformRate: '0.20', refundableReserveRate: '0.10' }),
    ).toEqual({ developerPending: 7200, platformFee: 2000, reserve: 800 });
  });

  it('rolls back order settlement when revenue accrual fails', async () => {
    const [pendingOrder] = await serverDB
      .update(moduleAppOrders)
      .set({
        snapshot: { currency: 'CNY', price: 10_000, revenueShareRate: '2' },
        status: 'pending',
      })
      .where(eq(moduleAppOrders.id, ORDER_ID))
      .returning();
    expect(pendingOrder?.status).toBe('pending');

    const service = new ModuleAppOrderRevenueService(serverDB);

    await expect(
      service.settleOrder({
        actorUserId: USER_ID,
        orderId: ORDER_ID,
        paymentReference: 'manual:atomicity-test',
      }),
    ).rejects.toThrow('MODULE_APP_REVENUE_SHARE_RATE_INVALID');

    const order = await serverDB.query.moduleAppOrders.findFirst({
      where: eq(moduleAppOrders.id, ORDER_ID),
    });
    const license = await new ModuleAppCommerceModel(serverDB).resolveLicense({
      appId: APP_ID,
      userId: USER_ID,
    });
    const revenue = await serverDB.query.moduleAppRevenueEntries.findFirst({
      where: eq(moduleAppRevenueEntries.orderId, ORDER_ID),
    });

    expect(order?.status).toBe('pending');
    expect(license).toBeNull();
    expect(revenue).toBeUndefined();
  });

  it('rolls back refund and license revocation when revenue reversal fails', async () => {
    const service = new ModuleAppOrderRevenueService(serverDB);
    await serverDB
      .update(moduleAppOrders)
      .set({ status: 'pending' })
      .where(eq(moduleAppOrders.id, ORDER_ID));
    await new ModuleAppCommerceModel(serverDB).settleOrder({
      orderId: ORDER_ID,
      paymentReference: 'manual:refund-atomicity-test',
    });
    await serverDB.delete(moduleAppRevenueEntries);

    await expect(
      service.refundOrder({
        actorUserId: USER_ID,
        orderId: ORDER_ID,
        reason: 'atomicity test',
        refundReference: 'offline:atomicity-test',
      }),
    ).rejects.toThrow('MODULE_APP_REVENUE_ACCRUAL_NOT_FOUND');

    const order = await serverDB.query.moduleAppOrders.findFirst({
      where: eq(moduleAppOrders.id, ORDER_ID),
    });
    const license = await new ModuleAppCommerceModel(serverDB).resolveLicense({
      appId: APP_ID,
      userId: USER_ID,
    });

    expect(order?.status).toBe('paid');
    expect(license).not.toBeNull();
  });

  it('accrues once, appends a reversal, and rejects non-settleable entries', async () => {
    const service = new ModuleAppRevenueService(serverDB, { settlementDelayMs: 0 });
    const accrual = await service.accrueOrder({ orderId: ORDER_ID, publisherUserId: PUBLISHER_ID });
    const replay = await service.accrueOrder({ orderId: ORDER_ID, publisherUserId: PUBLISHER_ID });
    expect(replay.id).toBe(accrual.id);

    const reversal = await service.reverseOrder({ orderId: ORDER_ID, reason: 'refund' });
    expect(reversal).toMatchObject({ developerAmount: -7200, type: 'reversal' });
    await expect(
      service.settleBatch({ actorUserId: 'admin-1', entryIds: [reversal.id] }),
    ).rejects.toThrow('MODULE_APP_REVENUE_NOT_SETTLEABLE');
  });

  it('rejects duplicate revenue entry ids in one settlement batch', async () => {
    const service = new ModuleAppRevenueService(serverDB, { settlementDelayMs: 0 });
    const accrual = await service.accrueOrder({
      orderId: ORDER_ID,
      publisherUserId: PUBLISHER_ID,
    });

    await expect(
      service.settleBatch({ actorUserId: USER_ID, entryIds: [accrual.id, accrual.id] }),
    ).rejects.toThrow('MODULE_APP_REVENUE_SETTLEMENT_INPUT_INVALID');
  });

  it('snapshots the stable assigned publisher even after suspension', async () => {
    await serverDB.insert(moduleAppPublishers).values({
      displayName: 'Revenue Publisher',
      id: PUBLISHER_RECORD_ID,
      status: 'verified',
      userId: PUBLISHER_ID,
    });
    await serverDB
      .update(moduleApps)
      .set({ publisherId: PUBLISHER_RECORD_ID })
      .where(eq(moduleApps.id, APP_ID));
    await serverDB
      .update(moduleAppPublishers)
      .set({ status: 'suspended', suspendedAt: new Date() })
      .where(eq(moduleAppPublishers.id, PUBLISHER_RECORD_ID));
    const service = new ModuleAppRevenueService(serverDB, { settlementDelayMs: 0 });

    await expect(service.accrueOrder({ orderId: ORDER_ID })).resolves.toMatchObject({
      publisherId: PUBLISHER_RECORD_ID,
      publisherUserId: PUBLISHER_ID,
    });
  });
});
