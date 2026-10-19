import {
  ADMIN_COMMANDS,
  type AdminCommandEnvelope,
  type AdminRole,
  type DesktopBuildAssetKind,
  type DesktopBuildAssetManifest,
  type DesktopBuildProfilePayload,
  type ModuleAppPayoutStatus,
  type PaymentProvider,
  type Plans,
} from '@lobechat/types';

import { getAdminSettingsWriteSWRKeys } from '@/const/adminCacheKeys';
import {
  type AppSettingKey,
  type AppSettingsSection,
  getAppSettingsSectionForKey,
} from '@/const/appSettingsRegistry';
import { normalizeMobileConfig } from '@/const/mobileConfig';
import { mutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import type { SubscriptionCycleType } from '@/types/business';

type AiProviderModelType =
  'chat' | 'embedding' | 'tts' | 'stt' | 'image' | 'video' | 'text2music' | 'realtime';

type NewapiModelType = AiProviderModelType;
const impersonationBoundary = ADMIN_COMMANDS['user.impersonate.attempt'].serverBoundary;

type AdminModelApiProviderType =
  | 'newapi'
  | 'openai-compatible'
  | 'openai'
  | 'claude'
  | 'deepseek'
  | 'aliyun'
  | 'opencode-go'
  | 'siliconflow';

type AdminAuditQueryParams = {
  action?: string;
  actorUserId?: string;
  from?: Date | string;
  resourceId?: string;
  resourceType?: string;
  targetUserId?: string;
  to?: Date | string;
};

const normalizeAdminAuditQueryParams = <T extends AdminAuditQueryParams>(params: T) => ({
  ...params,
  from: typeof params.from === 'string' ? new Date(params.from) : params.from,
  to: typeof params.to === 'string' ? new Date(params.to) : params.to,
});

type AdminSettingsSectionResponse = Awaited<
  ReturnType<typeof lambdaClient.admin.settings.getSection.query>
>;

export type AdminSettingsSectionData<Section extends AppSettingsSection> = Extract<
  AdminSettingsSectionResponse,
  { section: Section }
>;

export type AdminSettingsSaveErrorDetails = {
  code?: string;
  correlationId?: string;
  isConflict: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

export const getAdminSettingsSaveErrorDetails = (error: unknown): AdminSettingsSaveErrorDetails => {
  const root = asRecord(error);
  const data = asRecord(root?.data);
  const shape = asRecord(root?.shape);
  const shapeData = asRecord(shape?.data);
  const errorData = asRecord(data?.errorData) ?? asRecord(shapeData?.errorData);
  const message = typeof root?.message === 'string' ? root.message : '';
  const code =
    typeof data?.code === 'string'
      ? data.code
      : typeof shapeData?.code === 'string'
        ? shapeData.code
        : undefined;
  const correlationId =
    typeof errorData?.correlationId === 'string' ? errorData.correlationId : undefined;

  return {
    code,
    correlationId,
    isConflict: code === 'CONFLICT' || message.includes('APP_SETTINGS_REVISION_CONFLICT'),
  };
};

export class AdminSettingsRevisionConflictError extends Error {
  readonly code = 'APP_SETTINGS_REVISION_CONFLICT';

  constructor(
    readonly details: AdminSettingsSaveErrorDetails & { sections: AppSettingsSection[] },
    options?: ErrorOptions,
  ) {
    super('APP_SETTINGS_REVISION_CONFLICT', options);
    this.name = 'AdminSettingsRevisionConflictError';
  }
}

const invalidateAdminSettingsWrites = async (sections: readonly AppSettingsSection[]) => {
  for (const key of getAdminSettingsWriteSWRKeys(sections)) await mutate(key);
};

class AdminCommercialService {
  private appSettingRevisions = new Map<AppSettingsSection, number>();

  private rememberAppSettingRevisions = (revisions?: Record<string, number>) => {
    if (!revisions) return;
    for (const [section, revision] of Object.entries(revisions)) {
      this.appSettingRevisions.set(section as AppSettingsSection, revision);
    }
  };

  private getAppSettingSections = (keys: string[]) => [
    ...new Set(keys.map((key) => getAppSettingsSectionForKey(key as AppSettingKey))),
  ];

  private getExpectedAppSettingRevisions = async (keys: string[]) => {
    const sections = this.getAppSettingSections(keys);

    for (const section of sections) {
      if (this.appSettingRevisions.has(section)) continue;
      const response = (await lambdaClient.admin.settings.getSection.query({ section })) as any;
      this.appSettingRevisions.set(section, response?.__revision ?? 0);
    }

    return Object.fromEntries(
      sections.map((section) => [section, this.appSettingRevisions.get(section) ?? 0]),
    );
  };

  private runAppSettingWrite = async <Result>(
    sections: AppSettingsSection[],
    write: () => Promise<Result>,
  ): Promise<Result> => {
    try {
      return await write();
    } catch (error) {
      sections.forEach((section) => this.appSettingRevisions.delete(section));
      const details = getAdminSettingsSaveErrorDetails(error);
      if (details.isConflict) {
        throw new AdminSettingsRevisionConflictError({ ...details, sections }, { cause: error });
      }
      throw error;
    }
  };

  // Users
  listUsers = async (params: {
    cursor?: number;
    limit?: number;
    plan?: string;
    query?: string;
    subscriptionStartedOrder?: 'asc' | 'desc';
  }) => {
    return lambdaClient.admin.users.list.query(params);
  };

  getUserDetail = async (userId: string) => {
    return lambdaClient.admin.users.detail.query({ userId });
  };

  getCompactUserDetail = async (userId: string) => {
    return lambdaClient.admin.users.compactDetail.query({ userId });
  };

  getUserFullDetail = async (userId: string) => {
    return lambdaClient.admin.users.fullDetail.query({ userId });
  };

  banUser = async (params: { banReason?: string; userId: string }) => {
    return lambdaClient.admin.users.ban.mutate(params);
  };

  unbanUser = async (userId: string) => {
    return lambdaClient.admin.users.unban.mutate({ userId });
  };

  setUserRole = async (
    params: { role: AdminRole | 'user' | null; userId: string },
    command: AdminCommandEnvelope<'user.setRole'>,
  ) => {
    return lambdaClient.admin.users.setRole.mutate({ ...params, command });
  };

  // Credits
  getUserBalance = async (userId: string) => {
    return lambdaClient.admin.credits.getBalance.query({ userId });
  };

  getUserLedger = async (params: { cursor?: number; limit?: number; userId: string }) => {
    return lambdaClient.admin.credits.ledger.query(params);
  };

  adjustCredits = async (
    params: { amount: number; reason: string; userId: string },
    command: AdminCommandEnvelope<'credits.adjust'>,
  ) => {
    return lambdaClient.admin.credits.adjust.mutate({ ...params, command });
  };

  // Subscriptions
  listSubscriptions = async (params: { cursor?: number; limit?: number; plan?: string }) => {
    return lambdaClient.admin.subscriptions.list.query(params);
  };

  getUserSubscription = async (userId: string) => {
    return lambdaClient.admin.subscriptions.getUserSubscription.query({ userId });
  };

  forceChangePlan = async (params: {
    cycle: SubscriptionCycleType;
    plan: string;
    reason: string;
    userId: string;
  }) => {
    return lambdaClient.admin.subscriptions.forceChange.mutate(params);
  };

  assignUserPlan = async (params: {
    cycle: SubscriptionCycleType;
    durationMonths: number;
    plan: string;
    reason: string;
    userId: string;
  }) => lambdaClient.admin.subscriptions.assignPlan.mutate(params);

  // Settings
  getAllSettings = async () => {
    const response = (await lambdaClient.admin.settings.getAll.query()) as any;
    this.rememberAppSettingRevisions(response.__revisions);
    const { __revisions: _, ...settings } = response;

    return settings;
  };

  getSettingsSection = async <Section extends AppSettingsSection>(section: Section) => {
    const response = (await lambdaClient.admin.settings.getSection.query({ section })) as any;
    this.appSettingRevisions.set(section, response.__revision ?? 0);
    const { __revision: _, ...settings } = response;

    return settings as AdminSettingsSectionData<Section>;
  };

  getMobileSettings = async () => (await this.getSettingsSection('mobile')).mobileConfig;

  getDesktopOverview = async () => lambdaClient.admin.desktop.getOverview.query();

  activateDesktopRelease = async (releaseId: string) =>
    lambdaClient.admin.desktop.activateDesktopRelease.mutate({ releaseId });

  listBuildProfiles = async (params?: { cursor?: string; limit?: number }) =>
    lambdaClient.admin.desktop.listBuildProfiles.query(params);

  getBuildProfile = async (profileId: string) =>
    lambdaClient.admin.desktop.getBuildProfile.query({ profileId });

  createBuildAssetUpload = async (input: { kind: DesktopBuildAssetKind; profileId?: string }) =>
    lambdaClient.admin.desktop.createBuildAssetUpload.mutate(input);

  createDesktopRelease = async (input: {
    channel: 'canary' | 'stable';
    profileId: string;
    releaseNotes: string;
    version: string;
  }) => lambdaClient.admin.desktop.createDesktopRelease.mutate(input);

  completeBuildAssetUpload = async (input: {
    key: string;
    kind: DesktopBuildAssetKind;
    profileId: string;
  }) => lambdaClient.admin.desktop.completeBuildAssetUpload.mutate(input);

  saveBuildProfileDraft = async (input: {
    assets: DesktopBuildAssetManifest;
    createIfMissing?: boolean;
    expectedRevision: number;
    name: string;
    payload: DesktopBuildProfilePayload;
    profileId: string;
  }) => lambdaClient.admin.desktop.saveBuildProfileDraft.mutate(input);

  archiveBuildProfile = async (profileId: string) =>
    lambdaClient.admin.desktop.archiveBuildProfile.mutate({ profileId });

  listDesktopReleases = async (params?: { limit?: number; profileId?: string }) =>
    lambdaClient.admin.desktop.listDesktopReleases.query(params);

  reconcileDesktopRelease = async (releaseId: string) =>
    lambdaClient.admin.desktop.reconcileDesktopRelease.mutate({ releaseId });

  retryDesktopRelease = async (releaseId: string) =>
    lambdaClient.admin.desktop.retryDesktopRelease.mutate({ releaseId });

  getMobileSettingsPublication = async () =>
    lambdaClient.admin.settings.getMobileConfigPublication.query();

  getAppSettingsGovernance = async () => {
    return lambdaClient.admin.settings.getGovernance.query();
  };

  deleteUnknownAppSetting = async (params: { confirmKey: string; key: string }) => {
    return lambdaClient.admin.settings.deleteUnknownSetting.mutate(params);
  };

  setAppSetting = async (params: { key: string; value: unknown }) => {
    const sections = this.getAppSettingSections([params.key]);
    const expectedRevisions = await this.getExpectedAppSettingRevisions([params.key]);
    const result = await this.runAppSettingWrite(sections, () =>
      lambdaClient.admin.settings.setAppSetting.mutate({
        ...params,
        expectedRevisions,
      } as any),
    );
    this.rememberAppSettingRevisions(result.revisions);
    await invalidateAdminSettingsWrites([getAppSettingsSectionForKey(params.key as AppSettingKey)]);
    return result;
  };

  setAppSettingsBatch = async (params: { updates: Array<{ key: string; value: unknown }> }) => {
    const keys = params.updates.map(({ key }) => key);
    const sections = this.getAppSettingSections(keys);
    const expectedRevisions = await this.getExpectedAppSettingRevisions(keys);
    const result = await this.runAppSettingWrite(sections, () =>
      lambdaClient.admin.settings.setAppSettingsBatch.mutate({
        ...params,
        expectedRevisions,
      } as any),
    );
    this.rememberAppSettingRevisions(result.revisions);
    await invalidateAdminSettingsWrites(
      params.updates.map((update) => getAppSettingsSectionForKey(update.key as AppSettingKey)),
    );
    return result;
  };

  saveMobileSettingsDraft = async (config: unknown, expectedDraftRevision: number) => {
    const normalized = normalizeMobileConfig(config);
    const state = await lambdaClient.admin.settings.saveMobileConfigDraft.mutate({
      config: normalized,
      expectedDraftRevision,
    });
    await invalidateAdminSettingsWrites(['mobile']);
    return state;
  };

  saveMobileSettings = async (config: unknown, expectedDraftRevision = 0) =>
    (await this.saveMobileSettingsDraft(config, expectedDraftRevision)).draft.config;

  publishMobileSettings = async (params: {
    expectedDraftRevision: number;
    expectedRevision: number;
  }) => {
    const state = await lambdaClient.admin.settings.publishMobileConfig.mutate(params);
    await invalidateAdminSettingsWrites(['mobile']);
    return state;
  };

  rollbackMobileSettings = async (params: {
    expectedDraftRevision: number;
    expectedRevision: number;
    targetRevision: number;
  }) => {
    const state = await lambdaClient.admin.settings.rollbackMobileConfig.mutate(params);
    await invalidateAdminSettingsWrites(['mobile']);
    return state;
  };

  syncUserGlobalSettingsDefaultsToUsers = async (params?: { forceDefaultAgentMeta?: boolean }) => {
    return lambdaClient.admin.settings.syncUserGlobalSettingsDefaultsToUsers.mutate(params);
  };

  syncRuntimeMemoryModelsToUsers = async () => {
    return lambdaClient.admin.settings.syncRuntimeMemoryModelsToUsers.mutate();
  };

  refreshRuntimeCaches = async () => {
    return lambdaClient.admin.settings.refreshRuntimeCaches.mutate();
  };

  testS3Storage = async () => {
    return lambdaClient.admin.settings.testS3Storage.mutate();
  };

  validateDefaultAgentSettings = async (params: {
    model?: string;
    modelType?: 'chat' | 'image' | 'video';
    provider?: string;
  }) => {
    return lambdaClient.admin.settings.validateDefaultAgentSettings.mutate(params);
  };

  getPublicRecommendations = async () => {
    return lambdaClient.admin.settings.getPublicRecommendations.query();
  };

  getPublicOperations = async () => {
    return lambdaClient.admin.settings.getPublicOperations.query();
  };

  getPublicGrowth = async () => {
    return lambdaClient.admin.settings.getPublicGrowth.query();
  };

  getPublicExpertPlaza = async () => {
    return lambdaClient.admin.settings.getPublicExpertPlaza.query();
  };

  getPublicProfileOptions = async () => {
    return lambdaClient.admin.settings.getPublicProfileOptions.query();
  };

  impersonateUser = async (
    userId: string,
    command: AdminCommandEnvelope<'user.impersonate.attempt'>,
  ) => {
    if (impersonationBoundary.kind !== 'http') {
      throw new Error('Invalid impersonation command boundary');
    }

    const response = await fetch(impersonationBoundary.path, {
      body: JSON.stringify({ command, userId }),
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `Impersonation failed: ${response.status}`);
    }

    return response.json();
  };

  getPublicNotificationConfig = async () => {
    return lambdaClient.admin.settings.getPublicNotificationConfig.query();
  };

  getPublicHelpMenu = async () => {
    return lambdaClient.admin.settings.getPublicHelpMenu.query();
  };

  getPublicAboutPage = async () => {
    return lambdaClient.admin.settings.getPublicAboutPage.query();
  };

  getPublicDesktopUpdate = async () => {
    return lambdaClient.admin.settings.getPublicDesktopUpdate.query();
  };

  getPptSettings = async () => lambdaClient.admin.ppt.getSettings.query();

  savePptSettings = async (params: {
    allowPdfExport?: boolean;
    allowPptxDownload?: boolean;
    apiKey?: string;
    auditEnabled?: boolean;
    baseUrl?: string;
    clearApiKey?: boolean;
    creatorVersion?: 'v1' | 'v2';
    dailyLimit?: null | number;
    enabled?: boolean;
    lang?: string;
    themeColor?: null | string;
    tokenTtlMinutes?: number;
  }) => {
    const result = await lambdaClient.admin.ppt.saveSettings.mutate(params);
    await invalidateAdminSettingsWrites(['ppt']);
    return result;
  };

  // Module apps
  moduleApps = {
    acknowledgePaymentDiscrepancy: (input: { discrepancyId: string }) =>
      lambdaClient.admin.moduleApps.acknowledgePaymentDiscrepancy.mutate(input),
    assignPublisher: (input: { appId: string; publisherId: string }) =>
      lambdaClient.admin.moduleApps.assignPublisher.mutate(input),
    createPayoutBatch: (input: {
      publisherId: string;
      requestedAmount: number;
      revenueEntryIds: string[];
    }) => lambdaClient.admin.moduleApps.createPayoutBatch.mutate(input),
    createPublisher: (input: { displayName: string; recipientMask?: string; userId: string }) =>
      lambdaClient.admin.moduleApps.createPublisher.mutate(input),
    createProduct: (input: {
      appId: string;
      licenseScope: 'personal' | 'workspace' | 'workspace_seat';
      moduleMultiplier?: string;
      price: {
        amount: number;
        billingPeriod?: 'monthly' | 'yearly';
        currency: string;
        promotion?: Record<string, unknown>;
        trialDays?: number;
      };
      productKey: string;
      productType: 'free' | 'one_time' | 'subscription';
      revenueShareRate?: string;
      seatCount?: number;
      termsVersion?: string;
    }) => lambdaClient.admin.moduleApps.createProduct.mutate(input as any),
    get: (input: { appId: string }) => lambdaClient.admin.moduleApps.get.query(input),
    dispatchSchedulesNow: () => lambdaClient.admin.moduleApps.dispatchSchedulesNow.mutate(),
    getRuntimeDiagnostics: () => lambdaClient.admin.moduleApps.getRuntimeDiagnostics.query(),
    approvePackage: (input: {
      outboundHostPolicies: Array<{ host: string; purpose: 'ai' | 'general' | 'payment' }>;
      packageId: string;
    }) => lambdaClient.admin.moduleApps.approvePackage.mutate(input),
    getPackage: (input: { packageId: string }) =>
      lambdaClient.admin.moduleApps.getPackage.query(input),
    list: (input?: {
      appId?: string;
      category?: string;
      cursor?: number | string;
      limit?: number;
      publisherId?: string;
      query?: string;
      sort?: 'catalog' | 'name_asc' | 'updated_desc';
      status?: string;
    }) => lambdaClient.admin.moduleApps.list.query(input as any),
    listArtifacts: (input: { appId: string; cursor?: number | string; limit?: number }) =>
      lambdaClient.admin.moduleApps.listArtifacts.query(input as any),
    listAuditEvents: (input: { appId: string; cursor?: number | string; limit?: number }) =>
      lambdaClient.admin.moduleApps.listAuditEvents.query(input as any),
    listInstalls: (input: { appId: string; cursor?: number | string; limit?: number }) =>
      lambdaClient.admin.moduleApps.listInstalls.query(input as any),
    listPackages: (input?: {
      appId?: string;
      buildStatus?: 'building' | 'failed' | 'queued' | 'ready';
      cursor?: number | string;
      limit?: number;
      publisherId?: string;
      reviewStatus?: string;
      submittedByUserId?: string;
    }) => lambdaClient.admin.moduleApps.listPackages.query(input as any),
    listRevenue: (input?: {
      appId?: string;
      cursor?: number | string;
      limit?: number;
      publisherId?: string;
      publisherUserId?: string;
      status?: 'pending' | 'reversed' | 'settled';
    }) => lambdaClient.admin.moduleApps.listRevenue.query(input as any),
    listRecords: (input: { appId: string; cursor?: number | string; limit?: number }) =>
      lambdaClient.admin.moduleApps.listRecords.query(input as any),
    listRuns: (input: { appId: string; cursor?: number | string; limit?: number }) =>
      lambdaClient.admin.moduleApps.listRuns.query(input as any),
    listPublishers: (input?: {
      cursor?: number | string;
      limit?: number;
      status?: 'pending' | 'suspended' | 'verified';
      userId?: string;
    }) => lambdaClient.admin.moduleApps.listPublishers.query(input as any),
    listPayouts: (input?: {
      cursor?: number | string;
      limit?: number;
      publisherId?: string;
      status?: 'eligible' | 'failed' | 'paid' | 'pending' | 'processing' | 'reversed';
    }) => lambdaClient.admin.moduleApps.listPayouts.query(input as any),
    listPaymentDiagnostics: (input?: {
      appId?: string;
      cursor?: number | string;
      discrepancyStatus?: 'open' | 'resolved';
      limit?: number;
      orderId?: string;
      paymentStatus?: 'created' | 'failed' | 'paid' | 'pending' | 'refunded';
      refundStatus?: 'failed' | 'requested' | 'succeeded';
    }) => lambdaClient.admin.moduleApps.listPaymentDiagnostics.query(input as any),
    exportPaymentReconciliation: (input?: {
      cursor?: number;
      limit?: number;
      status?: 'open' | 'resolved';
    }) => lambdaClient.admin.moduleApps.exportPaymentReconciliation.query(input as any),
    listProducts: (input: { appId: string }) =>
      lambdaClient.admin.moduleApps.listProducts.query(input),
    publish: (input: { appId: string }) => lambdaClient.admin.moduleApps.publish.mutate(input),
    reconcilePendingPayments: (input: { limit: number }) =>
      lambdaClient.admin.moduleApps.reconcilePendingPayments.mutate(input),
    recordManualAlipayPayout: (input: {
      batchId: string;
      evidenceReference: string;
      recipientMask: string;
      transactionNo: string;
    }) => lambdaClient.admin.moduleApps.recordManualAlipayPayout.mutate(input),
    rejectPackage: (input: { packageId: string; reason?: string }) =>
      lambdaClient.admin.moduleApps.rejectPackage.mutate(input),
    rescanPackage: (input: { packageId: string }) =>
      lambdaClient.admin.moduleApps.rescanPackage.mutate(input),
    refundOrder: (input: { offlineRefundReference: string; orderId: string; reason: string }) =>
      lambdaClient.admin.moduleApps.refundOrder.mutate(input),
    refundPaymentOrder: (input: { orderId: string; reason: string }) =>
      lambdaClient.admin.moduleApps.refundPaymentOrder.mutate(input),
    resolvePaymentRefund: (input: {
      note: string;
      orderId: string;
      resolution: 'failed' | 'succeeded';
    }) => lambdaClient.admin.moduleApps.resolvePaymentRefund.mutate(input),
    retryPaymentQuery: (input: { outTradeNo: string; provider?: PaymentProvider }) =>
      lambdaClient.admin.moduleApps.retryPaymentQuery.mutate(input),
    retryRefundStatus: (input: { orderId: string }) =>
      lambdaClient.admin.moduleApps.retryRefundStatus.mutate(input),
    settleOrder: (input: { orderId: string; paymentReference: string }) =>
      lambdaClient.admin.moduleApps.settleOrder.mutate(input),
    settleRevenueBatch: (input: { entryIds: string[] }) =>
      lambdaClient.admin.moduleApps.settleRevenueBatch.mutate(input),
    suspendPublisher: (input: { publisherId: string }) =>
      lambdaClient.admin.moduleApps.suspendPublisher.mutate(input),
    transitionPayoutBatch: (input: {
      batchId: string;
      failureReason?: string;
      status: Exclude<ModuleAppPayoutStatus, 'paid'>;
    }) => lambdaClient.admin.moduleApps.transitionPayoutBatch.mutate(input),
    unpublish: (input: { appId: string }) => lambdaClient.admin.moduleApps.unpublish.mutate(input),
    upsert: (input: unknown) => lambdaClient.admin.moduleApps.upsert.mutate(input as any),
    upsertBilling: (input: { appId: string; billing: unknown }) =>
      lambdaClient.admin.moduleApps.upsertBilling.mutate(input as any),
    upsertConfiguration: (input: {
      actions: unknown[];
      appId: string;
      expectedVersionId: string;
      pages: unknown[];
    }) => lambdaClient.admin.moduleApps.upsertConfiguration.mutate(input as any),
    upsertEntitlements: (input: { appId: string; entitlements: unknown[] }) =>
      lambdaClient.admin.moduleApps.upsertEntitlements.mutate(input as any),
    updateProduct: (input: {
      licenseScope: 'personal' | 'workspace' | 'workspace_seat';
      moduleMultiplier?: string;
      price: {
        amount: number;
        billingPeriod?: 'monthly' | 'yearly';
        currency: string;
        promotion?: Record<string, unknown>;
        trialDays?: number;
      };
      productId: string;
      productType: 'free' | 'one_time' | 'subscription';
      revenueShareRate?: string;
      seatCount?: number;
      status: 'active' | 'inactive';
      termsVersion?: string;
    }) => lambdaClient.admin.moduleApps.updateProduct.mutate(input as any),
    verifyPublisher: (input: {
      publisherId: string;
      verificationMetadata: Record<string, unknown>;
    }) => lambdaClient.admin.moduleApps.verifyPublisher.mutate(input),
  };

  // Orders
  listOrders = async (params: {
    cursor?: number;
    limit?: number;
    status?: 'pending' | 'paid' | 'canceled' | 'expired' | 'failed' | 'refunded';
    userId?: string;
  }) => lambdaClient.admin.orders.list.query(params);

  cancelOrder = async (orderId: string, command: AdminCommandEnvelope<'order.cancel'>) =>
    lambdaClient.admin.orders.cancel.mutate({ command, orderId });

  expireOrder = async (orderId: string, command: AdminCommandEnvelope<'order.expire'>) =>
    lambdaClient.admin.orders.expire.mutate({ command, orderId });

  getOrderDetail = async (orderId: string) =>
    lambdaClient.admin.orders.getDetail.query({ orderId });

  settleOrder = async (
    params: { orderId: string; reason: string },
    command: AdminCommandEnvelope<'order.settle'>,
  ) => lambdaClient.admin.orders.settle.mutate({ ...params, command });

  // Unified payment center
  listCreditSettlementFailures = async (params?: {
    cursor?: number;
    limit?: number;
    status?: 'pending' | 'resolved';
  }) => lambdaClient.admin.payments.listCreditSettlementFailures.query(params);

  retryCreditSettlementFailure = async (failureId: string) =>
    lambdaClient.admin.payments.retryCreditSettlementFailure.mutate({ failureId });

  listTopUpPayments = async (params?: {
    cursor?: number;
    limit?: number;
    orderId?: string;
    provider?: PaymentProvider;
    status?: 'pending' | 'paid' | 'canceled' | 'expired' | 'failed' | 'refunded';
    userId?: string;
  }) => lambdaClient.admin.payments.listTopUpPayments.query(params);

  reconcileTopUpPayment = async (orderId: string) =>
    lambdaClient.admin.payments.reconcileTopUpPayment.mutate({ orderId });

  reconcilePendingTopUpPayments = async (limit = 100) =>
    lambdaClient.admin.payments.reconcilePendingTopUpPayments.mutate({ limit });

  refundTopUpPayment = async (input: { orderId: string; reason: string }) =>
    lambdaClient.admin.payments.refundTopUpPayment.mutate(input);

  resolveTopUpPaymentRefund = async (input: {
    note: string;
    orderId: string;
    resolution: 'failed' | 'succeeded';
  }) => lambdaClient.admin.payments.resolveTopUpPaymentRefund.mutate(input);

  listSubscriptionPayments = async (params?: {
    cursor?: number;
    limit?: number;
    orderId?: string;
    provider?: PaymentProvider;
    status?: 'pending' | 'paid' | 'canceled' | 'expired' | 'failed' | 'refunded';
    userId?: string;
  }) => lambdaClient.admin.payments.listSubscriptionPayments.query(params);

  reconcileSubscriptionPayment = async (orderId: string) =>
    lambdaClient.admin.payments.reconcileSubscriptionPayment.mutate({ orderId });

  reconcilePendingSubscriptionPayments = async (limit = 100) =>
    lambdaClient.admin.payments.reconcilePendingSubscriptionPayments.mutate({ limit });

  refundSubscriptionPayment = async (input: { orderId: string; reason: string }) =>
    lambdaClient.admin.payments.refundSubscriptionPayment.mutate(input);

  resolveSubscriptionPaymentRefund = async (input: {
    note: string;
    orderId: string;
    resolution: 'failed' | 'succeeded';
  }) => lambdaClient.admin.payments.resolveSubscriptionPaymentRefund.mutate(input);

  getReferralStats = async () => lambdaClient.admin.referral.getReferralStats.query();

  // Plan catalog
  listPlans = async () => lambdaClient.admin.plans.list.query();
  upsertPlan = async (params: {
    badge?: string;
    comparisonNote?: string;
    currency?: string;
    displayName: string;
    features?: string[];
    isActive?: boolean;
    lifetimePrice?: null | number;
    monthlyCredits: number;
    monthlyPrice: number;
    oneTimePrice?: null | number;
    plan: Plans;
    pptCreditCost?: number;
    pptEnabled?: boolean;
    pptMonthlyQuota?: null | number;
    purchaseUrl?: string;
    sortOrder?: number;
    storageQuotaMb?: null | number;
    vectorQuota?: null | number;
    yearlyDiscountLabel?: string;
    yearlyPrice: number;
  }) => lambdaClient.admin.plans.upsert.mutate(params);
  getPlanDeleteImpact = async (plan: string) =>
    lambdaClient.admin.plans.getDeleteImpact.query({ plan });
  deletePlan = async (plan: string) => lambdaClient.admin.plans.delete.mutate({ plan });
  setPlanActive = async (params: { isActive: boolean; plan: string }) =>
    lambdaClient.admin.plans.setActive.mutate(params);

  // Top-up packages
  listPackages = async () => lambdaClient.admin.topupPackages.list.query();
  upsertPackage = async (params: {
    amount: number;
    credits: number;
    currency?: string;
    displayName: string;
    id: string;
    isActive?: boolean;
    originalAmount?: number;
    promotionEnabled?: boolean;
    promotionLabel?: string;
    promotionNote?: string;
    recommended?: boolean;
    sortOrder?: number;
    validityMonths?: number;
  }) => lambdaClient.admin.topupPackages.upsert.mutate(params);
  deletePackage = async (id: string) => lambdaClient.admin.topupPackages.delete.mutate({ id });
  setPackageActive = async (params: { id: string; isActive: boolean }) =>
    lambdaClient.admin.topupPackages.setActive.mutate(params);

  // Stats
  getStatsOverview = async () => {
    return lambdaClient.admin.stats.overview.query();
  };

  getStatsDauTrend = async () => lambdaClient.admin.stats.dauTrend.query();
  getStatsSubscriptionsByPlan = async () => lambdaClient.admin.stats.subscriptionsByPlan.query();
  getStatsRevenueByMonth = async () => lambdaClient.admin.stats.revenueByMonth.query();
  getStatsRedemptionOverview = async () => lambdaClient.admin.stats.redemptionOverview.query();

  // Audit log
  listAudit = async (
    params: AdminAuditQueryParams & {
      cursor?: number;
      limit?: number;
    },
  ) => lambdaClient.admin.audit.list.query(normalizeAdminAuditQueryParams(params));

  exportAudit = async (
    params: AdminAuditQueryParams & {
      limit?: number;
    },
  ) => lambdaClient.admin.audit.exportAll.query(normalizeAdminAuditQueryParams(params));

  // Subscription Change Requests
  listChangeRequests = async (params: {
    cursor?: number;
    limit?: number;
    status?: 'pending' | 'completed' | 'canceled' | 'rejected';
    userId?: string;
  }) => lambdaClient.admin.subscriptions.listChangeRequests.query(params);

  approveChangeRequest = async (requestId: string) =>
    lambdaClient.admin.subscriptions.approveChangeRequest.mutate({ requestId });

  rejectChangeRequest = async (params: { reason?: string; requestId: string }) =>
    lambdaClient.admin.subscriptions.rejectChangeRequest.mutate(params);

  bulkApproveChangeRequests = async (
    requestIds: string[],
    command: AdminCommandEnvelope<'subscription.changeRequest.bulkApprove'>,
  ) => lambdaClient.admin.subscriptions.bulkApproveChangeRequests.mutate({ command, requestIds });

  bulkRejectChangeRequests = async (
    params: { reason?: string; requestIds: string[] },
    command: AdminCommandEnvelope<'subscription.changeRequest.bulkReject'>,
  ) => lambdaClient.admin.subscriptions.bulkRejectChangeRequests.mutate({ ...params, command });

  // Credit accounts
  listCreditAccounts = async (params: {
    cursor?: number;
    limit?: number;
    negativeOnly?: boolean;
    order?: 'asc' | 'desc';
    sort?: 'balance' | 'totalCredited' | 'totalDebited' | 'updatedAt';
  }) => lambdaClient.admin.credits.listAccounts.query(params);

  exportCreditAccounts = async (params: {
    limit?: number;
    negativeOnly?: boolean;
    order?: 'asc' | 'desc';
    sort?: 'balance' | 'totalCredited' | 'totalDebited' | 'updatedAt';
  }) => lambdaClient.admin.credits.exportAccounts.query(params);

  // Users export
  exportUsers = async (params: { limit?: number; query?: string }) =>
    lambdaClient.admin.users.exportAll.query(params);

  resetAllUsersToFreePlan = async (command: AdminCommandEnvelope<'user.resetAllToFreePlan'>) =>
    lambdaClient.admin.users.resetAllToFreePlan.mutate({
      command,
      reason: command.reason ?? undefined,
    });

  getResetAllUsersToFreePlanPreview = async () =>
    lambdaClient.admin.users.getResetAllToFreePlanPreview.query();

  recordImpersonationAttempt = async (
    userId: string,
    command: AdminCommandEnvelope<'user.impersonate.attempt'>,
  ) => lambdaClient.admin.users.recordImpersonationAttempt.mutate({ command, userId });

  // Content governance
  listAdminTopics = async (params: {
    cursor?: number;
    limit?: number;
    query?: string;
    status?: 'active' | 'completed' | 'archived';
    userId?: string;
  }) => lambdaClient.admin.content.listTopics.query(params);

  archiveAdminTopic = async (topicId: string) =>
    lambdaClient.admin.content.archiveTopic.mutate({ topicId });

  deleteAdminTopic = async (
    topicId: string,
    command: AdminCommandEnvelope<'content.deleteTopic'>,
  ) => lambdaClient.admin.content.deleteTopic.mutate({ command, topicId });

  listAdminFiles = async (params: {
    cursor?: number;
    limit?: number;
    query?: string;
    userId?: string;
  }) => lambdaClient.admin.content.listFiles.query(params);

  deleteAdminFile = async (fileId: string, command: AdminCommandEnvelope<'content.deleteFile'>) =>
    lambdaClient.admin.content.deleteFile.mutate({ command, fileId });

  listAdminDocuments = async (params: {
    cursor?: number;
    limit?: number;
    query?: string;
    sourceType?: 'file' | 'web' | 'api' | 'topic' | 'agent' | 'agent-signal';
    userId?: string;
  }) => lambdaClient.admin.content.listDocuments.query(params);

  deleteAdminDocument = async (
    documentId: string,
    command: AdminCommandEnvelope<'content.deleteDocument'>,
  ) => lambdaClient.admin.content.deleteDocument.mutate({ command, documentId });

  // Maintenance
  runMaintenance = async (
    command: AdminCommandEnvelope<'setting.runMaintenance'>,
    params: {
      auditRetentionDays?: number;
      notificationRetentionDays?: number;
      pendingOrderExpiryDays?: number;
      skipAudit?: boolean;
      skipModuleAppUploads?: boolean;
      skipNotifications?: boolean;
      skipOrders?: boolean;
    } = {},
  ) => lambdaClient.admin.settings.runMaintenance.mutate({ ...params, command });

  // Redemption codes
  generateRedemptionCodes = async (params: {
    batchId?: string;
    codeLength?: number;
    count?: number;
    creditsAmount?: number;
    expiresAt?: string;
    note?: string;
    planCycle?: 'monthly' | 'yearly';
    planDurationMonths?: number;
    planKey?: string;
    rewardType: 'plan' | 'credits' | 'topup_package';
    topupPackageId?: string;
  }) => lambdaClient.admin.redemption.generate.mutate(params as any);

  listRedemptionCodes = async (params: {
    batchId?: string;
    codeQuery?: string;
    cursor?: number;
    limit?: number;
    rewardType?: 'plan' | 'credits' | 'topup_package';
    status?: 'active' | 'redeemed' | 'disabled' | 'expired';
  }) => lambdaClient.admin.redemption.list.query(params);

  disableRedemptionCode = async (id: string) =>
    lambdaClient.admin.redemption.disable.mutate({ id });

  enableRedemptionCode = async (id: string) => lambdaClient.admin.redemption.enable.mutate({ id });

  expireOverdueRedemptionCodes = async () => lambdaClient.admin.redemption.expireOverdue.mutate();

  bulkDisableRedemptionCodes = async (
    ids: string[],
    command: AdminCommandEnvelope<'redemption.bulkDisable'>,
  ) => lambdaClient.admin.redemption.bulkDisable.mutate({ command, ids });

  bulkDeleteRedemptionCodes = async (
    params: { ids: string[]; reason?: string } | string[],
    command: AdminCommandEnvelope<'redemption.bulkDelete'>,
  ) =>
    lambdaClient.admin.redemption.bulkDelete.mutate(
      Array.isArray(params)
        ? { command, ids: params, reason: command.reason ?? undefined }
        : { ...params, command },
    );

  // AI service providers (TRPC route keeps its historical newapiProviders name for compatibility).
  listAiProviderInstances = async () => lambdaClient.admin.newapiProviders.listInstances.query();

  listNewapiInstances = this.listAiProviderInstances;

  listAllEnabledAiProviderModels = async (params?: { modelType?: AiProviderModelType }) =>
    lambdaClient.admin.newapiProviders.getAllEnabledModels.query(params);

  getAiProviderModelCatalogDiagnostics = async () =>
    lambdaClient.admin.newapiProviders.getModelCatalogDiagnostics.query();

  listAllEnabledNewapiModels = async (params?: { modelType?: NewapiModelType }) =>
    this.listAllEnabledAiProviderModels(params);

  createAiProviderInstance = async (params: {
    apiKey: string;
    baseUrl: string;
    description?: string;
    enabled?: boolean;
    fetchOnClient?: boolean;
    groupKey?: string;
    groupMultiplier?: number;
    groupName?: string;
    name: string;
    pricingPolicy?: {
      lobeHubOfficialPricingEnabled?: boolean;
      modelBankFallbackEnabled: boolean;
      upstreamSyncEnabled: boolean;
    };
    priority?: number;
    providerType?: AdminModelApiProviderType;
    usageScope?: AiProviderModelType[];
  }) => lambdaClient.admin.newapiProviders.createInstance.mutate(params);

  createNewapiInstance = this.createAiProviderInstance;

  updateAiProviderInstance = async (params: {
    data: {
      apiKey?: string;
      baseUrl?: string;
      description?: string;
      enabled?: boolean;
      fetchOnClient?: boolean;
      groupKey?: string;
      groupMultiplier?: number;
      groupName?: string;
      name?: string;
      pricingPolicy?: {
        lobeHubOfficialPricingEnabled?: boolean;
        modelBankFallbackEnabled: boolean;
        upstreamSyncEnabled: boolean;
      };
      priority?: number;
      providerType?: AdminModelApiProviderType;
      usageScope?: AiProviderModelType[];
    };
    id: string;
  }) => lambdaClient.admin.newapiProviders.updateInstance.mutate(params);

  updateNewapiInstance = this.updateAiProviderInstance;

  deleteAiProviderInstance = async (
    params: { id: string; reason?: string } | string,
    command: AdminCommandEnvelope<'newapiProvider.deleteInstance'>,
  ) =>
    lambdaClient.admin.newapiProviders.deleteInstance.mutate(
      typeof params === 'string'
        ? { command, id: params, reason: command.reason ?? undefined }
        : { ...params, command },
    );

  deleteNewapiInstance = this.deleteAiProviderInstance;

  getAiProviderInstanceDeleteImpact = async (id: string) =>
    lambdaClient.admin.newapiProviders.getDeleteInstanceImpact.query({ id });

  toggleAiProviderInstance = async (params: { enabled: boolean; id: string }) =>
    lambdaClient.admin.newapiProviders.toggleInstanceEnabled.mutate(params);

  toggleNewapiInstance = this.toggleAiProviderInstance;

  testAiProviderInstanceConnection = async (id: string) =>
    lambdaClient.admin.newapiProviders.testInstanceConnection.query({ id });

  testNewapiInstanceConnection = this.testAiProviderInstanceConnection;

  syncAiProviderInstanceModels = async (id: string) =>
    lambdaClient.admin.newapiProviders.syncInstanceModels.mutate({ id });

  syncNewapiInstanceModels = this.syncAiProviderInstanceModels;

  refreshAiProviderRuntimeCache = async () =>
    lambdaClient.admin.newapiProviders.refreshRuntimeCache.mutate();

  listAiProviderInstanceModels = async (params: {
    instanceId: string;
    modelType?: AiProviderModelType;
  }) => lambdaClient.admin.newapiProviders.listModels.query(params);

  listNewapiInstanceModels = this.listAiProviderInstanceModels;

  addAiProviderInstanceModels = async (params: {
    instanceId: string;
    models: Array<{
      displayName?: string;
      enabled?: boolean;
      modelId: string;
      modelType: AiProviderModelType;
      sortOrder?: number;
    }>;
  }) => lambdaClient.admin.newapiProviders.addModels.mutate(params);

  addNewapiInstanceModels = this.addAiProviderInstanceModels;

  removeAiProviderInstanceModel = async (params: {
    instanceId: string;
    modelId: string;
    modelType: AiProviderModelType;
  }) => lambdaClient.admin.newapiProviders.removeModel.mutate(params);

  getAiProviderModelDeleteImpact = async (params: {
    instanceId: string;
    modelId: string;
    modelType: AiProviderModelType;
  }) => lambdaClient.admin.newapiProviders.getRemoveModelImpact.query(params);

  removeNewapiInstanceModel = this.removeAiProviderInstanceModel;

  updateAiProviderInstanceModel = async (params: {
    data: {
      displayName?: string;
      enabled?: boolean;
      metadata?: Record<string, unknown> | null;
      sortOrder?: number;
    };
    instanceId: string;
    modelId: string;
    modelType: AiProviderModelType;
  }) => lambdaClient.admin.newapiProviders.updateModel.mutate(params);

  updateNewapiInstanceModel = this.updateAiProviderInstanceModel;

  setAiProviderInstanceModelsEnabled = async (params: {
    enabled: boolean;
    instanceId: string;
    models: Array<{ modelId: string; modelType: AiProviderModelType }>;
  }) => lambdaClient.admin.newapiProviders.setModelsEnabled.mutate(params);

  // Plan model rules (per-type allowlist/blocklist)
  setPlanModelRules = async (params: {
    modelRules?: Record<
      string,
      { allowlist?: string[]; blocklist?: string[]; mode: 'allowlist' | 'blocklist' }
    >;
    plan: string;
  }) => lambdaClient.admin.plans.setModelRules.mutate(params as any);

  setPlanModelRulesBatch = async (
    updates: Array<{
      modelRules?: Record<
        string,
        { allowlist?: string[]; blocklist?: string[]; mode: 'allowlist' | 'blocklist' }
      >;
      plan: string;
    }>,
  ) => lambdaClient.admin.plans.setModelRulesBatch.mutate({ updates } as any);
}

export const adminCommercialService = new AdminCommercialService();
