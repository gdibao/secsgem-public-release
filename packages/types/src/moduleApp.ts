import { z } from 'zod';

import { moduleAppMultiplierSchema } from './moduleAppCommerce';
import {
  moduleAppBuildConfigSchema,
  moduleAppExecutableRuntimeSchema,
  moduleAppOutboundHostsSchema,
} from './moduleAppRuntime';

const optionalTrimmedString = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;

    const text = value.trim();
    return text || undefined;
  }, z.string().max(max).optional());

const stripUndefinedValues = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

export const moduleAppStatusSchema = z.enum(['draft', 'published', 'unpublished']);
export type ModuleAppStatus = z.infer<typeof moduleAppStatusSchema>;

export const moduleAppSourceSchema = z.enum(['system', 'admin', 'user', 'developer']);
export type ModuleAppSource = z.infer<typeof moduleAppSourceSchema>;

export const moduleAppTypeSchema = z.enum([
  'standard_app',
  'api_app',
  'ai_app',
  'workflow_app',
  'hybrid_app',
]);
export type ModuleAppType = z.infer<typeof moduleAppTypeSchema>;

export const moduleAppRuntimeTypeSchema = z.enum([
  'none',
  'record_create',
  'record_update',
  'record_archive',
  'api_action',
  'server_action',
  'content_generation',
  'workflow_step',
  'executable_action',
]);
export type ModuleAppRuntimeType = z.infer<typeof moduleAppRuntimeTypeSchema>;

export const moduleAppScopeTypeSchema = z.enum(['personal', 'workspace']);
export type ModuleAppScopeType = z.infer<typeof moduleAppScopeTypeSchema>;

export const moduleAppPageTypeSchema = z.enum([
  'overview',
  'form',
  'list',
  'detail',
  'result',
  'artifact',
  'custom',
]);
export type ModuleAppPageType = z.infer<typeof moduleAppPageTypeSchema>;

export const moduleAppInputFieldSchema = z.object({
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  helpText: z.string().max(500).optional(),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  label: z.string().min(1).max(80),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        value: z.union([z.string().max(240), z.number().finite(), z.boolean()]),
      }),
    )
    .max(100)
    .optional(),
  required: z.boolean().default(false),
  type: z.enum(['text', 'textarea', 'number', 'boolean', 'select', 'date']),
  validationPattern: z.string().max(300).optional(),
});

export const moduleAppInputSchema = z.object({
  fields: z.array(moduleAppInputFieldSchema).max(80).default([]),
});
export type ModuleAppInputSchema = z.infer<typeof moduleAppInputSchema>;

export const moduleAppPageSchema = z.object({
  actionBindings: z.array(z.object({ actionKey: z.string(), event: z.string() })).default([]),
  dataSource: z.record(z.string(), z.unknown()).default({}),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  layoutSchema: z.record(z.string(), z.unknown()).default({}),
  routePath: z.string().min(1).max(160),
  sortOrder: z.coerce.number().int().default(0),
  title: z.string().min(1).max(120),
  type: moduleAppPageTypeSchema,
});
export type ModuleAppPage = z.infer<typeof moduleAppPageSchema>;

export const moduleAppFailureFixedFeePolicySchema = z.enum(['do_not_charge']);
export const moduleAppChargeModeSchema = z.enum([
  'free',
  'fixed',
  'ai_usage',
  'external_api',
  'hybrid',
]);

export const moduleAppBillingConfigSchema = z
  .object({
    chargeMode: moduleAppChargeModeSchema.default('free'),
    defaultMultiplier: moduleAppMultiplierSchema.default(1),
    externalApiCostCredits: z.coerce.number().finite().min(0).default(0),
    failureFixedFeePolicy: moduleAppFailureFixedFeePolicySchema.default('do_not_charge'),
    fixedServiceFeeCredits: z.coerce.number().finite().min(0).default(0),
  })
  .default({
    chargeMode: 'free',
    defaultMultiplier: 1,
    externalApiCostCredits: 0,
    failureFixedFeePolicy: 'do_not_charge',
    fixedServiceFeeCredits: 0,
  });
export type ModuleAppBillingConfig = z.infer<typeof moduleAppBillingConfigSchema>;

export const MODULE_APP_MAX_DECLARED_SECRET_KEYS = 80;
export const moduleAppSecretKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/);

