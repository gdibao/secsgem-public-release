import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { ModuleAppModel } from '@/database/models/moduleApp';

import { writeModuleAppAuditLog } from '../../module-apps/audit';
import { runRequiredAdminAuditExternalEffect } from './audit';
import { adminRouter } from './index';

const moduleAppModelMocks = vi.hoisted(() => ({
  approvePackageSubmissionForAdmin: vi.fn(),
  getAdminApp: vi.fn(),
  getAdminPackageSubmission: vi.fn(),
  listAdminPackageSubmissions: vi.fn(),
  rejectPackageSubmissionForAdmin: vi.fn(),
  setStatus: vi.fn(),
  upsertAppForAdmin: vi.fn(),
  upsertBillingForAdmin: vi.fn(),
  upsertConfigurationForAdmin: vi.fn(),
  upsertEntitlementsForAdmin: vi.fn(),
}));

const moduleAppCommerceMocks = vi.hoisted(() => ({
  createProduct: vi.fn(),
  listProducts: vi.fn(),
  refundOrder: vi.fn(),
  settleOrder: vi.fn(),
  updateProduct: vi.fn(),
}));

const transactionDb = { transaction: 'module-app-product-audit' };
const dbMocks = vi.hoisted(() => ({ transaction: vi.fn() }));
const authState = vi.hoisted(() => ({ role: 'admin' }));

const moduleAppRevenueMocks = vi.hoisted(() => ({
  listRevenue: vi.fn(),
  settleBatchWithAudit: vi.fn(),
}));

const moduleAppOrderRevenueMocks = vi.hoisted(() => ({
  refundOrder: vi.fn(),
  settleOrder: vi.fn(),
}));

const moduleAppPaymentMocks = vi.hoisted(() => ({
  reconcilePayment: vi.fn(),
  reconcilePendingPayments: vi.fn(),
  reconcileRefund: vi.fn(),
  refundOrder: vi.fn(),
  resolvePendingRefund: vi.fn(),
}));

const moduleAppPaymentModelMocks = vi.hoisted(() => ({
  acknowledgeDiscrepancy: vi.fn(),
  getPaymentAttemptByOrderId: vi.fn(),
  getRefundByOrderId: vi.fn(),
  listDiscrepancies: vi.fn(),
}));

const moduleAppPublisherMocks = vi.hoisted(() => ({
  assignApplication: vi.fn(),
  createPublisher: vi.fn(),
  listPublishers: vi.fn(),
  suspendPublisher: vi.fn(),
  verifyPublisher: vi.fn(),
}));

const moduleAppPayoutMocks = vi.hoisted(() => ({
  createEligibleBatch: vi.fn(),
  getBatch: vi.fn(),
  listPayouts: vi.fn(),
  recordManualAlipayPayout: vi.fn(),
  transitionBatch: vi.fn(),
}));

const moduleAppReadModelMocks = vi.hoisted(() => ({
  getRuntimeScheduleDiagnostics: vi.fn(),
  listApplications: vi.fn(),
  listArtifacts: vi.fn(),
  listAuditEvents: vi.fn(),
  listInstalls: vi.fn(),
  listPackages: vi.fn(),
  listPaymentDiagnostics: vi.fn(),
  listPayouts: vi.fn(),
  listPublishers: vi.fn(),
  listRecords: vi.fn(),
  listRevenue: vi.fn(),
  listRuns: vi.fn(),
}));

const mockAppEnv = vi.hoisted(() => ({
  MODULE_APP_ALIPAY_ENABLED: true,
  MODULE_APP_EXECUTION_ENABLED: false,
  MODULE_APP_PUBLIC_EXECUTION_ENABLED: false,
  MODULE_APP_PUBLISHER_ALLOWLIST: [] as string[],
  MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED: true,
  MODULE_APP_RUNTIME_INVOCATION_ENABLED: false,
  MODULE_APP_RUNTIME_PUBLIC_ORIGIN: undefined as string | undefined,
}));
const moduleAppRuntimeClientMocks = vi.hoisted(() => ({
  getConfigurationStatus: vi.fn(),
  healthCheck: vi.fn(),
}));
const getServerModuleAppRuntimeConfig = vi.hoisted(() => vi.fn());
const dispatchDueModuleAppSchedules = vi.hoisted(() => vi.fn());
const recordModuleAppPayoutState = vi.hoisted(() => vi.fn());
const mockCreateConfiguredModuleAppAlipayClient = vi.hoisted(() => vi.fn(() => ({})));
const mockCreatePaymentAdapter = vi.hoisted(() =>
  vi.fn(() => ({ method: 'alipay', provider: 'alipay' })),
);
const mockGetServerPaymentConfig = vi.hoisted(() => vi.fn());
const mockGetAllEnabledModels = vi.hoisted(() => vi.fn());
const mockListEnabledPaymentMethods = vi.hoisted(() => vi.fn());
const externalAuditMock = vi.hoisted(() => vi.fn());

const lifecycleMocks = vi.hoisted(() => ({
  releaseRejectedPackage: vi.fn(),
  rescanLegacyPackage: vi.fn(),
}));

const buildServiceMocks = vi.hoisted(() => ({
  approvePackage: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/moduleApp', () => ({
  ModuleAppModel: vi.fn(() => moduleAppModelMocks),
}));

vi.mock('@/database/models/moduleAppPayment', () => ({
  ModuleAppPaymentModel: vi.fn(() => moduleAppPaymentModelMocks),
}));

vi.mock('@/database/models/moduleAppPublisher', () => ({
  ModuleAppPublisherModel: vi.fn(() => moduleAppPublisherMocks),
}));

vi.mock('@/database/models/moduleAppPayout', () => ({
  ModuleAppPayoutModel: vi.fn(() => moduleAppPayoutMocks),
}));

vi.mock('./moduleApps.readModels', () => ({
  ModuleAppAdminReadModel: vi.fn(() => moduleAppReadModelMocks),
}));

vi.mock('@/envs/app', () => ({ appEnv: mockAppEnv }));

vi.mock('@lobechat/observability-otel/modules/module-app', () => ({
  recordModuleAppPayoutState,
}));

vi.mock('@/server/services/moduleAppPayments/alipay/client', () => ({
  createConfiguredModuleAppAlipayClient: mockCreateConfiguredModuleAppAlipayClient,
}));

vi.mock('@/server/services/payments/config', () => ({
  createOperationalPaymentConfig: vi.fn((config) => ({
    ...config,
    enabled: true,
    moduleAppEnabled: true,
  })),
  getServerPaymentConfig: mockGetServerPaymentConfig,
  listEnabledPaymentMethods: mockListEnabledPaymentMethods,
}));

