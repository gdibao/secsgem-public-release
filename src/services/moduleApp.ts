import type {
  ModuleAppDeveloperAppListResult,
  ModuleAppDeveloperFinance,
  ModuleAppDeveloperListInput,
  ModuleAppDeveloperPayoutListResult,
  ModuleAppDeveloperPublisherProfile,
  ModuleAppDeveloperRevenueListResult,
  ModuleAppDeveloperRevenueSummary,
  ModuleAppDeveloperSubmissionListResult,
  ModuleAppDeveloperVersionSummary,
  ModuleAppGrantSnapshot,
  ModuleAppInstallationListInput,
  ModuleAppInstallationReadiness,
  ModuleAppLaunchContext,
  ModuleAppMarketplaceListInput,
  ModuleAppPackageSubmissionListInput,
  ModuleAppPackageSubmissionListResult,
  ModuleAppPackageUploadedSubmitInput,
  ModuleAppPackageUploadRequest,
  ModuleAppPackageUploadTarget,
  ModuleAppPublisherProfileInput,
  ModuleAppRecordInput,
  ModuleAppRunInput,
  PaymentCreateResult,
  PaymentMethod,
  PaymentMethodId,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

type Procedure = {
  mutate?: (input?: unknown) => Promise<unknown>;
  query?: (input?: unknown) => Promise<unknown>;
};

type ModuleAppClient = {
  messenger: Record<string, Procedure>;
  moduleApp: Record<string, Procedure>;
};

type RecordListInput = Pick<
  ModuleAppRecordInput,
  'appId' | 'collectionKey' | 'scopeType' | 'workspaceId'
> & {
  limit?: number;
  offset?: number;
};

type ModuleAppHistoryInput = {
  cursor?: string;
  installationId: string;
  limit?: number;
  workspaceId?: string;
};

type ModuleAppWorkflowRunInput = Pick<ModuleAppHistoryInput, 'installationId' | 'workspaceId'> & {
  runId: string;
};

type ModuleAppInstallationSecretScope = Pick<
  ModuleAppHistoryInput,
  'installationId' | 'workspaceId'
>;

export type ModuleAppInstallationVersionChangeInput = {
  acceptedGrantSnapshot?: ModuleAppGrantSnapshot;
  appId: string;
  expectedVersionId: string;
  operation: 'rollback' | 'upgrade';
  targetVersionId?: string;
  workspaceId?: string;
};

export interface AvailableModuleApp {
  category?: string;
  displayName: string;
  icon?: null | string;
  id: string;
  installationReadiness?: ModuleAppInstallationReadiness;
  installationScope: 'personal' | 'workspace';
  installed: boolean;
  planState: { runnable: boolean };
  status: string;
  workspaceId?: string;
}

export interface InstalledModuleApp {
  category?: string;
  description?: string;
  displayName: string;
  icon?: null | string;
  id: string;
  installationReadiness?: ModuleAppInstallationReadiness;
  installed?: boolean;
  installedVersion?: null | { id: string; version: string };
  planState?: { installable: boolean; runnable: boolean; visible: boolean };
  publishedVersion?: null | { id: string; version: string };
  slug?: string;
  updateAvailable?: boolean;
  version?: null | string;
}

export type ModuleAppInstallationListResult = {
  items: InstalledModuleApp[];
  nextCursor: null | number;
};

export const createModuleAppService = (client: ModuleAppClient, fetcher: typeof fetch = fetch) => {
  const createPackageUpload = async (input: ModuleAppPackageUploadRequest) =>
    (await client.moduleApp.createPackageUpload.mutate!(input)) as ModuleAppPackageUploadTarget;

  const submitUploadedPackage = (input: ModuleAppPackageUploadedSubmitInput) =>
    client.moduleApp.submitUploadedPackage.mutate!(input);

  const listAvailableApps = async (workspaceId?: string): Promise<AvailableModuleApp[]> => {
    return client.moduleApp.listMobileApps.query!({ workspaceId }) as Promise<AvailableModuleApp[]>;
  };

  return {
    archiveRecord: (input: { appId: string; recordId: string; workspaceId?: string }) =>
      client.moduleApp.archiveRecord.mutate!(input),
    cancelOrder: (input: { orderId: string }) => client.moduleApp.cancelOrder.mutate!(input),
    cancelWorkflowRun: (input: ModuleAppWorkflowRunInput) =>
      client.moduleApp.cancelWorkflowRun.mutate!(input),
    callSdk: (input: { capability: string; input?: unknown; method: string; requestId?: string }) =>
      client.moduleApp.callSdk.mutate!(input),
    changeInstallationVersion: (input: ModuleAppInstallationVersionChangeInput) =>
      client.moduleApp.changeInstallationVersion.mutate!(input),
    createPackageUpload,
    createOrder: (input: { idempotencyKey: string; productId: string; workspaceId?: string }) =>
      client.moduleApp.createOrder.mutate!(input),
    createPayment: (input: { method?: PaymentMethodId; orderId: string }) =>
      client.moduleApp.createPayment.mutate!(input) as Promise<PaymentCreateResult>,
    createRecord: (input: ModuleAppRecordInput) => client.moduleApp.createRecord.mutate!(input),
    deleteInstallationSecret: (input: ModuleAppInstallationSecretScope & { secretKey: string }) =>
      client.moduleApp.deleteInstallationSecret.mutate!(input),
    getDetail: (input: { appIdOrSlug: string; workspaceId?: string }) =>
      client.moduleApp.getDetail.query!(input),
    getLaunchContext: (input: { appId: string; workspaceId?: string }) =>
      client.moduleApp.getLaunchContext.query!(input) as Promise<ModuleAppLaunchContext>,
    getLicense: (input: { appId: string; workspaceId?: string }) =>
      client.moduleApp.getLicense.query!(input),
    getPaymentMethods: () =>
      client.moduleApp.getPaymentMethods.query!() as Promise<PaymentMethod[]>,
    getPaymentStatus: (input: { orderId: string }) =>
      client.moduleApp.getPaymentStatus.query!(input),
    getMyDeveloperFinance: () =>
      client.moduleApp.getMyDeveloperFinance.query!() as Promise<ModuleAppDeveloperFinance>,
    getMyDeveloperFinanceSummary: () =>
      client.moduleApp.getMyDeveloperFinanceSummary.query!() as Promise<
        ModuleAppDeveloperRevenueSummary[]
      >,
    getMyPublisherProfile: () =>
      client.moduleApp.getMyPublisherProfile
        .query!() as Promise<ModuleAppDeveloperPublisherProfile | null>,
    getRecord: (input: { appId: string; recordId: string; workspaceId?: string }) =>
      client.moduleApp.getRecord.query!(input),
    getRuntimeManifest: (input: { appId: string; workspaceId?: string }) =>
      client.moduleApp.getRuntimeManifest.query!(input),
    getWorkflowRun: (input: ModuleAppWorkflowRunInput) =>
      client.moduleApp.getWorkflowRun.query!(input),
    installPersonal: (input: { appId: string }) => client.moduleApp.installPersonal.mutate!(input),
    installWorkspace: (input: { appId: string; workspaceId: string }) =>
      client.moduleApp.installWorkspace.mutate!(input),
    listArtifacts: (input: ModuleAppHistoryInput) => client.moduleApp.listArtifacts.query!(input),
    listAvailableApps,
    listInstallationSecrets: (input: ModuleAppInstallationSecretScope) =>
      client.moduleApp.listInstallationSecrets.query!(input),
    listCatalog: (input: { appId?: string } = {}) => client.moduleApp.listCatalog.query!(input),
    listMarketplace: (input?: ModuleAppMarketplaceListInput) =>
      client.moduleApp.listMarketplace.query!(input),
    listMyDeveloperApps: (input: ModuleAppDeveloperListInput = {}) =>
      client.moduleApp.listMyDeveloperApps.query!(
        input,
      ) as Promise<ModuleAppDeveloperAppListResult>,
    listMyDeveloperSubmissions: (input: ModuleAppDeveloperListInput = {}) =>
      client.moduleApp.listMyDeveloperSubmissions.query!(
        input,
      ) as Promise<ModuleAppDeveloperSubmissionListResult>,
    listMyDeveloperPayouts: (input: ModuleAppDeveloperListInput = {}) =>
      client.moduleApp.listMyDeveloperPayouts.query!(
        input,
      ) as Promise<ModuleAppDeveloperPayoutListResult>,
    listMyDeveloperRevenue: (input: ModuleAppDeveloperListInput = {}) =>
      client.moduleApp.listMyDeveloperRevenue.query!(
        input,
      ) as Promise<ModuleAppDeveloperRevenueListResult>,
    listMyDeveloperVersions: (input: { appId: string }) =>
      client.moduleApp.listMyDeveloperVersions.query!(input) as Promise<
        ModuleAppDeveloperVersionSummary[]
      >,
    listMyApps: (input: ModuleAppInstallationListInput = {}) =>
      client.moduleApp.listMyApps.query!(input) as Promise<ModuleAppInstallationListResult>,
    listOrders: (input: { limit?: number } = {}) => client.moduleApp.listOrders.query!(input),
    quoteProduct: (input: { productId: string }) => client.moduleApp.quoteProduct.query!(input),
    publishMyDeveloperApp: (input: { appId: string }) =>
      client.moduleApp.publishMyDeveloperApp.mutate!(input),
    listMyPackageSubmissions: (input: ModuleAppPackageSubmissionListInput = {}) =>
      client.moduleApp.listMyPackageSubmissions.query!(
        input,
      ) as Promise<ModuleAppPackageSubmissionListResult>,
    listRecords: (input: RecordListInput) => client.moduleApp.listRecords.query!(input),
    listRuns: (input: ModuleAppHistoryInput) => client.moduleApp.listRuns.query!(input),
    listWorkflowNodes: (input: ModuleAppWorkflowRunInput) =>
      client.moduleApp.listWorkflowNodes.query!(input),
    listTeamApps: (input: ModuleAppInstallationListInput & { workspaceId: string }) =>
      client.moduleApp.listTeamApps.query!(input) as Promise<ModuleAppInstallationListResult>,
    runAction: (input: ModuleAppRunInput) => client.moduleApp.runAction.mutate!(input),
    rollbackMyDeveloperApp: (input: { appId: string; versionId: string }) =>
      client.moduleApp.rollbackMyDeveloperApp.mutate!(input),
    submitUploadedPackage,
    uninstallPersonal: (input: { appId: string; dataPolicy?: 'delete' | 'retain' }) =>
      client.moduleApp.uninstallPersonal.mutate!(input),
    uninstallWorkspace: (input: {
      appId: string;
      dataPolicy?: 'delete' | 'retain';
      workspaceId: string;
    }) => client.moduleApp.uninstallWorkspace.mutate!(input),
    unpublishMyDeveloperApp: (input: { appId: string }) =>
      client.moduleApp.unpublishMyDeveloperApp.mutate!(input),
    upsertInstallationSecret: (
      input: ModuleAppInstallationSecretScope & { secretKey: string; value: string },
    ) => client.moduleApp.upsertInstallationSecret.mutate!(input),
    updateRecord: (input: ModuleAppRecordInput & { recordId: string }) =>
      client.moduleApp.updateRecord.mutate!(input),
    upsertMyPublisherProfile: (input: ModuleAppPublisherProfileInput) =>
      client.moduleApp.upsertMyPublisherProfile.mutate!(
        input,
      ) as Promise<ModuleAppDeveloperPublisherProfile>,
    uploadPackage: async (file: File) => {
      const mimeType: ModuleAppPackageUploadRequest['mimeType'] =
        file.type === 'application/x-zip-compressed' || file.type === 'application/octet-stream'
          ? file.type
          : 'application/zip';
      const target = await createPackageUpload({
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
      });
      const response = await fetcher(target.uploadUrl, {
        body: file,
        headers: { ...target.headers, 'Content-Type': mimeType },
        method: 'PUT',
      });

      if (!response.ok) throw new Error('module_app_package_upload_failed');

      return submitUploadedPackage({
        fileName: file.name,
        storageKey: target.storageKey,
        uploadId: target.uploadId,
      });
    },
  };
};

export const moduleAppService = createModuleAppService(lambdaClient as unknown as ModuleAppClient);
