import type {
  ModuleAppActionConfig,
  ModuleAppAdminUpsertInput,
  ModuleAppBillingConfig,
  ModuleAppBuildStatus,
  ModuleAppOutboundHostPurpose,
  ModuleAppPackageReviewStatus,
  ModuleAppPackageScanStatus,
  ModuleAppPage,
  ModuleAppPlanEntitlement,
  ModuleAppRuntimeReadiness,
  ModuleAppSource,
  ModuleAppStatus,
  ModuleAppType,
  PaymentMethodId,
} from '@lobechat/types';

export type AdminModuleAppItem = {
  appType: ModuleAppType;
  billing?: ModuleAppBillingConfig;
  category: string;
  description?: string;
  displayName: string;
  icon: string;
  id: string;
  slug: string;
  source?: ModuleAppSource;
  status: ModuleAppStatus;
  tags?: string[];
  updatedAt?: Date | string;
};

export type AdminModuleAppDetail = AdminModuleAppItem & {
  actions: ModuleAppActionConfig[];
  entitlements: ModuleAppPlanEntitlement[];
  pages: ModuleAppPage[];
  version?: string;
  versionId?: string;
};

export type AdminModuleAppUpsertResult = Pick<ModuleAppAdminUpsertInput, 'slug'> & {
  id: string;
};

export type AdminPlanOption = {
  displayName?: string;
  plan: string;
};

export type AdminModuleAppPackageRow = {
  appId?: null | string;
  buildFailureCode?: null | string;
  buildStatus?: ModuleAppBuildStatus | null;
  createdAt?: Date | string;
  id: string;
  manifestSnapshot?: {
    app?: {
      displayName?: string;
      slug?: string;
      source?: ModuleAppSource;
    };
    packageVersion?: string;
    runtime?: { outboundHosts?: string[] };
  };
  rejectionReason?: null | string;
  reviewStatus: ModuleAppPackageReviewStatus;
  scanStatus: ModuleAppPackageScanStatus;
  submittedByUserId?: null | string;
};

export type AdminModuleAppOutboundHostPurpose = ModuleAppOutboundHostPurpose;

export type ModuleAppRecordRow = {
  collectionKey: string;
  id: string;
  scopeType: string;
  status?: string;
  title?: null | string;
  updatedAt?: Date | string;
};

export type ModuleAppRunRow = {
  actionId?: null | string;
  createdAt?: Date | string;
  durationMs?: null | number;
  errorType?: null | string;
  id: string;
  status: string;
};

export type ModuleAppArtifactRow = {
  fileName?: null | string;
  id: string;
  mimeType?: null | string;
  scopeType?: null | string;
  sizeBytes?: null | number;
  storageKey?: null | string;
};

export type ModuleAppInstallRow = {
  id: string;
  installedAt?: Date | string;
  scopeType?: string;
  status?: string;
  userId?: null | string;
  workspaceId?: null | string;
};

export type ModuleAppRuntimeSwitches = {
  executionEnabled: boolean;
  invocationEnabled: boolean;
  publicExecutionEnabled: boolean;
  scheduleDispatchEnabled: boolean;
  workflowPrivilegedExecutorsEnabled: boolean;
};

export type ModuleAppRuntimeSettingsData = {
  blockers: {
    invocation: string[];
    publicExecution: string[];
    scheduleDispatch: string[];
    workflowPrivilegedExecutors: string[];
  };
  internalTokenConfigured: boolean;
  internalTokenMasked?: null | string;
  internalUrl: string;
  publicOrigin: string;
  requestedSwitches: ModuleAppRuntimeSwitches;
  source: {
    backendManaged: boolean;
    legacyEnvironmentKeys: string[];
    values: Record<
      | 'executionEnabled'
      | 'internalToken'
      | 'internalUrl'
      | 'invocationEnabled'
      | 'publicExecutionEnabled'
      | 'publicOrigin'
      | 'scheduleDispatchEnabled'
      | 'workflowPrivilegedExecutorsEnabled',
      'database' | 'default' | 'environment'
    >;
  };
  switches: ModuleAppRuntimeSwitches;
};

export type ModuleAppRuntimeDiagnostics = {
  configuration: {
    internalTokenConfigured: boolean;
    internalUrlConfigured: boolean;
    publicOriginConfigured: boolean;
  };
  platformGateways: {
    ai: {
      configured: boolean;
      enabledChatModelCount: number;
    };
    payments: {
      configured: boolean;
      enabled: boolean;
      methods: PaymentMethodId[];
      moduleAppEnabled: boolean;
      publicOriginConfigured: boolean;
      source: {
        backendManaged: boolean;
        legacyEnvironmentKeyCount: number;
      };
    };
  };
  probe: ModuleAppRuntimeReadiness;
  requestedSwitches: ModuleAppRuntimeSwitches;
  scheduler: {
    activeClaims: null | number;
    claimableSchedules: null | number;
    enabledSchedules: null | number;
    failedScheduledRuns24h: null | number;
    lastScheduledRunAt: Date | null | string;
    oldestClaimableAt: Date | null | string;
    staleClaims: null | number;
    status: 'available' | 'unavailable';
  };
  switches: ModuleAppRuntimeSwitches;
};

export type ModuleAppAuditRow = {
  actorUserId?: null | string;
  createdAt?: Date | string;
  eventType: string;
  id: string;
};