vi.mock('@/server/services/payments/factory', () => ({
  createPaymentAdapter: mockCreatePaymentAdapter,
}));

vi.mock('../../module-apps/payments/service', () => ({
  ModuleAppPaymentService: vi.fn(() => moduleAppPaymentMocks),
}));

vi.mock('@/database/models/moduleAppCommerce', () => ({
  ModuleAppCommerceModel: vi.fn(() => moduleAppCommerceMocks),
}));

vi.mock('../../module-apps/revenue', () => ({
  ModuleAppRevenueService: vi.fn(() => moduleAppRevenueMocks),
  ModuleAppOrderRevenueService: vi.fn(() => moduleAppOrderRevenueMocks),
}));

vi.mock('@/server/services/moduleAppPackage/lifecycle', () => ({
  ModuleAppPackageLifecycleService: vi.fn(() => lifecycleMocks),
}));

vi.mock('@/server/services/moduleAppBuild/service', () => ({
  ModuleAppBuildService: vi.fn(() => buildServiceMocks),
}));

vi.mock('@/server/services/moduleAppRuntime/client', () => ({
  ModuleAppRuntimeClient: vi.fn(() => moduleAppRuntimeClientMocks),
}));

vi.mock('@/server/services/moduleAppRuntime/config', () => ({
  getServerModuleAppRuntimeConfig,
}));

vi.mock('@/server/workflows/moduleApp/scheduleDispatcher', () => ({
  dispatchDueModuleAppSchedules,
}));

vi.mock('@/server/services/newapiInstance', () => ({
  getAllEnabledModels: mockGetAllEnabledModels,
}));

vi.mock('../../module-apps/audit', () => ({
  writeModuleAppAuditLog: vi.fn(),
}));

vi.mock('./audit', () => ({
  runRequiredAdminAuditExternalEffect: externalAuditMock,
}));

vi.mock('./audit-router', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminAuditRouter: router({}) };
});

vi.mock('./content', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminContentRouter: router({}) };
});

vi.mock('./credits', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminCreditsRouter: router({}) };
});

vi.mock('./newapiProviders', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminNewapiProvidersRouter: router({}) };
});

vi.mock('./orders', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminOrdersRouter: router({}) };
});

vi.mock('./payments', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminPaymentsRouter: router({}) };
});

vi.mock('./plans', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminPlansRouter: router({}) };
});

vi.mock('./ppt', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminPptRouter: router({}) };
});

vi.mock('./redemption', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminRedemptionRouter: router({}) };
});

vi.mock('./referral', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminReferralRouter: router({}) };
});

vi.mock('./settings', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminSettingsRouter: router({}) };
});

vi.mock('./stats', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminStatsRouter: router({}) };
});

vi.mock('./subscriptions', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminSubscriptionsRouter: router({}) };
});

vi.mock('./topupPackages', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminTopUpPackagesRouter: router({}) };
});

vi.mock('./users', async () => {
  const { router } = await import('@/libs/trpc/lambda');

  return { adminUsersRouter: router({}) };
});

const APP_ID = '00000000-0000-4000-8000-000000000001';
const PACKAGE_ID = '00000000-0000-4000-8000-000000000011';
const ORDER_ID = '00000000-0000-4000-8000-000000000021';
const PUBLISHER_ID = '00000000-0000-4000-8000-000000000051';
const PAYOUT_ID = '00000000-0000-4000-8000-000000000061';
const REVENUE_ID = '00000000-0000-4000-8000-000000000071';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000081';

const createDb = () =>
  ({
    query: {
      users: {
        findFirst: vi
          .fn()
          .mockImplementation(async () => ({ banned: false, role: authState.role })),
      },
    },
    transaction: dbMocks.transaction,
  }) as any;

const createCaller = () => {
  vi.mocked(getServerDB).mockResolvedValue(createDb());

  return adminRouter.createCaller({ userId: 'admin-user' } as any);
};

