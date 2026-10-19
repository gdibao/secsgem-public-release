import { ADMIN_COMMANDS } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADMIN_DESKTOP_OVERVIEW_SWR_KEY,
  ADMIN_SETTINGS_SECTION_SWR_KEY,
  ADMIN_SETTINGS_SWR_KEY,
} from '@/const/adminCacheKeys';
import { DEFAULT_MOBILE_CONFIG, normalizeMobileConfig } from '@/const/mobileConfig';
import { mutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

import type { AdminSettingsRevisionConflictError } from './adminCommercial';
import { adminCommercialService } from './adminCommercial';

const PROFILE_CURSOR = Buffer.from(
  JSON.stringify({
    createdAt: '2026-07-21T00:00:00.000000Z',
    id: '11111111-1111-4111-8111-111111111111',
    v: 2,
  }),
).toString('base64url');

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    admin: {
      content: {
        deleteDocument: { mutate: vi.fn() },
      },
      desktop: {
        activateDesktopRelease: { mutate: vi.fn() },
        archiveBuildProfile: { mutate: vi.fn() },
        completeBuildAssetUpload: { mutate: vi.fn() },
        createDesktopRelease: { mutate: vi.fn() },
        createBuildAssetUpload: { mutate: vi.fn() },
        getBuildProfile: { query: vi.fn() },
        getOverview: { query: vi.fn() },
        listBuildProfiles: { query: vi.fn() },
        listDesktopReleases: { query: vi.fn() },
        reconcileDesktopRelease: { mutate: vi.fn() },
        retryDesktopRelease: { mutate: vi.fn() },
        saveBuildProfileDraft: { mutate: vi.fn() },
      },
      settings: {
        getAll: { query: vi.fn() },
        getMobileConfigPublication: { query: vi.fn() },
        getSection: { query: vi.fn() },
        publishMobileConfig: { mutate: vi.fn() },
        rollbackMobileConfig: { mutate: vi.fn() },
        saveMobileConfigDraft: { mutate: vi.fn() },
        setAppSetting: { mutate: vi.fn() },
        setAppSettingsBatch: { mutate: vi.fn() },
        validateDefaultAgentSettings: { mutate: vi.fn() },
      },
      moduleApps: {
        acknowledgePaymentDiscrepancy: { mutate: vi.fn() },
        createPayoutBatch: { mutate: vi.fn() },
        exportPaymentReconciliation: { query: vi.fn() },
        list: { query: vi.fn() },
        reconcilePendingPayments: { mutate: vi.fn() },
        recordManualAlipayPayout: { mutate: vi.fn() },
        refundOrder: { mutate: vi.fn() },
        refundPaymentOrder: { mutate: vi.fn() },
        retryPaymentQuery: { mutate: vi.fn() },
        retryRefundStatus: { mutate: vi.fn() },
        settleOrder: { mutate: vi.fn() },
        transitionPayoutBatch: { mutate: vi.fn() },
      },
      newapiProviders: {
        getDeleteInstanceImpact: { query: vi.fn() },
        getModelCatalogDiagnostics: { query: vi.fn() },
        getRemoveModelImpact: { query: vi.fn() },
        setModelsEnabled: { mutate: vi.fn() },
        syncInstanceModels: { mutate: vi.fn() },
        testInstanceConnection: { query: vi.fn() },
      },
      plans: {
        getDeleteImpact: { query: vi.fn() },
        setModelRulesBatch: { mutate: vi.fn() },
      },
      users: {
        compactDetail: { query: vi.fn() },
        recordImpersonationAttempt: { mutate: vi.fn() },
        recordImpersonationStart: { mutate: vi.fn() },
      },
    },
  },
}));

vi.mock('@/libs/swr', () => ({ mutate: vi.fn() }));