export const moduleAppActionConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    inputSchema: moduleAppInputSchema.default({ fields: [] }),
    moduleMultiplier: moduleAppMultiplierSchema.default(1),
    name: z.string().min(1).max(120),
    outputSchema: z.record(z.string(), z.unknown()).default({}),
    runtimeConfig: z.record(z.string(), z.unknown()).default({}),
    runtimeType: moduleAppRuntimeTypeSchema,
  })
  .superRefine((action, ctx) => {
    const secretKeys = action.runtimeConfig.secretKeys;
    if (
      secretKeys !== undefined &&
      !z.array(moduleAppSecretKeySchema).max(20).safeParse(secretKeys).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_secret_keys_invalid',
        path: ['runtimeConfig', 'secretKeys'],
      });
    }
    if (
      action.runtimeType === 'executable_action' &&
      (typeof action.runtimeConfig.functionKey !== 'string' ||
        !/^[a-z][a-z0-9_]{1,63}$/.test(action.runtimeConfig.functionKey))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_executable_function_key_required',
        path: ['runtimeConfig', 'functionKey'],
      });
    }
  });
export type ModuleAppActionConfig = z.infer<typeof moduleAppActionConfigSchema>;

export const getModuleAppDeclaredSecretKeys = (
  actions: Array<Pick<ModuleAppActionConfig, 'runtimeConfig'>>,
) => {
  const keys = new Set<string>();

  for (const action of actions) {
    const configuredKeys = action.runtimeConfig.secretKeys;
    if (configuredKeys === undefined) continue;

    const parsed = z.array(moduleAppSecretKeySchema).max(20).safeParse(configuredKeys);
    if (!parsed.success) throw new Error('MODULE_APP_SECRET_KEYS_INVALID');
    for (const key of parsed.data) keys.add(key);
  }

  if (keys.size > MODULE_APP_MAX_DECLARED_SECRET_KEYS) {
    throw new Error('MODULE_APP_SECRET_KEYS_INVALID');
  }

  return [...keys].sort();
};

export const moduleAppActionListSchema = z
  .array(moduleAppActionConfigSchema)
  .max(80)
  .superRefine((actions, ctx) => {
    try {
      getModuleAppDeclaredSecretKeys(actions);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_secret_keys_invalid',
      });
    }
  });

export const moduleAppPlanEntitlementSchema = z.object({
  discountPercent: z.coerce.number().finite().min(0).max(100).default(0),
  freeQuotaCredits: z.coerce.number().finite().min(0).default(0),
  installable: z.boolean().default(false),
  plan: z.string().min(1).max(80),
  runnable: z.boolean().default(false),
  visible: z.boolean().default(false),
});
export type ModuleAppPlanEntitlement = z.infer<typeof moduleAppPlanEntitlementSchema>;

export const moduleAppAdminUpsertSchema = z.object({
  actions: moduleAppActionListSchema.default([]),
  appType: moduleAppTypeSchema,
  billing: moduleAppBillingConfigSchema,
  category: z.string().min(1).max(80),
  description: z.string().min(1).max(4000),
  displayName: z.string().min(1).max(120),
  icon: z.string().min(1).max(240),
  id: z.string().uuid().optional(),
  pages: z.array(moduleAppPageSchema).max(80).default([]),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  source: moduleAppSourceSchema.default('admin'),
  status: moduleAppStatusSchema.default('draft'),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
});
export type ModuleAppAdminUpsertInput = z.infer<typeof moduleAppAdminUpsertSchema>;

export const moduleAppMarketplaceListInputSchema = z
  .object({
    appType: moduleAppTypeSchema.optional(),
    category: optionalTrimmedString(80),
    query: optionalTrimmedString(120),
  })
  .optional()
  .default({})
  .transform((value) => stripUndefinedValues(value));
export type ModuleAppMarketplaceListInput = z.infer<typeof moduleAppMarketplaceListInputSchema>;

export const moduleAppInstallationReadinessSchema = z
  .object({
    configuration: z.enum(['invalid', 'ready', 'required']),
    missingSecretCount: z.number().int().min(0).max(MODULE_APP_MAX_DECLARED_SECRET_KEYS),
    runtime: z.enum(['ready', 'unavailable']),
  })
  .superRefine((value, ctx) => {
    if (value.configuration === 'ready' && value.missingSecretCount !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_ready_configuration_has_missing_secrets',
        path: ['missingSecretCount'],
      });
    }
    if (value.configuration === 'required' && value.missingSecretCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_required_configuration_has_no_missing_secrets',
        path: ['missingSecretCount'],
      });
    }
  });
export type ModuleAppInstallationReadiness = z.infer<typeof moduleAppInstallationReadinessSchema>;

export const moduleAppInstallationListInputSchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  query: optionalTrimmedString(80),
});
export type ModuleAppInstallationListInput = z.input<typeof moduleAppInstallationListInputSchema>;