describe('admin module apps router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'admin';
    dbMocks.transaction.mockImplementation(async (callback) => callback(transactionDb));
    externalAuditMock.mockImplementation(async (_ctx, options) => options.effect());
    moduleAppModelMocks.getAdminApp.mockResolvedValue({ id: APP_ID, slug: 'workbench' });
    moduleAppModelMocks.upsertBillingForAdmin.mockResolvedValue({ ok: true });
    moduleAppModelMocks.upsertConfigurationForAdmin.mockResolvedValue({
      ok: true,
      versionId: '00000000-0000-4000-8000-000000000012',
    });
    moduleAppModelMocks.upsertEntitlementsForAdmin.mockResolvedValue({ ok: true });
    moduleAppModelMocks.getAdminPackageSubmission.mockResolvedValue({
      id: PACKAGE_ID,
      reviewStatus: 'pending_review',
    });
    moduleAppModelMocks.listAdminPackageSubmissions.mockResolvedValue({
      items: [{ id: PACKAGE_ID }],
      nextCursor: null,
    });
    moduleAppModelMocks.approvePackageSubmissionForAdmin.mockResolvedValue({
      appId: APP_ID,
      package: { id: PACKAGE_ID, reviewStatus: 'approved' },
      slug: 'workbench',
      versionId: 'version-1',
    });
    buildServiceMocks.approvePackage.mockResolvedValue({
      appId: APP_ID,
      build: { id: 'build-1', status: 'queued' },
      outboundHostPolicies: [],
      package: { id: PACKAGE_ID, reviewStatus: 'approved' },
      slug: 'workbench',
      versionId: 'version-1',
    });
    moduleAppModelMocks.rejectPackageSubmissionForAdmin.mockResolvedValue({
      id: PACKAGE_ID,
      reviewStatus: 'rejected',
    });
    lifecycleMocks.releaseRejectedPackage.mockResolvedValue({
      cleanupQueued: false,
      package: { id: PACKAGE_ID, reviewStatus: 'rejected' },
    });
    moduleAppOrderRevenueMocks.settleOrder.mockResolvedValue({ id: ORDER_ID, status: 'paid' });
    moduleAppOrderRevenueMocks.refundOrder.mockResolvedValue({ id: ORDER_ID, status: 'refunded' });
    mockAppEnv.MODULE_APP_ALIPAY_ENABLED = true;
    mockAppEnv.MODULE_APP_EXECUTION_ENABLED = false;
    mockAppEnv.MODULE_APP_PUBLIC_EXECUTION_ENABLED = false;
    mockAppEnv.MODULE_APP_PUBLISHER_ALLOWLIST = [PUBLISHER_ID];
    mockAppEnv.MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED = true;
    mockAppEnv.MODULE_APP_RUNTIME_INVOCATION_ENABLED = false;
    mockAppEnv.MODULE_APP_RUNTIME_PUBLIC_ORIGIN = undefined;
    mockGetServerPaymentConfig.mockResolvedValue({
      alipay: {
        configured: true,
        enabled: true,
        merchantPrivateKey: 'payment-private-secret',
      },
      enabled: true,
      moduleAppEnabled: true,
      publicBaseUrl: 'https://billing.example.com',
      source: {
        backendManaged: false,
        legacyEnvironmentKeys: ['PAYMENT_ENABLED'],
      },
    });
    mockListEnabledPaymentMethods.mockReturnValue([
      { id: 'alipay', label: 'Alipay', provider: 'alipay' },
      { id: 'zpay_wechat', label: 'Z-Pay WeChat', provider: 'zpay' },
    ]);
    mockGetAllEnabledModels.mockResolvedValue([
      {
        id: 'gpt-secret-model',
        instanceName: 'Private NewAPI Gateway',
        type: 'chat',
      },
      { id: 'image-secret-model', type: 'image' },
    ]);
    moduleAppRuntimeClientMocks.getConfigurationStatus.mockReturnValue({
      internalTokenConfigured: false,
      internalUrlConfigured: true,
    });
    moduleAppRuntimeClientMocks.healthCheck.mockResolvedValue({ status: 'disabled' });
    getServerModuleAppRuntimeConfig.mockResolvedValue({
      configuration: { publicOriginConfigured: false },
      connections: {},
      requestedSwitches: {
        executionEnabled: false,
        invocationEnabled: false,
        publicExecutionEnabled: false,
        scheduleDispatchEnabled: false,
        workflowPrivilegedExecutorsEnabled: false,
      },
      switches: {
        executionEnabled: false,
        invocationEnabled: false,
        publicExecutionEnabled: false,
        scheduleDispatchEnabled: false,
        workflowPrivilegedExecutorsEnabled: false,
      },
    });
    dispatchDueModuleAppSchedules.mockResolvedValue({
      bookkeepingFailed: 0,
      claimed: 2,
      dispatched: 1,
      failed: 1,
    });
    moduleAppPaymentMocks.refundOrder.mockResolvedValue({ id: ORDER_ID, status: 'refunded' });
    moduleAppPaymentMocks.reconcilePayment.mockResolvedValue({ status: 'paid' });
    moduleAppPaymentMocks.reconcilePendingPayments.mockResolvedValue({ count: 0, results: [] });
    moduleAppPaymentMocks.reconcileRefund.mockResolvedValue({ status: 'succeeded' });
    moduleAppPaymentMocks.resolvePendingRefund.mockResolvedValue({
      id: ORDER_ID,
      status: 'refunded',
    });
    moduleAppPaymentModelMocks.getPaymentAttemptByOrderId.mockResolvedValue({ provider: 'zpay' });
    moduleAppPaymentModelMocks.getRefundByOrderId.mockResolvedValue({
      providerRefundId: 'zpay-refund-1',
    });
    moduleAppPaymentModelMocks.acknowledgeDiscrepancy.mockResolvedValue({ status: 'resolved' });
    moduleAppPaymentModelMocks.listDiscrepancies.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppPublisherMocks.createPublisher.mockResolvedValue({
      id: PUBLISHER_ID,
      status: 'pending',
    });
    moduleAppPublisherMocks.verifyPublisher.mockResolvedValue({
      id: PUBLISHER_ID,
      status: 'verified',
    });
    moduleAppPublisherMocks.suspendPublisher.mockResolvedValue({
      id: PUBLISHER_ID,
      status: 'suspended',
    });
    moduleAppPublisherMocks.assignApplication.mockResolvedValue({
      id: APP_ID,
      publisherId: PUBLISHER_ID,
    });
    moduleAppPublisherMocks.listPublishers.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppPayoutMocks.createEligibleBatch.mockResolvedValue({
      id: PAYOUT_ID,
      status: 'eligible',
    });
    moduleAppPayoutMocks.getBatch.mockResolvedValue({
      id: PAYOUT_ID,
      publisherId: PUBLISHER_ID,
      status: 'eligible',
    });
    moduleAppPayoutMocks.transitionBatch.mockResolvedValue({ id: PAYOUT_ID, status: 'processing' });
    moduleAppPayoutMocks.recordManualAlipayPayout.mockResolvedValue({
      id: PAYOUT_ID,
      status: 'paid',
      transactionNo: 'alipay-txn-1',
    });
    moduleAppPayoutMocks.listPayouts.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listApplications.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listArtifacts.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listAuditEvents.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listInstalls.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listPackages.mockResolvedValue({
      items: [{ id: PACKAGE_ID }],
      nextCursor: null,
    });
    moduleAppReadModelMocks.listPaymentDiagnostics.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    moduleAppReadModelMocks.listPayouts.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listPublishers.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listRecords.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listRevenue.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.listRuns.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppReadModelMocks.getRuntimeScheduleDiagnostics.mockResolvedValue({
      activeClaims: 1,
      claimableSchedules: 2,
      enabledSchedules: 4,
      failedScheduledRuns24h: 1,
      lastScheduledRunAt: new Date('2026-07-12T00:30:00.000Z'),
      oldestClaimableAt: new Date('2026-07-12T00:00:00.000Z'),
      staleClaims: 1,
    });
    moduleAppRevenueMocks.listRevenue.mockResolvedValue({ items: [], nextCursor: null });
    moduleAppRevenueMocks.settleBatchWithAudit.mockResolvedValue({
      batchId: '00000000-0000-4000-8000-000000000031',
      count: 2,
      settledAt: new Date('2026-07-11T00:00:00.000Z'),
    });
    lifecycleMocks.rescanLegacyPackage.mockResolvedValue({
      cleanupQueued: false,
      issueCodes: [],
      packageId: PACKAGE_ID,
      scanStatus: 'clean',
    });
    moduleAppModelMocks.setStatus.mockResolvedValue({ ok: true });
    moduleAppModelMocks.upsertAppForAdmin.mockResolvedValue({ id: APP_ID, slug: 'workbench' });
    moduleAppCommerceMocks.createProduct.mockResolvedValue({ id: PRODUCT_ID });
    moduleAppCommerceMocks.listProducts.mockResolvedValue([{ productId: PRODUCT_ID }]);
    moduleAppCommerceMocks.updateProduct.mockResolvedValue({
      product: { id: PRODUCT_ID, status: 'active' },
    });
  });

  it('registers admin.moduleApps', () => {
    expect(adminRouter._def.record.moduleApps).toBeDefined();
  });

  it('returns bounded, secret-free runtime diagnostics without changing rollout state', async () => {
    mockAppEnv.MODULE_APP_EXECUTION_ENABLED = true;
    mockAppEnv.MODULE_APP_PUBLIC_EXECUTION_ENABLED = true;
    mockAppEnv.MODULE_APP_RUNTIME_INVOCATION_ENABLED = true;
    mockAppEnv.MODULE_APP_RUNTIME_PUBLIC_ORIGIN = 'https://runtime.example.com';
    moduleAppRuntimeClientMocks.getConfigurationStatus.mockReturnValue({
      internalTokenConfigured: true,
      internalUrlConfigured: true,
    });
    moduleAppRuntimeClientMocks.healthCheck.mockResolvedValue({
      code: 'MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE',
      status: 'unavailable',
    });
    const requestedSwitches = {
      executionEnabled: true,
      invocationEnabled: true,
      publicExecutionEnabled: true,
      scheduleDispatchEnabled: true,
      workflowPrivilegedExecutorsEnabled: true,
    };
    const switches = { ...requestedSwitches };
    getServerModuleAppRuntimeConfig.mockResolvedValueOnce({
      configuration: { publicOriginConfigured: true },
      connections: {
        internalToken: 'runtime-internal-token',
        internalUrl: 'http://module-runtime:3210',
        publicOrigin: 'https://runtime.example.com',
      },
      requestedSwitches,
      switches,
    });

    const result = await createCaller().moduleApps.getRuntimeDiagnostics();

    expect(result).toEqual({
      configuration: {
        internalTokenConfigured: true,
        internalUrlConfigured: true,
        publicOriginConfigured: true,
      },
      platformGateways: {
        ai: {
          configured: true,
          enabledChatModelCount: 1,
        },
        payments: {
          configured: true,
          enabled: true,
          methods: ['alipay', 'zpay_wechat'],
          moduleAppEnabled: true,
          publicOriginConfigured: true,
          source: {
            backendManaged: false,
            legacyEnvironmentKeyCount: 1,
          },
        },
      },
      probe: {
        code: 'MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE',
        status: 'unavailable',
      },
      requestedSwitches,
      scheduler: {
        activeClaims: 1,
        claimableSchedules: 2,
        enabledSchedules: 4,
        failedScheduledRuns24h: 1,
        lastScheduledRunAt: new Date('2026-07-12T00:30:00.000Z'),
        oldestClaimableAt: new Date('2026-07-12T00:00:00.000Z'),
        staleClaims: 1,
        status: 'available',
      },
      switches,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('runtime-internal-token');
    expect(serialized).not.toContain('billing.example.com');
    expect(serialized).not.toContain('payment-private-secret');
    expect(serialized).not.toContain('gpt-secret-model');
    expect(serialized).not.toContain('Private NewAPI Gateway');
    expect(serialized).not.toContain('PAYMENT_ENABLED');
    expect(mockGetAllEnabledModels).toHaveBeenCalledWith(expect.anything());
    expect(mockListEnabledPaymentMethods).toHaveBeenCalledWith(
      expect.objectContaining({ moduleAppEnabled: true }),
      'module_app',
    );
    expect(moduleAppRuntimeClientMocks.healthCheck).toHaveBeenCalledOnce();
  });

  it('keeps runtime diagnostics available when scheduler telemetry cannot be read', async () => {
    moduleAppReadModelMocks.getRuntimeScheduleDiagnostics.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    const result = await createCaller().moduleApps.getRuntimeDiagnostics();

    expect(result.probe).toEqual({ status: 'disabled' });
    expect(result.scheduler).toEqual({
      activeClaims: null,
      claimableSchedules: null,
      enabledSchedules: null,
      failedScheduledRuns24h: null,
      lastScheduledRunAt: null,
      oldestClaimableAt: null,
      staleClaims: null,
      status: 'unavailable',
    });
  });

  it('runs a bounded, audited schedule dispatch through the governed backend switch', async () => {
    const result = await createCaller().moduleApps.dispatchSchedulesNow();

    expect(result).toEqual({ bookkeepingFailed: 0, claimed: 2, dispatched: 1, failed: 1 });
    expect(dispatchDueModuleAppSchedules).toHaveBeenCalledWith({
      batchSize: 25,
      db: expect.anything(),
    });
    const options = externalAuditMock.mock.calls.at(-1)?.[1];
    expect(options.audit('failed', result)).toEqual({
      action: 'module_app.schedule_dispatch_executed',
      payload: {
        batchSize: 25,
        bookkeepingFailed: 0,
        claimed: 2,
        dispatched: 1,
        failed: 1,
        terminalStatus: 'failed',
      },
      resourceId: 'module-app-scheduler',
      resourceType: 'moduleAppScheduleDispatcher',
    });
    expect(options.terminalStatus(result)).toBe('failed');
  });

  it('rejects content admins from Module App governance procedures', async () => {
    authState.role = 'content_admin';
    const caller = createCaller();

    await expect(caller.moduleApps.list({ limit: 20 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.moduleApps.getRuntimeDiagnostics()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.moduleApps.dispatchSchedulesNow()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.moduleApps.publish({ appId: APP_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      caller.moduleApps.exportPaymentReconciliation({ limit: 20 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows finance admins to inspect finance views without governance writes', async () => {
    authState.role = 'finance_admin';
    const caller = createCaller();

    await expect(caller.moduleApps.list({ limit: 20 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.moduleApps.listPublishers({ limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(caller.moduleApps.listPaymentDiagnostics({})).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(caller.moduleApps.exportPaymentReconciliation({ limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(caller.moduleApps.publish({ appId: APP_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('allows module admins to govern publishers without finance access', async () => {
    authState.role = 'module_admin';
    const caller = createCaller();

    await expect(caller.moduleApps.listAuditEvents({ appId: APP_ID, limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(caller.moduleApps.listPublishers({ limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(caller.moduleApps.listPaymentDiagnostics({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('writes an audit log when upserting a module app', async () => {
    const caller = createCaller();

    const result = await caller.moduleApps.upsert({
      actions: [],
      appType: 'standard_app',
      billing: {
        chargeMode: 'free',
        defaultMultiplier: 1,
        externalApiCostCredits: 0,
        failureFixedFeePolicy: 'do_not_charge',
        fixedServiceFeeCredits: 0,
      },
      category: 'office',
      description: 'Simple workbench app.',
      displayName: 'Workbench',
      icon: 'Blocks',
      pages: [],
      slug: 'workbench',
      status: 'draft',
      tags: [],
    });

    expect(result).toEqual({ id: APP_ID, slug: 'workbench' });
    expect(moduleAppModelMocks.upsertAppForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Workbench', slug: 'workbench' }),
    );
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        eventType: 'module_app.upserted',
        resourceId: APP_ID,
        resourceType: 'moduleApp',
      }),
    );
  });

  it('creates, lists, and updates module app products through Module App permissions', async () => {
    const caller = createCaller();
    const price = { amount: 88, currency: 'CNY' as const };

    await expect(
      caller.moduleApps.createProduct({
        appId: APP_ID,
        licenseScope: 'personal',
        price,
        productKey: 'pro-lifetime',
        productType: 'one_time',
      }),
    ).resolves.toEqual({ id: PRODUCT_ID });
    await expect(caller.moduleApps.listProducts({ appId: APP_ID })).resolves.toEqual([
      { productId: PRODUCT_ID },
    ]);
    await expect(
      caller.moduleApps.updateProduct({
        licenseScope: 'personal',
        price: { amount: 120, currency: 'CNY' },
        productId: PRODUCT_ID,
        productType: 'one_time',
        status: 'active',
      }),
    ).resolves.toMatchObject({ product: { id: PRODUCT_ID } });

    expect(moduleAppCommerceMocks.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP_ID, price, productKey: 'pro-lifetime' }),
    );
    expect(moduleAppCommerceMocks.listProducts).toHaveBeenCalledWith({ appId: APP_ID });
    expect(moduleAppCommerceMocks.updateProduct).toHaveBeenCalledWith(
      expect.objectContaining({ price: { amount: 120, currency: 'CNY' }, productId: PRODUCT_ID }),
    );
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        db: transactionDb,
        eventType: 'module_app.product_created',
        resourceId: PRODUCT_ID,
      }),
    );
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        db: transactionDb,
        eventType: 'module_app.product_updated',
        resourceId: PRODUCT_ID,
      }),
    );
    expect(dbMocks.transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects product definitions that cannot produce a valid order snapshot', async () => {
    const caller = createCaller();

    await expect(
      caller.moduleApps.createProduct({
        appId: APP_ID,
        licenseScope: 'personal',
        price: { amount: 1, currency: 'CNY' },
        productKey: 'invalid-free',
        productType: 'free',
      }),
    ).rejects.toThrow();
    await expect(
      caller.moduleApps.createProduct({
        appId: APP_ID,
        licenseScope: 'personal',
        price: { amount: 10.5, currency: 'EUR' as 'CNY' },
        productKey: 'invalid-subscription',
        productType: 'subscription',
      }),
    ).rejects.toThrow();
    await expect(
      caller.moduleApps.createProduct({
        appId: APP_ID,
        licenseScope: 'workspace_seat',
        price: { amount: 10, currency: 'USD' },
        productKey: 'invalid-seats',
        productType: 'one_time',
      }),
    ).rejects.toThrow();
    expect(moduleAppCommerceMocks.createProduct).not.toHaveBeenCalled();
  });

  it('writes an audit log when publishing a module app', async () => {
    const caller = createCaller();

    await expect(caller.moduleApps.publish({ appId: APP_ID })).resolves.toEqual({ ok: true });

    expect(moduleAppModelMocks.setStatus).toHaveBeenCalledWith({
      appId: APP_ID,
      status: 'published',
    });
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        eventType: 'module_app.published',
        resourceId: APP_ID,
        resourceType: 'moduleApp',
      }),
    );
  });

  it('does not publish or audit a missing module app', async () => {
    moduleAppModelMocks.getAdminApp.mockResolvedValue(null);
    const caller = createCaller();

    await expect(caller.moduleApps.publish({ appId: APP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'module_app_not_found',
    });

    expect(moduleAppModelMocks.setStatus).not.toHaveBeenCalled();
    expect(writeModuleAppAuditLog).not.toHaveBeenCalled();
  });

  it('maps an executable build gate to a precondition error without a success audit', async () => {
    moduleAppModelMocks.setStatus.mockRejectedValueOnce(new Error('MODULE_APP_BUILD_NOT_READY'));
    const caller = createCaller();

    await expect(caller.moduleApps.publish({ appId: APP_ID })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'MODULE_APP_BUILD_NOT_READY',
    });
    expect(writeModuleAppAuditLog).not.toHaveBeenCalled();
  });

  it('lists module app package submissions for review', async () => {
    const caller = createCaller();

    await expect(
      caller.moduleApps.listPackages({ reviewStatus: 'pending_review' }),
    ).resolves.toEqual({
      items: [{ id: PACKAGE_ID }],
      nextCursor: null,
    });

    expect(moduleAppReadModelMocks.listPackages).toHaveBeenCalledWith({
      cursor: 0,
      limit: 50,
      reviewStatus: 'pending_review',
    });
  });

  it('approves a package submission and writes an audit log', async () => {
    const caller = createCaller();

    await expect(
      caller.moduleApps.approvePackage({ outboundHostPolicies: [], packageId: PACKAGE_ID }),
    ).resolves.toEqual({
      appId: APP_ID,
      build: { id: 'build-1', status: 'queued' },
      outboundHostPolicies: [],
      package: { id: PACKAGE_ID, reviewStatus: 'approved' },
      slug: 'workbench',
      versionId: 'version-1',
    });

    expect(buildServiceMocks.approvePackage).toHaveBeenCalledWith({
      outboundHostPolicies: [],
      packageId: PACKAGE_ID,
      reviewedByUserId: 'admin-user',
    });
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        eventType: 'module_app.package_approved',
        metadata: expect.objectContaining({
          outboundHostPolicies: [],
          outboundHostPurposes: [],
        }),
        resourceId: APP_ID,
        resourceType: 'moduleApp',
      }),
    );
  });

  it('maps a non-clean package approval to a precondition error', async () => {
    buildServiceMocks.approvePackage.mockRejectedValueOnce(
      new Error('MODULE_APP_PACKAGE_SCAN_NOT_CLEAN'),
    );
    const caller = createCaller();

    await expect(
      caller.moduleApps.approvePackage({ outboundHostPolicies: [], packageId: PACKAGE_ID }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'MODULE_APP_PACKAGE_SCAN_NOT_CLEAN',
    });
  });

  it.each([
    ['MODULE_APP_PACKAGE_SUBMITTER_REQUIRED', 'PRECONDITION_FAILED'],
    ['MODULE_APP_PACKAGE_PUBLISHER_NOT_VERIFIED', 'PRECONDITION_FAILED'],
    ['MODULE_APP_PACKAGE_APP_OWNERSHIP_MISMATCH', 'CONFLICT'],
    ['MODULE_APP_OUTBOUND_HOST_CLASSIFICATION_REQUIRED', 'BAD_REQUEST'],
  ] as const)('maps package review error %s to %s', async (message, code) => {
    buildServiceMocks.approvePackage.mockRejectedValueOnce(new Error(message));
    const caller = createCaller();

    await expect(
      caller.moduleApps.approvePackage({ outboundHostPolicies: [], packageId: PACKAGE_ID }),
    ).rejects.toMatchObject({ code, message });
    expect(writeModuleAppAuditLog).not.toHaveBeenCalled();
  });

  it('rescans a legacy package and writes an audit log', async () => {
    const caller = createCaller();

    await expect(caller.moduleApps.rescanPackage({ packageId: PACKAGE_ID })).resolves.toEqual({
      cleanupQueued: false,
      issueCodes: [],
      packageId: PACKAGE_ID,
      scanStatus: 'clean',
    });

    expect(lifecycleMocks.rescanLegacyPackage).toHaveBeenCalledWith({
      packageId: PACKAGE_ID,
      reviewedByUserId: 'admin-user',
    });
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        eventType: 'module_app.package_rescanned',
        resourceId: PACKAGE_ID,
        resourceType: 'moduleAppPackage',
      }),
    );
  });

  it('maps a rescan remediation error without writing a success audit', async () => {
    lifecycleMocks.rescanLegacyPackage.mockRejectedValueOnce(
      new Error('MODULE_APP_PACKAGE_RESCAN_OBJECT_MISSING'),
    );
    const caller = createCaller();

    await expect(caller.moduleApps.rescanPackage({ packageId: PACKAGE_ID })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_PACKAGE_RESCAN_OBJECT_MISSING',
    });
    expect(writeModuleAppAuditLog).not.toHaveBeenCalled();
  });

  it('rejects a package submission and writes an audit log', async () => {
    const caller = createCaller();

    await expect(
      caller.moduleApps.rejectPackage({ packageId: PACKAGE_ID, reason: 'Unsafe manifest' }),
    ).resolves.toEqual({
      cleanupQueued: false,
      package: { id: PACKAGE_ID, reviewStatus: 'rejected' },
    });

    expect(lifecycleMocks.releaseRejectedPackage).toHaveBeenCalledWith({
      packageId: PACKAGE_ID,
      reason: 'Unsafe manifest',
      reviewedByUserId: 'admin-user',
    });
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        eventType: 'module_app.package_rejected',
        resourceId: PACKAGE_ID,
        resourceType: 'moduleAppPackage',
      }),
    );
  });

  it('settles a module app order through finance permission and audits it', async () => {
    const caller = createCaller();
    await expect(
      caller.moduleApps.settleOrder({ orderId: ORDER_ID, paymentReference: 'manual:admin:1' }),
    ).resolves.toMatchObject({ status: 'paid' });

    expect(moduleAppOrderRevenueMocks.settleOrder).toHaveBeenCalledWith({
      actorUserId: 'admin-user',
      orderId: ORDER_ID,
      paymentReference: 'manual:admin:1',
    });
  });

  it('refunds a paid order with an actor and reason audit snapshot', async () => {
    const caller = createCaller();
    await expect(
      caller.moduleApps.refundOrder({ orderId: ORDER_ID, reason: 'customer_request' } as any),
    ).rejects.toBeTruthy();
    await expect(
      caller.moduleApps.refundOrder({
        offlineRefundReference: 'bank-transfer-1',
        orderId: ORDER_ID,
        reason: 'customer_request',
      } as any),
    ).resolves.toMatchObject({ status: 'refunded' });

    expect(moduleAppOrderRevenueMocks.refundOrder).toHaveBeenCalledWith({
      actorUserId: 'admin-user',
      orderId: ORDER_ID,
      reason: 'customer_request',
      refundReference: 'offline:bank-transfer-1',
    });
  });

  it('requests an Alipay refund through the provider payment service', async () => {
    const caller = createCaller();
    await expect(
      caller.moduleApps.refundPaymentOrder({ orderId: ORDER_ID, reason: 'customer_request' }),
    ).resolves.toMatchObject({ status: 'refunded' });
    expect(moduleAppPaymentMocks.refundOrder).toHaveBeenCalledWith({
      actorUserId: 'admin-user',
      orderId: ORDER_ID,
      reason: 'customer_request',
    });
    expect(runRequiredAdminAuditExternalEffect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ audit: expect.any(Function), effect: expect.any(Function) }),
    );
  });

  it('manually resolves a pending provider refund through required audit', async () => {
    const caller = createCaller();
    await expect(
      caller.moduleApps.resolvePaymentRefund({
        note: 'checked Z-Pay merchant portal',
        orderId: ORDER_ID,
        resolution: 'succeeded',
      }),
    ).resolves.toMatchObject({ status: 'refunded' });
    expect(moduleAppPaymentMocks.resolvePendingRefund).toHaveBeenCalledWith({
      actorUserId: 'admin-user',
      orderId: ORDER_ID,
      resolution: 'succeeded',
    });
    expect(mockGetServerPaymentConfig).not.toHaveBeenCalled();
    expect(mockCreatePaymentAdapter).not.toHaveBeenCalled();
    expect(runRequiredAdminAuditExternalEffect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ audit: expect.any(Function), effect: expect.any(Function) }),
    );
    const options = vi.mocked(runRequiredAdminAuditExternalEffect).mock.calls.at(-1)?.[1];
    expect(await options?.audit('succeeded', { status: 'refunded' })).toMatchObject({
      action: 'module_app.payment_refund_manually_resolved',
      payload: {
        note: 'checked Z-Pay merchant portal',
        provider: 'zpay',
        refundReference: 'zpay-refund-1',
        resolution: 'succeeded',
        resultStatus: 'refunded',
        terminalStatus: 'succeeded',
      },
    });
  });

  it('does not call the refund provider when its required started audit fails', async () => {
    const startedFailure = new Error('started audit failed');
    externalAuditMock.mockRejectedValueOnce(startedFailure);
    const caller = createCaller();

    await expect(
      caller.moduleApps.refundPaymentOrder({ orderId: ORDER_ID, reason: 'customer_request' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: startedFailure.message });

    expect(moduleAppPaymentMocks.refundOrder).not.toHaveBeenCalled();
  });

  it('runs bounded payment reconciliation operations through finance permission', async () => {
    const caller = createCaller();
    await expect(caller.moduleApps.retryPaymentQuery({ outTradeNo: 'out-1' })).resolves.toEqual({
      status: 'paid',
    });
    await expect(caller.moduleApps.reconcilePendingPayments({ limit: 25 })).resolves.toEqual({
      count: 0,
      results: [],
    });
    await expect(caller.moduleApps.retryRefundStatus({ orderId: ORDER_ID })).resolves.toEqual({
      status: 'succeeded',
    });
    expect(moduleAppPaymentMocks.reconcilePayment).toHaveBeenCalledWith({ outTradeNo: 'out-1' });
    expect(moduleAppPaymentMocks.reconcilePendingPayments).toHaveBeenCalledWith({ limit: 25 });
    expect(moduleAppPaymentMocks.reconcileRefund).toHaveBeenCalledWith({
      actorUserId: 'admin-user',
      orderId: ORDER_ID,
    });
    const lifecycleActions = await Promise.all(
      vi
        .mocked(runRequiredAdminAuditExternalEffect)
        .mock.calls.map(async ([, options]) => (await options.audit('started')).action),
    );
    expect(lifecycleActions).toEqual([
      'module_app.payment_query_retried',
      'module_app.pending_payments_reconciled',
      'module_app.refund_status_retried',
    ]);
  });

  it('classifies partial payment reconciliation errors as a failed terminal lifecycle', async () => {
    const result = {
      count: 1,
      results: [{ error: 'provider unavailable', outTradeNo: 'out-private' }],
    };
    moduleAppPaymentMocks.reconcilePendingPayments.mockResolvedValueOnce(result);

    await expect(
      createCaller().moduleApps.reconcilePendingPayments({ limit: 25 }),
    ).resolves.toEqual(result);

    const options = vi.mocked(runRequiredAdminAuditExternalEffect).mock.calls[0]?.[1];
    expect(options?.terminalStatus?.(result)).toBe('failed');
    expect(await options?.audit('failed', result)).toMatchObject({
      action: 'module_app.pending_payments_reconciled',
      payload: { count: 1, limit: 25, terminalStatus: 'failed' },
    });
  });

  it('acknowledges and exports bounded payment discrepancies', async () => {
    const caller = createCaller();
    const discrepancyId = '00000000-0000-4000-8000-000000000041';
    await expect(
      caller.moduleApps.acknowledgePaymentDiscrepancy({ discrepancyId }),
    ).resolves.toMatchObject({ status: 'resolved' });
    await expect(
      caller.moduleApps.exportPaymentReconciliation({ limit: 500, status: 'open' }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(moduleAppPaymentModelMocks.listDiscrepancies).toHaveBeenCalledWith({
      cursor: 0,
      limit: 500,
      status: 'open',
    });
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        db: transactionDb,
        eventType: 'module_app.payment_discrepancy_acknowledged',
        resourceId: discrepancyId,
      }),
    );
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        eventType: 'module_app.payment_reconciliation_exported',
        metadata: {
          count: 0,
          filters: { cursor: 0, limit: 500, status: 'open' },
        },
        resourceId: 'payment-reconciliation',
        resourceType: 'moduleAppPaymentReconciliation',
      }),
    );
  });

  it('commits billing and entitlement upserts with their Module App audits', async () => {
    const caller = createCaller();
    const billing = {
      chargeMode: 'free' as const,
      defaultMultiplier: 1,
      externalApiCostCredits: 0,
      failureFixedFeePolicy: 'do_not_charge' as const,
      fixedServiceFeeCredits: 0,
    };
    const entitlements = [
      {
        discountPercent: 20,
        freeQuotaCredits: 100,
        installable: false,
        plan: 'premium',
        runnable: true,
        visible: true,
      },
    ];

    await expect(caller.moduleApps.upsertBilling({ appId: APP_ID, billing })).resolves.toEqual({
      ok: true,
    });
    await expect(
      caller.moduleApps.upsertEntitlements({ appId: APP_ID, entitlements }),
    ).resolves.toEqual({ ok: true });

    expect(dbMocks.transaction).toHaveBeenCalledTimes(2);
    expect(ModuleAppModel).toHaveBeenCalledWith(transactionDb);
    expect(moduleAppModelMocks.upsertBillingForAdmin).toHaveBeenCalledWith({
      appId: APP_ID,
      billing,
    });
    expect(moduleAppModelMocks.upsertEntitlementsForAdmin).toHaveBeenCalledWith(
      { appId: APP_ID, entitlements },
      transactionDb,
    );
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        db: transactionDb,
        eventType: 'module_app.billing_upserted',
        resourceId: APP_ID,
      }),
    );
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        db: transactionDb,
        eventType: 'module_app.entitlements_upserted',
        resourceId: APP_ID,
      }),
    );
  });

  it('commits pages and actions together with one configuration audit', async () => {
    const caller = createCaller();
    const input = {
      actions: [],
      appId: APP_ID,
      expectedVersionId: '00000000-0000-4000-8000-000000000011',
      pages: [],
    };

    await expect(caller.moduleApps.upsertConfiguration(input)).resolves.toEqual({
      ok: true,
      versionId: '00000000-0000-4000-8000-000000000012',
    });

    expect(dbMocks.transaction).toHaveBeenCalledTimes(1);
    expect(moduleAppModelMocks.upsertConfigurationForAdmin).toHaveBeenCalledWith(
      input,
      transactionDb,
    );
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        db: transactionDb,
        eventType: 'module_app.configuration_upserted',
        metadata: { actions: 0, pages: 0 },
        resourceId: APP_ID,
      }),
    );
  });

  it('reports stale configuration revisions without writing a success audit', async () => {
    const conflict = new Error('MODULE_APP_CONFIGURATION_CONFLICT');
    moduleAppModelMocks.upsertConfigurationForAdmin.mockRejectedValueOnce(conflict);
    const caller = createCaller();

    await expect(
      caller.moduleApps.upsertConfiguration({
        actions: [],
        appId: APP_ID,
        expectedVersionId: '00000000-0000-4000-8000-000000000011',
        pages: [],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'MODULE_APP_CONFIGURATION_CONFLICT' });
    expect(writeModuleAppAuditLog).not.toHaveBeenCalled();
  });

  it('lists bounded module app revenue entries', async () => {
    const caller = createCaller();

    await expect(
      caller.moduleApps.listRevenue({
        limit: 25,
        publisherUserId: 'publisher-1',
        status: 'pending',
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    expect(moduleAppReadModelMocks.listRevenue).toHaveBeenCalledWith({
      cursor: 0,
      limit: 25,
      publisherUserId: 'publisher-1',
      status: 'pending',
    });
  });

  it('settles a revenue batch through finance permission with an audit snapshot', async () => {
    const caller = createCaller();
    const entryIds = [
      '00000000-0000-4000-8000-000000000041',
      '00000000-0000-4000-8000-000000000042',
    ];

    await expect(caller.moduleApps.settleRevenueBatch({ entryIds })).resolves.toMatchObject({
      batchId: '00000000-0000-4000-8000-000000000031',
      count: 2,
    });

    expect(moduleAppRevenueMocks.settleBatchWithAudit).toHaveBeenCalledWith({
      actorUserId: 'admin-user',
      entryIds,
    });
  });

  it('manages stable publisher ownership through admin procedures and audits mutations', async () => {
    const caller = createCaller();

    await caller.moduleApps.createPublisher({
      displayName: 'Verified Studio',
      recipientMask: 'ali***@example.com',
      userId: 'publisher-user',
    });
    await caller.moduleApps.verifyPublisher({
      publisherId: PUBLISHER_ID,
      verificationMetadata: { ticket: 'review-1' },
    });
    await caller.moduleApps.assignPublisher({ appId: APP_ID, publisherId: PUBLISHER_ID });
    await caller.moduleApps.suspendPublisher({ publisherId: PUBLISHER_ID });
    await expect(
      caller.moduleApps.listPublishers({ limit: 25, status: 'verified' }),
    ).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(moduleAppReadModelMocks.listPublishers).toHaveBeenCalledWith({
      cursor: 0,
      limit: 25,
      status: 'verified',
    });

    expect(moduleAppPublisherMocks.assignApplication).toHaveBeenCalledWith({
      appId: APP_ID,
      publisherId: PUBLISHER_ID,
    });
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        eventType: 'module_app.publisher_suspended',
        resourceId: PUBLISHER_ID,
        resourceType: 'moduleAppPublisher',
      }),
    );
  });

  it('creates, transitions, and records manual Alipay payouts with audit evidence', async () => {
    const caller = createCaller();

    await caller.moduleApps.createPayoutBatch({
      publisherId: PUBLISHER_ID,
      requestedAmount: 80,
      revenueEntryIds: [REVENUE_ID],
    });
    await caller.moduleApps.transitionPayoutBatch({
      batchId: PAYOUT_ID,
      status: 'processing',
    });
    await caller.moduleApps.recordManualAlipayPayout({
      batchId: PAYOUT_ID,
      evidenceReference: 's3://evidence/payout-1.pdf',
      recipientMask: 'ali***@example.com',
      transactionNo: 'alipay-txn-1',
    });
    await expect(
      caller.moduleApps.listPayouts({ publisherId: PUBLISHER_ID, status: 'paid' }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(moduleAppReadModelMocks.listPayouts).toHaveBeenCalledWith({
      cursor: 0,
      limit: 50,
      publisherId: PUBLISHER_ID,
      status: 'paid',
    });

    expect(moduleAppPayoutMocks.recordManualAlipayPayout).toHaveBeenCalledWith({
      actorUserId: 'admin-user',
      batchId: PAYOUT_ID,
      evidenceReference: 's3://evidence/payout-1.pdf',
      recipientMask: 'ali***@example.com',
      transactionNo: 'alipay-txn-1',
    });
    expect(recordModuleAppPayoutState).toHaveBeenCalledWith('eligible');
    expect(recordModuleAppPayoutState).toHaveBeenCalledWith('processing');
    expect(recordModuleAppPayoutState).toHaveBeenCalledWith('paid');
    expect(writeModuleAppAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user',
        db: transactionDb,
        eventType: 'module_app.payout_paid',
        resourceId: PAYOUT_ID,
        resourceType: 'moduleAppPayout',
      }),
    );
  });

  it('keeps payout reads available while disabled and blocks mutations before model writes', async () => {
    mockAppEnv.MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED = false;
    const caller = createCaller();

    await expect(caller.moduleApps.listPayouts({ publisherId: PUBLISHER_ID })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(
      caller.moduleApps.createPayoutBatch({
        publisherId: PUBLISHER_ID,
        requestedAmount: 80,
        revenueEntryIds: [REVENUE_ID],
      }),
    ).rejects.toThrow('MODULE_APP_PUBLISHER_PAYOUT_RECORDING_DISABLED');
    expect(moduleAppPayoutMocks.createEligibleBatch).not.toHaveBeenCalled();
  });

  it('rejects payout mutations outside the publisher rollout allowlist', async () => {
    mockAppEnv.MODULE_APP_PUBLISHER_ALLOWLIST = [];
    const caller = createCaller();

    await expect(
      caller.moduleApps.transitionPayoutBatch({ batchId: PAYOUT_ID, status: 'processing' }),
    ).rejects.toThrow('MODULE_APP_ROLLOUT_NOT_ALLOWED');
    expect(moduleAppPayoutMocks.transitionBatch).not.toHaveBeenCalled();
  });

  it('lists stable-cursor application and payment diagnostics with server filters', async () => {
    const caller = createCaller();
    const cursor = Buffer.from('cursor').toString('base64url');

    await caller.moduleApps.list({
      cursor,
      publisherId: PUBLISHER_ID,
      query: `${' workspace '.repeat(20)}`,
      sort: 'updated_desc',
      status: 'published',
    });
    await caller.moduleApps.listPaymentDiagnostics({
      appId: APP_ID,
      discrepancyStatus: 'open',
      paymentStatus: 'paid',
      refundStatus: 'succeeded',
    });

    expect(moduleAppReadModelMocks.listApplications).toHaveBeenCalledWith({
      cursor,
      limit: 50,
      publisherId: PUBLISHER_ID,
      query: 'workspace '.repeat(8).trim(),
      sort: 'updated_desc',
      status: 'published',
    });
    expect(moduleAppReadModelMocks.listPaymentDiagnostics).toHaveBeenCalledWith({
      appId: APP_ID,
      cursor: 0,
      discrepancyStatus: 'open',
      limit: 50,
      paymentStatus: 'paid',
      refundStatus: 'succeeded',
    });
  });
});