describe('adminCommercialService NewAPI helpers', () => {
  const getLegacyImpersonationStartMock = () =>
    (lambdaClient.admin.users as any).recordImpersonationStart.mutate;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delegates desktop overview reads to admin.desktop', async () => {
    await adminCommercialService.getDesktopOverview();

    expect(lambdaClient.admin.desktop.getOverview.query).toHaveBeenCalledTimes(1);
  });

  it('delegates desktop build profile and protected asset operations to admin.desktop', async () => {
    const input = { kind: 'appPreview' as const };
    await adminCommercialService.activateDesktopRelease('44444444-4444-4444-8444-444444444444');
    await adminCommercialService.createBuildAssetUpload(input);
    await adminCommercialService.completeBuildAssetUpload({
      key: 'desktop-build-assets/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png',
      kind: 'appPreview',
      profileId: '11111111-1111-4111-8111-111111111111',
    });
    await adminCommercialService.listBuildProfiles({ cursor: PROFILE_CURSOR, limit: 25 });
    await adminCommercialService.listDesktopReleases({ limit: 10 });
    await adminCommercialService.createDesktopRelease({
      channel: 'stable',
      profileId: '11111111-1111-4111-8111-111111111111',
      releaseNotes: 'notes',
      version: '2.4.0',
    });
    await adminCommercialService.reconcileDesktopRelease('44444444-4444-4444-8444-444444444444');
    await adminCommercialService.retryDesktopRelease('44444444-4444-4444-8444-444444444444');

    expect(lambdaClient.admin.desktop.activateDesktopRelease.mutate).toHaveBeenCalledWith({
      releaseId: '44444444-4444-4444-8444-444444444444',
    });
    expect(lambdaClient.admin.desktop.createBuildAssetUpload.mutate).toHaveBeenCalledWith(input);
    expect(lambdaClient.admin.desktop.completeBuildAssetUpload.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'appPreview' }),
    );
    expect(lambdaClient.admin.desktop.listBuildProfiles.query).toHaveBeenCalledWith({
      cursor: PROFILE_CURSOR,
      limit: 25,
    });
    expect(lambdaClient.admin.desktop.listDesktopReleases.query).toHaveBeenCalledWith({
      limit: 10,
    });
    expect(lambdaClient.admin.desktop.createDesktopRelease.mutate).toHaveBeenCalledWith({
      channel: 'stable',
      profileId: '11111111-1111-4111-8111-111111111111',
      releaseNotes: 'notes',
      version: '2.4.0',
    });
    expect(lambdaClient.admin.desktop.reconcileDesktopRelease.mutate).toHaveBeenCalledWith({
      releaseId: '44444444-4444-4444-8444-444444444444',
    });
    expect(lambdaClient.admin.desktop.retryDesktopRelease.mutate).toHaveBeenCalledWith({
      releaseId: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('calls the AI provider connection test endpoint', async () => {
    vi.mocked(lambdaClient.admin.newapiProviders.testInstanceConnection.query).mockResolvedValue({
      modelsCount: 1,
      ok: true,
      pricingCount: 0,
      warnings: [],
    });

    await adminCommercialService.testAiProviderInstanceConnection('instance-1');

    expect(lambdaClient.admin.newapiProviders.testInstanceConnection.query).toHaveBeenCalledWith({
      id: 'instance-1',
    });
  });

  it('delegates model and plan batches as one server transaction each', async () => {
    const models = [
      { modelId: 'gpt-4.1', modelType: 'chat' as const },
      { modelId: 'text-embedding-3-large', modelType: 'embedding' as const },
    ];
    const updates = [
      {
        modelRules: { chat: { allowlist: ['gpt-4.1'], mode: 'allowlist' as const } },
        plan: 'premium',
      },
      {
        modelRules: { chat: { blocklist: ['legacy-chat'], mode: 'blocklist' as const } },
        plan: 'ultimate',
      },
    ];

    await adminCommercialService.setAiProviderInstanceModelsEnabled({
      enabled: false,
      instanceId: '11111111-1111-4111-8111-111111111111',
      models,
    });
    await adminCommercialService.setPlanModelRulesBatch(updates);

    expect(lambdaClient.admin.newapiProviders.setModelsEnabled.mutate).toHaveBeenCalledOnce();
    expect(lambdaClient.admin.newapiProviders.setModelsEnabled.mutate).toHaveBeenCalledWith({
      enabled: false,
      instanceId: '11111111-1111-4111-8111-111111111111',
      models,
    });
    expect(lambdaClient.admin.plans.setModelRulesBatch.mutate).toHaveBeenCalledOnce();
    expect(lambdaClient.admin.plans.setModelRulesBatch.mutate).toHaveBeenCalledWith({ updates });
  });

  it('loads structured deletion impact previews for plans, providers, and models', async () => {
    const impact = {
      blocking: [],
      canProceed: true,
      immediateEffects: [],
      liveEffects: [],
      target: { id: 'target', type: 'plan' },
      targetExists: true,
    } as any;
    vi.mocked(lambdaClient.admin.plans.getDeleteImpact.query).mockResolvedValue(impact);
    vi.mocked(lambdaClient.admin.newapiProviders.getDeleteInstanceImpact.query).mockResolvedValue(
      impact,
    );
    vi.mocked(lambdaClient.admin.newapiProviders.getRemoveModelImpact.query).mockResolvedValue(
      impact,
    );

    await adminCommercialService.getPlanDeleteImpact('premium');
    await adminCommercialService.getAiProviderInstanceDeleteImpact('instance-1');
    await adminCommercialService.getAiProviderModelDeleteImpact({
      instanceId: 'instance-1',
      modelId: 'gpt-4o',
      modelType: 'chat',
    });

    expect(lambdaClient.admin.plans.getDeleteImpact.query).toHaveBeenCalledWith({
      plan: 'premium',
    });
    expect(lambdaClient.admin.newapiProviders.getDeleteInstanceImpact.query).toHaveBeenCalledWith({
      id: 'instance-1',
    });
    expect(lambdaClient.admin.newapiProviders.getRemoveModelImpact.query).toHaveBeenCalledWith({
      instanceId: 'instance-1',
      modelId: 'gpt-4o',
      modelType: 'chat',
    });
  });

  it('calls the module app admin list endpoint', async () => {
    vi.mocked(lambdaClient.admin.moduleApps.list.query).mockResolvedValue({
      items: [{ id: 'app1' } as any],
      nextCursor: null,
    });

    await expect(
      adminCommercialService.moduleApps.list({
        query: 'work',
        sort: 'updated_desc',
        status: 'published',
      }),
    ).resolves.toEqual({ items: [{ id: 'app1' }], nextCursor: null });

    expect(lambdaClient.admin.moduleApps.list.query).toHaveBeenCalledWith({
      query: 'work',
      sort: 'updated_desc',
      status: 'published',
    });
  });

  it('uses the compact user detail endpoint for cross-domain drawers', async () => {
    vi.mocked(lambdaClient.admin.users.compactDetail.query).mockResolvedValue({
      banned: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 'target-user',
      lastActiveAt: null,
      role: 'user',
    });

    await adminCommercialService.getCompactUserDetail('target-user');

    expect(lambdaClient.admin.users.compactDetail.query).toHaveBeenCalledWith({
      userId: 'target-user',
    });
  });

  it('calls the module app admin detail endpoint', async () => {
    (lambdaClient.admin.moduleApps as any).get = {
      query: vi.fn().mockResolvedValue({ id: 'app1' }),
    };

    await expect(adminCommercialService.moduleApps.get({ appId: 'app1' })).resolves.toEqual({
      id: 'app1',
    });

    expect((lambdaClient.admin.moduleApps as any).get.query).toHaveBeenCalledWith({
      appId: 'app1',
    });
  });

  it('calls the module app package review endpoints', async () => {
    (lambdaClient.admin.moduleApps as any).listPackages = {
      query: vi.fn().mockResolvedValue({ items: [{ id: 'package-1' }], nextCursor: null }),
    };
    (lambdaClient.admin.moduleApps as any).getPackage = {
      query: vi.fn().mockResolvedValue({ id: 'package-1' }),
    };
    (lambdaClient.admin.moduleApps as any).approvePackage = {
      mutate: vi.fn().mockResolvedValue({ appId: 'app-1', package: { id: 'package-1' } }),
    };
    (lambdaClient.admin.moduleApps as any).rejectPackage = {
      mutate: vi.fn().mockResolvedValue({ package: { id: 'package-1', reviewStatus: 'rejected' } }),
    };
    (lambdaClient.admin.moduleApps as any).rescanPackage = {
      mutate: vi.fn().mockResolvedValue({ packageId: 'package-1', scanStatus: 'clean' }),
    };

    await expect(
      adminCommercialService.moduleApps.listPackages({ reviewStatus: 'pending_review' }),
    ).resolves.toEqual({ items: [{ id: 'package-1' }], nextCursor: null });
    await expect(
      adminCommercialService.moduleApps.getPackage({ packageId: 'package-1' }),
    ).resolves.toEqual({
      id: 'package-1',
    });
    await expect(
      adminCommercialService.moduleApps.approvePackage({
        outboundHostPolicies: [],
        packageId: 'package-1',
      }),
    ).resolves.toEqual({ appId: 'app-1', package: { id: 'package-1' } });
    await expect(
      adminCommercialService.moduleApps.rejectPackage({
        packageId: 'package-1',
        reason: 'Unsafe manifest',
      }),
    ).resolves.toEqual({ package: { id: 'package-1', reviewStatus: 'rejected' } });
    await expect(
      adminCommercialService.moduleApps.rescanPackage({ packageId: 'package-1' }),
    ).resolves.toEqual({ packageId: 'package-1', scanStatus: 'clean' });

    expect((lambdaClient.admin.moduleApps as any).listPackages.query).toHaveBeenCalledWith({
      reviewStatus: 'pending_review',
    });
    expect((lambdaClient.admin.moduleApps as any).getPackage.query).toHaveBeenCalledWith({
      packageId: 'package-1',
    });
    expect((lambdaClient.admin.moduleApps as any).approvePackage.mutate).toHaveBeenCalledWith({
      outboundHostPolicies: [],
      packageId: 'package-1',
    });
    expect((lambdaClient.admin.moduleApps as any).rejectPackage.mutate).toHaveBeenCalledWith({
      packageId: 'package-1',
      reason: 'Unsafe manifest',
    });
    expect((lambdaClient.admin.moduleApps as any).rescanPackage.mutate).toHaveBeenCalledWith({
      packageId: 'package-1',
    });
  });

  it('delegates publisher governance mutations to the module app client', async () => {
    (lambdaClient.admin.moduleApps as any).createPublisher = { mutate: vi.fn() };
    (lambdaClient.admin.moduleApps as any).verifyPublisher = { mutate: vi.fn() };
    (lambdaClient.admin.moduleApps as any).suspendPublisher = { mutate: vi.fn() };
    (lambdaClient.admin.moduleApps as any).assignPublisher = { mutate: vi.fn() };

    const createPublisher = {
      displayName: 'Verified Studio',
      recipientMask: 'ali***@example.com',
      userId: 'user-1',
    };
    const verifyPublisher = { publisherId: 'publisher-1', verificationMetadata: {} };
    const suspendPublisher = { publisherId: 'publisher-1' };
    const assignPublisher = { appId: 'app-1', publisherId: 'publisher-1' };

    await adminCommercialService.moduleApps.createPublisher(createPublisher);
    await adminCommercialService.moduleApps.verifyPublisher(verifyPublisher);
    await adminCommercialService.moduleApps.suspendPublisher(suspendPublisher);
    await adminCommercialService.moduleApps.assignPublisher(assignPublisher);

    expect((lambdaClient.admin.moduleApps as any).createPublisher.mutate).toHaveBeenCalledWith(
      createPublisher,
    );
    expect((lambdaClient.admin.moduleApps as any).verifyPublisher.mutate).toHaveBeenCalledWith(
      verifyPublisher,
    );
    expect((lambdaClient.admin.moduleApps as any).suspendPublisher.mutate).toHaveBeenCalledWith(
      suspendPublisher,
    );
    expect((lambdaClient.admin.moduleApps as any).assignPublisher.mutate).toHaveBeenCalledWith(
      assignPublisher,
    );
  });

  it('delegates module app finance workflows with exact backend inputs', async () => {
    const inputs = {
      acknowledge: { discrepancyId: 'discrepancy-1' },
      createPayout: {
        publisherId: 'publisher-1',
        requestedAmount: 80,
        revenueEntryIds: ['revenue-1'],
      },
      exportReconciliation: { cursor: 10, limit: 100, status: 'open' as const },
      manualPayout: {
        batchId: 'payout-1',
        evidenceReference: 'evidence-1',
        recipientMask: 'ali***@example.com',
        transactionNo: 'alipay-1',
      },
      offlineRefund: {
        offlineRefundReference: 'offline-1',
        orderId: 'order-1',
        reason: 'duplicate',
      },
      paymentRefund: { orderId: 'order-1', reason: 'duplicate' },
      reconcile: { limit: 100 },
      retryPayment: { outTradeNo: 'trade-1' },
      retryRefund: { orderId: 'order-1' },
      settle: { orderId: 'order-1', paymentReference: 'payment-1' },
      transitionPayout: {
        batchId: 'payout-1',
        failureReason: 'provider rejected transfer',
        status: 'failed' as const,
      },
    };

    await adminCommercialService.moduleApps.acknowledgePaymentDiscrepancy(inputs.acknowledge);
    await adminCommercialService.moduleApps.exportPaymentReconciliation(
      inputs.exportReconciliation,
    );
    await adminCommercialService.moduleApps.reconcilePendingPayments(inputs.reconcile);
    await adminCommercialService.moduleApps.refundOrder(inputs.offlineRefund);
    await adminCommercialService.moduleApps.refundPaymentOrder(inputs.paymentRefund);
    await adminCommercialService.moduleApps.retryPaymentQuery(inputs.retryPayment);
    await adminCommercialService.moduleApps.retryRefundStatus(inputs.retryRefund);
    await adminCommercialService.moduleApps.settleOrder(inputs.settle);
    await adminCommercialService.moduleApps.createPayoutBatch(inputs.createPayout);
    await adminCommercialService.moduleApps.recordManualAlipayPayout(inputs.manualPayout);
    await adminCommercialService.moduleApps.transitionPayoutBatch(inputs.transitionPayout);

    expect(lambdaClient.admin.moduleApps.acknowledgePaymentDiscrepancy.mutate).toHaveBeenCalledWith(
      inputs.acknowledge,
    );
    expect(lambdaClient.admin.moduleApps.exportPaymentReconciliation.query).toHaveBeenCalledWith(
      inputs.exportReconciliation,
    );
    expect(lambdaClient.admin.moduleApps.reconcilePendingPayments.mutate).toHaveBeenCalledWith(
      inputs.reconcile,
    );
    expect(lambdaClient.admin.moduleApps.refundOrder.mutate).toHaveBeenCalledWith(
      inputs.offlineRefund,
    );
    expect(lambdaClient.admin.moduleApps.refundPaymentOrder.mutate).toHaveBeenCalledWith(
      inputs.paymentRefund,
    );
    expect(lambdaClient.admin.moduleApps.retryPaymentQuery.mutate).toHaveBeenCalledWith(
      inputs.retryPayment,
    );
    expect(lambdaClient.admin.moduleApps.retryRefundStatus.mutate).toHaveBeenCalledWith(
      inputs.retryRefund,
    );
    expect(lambdaClient.admin.moduleApps.settleOrder.mutate).toHaveBeenCalledWith(inputs.settle);
    expect(lambdaClient.admin.moduleApps.createPayoutBatch.mutate).toHaveBeenCalledWith(
      inputs.createPayout,
    );
    expect(lambdaClient.admin.moduleApps.recordManualAlipayPayout.mutate).toHaveBeenCalledWith(
      inputs.manualPayout,
    );
    expect(lambdaClient.admin.moduleApps.transitionPayoutBatch.mutate).toHaveBeenCalledWith(
      inputs.transitionPayout,
    );
  });

  it('calls the module app admin publish endpoint', async () => {
    (lambdaClient.admin.moduleApps as any).publish = {
      mutate: vi.fn().mockResolvedValue({ ok: true }),
    };

    await expect(adminCommercialService.moduleApps.publish({ appId: 'app1' })).resolves.toEqual({
      ok: true,
    });

    expect((lambdaClient.admin.moduleApps as any).publish.mutate).toHaveBeenCalledWith({
      appId: 'app1',
    });
  });

  it('calls the module app admin upsert endpoint', async () => {
    (lambdaClient.admin.moduleApps as any).upsert = {
      mutate: vi.fn().mockResolvedValue({ id: 'app1', slug: 'workbench' }),
    };

    const input = {
      actions: [],
      appType: 'standard_app',
      billing: {},
      category: 'office',
      description: 'Simple workbench app.',
      displayName: 'Workbench',
      icon: 'Blocks',
      pages: [{ key: 'overview', routePath: '/', title: 'Overview', type: 'overview' }],
      slug: 'workbench',
      status: 'draft',
      tags: [],
    };

    await expect(adminCommercialService.moduleApps.upsert(input)).resolves.toEqual({
      id: 'app1',
      slug: 'workbench',
    });

    expect((lambdaClient.admin.moduleApps as any).upsert.mutate).toHaveBeenCalledWith(input);
  });

  it('calls module app product management endpoints', async () => {
    (lambdaClient.admin.moduleApps as any).createProduct = {
      mutate: vi.fn().mockResolvedValue({ id: 'product-1' }),
    };
    (lambdaClient.admin.moduleApps as any).listProducts = {
      query: vi.fn().mockResolvedValue([{ productId: 'product-1' }]),
    };
    (lambdaClient.admin.moduleApps as any).updateProduct = {
      mutate: vi.fn().mockResolvedValue({ product: { id: 'product-1' } }),
    };
    const createInput = {
      appId: 'app1',
      licenseScope: 'personal' as const,
      price: { amount: 88, currency: 'CNY' },
      productKey: 'pro',
      productType: 'one_time' as const,
    };
    const updateInput = {
      licenseScope: 'personal' as const,
      price: { amount: 120, currency: 'CNY' },
      productId: 'product-1',
      productType: 'one_time' as const,
      status: 'active' as const,
    };

    await expect(adminCommercialService.moduleApps.createProduct(createInput)).resolves.toEqual({
      id: 'product-1',
    });
    await expect(
      adminCommercialService.moduleApps.listProducts({ appId: 'app1' }),
    ).resolves.toEqual([{ productId: 'product-1' }]);
    await expect(
      adminCommercialService.moduleApps.updateProduct(updateInput),
    ).resolves.toMatchObject({
      product: { id: 'product-1' },
    });
  });

  it('calls the AI provider model sync endpoint', async () => {
    vi.mocked(lambdaClient.admin.newapiProviders.syncInstanceModels.mutate).mockResolvedValue({
      abilitiesCount: 1,
      deletedCount: 1,
      importedCount: 1,
      modelsCount: 1,
      ok: true,
      pricingCount: 0,
      staleCount: 0,
      warnings: [],
    });

    await adminCommercialService.syncAiProviderInstanceModels('instance-1');

    expect(lambdaClient.admin.newapiProviders.syncInstanceModels.mutate).toHaveBeenCalledWith({
      id: 'instance-1',
    });
  });

  it('calls the AI provider model catalog diagnostics endpoint', async () => {
    vi.mocked(
      lambdaClient.admin.newapiProviders.getModelCatalogDiagnostics.query,
    ).mockResolvedValue({
      catalog: [],
      views: [],
      health: { hiddenByPlanCount: 0, modelTypeCount: 0, totalCount: 0, visibleCount: 0 },
      hiddenByReason: {},
      risks: [],
    });

    await adminCommercialService.getAiProviderModelCatalogDiagnostics();

    expect(
      lambdaClient.admin.newapiProviders.getModelCatalogDiagnostics.query,
    ).toHaveBeenCalledWith();
  });

  it('keeps legacy NewAPI helper aliases for compatibility', async () => {
    vi.mocked(lambdaClient.admin.newapiProviders.testInstanceConnection.query).mockResolvedValue({
      modelsCount: 1,
      ok: true,
      pricingCount: 0,
      warnings: [],
    });

    await adminCommercialService.testNewapiInstanceConnection('instance-1');

    expect(lambdaClient.admin.newapiProviders.testInstanceConnection.query).toHaveBeenCalledWith({
      id: 'instance-1',
    });
  });

  it('calls the default agent settings validation endpoint', async () => {
    vi.mocked(lambdaClient.admin.settings.validateDefaultAgentSettings.mutate).mockResolvedValue({
      ok: true,
    });

    await adminCommercialService.validateDefaultAgentSettings({
      model: 'deepseek-chat',
      provider: 'newapi',
    });

    expect(lambdaClient.admin.settings.validateDefaultAgentSettings.mutate).toHaveBeenCalledWith({
      model: 'deepseek-chat',
      provider: 'newapi',
    });
  });

  it('uses the requested file-storage section for upload URL settings reads', async () => {
    vi.mocked(lambdaClient.admin.settings.getSection.query).mockResolvedValue({
      section: 'file-storage',
      sharedHealth: {},
      storageS3PublicDomain: 'https://assets.example.com',
    } as any);

    await expect(adminCommercialService.getSettingsSection('file-storage')).resolves.toMatchObject({
      storageS3PublicDomain: 'https://assets.example.com',
    });

    expect(lambdaClient.admin.settings.getSection.query).toHaveBeenCalledWith({
      section: 'file-storage',
    });
    expect(lambdaClient.admin.settings.getAll.query).not.toHaveBeenCalled();
  });

  it('returns the bare normalized mobile configuration from the mobile section', async () => {
    vi.mocked(lambdaClient.admin.settings.getSection.query).mockResolvedValue({
      mobileConfig: DEFAULT_MOBILE_CONFIG,
      section: 'mobile',
      sharedHealth: {},
    } as any);

    await expect(adminCommercialService.getMobileSettings()).resolves.toEqual(
      DEFAULT_MOBILE_CONFIG,
    );
    expect(lambdaClient.admin.settings.getSection.query).toHaveBeenCalledWith({
      section: 'mobile',
    });
  });

  it('carries section revisions through settings writes', async () => {
    vi.mocked(lambdaClient.admin.settings.getSection.query).mockResolvedValue({
      __revision: 4,
      section: 'settings',
      sharedHealth: {},
    } as any);
    vi.mocked(lambdaClient.admin.settings.setAppSetting.mutate).mockResolvedValue({
      ok: true,
      revisions: { settings: 5 },
    } as any);

    await adminCommercialService.getSettingsSection('settings');
    await adminCommercialService.setAppSetting({ key: 'defaultAgent.name', value: 'ComHub' });

    expect(lambdaClient.admin.settings.setAppSetting.mutate).toHaveBeenCalledWith({
      expectedRevisions: { settings: 4 },
      key: 'defaultAgent.name',
      value: 'ComHub',
    });
  });

  it('surfaces conflict correlation ids and reloads a cleared revision before retrying', async () => {
    vi.mocked(lambdaClient.admin.settings.getSection.query)
      .mockResolvedValueOnce({ __revision: 4, section: 'settings', sharedHealth: {} } as any)
      .mockResolvedValueOnce({ __revision: 7, section: 'settings', sharedHealth: {} } as any);
    vi.mocked(lambdaClient.admin.settings.setAppSetting.mutate)
      .mockRejectedValueOnce({
        data: { code: 'CONFLICT', errorData: { correlationId: 'settings-correlation-1' } },
        message: 'APP_SETTINGS_REVISION_CONFLICT',
      })
      .mockResolvedValueOnce({ ok: true, revisions: { settings: 8 } } as any);

    await adminCommercialService.getSettingsSection('settings');
    await expect(
      adminCommercialService.setAppSetting({ key: 'defaultAgent.name', value: 'Stale' }),
    ).rejects.toMatchObject({
      details: {
        correlationId: 'settings-correlation-1',
        isConflict: true,
        sections: ['settings'],
      },
      name: 'AdminSettingsRevisionConflictError',
    } satisfies Partial<AdminSettingsRevisionConflictError>);

    await adminCommercialService.setAppSetting({ key: 'defaultAgent.name', value: 'Fresh' });

    expect(lambdaClient.admin.settings.getSection.query).toHaveBeenCalledTimes(2);
    expect(lambdaClient.admin.settings.setAppSetting.mutate).toHaveBeenLastCalledWith({
      expectedRevisions: { settings: 7 },
      key: 'defaultAgent.name',
      value: 'Fresh',
    });
  });

  it('returns the complete mobile publication state from the dedicated endpoint', async () => {
    const publication = {
      draft: { config: DEFAULT_MOBILE_CONFIG, revision: 2, updatedAt: '2026-07-20T02:00:00.000Z' },
      history: [
        { config: DEFAULT_MOBILE_CONFIG, revision: 1, updatedAt: '2026-07-20T01:00:00.000Z' },
      ],
      published: {
        config: DEFAULT_MOBILE_CONFIG,
        revision: 1,
        updatedAt: '2026-07-20T01:00:00.000Z',
      },
    };
    vi.mocked(lambdaClient.admin.settings.getMobileConfigPublication.query).mockResolvedValue(
      publication,
    );

    await expect(adminCommercialService.getMobileSettingsPublication()).resolves.toEqual(
      publication,
    );
    expect(lambdaClient.admin.settings.getMobileConfigPublication.query).toHaveBeenCalledTimes(1);
  });

  it('normalizes and persists the mobile draft through the dedicated endpoint', async () => {
    const rawConfig = {
      discover: {
        assistants: Array.from({ length: 5 }, (_, index) => ({
          assistantId: `assistant-${index}`,
          model: 'chat-model',
          order: index + 1,
          provider: 'catalog',
        })),
      },
      navigation: {
        items: [
          {
            icon: 'bell',
            id: 'slot-1',
            label: 'Inbox',
            order: 1,
            path: 'javascript:alert(1)',
            visible: true,
          },
        ],
      },
      version: 1,
    };
    const normalized = normalizeMobileConfig(rawConfig);
    vi.mocked(lambdaClient.admin.settings.saveMobileConfigDraft.mutate).mockResolvedValue({
      draft: { config: normalized, revision: 1, updatedAt: '2026-07-20T00:00:00.000Z' },
      history: [],
      published: {
        config: DEFAULT_MOBILE_CONFIG,
        revision: 0,
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    } as any);

    await expect(adminCommercialService.saveMobileSettings(rawConfig)).resolves.toEqual(normalized);

    expect(lambdaClient.admin.settings.saveMobileConfigDraft.mutate).toHaveBeenCalledWith({
      config: normalized,
      expectedDraftRevision: 0,
    });
  });

  it('publishes and rolls back mobile settings with revision preconditions', async () => {
    vi.mocked(lambdaClient.admin.settings.publishMobileConfig.mutate).mockResolvedValue({
      published: { config: DEFAULT_MOBILE_CONFIG, revision: 2 },
    } as any);
    vi.mocked(lambdaClient.admin.settings.rollbackMobileConfig.mutate).mockResolvedValue({
      published: { config: DEFAULT_MOBILE_CONFIG, revision: 3 },
    } as any);

    await adminCommercialService.publishMobileSettings({
      expectedDraftRevision: 3,
      expectedRevision: 1,
    });
    await adminCommercialService.rollbackMobileSettings({
      expectedDraftRevision: 4,
      expectedRevision: 2,
      targetRevision: 1,
    });

    expect(lambdaClient.admin.settings.publishMobileConfig.mutate).toHaveBeenCalledWith({
      expectedDraftRevision: 3,
      expectedRevision: 1,
    });
    expect(lambdaClient.admin.settings.rollbackMobileConfig.mutate).toHaveBeenCalledWith({
      expectedDraftRevision: 4,
      expectedRevision: 2,
      targetRevision: 1,
    });
  });

  it('invalidates only affected section caches and the compatibility aggregate after writes', async () => {
    vi.mocked(lambdaClient.admin.settings.setAppSettingsBatch.mutate).mockResolvedValue({
      count: 3,
      ok: true,
      revisions: { growth: 1, notifications: 1 },
    });

    await adminCommercialService.setAppSettingsBatch({
      updates: [
        { key: 'auth.signup.enabled', value: false },
        { key: 'notification.retentionDays', value: 30 },
        { key: 'auth.signup.disabledMessage', value: 'Closed' },
      ],
    });

    expect(vi.mocked(mutate).mock.calls.map(([key]) => key)).toEqual([
      ADMIN_SETTINGS_SECTION_SWR_KEY('growth'),
      ADMIN_SETTINGS_SECTION_SWR_KEY('notifications'),
      ADMIN_SETTINGS_SWR_KEY,
    ]);
    expect(mutate).not.toHaveBeenCalledWith(ADMIN_SETTINGS_SECTION_SWR_KEY('operations'));
  });

  it('invalidates desktop settings and release diagnostics after desktop writes', async () => {
    vi.mocked(lambdaClient.admin.settings.setAppSettingsBatch.mutate).mockResolvedValue({
      count: 1,
      ok: true,
      revisions: { 'desktop-update': 1 },
    });

    await adminCommercialService.setAppSettingsBatch({
      updates: [{ key: 'desktop.update.serverUrl', value: 'https://updates.example.com' }],
    });

    expect(vi.mocked(mutate).mock.calls.map(([key]) => key)).toEqual([
      ADMIN_SETTINGS_SECTION_SWR_KEY('desktop-update'),
      ADMIN_DESKTOP_OVERVIEW_SWR_KEY,
      ADMIN_SETTINGS_SWR_KEY,
    ]);
  });

  it('forwards the shared command to the catalogued Better Auth effect boundary', async () => {
    vi.mocked(lambdaClient.admin.users.recordImpersonationAttempt.mutate).mockResolvedValue({
      ok: true,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    const command = { actionId: 'user.impersonate.attempt', confirmed: true } as const;
    await adminCommercialService.impersonateUser('target-user', command);

    expect(ADMIN_COMMANDS['user.impersonate.attempt'].serverBoundary).toEqual({
      kind: 'http',
      method: 'POST',
      path: '/api/auth/admin/impersonate-user',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/admin/impersonate-user', {
      body: JSON.stringify({ command, userId: 'target-user' }),
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(lambdaClient.admin.users.recordImpersonationAttempt.mutate).not.toHaveBeenCalled();
    expect(getLegacyImpersonationStartMock()).not.toHaveBeenCalled();
  });

  it('does not mark a failed Better Auth impersonation request as started', async () => {
    vi.mocked(lambdaClient.admin.users.recordImpersonationAttempt.mutate).mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('forbidden'),
      }),
    );

    const command = { actionId: 'user.impersonate.attempt', confirmed: true } as const;
    await expect(adminCommercialService.impersonateUser('target-user', command)).rejects.toThrow(
      'forbidden',
    );

    expect(lambdaClient.admin.users.recordImpersonationAttempt.mutate).not.toHaveBeenCalled();
    expect(getLegacyImpersonationStartMock()).not.toHaveBeenCalled();
  });

  it('forwards the shared command envelope to a dangerous content mutation', async () => {
    vi.mocked(lambdaClient.admin.content.deleteDocument.mutate).mockResolvedValue({ ok: true });
    const command = { actionId: 'content.deleteDocument', confirmed: true } as const;

    await adminCommercialService.deleteAdminDocument('document-1', command);

    expect(lambdaClient.admin.content.deleteDocument.mutate).toHaveBeenCalledWith({
      command,
      documentId: 'document-1',
    });
  });
});
