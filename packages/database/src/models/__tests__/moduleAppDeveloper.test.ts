// @vitest-environment node
import { moduleAppPackageManifestSchema } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppAuditLogs,
  moduleAppBuilds,
  moduleAppInstallations,
  moduleAppOrders,
  moduleAppPackages,
  moduleAppPackageUploads,
  moduleAppPayoutBatches,
  moduleAppPrices,
  moduleAppProducts,
  moduleAppPublishers,
  moduleAppRevenueEntries,
  moduleAppRuns,
  moduleApps,
  moduleAppVersions,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppCommerceModel } from '../moduleAppCommerce';
import { ModuleAppDeveloperModel } from '../moduleAppDeveloper';
import { ModuleAppPublisherModel } from '../moduleAppPublisher';

const USER_ID = 'module-app-developer-owner';
const OTHER_USER_ID = 'module-app-developer-other';
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(moduleAppAuditLogs);
  await serverDB.delete(moduleAppRuns);
  await serverDB.delete(moduleAppInstallations);
  await serverDB.delete(moduleAppRevenueEntries);
  await serverDB.delete(moduleAppOrders);
  await serverDB.delete(moduleAppPrices);
  await serverDB.delete(moduleAppProducts);
  await serverDB.delete(moduleAppBuilds);
  await serverDB.delete(moduleAppPackageUploads);
  await serverDB.delete(moduleAppPackages);
  await serverDB.delete(moduleAppVersions);
  await serverDB.delete(moduleApps);
  await serverDB.delete(moduleAppPayoutBatches);
  await serverDB.delete(moduleAppPublishers);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: USER_ID }, { id: OTHER_USER_ID }]);
});