export const moduleAppRecordInputSchema = z.object({
  appId: z.string().uuid(),
  collectionKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  data: z.record(z.string(), z.unknown()).default({}),
  recordId: z.string().uuid().optional(),
  scopeType: moduleAppScopeTypeSchema,
  title: z.string().max(240).optional(),
  workspaceId: z.string().optional(),
});
export type ModuleAppRecordInput = z.infer<typeof moduleAppRecordInputSchema>;

export const moduleAppRunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'denied',
]);
export type ModuleAppRunStatus = z.infer<typeof moduleAppRunStatusSchema>;

export const moduleAppRunInputSchema = z.object({
  actionId: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  appId: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).default({}),
  recordId: z.string().uuid().optional(),
  scopeType: moduleAppScopeTypeSchema,
  workspaceId: z.string().optional(),
});
export type ModuleAppRunInput = z.infer<typeof moduleAppRunInputSchema>;

export const moduleAppPackageReviewStatusSchema = z.enum([
  'pending_review',
  'approved',
  'rejected',
]);
export type ModuleAppPackageReviewStatus = z.infer<typeof moduleAppPackageReviewStatusSchema>;

export const moduleAppPackageRuntimeKindSchema = z.enum([
  'manifest_only',
  'frontend_static',
  'external_api',
]);
export type ModuleAppPackageRuntimeKind = z.infer<typeof moduleAppPackageRuntimeKindSchema>;

export const moduleAppPackageRuntimeSchema = z.object({
  entry: optionalTrimmedString(240),
  kind: moduleAppPackageRuntimeKindSchema.default('manifest_only'),
  outboundHosts: moduleAppOutboundHostsSchema.optional(),
  permissions: z
    .array(z.string().regex(/^[a-z][a-z0-9_.:-]{1,79}$/))
    .max(80)
    .default([]),
});
export type ModuleAppPackageRuntime = z.infer<typeof moduleAppPackageRuntimeSchema>;

const moduleAppGrantItemsSchema = z.array(z.string().min(1).max(253)).max(1000);

export const moduleAppGrantSnapshotSchema = z
  .object({
    functionKeys: moduleAppGrantItemsSchema,
    outboundHosts: moduleAppGrantItemsSchema,
    permissions: moduleAppGrantItemsSchema,
    secretKeys: moduleAppGrantItemsSchema,
    tableKeys: moduleAppGrantItemsSchema,
    workflowKeys: moduleAppGrantItemsSchema,
  })
  .strict();
export type ModuleAppGrantSnapshot = z.infer<typeof moduleAppGrantSnapshotSchema>;

export const EMPTY_MODULE_APP_GRANT_SNAPSHOT: ModuleAppGrantSnapshot = {
  functionKeys: [],
  outboundHosts: [],
  permissions: [],
  secretKeys: [],
  tableKeys: [],
  workflowKeys: [],
};

export type ModuleAppGrantDiff = {
  added: ModuleAppGrantSnapshot;
  hasExpansion: boolean;
};

export const getModuleAppGrantDiff = (
  current: ModuleAppGrantSnapshot,
  target: ModuleAppGrantSnapshot,
): ModuleAppGrantDiff => {
  const added = Object.fromEntries(
    Object.keys(EMPTY_MODULE_APP_GRANT_SNAPSHOT).map((key) => {
      const dimension = key as keyof ModuleAppGrantSnapshot;
      const currentItems = new Set(current[dimension]);

      return [dimension, target[dimension].filter((item) => !currentItems.has(item))];
    }),
  ) as ModuleAppGrantSnapshot;

  return {
    added,
    hasExpansion: Object.values(added).some((items) => items.length > 0),
  };
};

export const MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MODULE_APP_PACKAGE_MAX_OPEN_UPLOADS = 3;
export const MODULE_APP_PACKAGE_MAX_DAILY_UPLOADS = 20;
export const MODULE_APP_PACKAGE_MAX_RETAINED_BYTES = 500 * 1024 * 1024;
export const MODULE_APP_PACKAGE_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;
export const MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE = 100;
export const MODULE_APP_PACKAGE_MAX_SCAN_ISSUES = 100;

export const moduleAppPackageUploadStatusSchema = z.enum([
  'issued',
  'processing',
  'submitted',
  'rejected',
  'failed',
  'cleaning',
  'expired',
]);
export type ModuleAppPackageUploadStatus = z.infer<typeof moduleAppPackageUploadStatusSchema>;

export const moduleAppPackageScanStatusSchema = z.enum(['pending', 'clean', 'blocked', 'error']);
export type ModuleAppPackageScanStatus = z.infer<typeof moduleAppPackageScanStatusSchema>;

export const moduleAppPackageUploadIdSchema = z.string().uuid();

const moduleAppPackageFileNameSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => value.toLowerCase().endsWith('.zip'), {
    message: 'module_app_package_archive_must_be_zip',
  });