describe('ModuleAppDeveloperModel', () => {
  it('scopes publisher applications, metrics, releases, submissions, and payouts to the owner', async () => {
    const model = new ModuleAppDeveloperModel(serverDB);
    const profile = await model.upsertPublisherProfile(USER_ID, {
      displayName: 'Developer Studio',
    });
    await new ModuleAppPublisherModel(serverDB).verifyPublisher({ publisherId: profile.id });
    const otherProfile = await model.upsertPublisherProfile(OTHER_USER_ID, {
      displayName: 'Other Studio',
    });
    await new ModuleAppPublisherModel(serverDB).verifyPublisher({ publisherId: otherProfile.id });

    const [app] = await serverDB
      .insert(moduleApps)
      .values({
        appType: 'standard_app',
        category: 'productivity',
        description: 'Developer application.',
        displayName: 'Developer App',
        icon: 'Box',
        publisherId: profile.id,
        slug: 'developer-app',
        source: 'developer',
        status: 'draft',
      })
      .returning();
    const [version] = await serverDB
      .insert(moduleAppVersions)
      .values({
        appId: app.id,
        manifestSnapshot: {},
        runtimeManifest: { manifestVersion: 1 },
        version: '1.0.0',
      })
      .returning();
    const [packageRow] = await serverDB
      .insert(moduleAppPackages)
      .values({
        appId: app.id,
        archive: {
          fileName: 'developer-app.zip',
          mimeType: 'application/zip',
          sha256: 'a'.repeat(64),
          sizeBytes: 1024,
          storageKey: 'module-app-packages/developer-app.zip',
        },
        manifestSnapshot: moduleAppPackageManifestSchema.parse({
          app: {
            actions: [],
            appType: 'standard_app',
            billing: {},
            category: 'productivity',
            description: 'Developer application.',
            displayName: 'Developer App',
            icon: 'Box',
            pages: [],
            slug: 'developer-app',
            source: 'developer',
            status: 'draft',
            tags: [],
          },
          entitlements: [],
          manifestVersion: 1,
          packageVersion: '1.0.0',
          runtime: { kind: 'manifest_only', permissions: [] },
        }),
        publisherId: profile.id,
        reviewStatus: 'approved',
        submittedByUserId: USER_ID,
        versionId: version.id,
      })
      .returning();
    await serverDB.insert(moduleAppPackageUploads).values({
      actualSizeBytes: 1024,
      completedAt: new Date(),
      declaredSizeBytes: 1024,
      expiresAt: new Date(Date.now() + 60_000),
      fileName: 'developer-app.zip',
      mimeType: 'application/zip',
      packageId: packageRow.id,
      scanStatus: 'clean',
      status: 'submitted',
      storageKey: 'module-app-packages/developer-app.zip',
      userId: USER_ID,
    });
    const [installation] = await serverDB
      .insert(moduleAppInstallations)
      .values({
        appId: app.id,
        scopeType: 'personal',
        status: 'installed',
        userId: USER_ID,
        versionId: version.id,
      })
      .returning();
    await serverDB.insert(moduleAppRuns).values([
      {
        appId: app.id,
        installationId: installation.id,
        scopeType: 'personal',
        status: 'succeeded',
        userId: USER_ID,
        versionId: version.id,
      },
      {
        appId: app.id,
        installationId: installation.id,
        scopeType: 'personal',
        status: 'failed',
        userId: USER_ID,
        versionId: version.id,
      },
    ]);
    await serverDB.insert(moduleAppPayoutBatches).values([
      { currency: 'CNY', publisherId: profile.id, status: 'paid', totalAmount: 80 },
      { currency: 'CNY', publisherId: profile.id, status: 'pending', totalAmount: 60 },
      { currency: 'CNY', publisherId: profile.id, status: 'processing', totalAmount: 40 },
      { currency: 'CNY', publisherId: otherProfile.id, status: 'paid', totalAmount: 120 },
    ]);

    await expect(model.listApplications({ userId: USER_ID })).resolves.toMatchObject({
      items: [
        {
          id: app.id,
          latestPackage: { id: packageRow.id, scanStatus: 'clean' },
          metrics: { activeInstallations: 1, failedRuns30d: 1, totalRuns30d: 2 },
        },
      ],
    });
    await expect(model.listSubmissions({ userId: USER_ID })).resolves.toMatchObject({
      items: [{ appId: app.id, id: packageRow.id }],
    });
    await expect(
      model.setPublication({ appId: app.id, published: true, userId: USER_ID }),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(model.listVersions({ appId: app.id, userId: USER_ID })).resolves.toMatchObject([
      { current: true, id: version.id, version: '1.0.0' },
    ]);
    const product = await new ModuleAppCommerceModel(serverDB).createProduct({
      appId: app.id,
      licenseScope: 'personal',
      price: { amount: 100, currency: 'CNY' },
      productKey: 'developer-console-product',
      productType: 'one_time',
    });
    const order = await new ModuleAppCommerceModel(serverDB).createOrder({
      productId: product.id,
      purchaserUserId: OTHER_USER_ID,
    });
    const settledOrder = await new ModuleAppCommerceModel(serverDB).createOrder({
      productId: product.id,
      purchaserUserId: OTHER_USER_ID,
    });
    await serverDB.insert(moduleAppRevenueEntries).values([
      {
        appId: app.id,
        currency: 'CNY',
        developerAmount: 80,
        grossAmount: 100,
        orderId: order.id,
        platformFee: 20,
        publisherId: profile.id,
        publisherUserId: USER_ID,
        reserveAmount: 0,
        status: 'pending',
        type: 'accrual',
      },
      {
        appId: app.id,
        currency: 'CNY',
        developerAmount: -80,
        grossAmount: -100,
        orderId: order.id,
        platformFee: -20,
        publisherId: profile.id,
        publisherUserId: USER_ID,
        reserveAmount: 0,
        status: 'reversed',
        type: 'reversal',
      },
      {
        appId: app.id,
        currency: 'CNY',
        developerAmount: 40,
        grossAmount: 50,
        orderId: settledOrder.id,
        platformFee: 10,
        publisherId: profile.id,
        publisherUserId: USER_ID,
        reserveAmount: 0,
        status: 'settled',
        type: 'accrual',
      },
      {
        appId: app.id,
        currency: 'CNY',
        developerAmount: -40,
        grossAmount: -50,
        orderId: settledOrder.id,
        platformFee: -10,
        publisherId: profile.id,
        publisherUserId: USER_ID,
        reserveAmount: 0,
        status: 'reversed',
        type: 'reversal',
      },
    ]);
    await expect(
      model.setPublication({ appId: app.id, published: false, userId: USER_ID }),
    ).resolves.toEqual({ ok: true });
    await expect(
      serverDB.query.moduleApps.findFirst({
        where: (rows, { eq }) => eq(rows.id, app.id),
      }),
    ).resolves.toMatchObject({ currentPublishedVersionId: null, status: 'unpublished' });
    await expect(
      model.setPublication({ appId: app.id, published: false, userId: OTHER_USER_ID }),
    ).rejects.toThrow('MODULE_APP_DEVELOPER_APP_NOT_FOUND');
    const finance = await model.getFinance(USER_ID);
    expect(finance.payouts).toEqual(
      expect.arrayContaining([expect.objectContaining({ totalAmount: 80 })]),
    );
    expect(finance.summary).toEqual([
      { currency: 'CNY', pendingAmount: 0, settledAmount: 0, totalAmount: 0 },
    ]);
    const firstRevenuePage = await model.listRevenue({ limit: 2, userId: USER_ID });
    const secondRevenuePage = await model.listRevenue({
      cursor: firstRevenuePage.nextCursor!,
      limit: 2,
      userId: USER_ID,
    });
    expect(firstRevenuePage.nextCursor).toBe(2);
    expect(secondRevenuePage.nextCursor).toBeNull();
    expect(
      new Set([...firstRevenuePage.items, ...secondRevenuePage.items].map(({ id }) => id)).size,
    ).toBe(4);

    const firstPayoutPage = await model.listPayouts({ limit: 2, userId: USER_ID });
    const secondPayoutPage = await model.listPayouts({
      cursor: firstPayoutPage.nextCursor!,
      limit: 2,
      userId: USER_ID,
    });
    expect(firstPayoutPage.nextCursor).toBe(2);
    expect(secondPayoutPage.nextCursor).toBeNull();
    expect(
      new Set([...firstPayoutPage.items, ...secondPayoutPage.items].map(({ id }) => id)).size,
    ).toBe(3);
    await expect(model.listPayouts({ userId: OTHER_USER_ID })).resolves.toMatchObject({
      items: [{ totalAmount: 120 }],
    });
    await new ModuleAppPublisherModel(serverDB).suspendPublisher({ publisherId: profile.id });
    await expect(model.listVersions({ appId: app.id, userId: USER_ID })).resolves.toHaveLength(1);
    await expect(
      model.setPublication({ appId: app.id, published: true, userId: USER_ID }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_PUBLISHER_NOT_VERIFIED');
  });
});