const moduleAppPackageMimeTypeSchema = z.enum([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

export const moduleAppPackageArchiveMetadataSchema = z.object({
  fileName: moduleAppPackageFileNameSchema,
  mimeType: moduleAppPackageMimeTypeSchema.default('application/zip'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  sizeBytes: z.coerce.number().int().min(1),
  storageKey: z.string().min(1).max(600),
});
export type ModuleAppPackageArchiveMetadata = z.infer<typeof moduleAppPackageArchiveMetadataSchema>;

export const moduleAppPackageFileManifestItemSchema = z.object({
  path: z.string().min(1).max(500),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  sizeBytes: z.coerce.number().int().min(0),
});
export type ModuleAppPackageFileManifestItem = z.infer<
  typeof moduleAppPackageFileManifestItemSchema
>;

export const moduleAppPackageValidationIssueSchema = z.object({
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(500),
  path: z.string().max(500).optional(),
  severity: z.enum(['error', 'warning']),
});
export type ModuleAppPackageValidationIssue = z.infer<typeof moduleAppPackageValidationIssueSchema>;

export const moduleAppPackageManifestV1Schema = z.object({
  app: moduleAppAdminUpsertSchema.omit({ id: true }).extend({
    status: moduleAppStatusSchema.default('draft'),
  }),
  entitlements: z.array(moduleAppPlanEntitlementSchema).max(100).default([]),
  manifestVersion: z.literal(1),
  packageVersion: z.string().min(1).max(80),
  runtime: moduleAppPackageRuntimeSchema.default({ kind: 'manifest_only', permissions: [] }),
});

export const moduleAppPackageManifestV2Schema = z
  .object({
    app: moduleAppAdminUpsertSchema.omit({ id: true }).extend({
      status: moduleAppStatusSchema.default('draft'),
    }),
    build: moduleAppBuildConfigSchema,
    entitlements: z.array(moduleAppPlanEntitlementSchema).max(100).default([]),
    manifestVersion: z.literal(2),
    packageVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i)
      .max(80),
    runtime: moduleAppExecutableRuntimeSchema,
  })
  .strict();

export const moduleAppPackageManifestSchema = z.discriminatedUnion('manifestVersion', [
  moduleAppPackageManifestV1Schema,
  moduleAppPackageManifestV2Schema,
]);
export type ModuleAppPackageManifest = z.infer<typeof moduleAppPackageManifestSchema>;

export const moduleAppPackageSubmitSchema = z.object({
  archive: moduleAppPackageArchiveMetadataSchema,
  fileManifest: z.array(moduleAppPackageFileManifestItemSchema).max(1000).default([]),
  manifest: moduleAppPackageManifestSchema,
});
export type ModuleAppPackageSubmitInput = z.infer<typeof moduleAppPackageSubmitSchema>;

export const moduleAppPackageUploadRequestSchema = z.object({
  fileName: moduleAppPackageFileNameSchema,
  mimeType: moduleAppPackageMimeTypeSchema.default('application/zip'),
  sizeBytes: z.coerce.number().int().min(1).max(MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES),
});
export type ModuleAppPackageUploadRequest = z.infer<typeof moduleAppPackageUploadRequestSchema>;

export type ModuleAppPackageUploadTarget = {
  expiresAt: Date | string;
  headers: Record<string, string>;
  storageKey: string;
  uploadId: string;
  uploadUrl: string;
};

export const moduleAppPackageUploadedSubmitSchema = z.object({
  fileName: moduleAppPackageFileNameSchema,
  storageKey: z.string().min(1).max(600),
  uploadId: moduleAppPackageUploadIdSchema,
});
export type ModuleAppPackageUploadedSubmitInput = z.infer<
  typeof moduleAppPackageUploadedSubmitSchema
>;

export const moduleAppPackageSubmissionListInputSchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  reviewStatus: moduleAppPackageReviewStatusSchema.optional(),
});
export type ModuleAppPackageSubmissionListInput = z.input<
  typeof moduleAppPackageSubmissionListInputSchema
>;

export type ModuleAppPackageSubmissionSummary = {
  appDisplayName: string;
  appId: null | string;
  appSlug: string;
  createdAt: Date | string;
  fileName: string;
  id: string;
  packageVersion: string;
  publishedAt: Date | null | string;
  rejectionReason: null | string;
  reviewedAt: Date | null | string;
  reviewStatus: ModuleAppPackageReviewStatus;
  sizeBytes: number;
  updatedAt: Date | string;
};

export type ModuleAppPackageSubmissionListResult = {
  items: ModuleAppPackageSubmissionSummary[];
  nextCursor: null | number;
};
