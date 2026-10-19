import type {
  ModuleAppActionConfig,
  ModuleAppBillingConfig,
  ModuleAppBuildProfile,
  ModuleAppBuildStatus,
  ModuleAppGrantSnapshot,
  ModuleAppInputSchema,
  ModuleAppPackageArchiveMetadata,
  ModuleAppPackageFileManifestItem,
  ModuleAppPackageManifest,
  ModuleAppPackageReviewStatus,
  ModuleAppPackageScanStatus,
  ModuleAppPackageUploadStatus,
  ModuleAppPackageValidationIssue,
  ModuleAppPage,
  ModuleAppPaymentAttemptStatus,
  ModuleAppPaymentDiscrepancyKind,
  ModuleAppPaymentEventStatus,
  ModuleAppPaymentEventType,
  ModuleAppPaymentProvider,
  ModuleAppPaymentRefundStatus,
  ModuleAppPayoutStatus,
  ModuleAppPublisherStatus,
  ModuleAppRunStatus,
  ModuleAppScopeType,
  ModuleAppSource,
  ModuleAppStatus,
  ModuleAppTableSchema,
  ModuleAppType,
  ModuleAppWorkflowNodeStatus,
  ModuleAppWorkflowRunStatus,
  PaymentCheckoutAction,
  PaymentMethodId,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

const DEFAULT_MODULE_APP_BILLING: ModuleAppBillingConfig = {
  chargeMode: 'free',
  defaultMultiplier: 1,
  externalApiCostCredits: 0,
  failureFixedFeePolicy: 'do_not_charge',
  fixedServiceFeeCredits: 0,
};

export const moduleAppPublishers = pgTable(
  'module_app_publishers',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').$type<ModuleAppPublisherStatus>().default('pending').notNull(),
    recipientMask: text('recipient_mask'),
    verificationMetadata: jsonb('verification_metadata')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    verifiedAt: timestamptz('verified_at'),
    suspendedAt: timestamptz('suspended_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_publishers_user_unique').on(table.userId),
    index('module_app_publishers_status_created_idx').on(table.status, table.createdAt),
    check(
      'module_app_publishers_status_check',
      sql`${table.status} IN ('pending', 'verified', 'suspended')`,
    ),
  ],
);

export const moduleApps = pgTable(
  'module_apps',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    publisherId: uuid('publisher_id').references(() => moduleAppPublishers.id, {
      onDelete: 'set null',
    }),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name').notNull(),
    icon: text('icon').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    appType: text('app_type').$type<ModuleAppType>().notNull(),
    source: text('source').$type<ModuleAppSource>().default('admin').notNull(),
    status: text('status').$type<ModuleAppStatus>().default('draft').notNull(),
    currentPublishedVersionId: uuid('current_published_version_id').references(
      (): AnyPgColumn => moduleAppVersions.id,
      { onDelete: 'set null' },
    ),
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    billing: jsonb('billing')
      .$type<ModuleAppBillingConfig>()
      .default(DEFAULT_MODULE_APP_BILLING)
      .notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('module_apps_status_category_sort_idx').on(table.status, table.category, table.sortOrder),
    index('module_apps_publisher_status_idx').on(table.publisherId, table.status),
    index('module_apps_current_published_version_idx').on(table.currentPublishedVersionId),
  ],
);

export type NewModuleApp = typeof moduleApps.$inferInsert;
export type ModuleAppItem = typeof moduleApps.$inferSelect;

export const moduleAppVersions = pgTable(
  'module_app_versions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    version: text('version').notNull(),
    manifestSnapshot: jsonb('manifest_snapshot')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    changelog: text('changelog').default('').notNull(),
    publishedAt: timestamptz('published_at'),
    rollbackSourceVersionId: uuid('rollback_source_version_id'),
    runtimeArtifactKey: text('runtime_artifact_key'),
    runtimeArtifactSha256: text('runtime_artifact_sha256'),
    runtimeManifest: jsonb('runtime_manifest')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('module_app_versions_id_app_id_unique').on(table.id, table.appId),
    uniqueIndex('module_app_versions_app_id_published_version_unique')
      .on(table.appId, table.version)
      .where(sql`${table.publishedAt} IS NOT NULL`),
    uniqueIndex('module_app_versions_one_draft_per_app_unique')
      .on(table.appId)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);

export type NewModuleAppVersion = typeof moduleAppVersions.$inferInsert;
export type ModuleAppVersionItem = typeof moduleAppVersions.$inferSelect;

export const moduleAppPages = pgTable(
  'module_app_pages',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    versionId: uuid('version_id').notNull(),
    pageKey: text('page_key').notNull(),
    title: text('title').notNull(),
    pageType: text('page_type').notNull(),
    routePath: text('route_path').notNull(),
    layoutSchema: jsonb('layout_schema')
      .$type<ModuleAppPage['layoutSchema']>()
      .default({})
      .notNull(),
    dataSource: jsonb('data_source').$type<ModuleAppPage['dataSource']>().default({}).notNull(),
    actionBindings: jsonb('action_bindings')
      .$type<ModuleAppPage['actionBindings']>()
      .default([])
      .notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('module_app_pages_app_id_version_id_sort_order_idx').on(
      table.appId,
      table.versionId,
      table.sortOrder,
    ),
    uniqueIndex('module_app_pages_version_id_page_key_unique').on(table.versionId, table.pageKey),
    foreignKey({
      columns: [table.versionId, table.appId],
      foreignColumns: [moduleAppVersions.id, moduleAppVersions.appId],
      name: 'module_app_pages_version_app_fk',
    }).onDelete('cascade'),
  ],
);

export type NewModuleAppPage = typeof moduleAppPages.$inferInsert;
export type ModuleAppPageItem = typeof moduleAppPages.$inferSelect;

export const moduleAppActions = pgTable(
  'module_app_actions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    versionId: uuid('version_id').notNull(),
    actionKey: text('action_key').notNull(),
    runtimeType: text('runtime_type').$type<ModuleAppActionConfig['runtimeType']>().notNull(),
    name: text('name').notNull(),
    inputSchema: jsonb('input_schema')
      .$type<ModuleAppInputSchema>()
      .default({ fields: [] })
      .notNull(),
    outputSchema: jsonb('output_schema').$type<Record<string, unknown>>().default({}).notNull(),
    moduleMultiplier: numeric('module_multiplier', { mode: 'number', precision: 10, scale: 4 })
      .default(1)
      .notNull(),
    runtimeConfig: jsonb('runtime_config').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('module_app_actions_app_id_version_id_action_key_idx').on(
      table.appId,
      table.versionId,
      table.actionKey,
    ),
    uniqueIndex('module_app_actions_version_id_action_key_unique').on(
      table.versionId,
      table.actionKey,
    ),
    foreignKey({
      columns: [table.versionId, table.appId],
      foreignColumns: [moduleAppVersions.id, moduleAppVersions.appId],
      name: 'module_app_actions_version_app_fk',
    }).onDelete('cascade'),
  ],
);

export type NewModuleAppAction = typeof moduleAppActions.$inferInsert;
export type ModuleAppActionItem = typeof moduleAppActions.$inferSelect;

export const moduleAppEntitlements = pgTable(
  'module_app_entitlements',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    plan: text('plan').notNull(),
    visible: boolean('visible').default(false).notNull(),
    installable: boolean('installable').default(false).notNull(),
    runnable: boolean('runnable').default(false).notNull(),
    freeQuotaCredits: integer('free_quota_credits').default(0).notNull(),
    discountPercent: integer('discount_percent').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_entitlements_app_id_plan_unique').on(table.appId, table.plan),
  ],
);

export type NewModuleAppEntitlement = typeof moduleAppEntitlements.$inferInsert;
export type ModuleAppEntitlementItem = typeof moduleAppEntitlements.$inferSelect;

export const moduleAppInstallations = pgTable(
  'module_app_installations',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    versionId: uuid('version_id').references(() => moduleAppVersions.id, { onDelete: 'no action' }),
    scopeType: text('scope_type').$type<ModuleAppScopeType>().notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    status: text('status').default('installed').notNull(),
    grantSnapshot: jsonb('grant_snapshot')
      .$type<ModuleAppGrantSnapshot>()
      .default({
        functionKeys: [],
        outboundHosts: [],
        permissions: [],
        secretKeys: [],
        tableKeys: [],
        workflowKeys: [],
      })
      .notNull(),
    installedAt: timestamptz('installed_at').defaultNow().notNull(),
    uninstalledAt: timestamptz('uninstalled_at'),
    dataPurgedAt: timestamptz('data_purged_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'module_app_installations_scope_owner_check',
      sql`(
        (${table.scopeType} = 'personal' AND ${table.userId} IS NOT NULL AND ${table.workspaceId} IS NULL)
        OR (${table.scopeType} = 'workspace' AND ${table.workspaceId} IS NOT NULL)
      )`,
    ),
    check(
      'module_app_installations_lifecycle_check',
      sql`(
        (${table.status} = 'installed' AND ${table.versionId} IS NOT NULL AND ${table.uninstalledAt} IS NULL)
        OR (${table.status} = 'uninstalled' AND ${table.versionId} IS NULL AND ${table.uninstalledAt} IS NOT NULL)
      )`,
    ),
    uniqueIndex('module_app_install_personal_unique')
      .on(table.appId, table.userId)
      .where(sql`${table.scopeType} = 'personal' AND ${table.userId} IS NOT NULL`),
    uniqueIndex('module_app_install_workspace_unique')
      .on(table.appId, table.workspaceId)
      .where(sql`${table.scopeType} = 'workspace' AND ${table.workspaceId} IS NOT NULL`),
  ],
);

export type NewModuleAppInstallation = typeof moduleAppInstallations.$inferInsert;
export type ModuleAppInstallationItem = typeof moduleAppInstallations.$inferSelect;

/** Active installations retain these immutable versions for explicit rollback. */
export const moduleAppInstallationVersionRefs = pgTable(
  'module_app_installation_version_refs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    installationId: uuid('installation_id')
      .references(() => moduleAppInstallations.id, { onDelete: 'cascade' })
      .notNull(),
    versionId: uuid('version_id')
      .references(() => moduleAppVersions.id, { onDelete: 'no action' })
      .notNull(),
    packageId: uuid('package_id').references((): AnyPgColumn => moduleAppPackages.id, {
      onDelete: 'no action',
    }),
    buildId: uuid('build_id').references((): AnyPgColumn => moduleAppBuilds.id, {
      onDelete: 'no action',
    }),
    activationCount: integer('activation_count').default(1).notNull(),
    lastActivatedAt: timestamptz('last_activated_at').defaultNow().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_installation_version_refs_unique').on(
      table.installationId,
      table.versionId,
    ),
    index('module_app_installation_version_refs_version_idx').on(table.versionId),
    index('module_app_installation_version_refs_package_idx').on(table.packageId),
    index('module_app_installation_version_refs_build_idx').on(table.buildId),
    check('module_app_installation_version_refs_count_check', sql`${table.activationCount} >= 1`),
  ],
);

export type NewModuleAppInstallationVersionRef =
  typeof moduleAppInstallationVersionRefs.$inferInsert;
export type ModuleAppInstallationVersionRefItem =
  typeof moduleAppInstallationVersionRefs.$inferSelect;

export const moduleAppInstallationSecrets = pgTable(
  'module_app_installation_secrets',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    installationId: uuid('installation_id')
      .references(() => moduleAppInstallations.id, { onDelete: 'cascade' })
      .notNull(),
    secretKey: text('secret_key').notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_installation_secrets_installation_key_unique').on(
      table.installationId,
      table.secretKey,
    ),
  ],
);

export type NewModuleAppInstallationSecret = typeof moduleAppInstallationSecrets.$inferInsert;
export type ModuleAppInstallationSecretItem = typeof moduleAppInstallationSecrets.$inferSelect;

export const moduleAppRecords = pgTable(
  'module_app_records',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    installationId: uuid('installation_id').references(() => moduleAppInstallations.id, {
      onDelete: 'cascade',
    }),
    collectionKey: text('collection_key').notNull(),
    scopeType: text('scope_type').$type<ModuleAppScopeType>().notNull(),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    recordKey: text('record_key'),
    title: text('title'),
    status: text('status').default('active').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().default({}).notNull(),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'module_app_records_scope_owner_check',
      sql`(
        (${table.scopeType} = 'personal' AND ${table.ownerUserId} IS NOT NULL AND ${table.workspaceId} IS NULL)
        OR (${table.scopeType} = 'workspace' AND ${table.workspaceId} IS NOT NULL)
      )`,
    ),
    index('module_app_records_personal_idx').on(
      table.appId,
      table.scopeType,
      table.ownerUserId,
      table.collectionKey,
      table.updatedAt,
    ),
    index('module_app_records_workspace_idx').on(
      table.appId,
      table.scopeType,
      table.workspaceId,
      table.collectionKey,
      table.updatedAt,
    ),
    index('module_app_records_record_key_idx').on(
      table.appId,
      table.collectionKey,
      table.recordKey,
    ),
    index('module_app_records_installation_updated_at_idx').on(
      table.installationId,
      table.updatedAt,
    ),
  ],
);

export type NewModuleAppRecord = typeof moduleAppRecords.$inferInsert;
export type ModuleAppRecordItem = typeof moduleAppRecords.$inferSelect;

export const moduleAppRecordEvents = pgTable(
  'module_app_record_events',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    recordId: uuid('record_id')
      .references(() => moduleAppRecords.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    scopeType: text('scope_type').$type<ModuleAppScopeType>().notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    beforeSnapshot: jsonb('before_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
    afterSnapshot: jsonb('after_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('module_app_record_events_record_id_created_at_idx').on(table.recordId, table.createdAt),
  ],
);

export type NewModuleAppRecordEvent = typeof moduleAppRecordEvents.$inferInsert;
export type ModuleAppRecordEventItem = typeof moduleAppRecordEvents.$inferSelect;

export const moduleAppRuns = pgTable(
  'module_app_runs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    installationId: uuid('installation_id').references(() => moduleAppInstallations.id, {
      onDelete: 'cascade',
    }),
    versionId: uuid('version_id').references(() => moduleAppVersions.id, {
      onDelete: 'set null',
    }),
    actionId: uuid('action_id').references(() => moduleAppActions.id, {
      onDelete: 'set null',
    }),
    recordId: uuid('record_id').references(() => moduleAppRecords.id, {
      onDelete: 'set null',
    }),
    scopeType: text('scope_type').$type<ModuleAppScopeType>().notNull(),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<ModuleAppRunStatus>().default('queued').notNull(),
    inputSnapshot: jsonb('input_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
    outputSnapshot: jsonb('output_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
    billingSnapshot: jsonb('billing_snapshot')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    errorType: text('error_type'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('module_app_runs_user_id_created_at_idx').on(table.userId, table.createdAt),
    index('module_app_runs_workspace_id_created_at_idx').on(table.workspaceId, table.createdAt),
    index('module_app_runs_app_id_created_at_idx').on(table.appId, table.createdAt),
    index('module_app_runs_installation_id_created_at_idx').on(
      table.installationId,
      table.createdAt,
    ),
  ],
);

export type NewModuleAppRun = typeof moduleAppRuns.$inferInsert;
export type ModuleAppRunItem = typeof moduleAppRuns.$inferSelect;

export const moduleAppArtifacts = pgTable(
  'module_app_artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    installationId: uuid('installation_id').references(() => moduleAppInstallations.id, {
      onDelete: 'cascade',
    }),
    runId: uuid('run_id')
      .references(() => moduleAppRuns.id, { onDelete: 'cascade' })
      .notNull(),
    recordId: uuid('record_id').references(() => moduleAppRecords.id, {
      onDelete: 'set null',
    }),
    scopeType: text('scope_type').$type<ModuleAppScopeType>().notNull(),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    expiresAt: timestamptz('expires_at'),
    downloadCount: integer('download_count').default(0).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('module_app_artifacts_run_id_idx').on(table.runId),
    index('module_app_artifacts_installation_id_created_at_idx').on(
      table.installationId,
      table.createdAt,
    ),
  ],
);

export type NewModuleAppArtifact = typeof moduleAppArtifacts.$inferInsert;
export type ModuleAppArtifactItem = typeof moduleAppArtifacts.$inferSelect;

export const moduleAppArtifactCleanupJobs = pgTable(
  'module_app_artifact_cleanup_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id').notNull(),
    installationId: uuid('installation_id'),
    artifactId: uuid('artifact_id').notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status')
      .$type<'failed' | 'pending' | 'processing' | 'released'>()
      .default('pending')
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    lastError: text('last_error'),
    claimedAt: timestamptz('claimed_at'),
    releasedAt: timestamptz('released_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_artifact_cleanup_jobs_storage_key_unique').on(table.storageKey),
    index('module_app_artifact_cleanup_jobs_status_updated_idx').on(table.status, table.updatedAt),
    index('module_app_artifact_cleanup_jobs_installation_idx').on(table.installationId),
    check(
      'module_app_artifact_cleanup_jobs_status_check',
      sql`${table.status} IN ('pending', 'processing', 'released', 'failed')`,
    ),
    check('module_app_artifact_cleanup_jobs_attempt_count_check', sql`${table.attemptCount} >= 0`),
  ],
);

export type NewModuleAppArtifactCleanupJob = typeof moduleAppArtifactCleanupJobs.$inferInsert;
export type ModuleAppArtifactCleanupJobItem = typeof moduleAppArtifactCleanupJobs.$inferSelect;

export const moduleAppPackages = pgTable(
  'module_app_packages',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    publisherId: uuid('publisher_id').references(() => moduleAppPublishers.id, {
      onDelete: 'set null',
    }),
    appId: uuid('app_id').references(() => moduleApps.id, {
      onDelete: 'set null',
    }),
    versionId: uuid('version_id').references(() => moduleAppVersions.id, {
      onDelete: 'set null',
    }),
    submittedByUserId: text('submitted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedByUserId: text('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewStatus: text('review_status')
      .$type<ModuleAppPackageReviewStatus>()
      .default('pending_review')
      .notNull(),
    archive: jsonb('archive').$type<ModuleAppPackageArchiveMetadata>().notNull(),
    fileManifest: jsonb('file_manifest')
      .$type<ModuleAppPackageFileManifestItem[]>()
      .default([])
      .notNull(),
    manifestSnapshot: jsonb('manifest_snapshot').$type<ModuleAppPackageManifest>().notNull(),
    validationReport: jsonb('validation_report')
      .$type<ModuleAppPackageValidationIssue[]>()
      .default([])
      .notNull(),
    rejectionReason: text('rejection_reason'),
    reviewedAt: timestamptz('reviewed_at'),
    publishedAt: timestamptz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('module_app_packages_review_status_created_at_idx').on(
      table.reviewStatus,
      table.createdAt,
    ),
    index('module_app_packages_submitted_by_created_at_idx').on(
      table.submittedByUserId,
      table.createdAt,
    ),
    index('module_app_packages_app_id_created_at_idx').on(table.appId, table.createdAt),
    index('module_app_packages_publisher_review_idx').on(table.publisherId, table.reviewStatus),
  ],
);

export type NewModuleAppPackage = typeof moduleAppPackages.$inferInsert;
export type ModuleAppPackageItem = typeof moduleAppPackages.$inferSelect;

export const moduleAppBuilds = pgTable(
  'module_app_builds',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    packageId: uuid('package_id')
      .references(() => moduleAppPackages.id, { onDelete: 'cascade' })
      .notNull(),
    versionId: uuid('version_id')
      .references(() => moduleAppVersions.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').$type<ModuleAppBuildStatus>().default('queued').notNull(),
    sourceSha256: text('source_sha256').notNull(),
    artifactKey: text('artifact_key'),
    artifactSha256: text('artifact_sha256'),
    buildProfile: text('build_profile').$type<ModuleAppBuildProfile>().notNull(),
    workerId: text('worker_id'),
    claimedAt: timestamptz('claimed_at'),
    claimToken: text('claim_token'),
    claimExpiresAt: timestamptz('claim_expires_at'),
    attemptCount: integer('attempt_count').default(0).notNull(),
    nextAttemptAt: timestamptz('next_attempt_at').defaultNow().notNull(),
    completedAt: timestamptz('completed_at'),
    failureCode: text('failure_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_builds_version_id_unique').on(table.versionId),
    index('module_app_builds_status_created_at_idx').on(table.status, table.createdAt),
    index('module_app_builds_claimable_idx').on(
      table.status,
      table.nextAttemptAt,
      table.claimExpiresAt,
      table.createdAt,
    ),
    check(
      'module_app_builds_status_check',
      sql`${table.status} IN ('queued', 'building', 'ready', 'failed')`,
    ),
    check('module_app_builds_source_sha256_check', sql`${table.sourceSha256} ~ '^[a-f0-9]{64}$'`),
    check(
      'module_app_builds_attempt_count_check',
      sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= 4`,
    ),
  ],
);

export type NewModuleAppBuild = typeof moduleAppBuilds.$inferInsert;
export type ModuleAppBuildItem = typeof moduleAppBuilds.$inferSelect;

export const moduleAppPackageUploads = pgTable(
  'module_app_package_uploads',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    packageId: uuid('package_id').references(() => moduleAppPackages.id, {
      onDelete: 'set null',
    }),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    actualSizeBytes: integer('actual_size_bytes'),
    sha256: text('sha256'),
    status: text('status').$type<ModuleAppPackageUploadStatus>().default('issued').notNull(),
    scanStatus: text('scan_status')
      .$type<ModuleAppPackageScanStatus>()
      .default('pending')
      .notNull(),
    scanReport: jsonb('scan_report')
      .$type<ModuleAppPackageValidationIssue[]>()
      .default([])
      .notNull(),
    failureCode: text('failure_code'),
    storageReleasedAt: timestamptz('storage_released_at'),
    expiresAt: timestamptz('expires_at').notNull(),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_package_uploads_storage_key_unique').on(table.storageKey),
    uniqueIndex('module_app_package_uploads_package_id_unique').on(table.packageId),
    index('module_app_package_uploads_user_status_created_at_idx').on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    index('module_app_package_uploads_status_expires_at_idx').on(table.status, table.expiresAt),
    check(
      'module_app_package_uploads_status_check',
      sql`${table.status} IN ('issued', 'processing', 'submitted', 'rejected', 'failed', 'cleaning', 'expired')`,
    ),
    check(
      'module_app_package_uploads_scan_status_check',
      sql`${table.scanStatus} IN ('pending', 'clean', 'blocked', 'error')`,
    ),
  ],
);

export type NewModuleAppPackageUpload = typeof moduleAppPackageUploads.$inferInsert;
export type ModuleAppPackageUploadItem = typeof moduleAppPackageUploads.$inferSelect;

export const moduleAppDataSchemas = pgTable(
  'module_app_data_schemas',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    installationId: uuid('installation_id')
      .references(() => moduleAppInstallations.id, { onDelete: 'cascade' })
      .notNull(),
    tableKey: text('table_key').notNull(),
    version: integer('version').notNull(),
    schemaSnapshot: jsonb('schema_snapshot').$type<ModuleAppTableSchema>().notNull(),
    status: text('status').default('active').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('module_app_data_schemas_installation_table_version_unique').on(
      table.installationId,
      table.tableKey,
      table.version,
    ),
    index('module_app_data_schemas_installation_table_status_idx').on(
      table.installationId,
      table.tableKey,
      table.status,
    ),
    check('module_app_data_schemas_version_check', sql`${table.version} > 0`),
    check('module_app_data_schemas_status_check', sql`${table.status} IN ('active', 'retired')`),
  ],
);

export type NewModuleAppDataSchema = typeof moduleAppDataSchemas.$inferInsert;
export type ModuleAppDataSchemaItem = typeof moduleAppDataSchemas.$inferSelect;

export const moduleAppDataRows = pgTable(
  'module_app_data_rows',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    installationId: uuid('installation_id')
      .references(() => moduleAppInstallations.id, { onDelete: 'cascade' })
      .notNull(),
    tableKey: text('table_key').notNull(),
    rowKey: text('row_key').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    values: jsonb('values').$type<Record<string, unknown>>().default({}).notNull(),
    status: text('status').default('active').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_data_rows_installation_table_row_unique').on(
      table.installationId,
      table.tableKey,
      table.rowKey,
    ),
    foreignKey({
      columns: [table.installationId, table.tableKey, table.schemaVersion],
      foreignColumns: [
        moduleAppDataSchemas.installationId,
        moduleAppDataSchemas.tableKey,
        moduleAppDataSchemas.version,
      ],
      name: 'module_app_data_rows_schema_version_fk',
    }).onDelete('restrict'),
    index('module_app_data_rows_installation_table_status_updated_idx').on(
      table.installationId,
      table.tableKey,
      table.status,
      table.updatedAt,
    ),
    check('module_app_data_rows_schema_version_check', sql`${table.schemaVersion} > 0`),
    check('module_app_data_rows_status_check', sql`${table.status} IN ('active', 'archived')`),
  ],
);

export type NewModuleAppDataRow = typeof moduleAppDataRows.$inferInsert;
export type ModuleAppDataRowItem = typeof moduleAppDataRows.$inferSelect;

export const moduleAppWorkflowRuns = pgTable(
  'module_app_workflow_runs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    installationId: uuid('installation_id')
      .references(() => moduleAppInstallations.id, { onDelete: 'cascade' })
      .notNull(),
    workflowKey: text('workflow_key').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    status: text('status').$type<ModuleAppWorkflowRunStatus>().default('queued').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().default({}).notNull(),
    outputSummary: jsonb('output_summary').$type<Record<string, unknown>>().default({}).notNull(),
    errorCode: text('error_code'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_workflow_runs_installation_workflow_idempotency_unique').on(
      table.installationId,
      table.workflowKey,
      table.idempotencyKey,
    ),
    uniqueIndex('module_app_workflow_runs_id_installation_unique').on(
      table.id,
      table.installationId,
    ),
    index('module_app_workflow_runs_installation_status_created_idx').on(
      table.installationId,
      table.status,
      table.createdAt,
    ),
    check('module_app_workflow_runs_version_check', sql`${table.workflowVersion} > 0`),
    check(
      'module_app_workflow_runs_status_check',
      sql`${table.status} IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')`,
    ),
  ],
);

export type NewModuleAppWorkflowRun = typeof moduleAppWorkflowRuns.$inferInsert;
export type ModuleAppWorkflowRunItem = typeof moduleAppWorkflowRuns.$inferSelect;

export const moduleAppWorkflowNodes = pgTable(
  'module_app_workflow_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    installationId: uuid('installation_id')
      .references(() => moduleAppInstallations.id, { onDelete: 'cascade' })
      .notNull(),
    runId: uuid('run_id')
      .references(() => moduleAppWorkflowRuns.id, { onDelete: 'cascade' })
      .notNull(),
    nodeKey: text('node_key').notNull(),
    status: text('status').$type<ModuleAppWorkflowNodeStatus>().default('queued').notNull(),
    attempt: integer('attempt').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(1).notNull(),
    workerId: text('worker_id'),
    availableAt: timestamptz('available_at').defaultNow().notNull(),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    inputSummary: jsonb('input_summary').$type<Record<string, unknown>>().default({}).notNull(),
    outputSummary: jsonb('output_summary').$type<Record<string, unknown>>().default({}).notNull(),
    usage: jsonb('usage').$type<Record<string, unknown>>().default({}).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_workflow_nodes_run_node_unique').on(table.runId, table.nodeKey),
    foreignKey({
      columns: [table.runId, table.installationId],
      foreignColumns: [moduleAppWorkflowRuns.id, moduleAppWorkflowRuns.installationId],
      name: 'module_app_workflow_nodes_run_installation_fk',
    }).onDelete('cascade'),
    index('module_app_workflow_nodes_status_available_lease_idx').on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    index('module_app_workflow_nodes_installation_status_idx').on(
      table.installationId,
      table.status,
    ),
    check(
      'module_app_workflow_nodes_status_check',
      sql`${table.status} IN ('pending', 'queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'skipped')`,
    ),
    check(
      'module_app_workflow_nodes_attempt_check',
      sql`${table.attempt} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 10`,
    ),
  ],
);

export type NewModuleAppWorkflowNode = typeof moduleAppWorkflowNodes.$inferInsert;
export type ModuleAppWorkflowNodeItem = typeof moduleAppWorkflowNodes.$inferSelect;

export const moduleAppSchedules = pgTable(
  'module_app_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    installationId: uuid('installation_id')
      .references(() => moduleAppInstallations.id, { onDelete: 'cascade' })
      .notNull(),
    scheduleKey: text('schedule_key').notNull(),
    workflowKey: text('workflow_key').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    schedule: text('schedule').notNull(),
    timezone: text('timezone').notNull(),
    nextRunAt: timestamptz('next_run_at').notNull(),
    claimToken: text('claim_token'),
    claimExpiresAt: timestamptz('claim_expires_at'),
    enabled: boolean('enabled').default(true).notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_schedules_installation_key_unique').on(
      table.installationId,
      table.scheduleKey,
    ),
    index('module_app_schedules_enabled_next_run_idx').on(table.enabled, table.nextRunAt),
    check('module_app_schedules_version_check', sql`${table.workflowVersion} > 0`),
  ],
);

export type NewModuleAppSchedule = typeof moduleAppSchedules.$inferInsert;
export type ModuleAppScheduleItem = typeof moduleAppSchedules.$inferSelect;

export const moduleAppWebhooks = pgTable(
  'module_app_webhooks',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    installationId: uuid('installation_id')
      .references(() => moduleAppInstallations.id, { onDelete: 'cascade' })
      .notNull(),
    webhookKey: text('webhook_key').notNull(),
    workflowKey: text('workflow_key').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    secretHash: text('secret_hash').notNull(),
    replayWindowSeconds: integer('replay_window_seconds').default(300).notNull(),
    status: text('status').default('active').notNull(),
    lastDeliveryAt: timestamptz('last_delivery_at'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_webhooks_installation_key_unique').on(
      table.installationId,
      table.webhookKey,
    ),
    check('module_app_webhooks_version_check', sql`${table.workflowVersion} > 0`),
    check(
      'module_app_webhooks_replay_window_check',
      sql`${table.replayWindowSeconds} BETWEEN 30 AND 3600`,
    ),
    check('module_app_webhooks_status_check', sql`${table.status} IN ('active', 'disabled')`),
  ],
);

export type NewModuleAppWebhook = typeof moduleAppWebhooks.$inferInsert;
export type ModuleAppWebhookItem = typeof moduleAppWebhooks.$inferSelect;

export const moduleAppWebhookDeliveries = pgTable(
  'module_app_webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    webhookId: uuid('webhook_id')
      .references(() => moduleAppWebhooks.id, { onDelete: 'cascade' })
      .notNull(),
    deliveryId: text('delivery_id').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    status: text('status').default('accepted').notNull(),
    receivedAt: timestamptz('received_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('module_app_webhook_deliveries_webhook_delivery_unique').on(
      table.webhookId,
      table.deliveryId,
    ),
    index('module_app_webhook_deliveries_received_at_idx').on(table.receivedAt),
    check(
      'module_app_webhook_deliveries_payload_sha256_check',
      sql`${table.payloadSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'module_app_webhook_deliveries_status_check',
      sql`${table.status} IN ('accepted', 'processed', 'failed')`,
    ),
  ],
);

export type NewModuleAppWebhookDelivery = typeof moduleAppWebhookDeliveries.$inferInsert;
export type ModuleAppWebhookDeliveryItem = typeof moduleAppWebhookDeliveries.$inferSelect;

export const moduleAppProducts = pgTable(
  'module_app_products',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'cascade' })
      .notNull(),
    productKey: text('product_key').notNull(),
    productType: text('product_type').notNull(),
    licenseScope: text('license_scope').notNull(),
    status: text('status').default('active').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('module_app_products_app_key_unique').on(table.appId, table.productKey)],
);

export const moduleAppPrices = pgTable('module_app_prices', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  productId: uuid('product_id')
    .references(() => moduleAppProducts.id, { onDelete: 'cascade' })
    .notNull(),
  currency: varchar('currency', { length: 16 }).notNull(),
  amount: numeric('amount', { mode: 'number', precision: 20, scale: 6 }).notNull(),
  billingPeriod: text('billing_period'),
  trialDays: integer('trial_days').default(0).notNull(),
  promotion: jsonb('promotion').$type<Record<string, unknown>>(),
  active: boolean('active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const moduleAppOrders = pgTable(
  'module_app_orders',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'restrict' })
      .notNull(),
    productId: uuid('product_id')
      .references(() => moduleAppProducts.id, { onDelete: 'restrict' })
      .notNull(),
    priceId: uuid('price_id')
      .references(() => moduleAppPrices.id, { onDelete: 'restrict' })
      .notNull(),
    purchaserUserId: text('purchaser_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key')
      .default(sql`gen_random_uuid()::text`)
      .notNull(),
    status: text('status').default('pending').notNull(),
    paymentReference: text('payment_reference'),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    paidAt: timestamptz('paid_at'),
    cancelledAt: timestamptz('cancelled_at'),
    refundedAt: timestamptz('refunded_at'),
    refundReference: text('refund_reference'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_orders_purchaser_idempotency_unique').on(
      table.purchaserUserId,
      table.idempotencyKey,
    ),
  ],
);

export const moduleAppPaymentAttempts = pgTable(
  'module_app_payment_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    orderId: uuid('order_id')
      .references(() => moduleAppOrders.id, { onDelete: 'restrict' })
      .notNull(),
    provider: text('provider').$type<ModuleAppPaymentProvider>().notNull(),
    method: text('method').$type<PaymentMethodId>().default('alipay').notNull(),
    outTradeNo: text('out_trade_no').notNull(),
    subject: text('subject').notNull(),
    totalAmount: numeric('total_amount', { precision: 20, scale: 6 }).notNull(),
    currency: varchar('currency', { length: 16 }).notNull(),
    returnUrl: text('return_url').notNull(),
    notifyUrl: text('notify_url').notNull(),
    status: text('status').$type<ModuleAppPaymentAttemptStatus>().default('created').notNull(),
    providerTransactionId: text('provider_transaction_id'),
    lastError: text('last_error'),
    checkout: jsonb('checkout').$type<PaymentCheckoutAction>(),
    paidAt: timestamptz('paid_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_payment_attempts_order_unique').on(table.orderId),
    uniqueIndex('module_app_payment_attempts_provider_out_trade_no_unique').on(
      table.provider,
      table.outTradeNo,
    ),
    index('module_app_payment_attempts_order_status_idx').on(table.orderId, table.status),
    check(
      'module_app_payment_attempts_provider_check',
      sql`${table.provider} IN ('alipay', 'wechat_pay', 'zpay')`,
    ),
    check(
      'module_app_payment_attempts_method_check',
      sql`${table.method} IN ('alipay', 'wechat_pay', 'zpay_alipay', 'zpay_wechat')`,
    ),
    check(
      'module_app_payment_attempts_status_check',
      sql`${table.status} IN ('created', 'pending', 'paid', 'failed', 'refunded')`,
    ),
    check('module_app_payment_attempts_amount_check', sql`${table.totalAmount} > 0`),
  ],
);

export const moduleAppPaymentEvents = pgTable(
  'module_app_payment_events',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    provider: text('provider').$type<ModuleAppPaymentProvider>().notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').$type<ModuleAppPaymentEventType>().notNull(),
    eventStatus: text('event_status')
      .$type<ModuleAppPaymentEventStatus>()
      .default('received')
      .notNull(),
    orderId: uuid('order_id').references(() => moduleAppOrders.id, { onDelete: 'set null' }),
    outTradeNo: text('out_trade_no').notNull(),
    paymentReference: text('payment_reference'),
    providerTransactionId: text('provider_transaction_id'),
    totalAmount: numeric('total_amount', { precision: 20, scale: 6 }).notNull(),
    currency: varchar('currency', { length: 16 }).notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    errorCode: text('error_code'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
    processedAt: timestamptz('processed_at'),
  },
  (table) => [
    uniqueIndex('module_app_payment_events_provider_event_unique').on(
      table.provider,
      table.providerEventId,
    ),
    index('module_app_payment_events_out_trade_no_created_idx').on(
      table.outTradeNo,
      table.createdAt,
    ),
    check(
      'module_app_payment_events_provider_check',
      sql`${table.provider} IN ('alipay', 'wechat_pay', 'zpay')`,
    ),
    check(
      'module_app_payment_events_type_check',
      sql`${table.eventType} IN ('payment_succeeded', 'payment_failed', 'refund_succeeded')`,
    ),
    check(
      'module_app_payment_events_status_check',
      sql`${table.eventStatus} IN ('received', 'processed', 'ignored', 'rejected')`,
    ),
    check('module_app_payment_events_amount_check', sql`${table.totalAmount} >= 0`),
  ],
);

export const moduleAppPaymentRefunds = pgTable(
  'module_app_payment_refunds',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    orderId: uuid('order_id')
      .references(() => moduleAppOrders.id, { onDelete: 'restrict' })
      .notNull(),
    provider: text('provider').$type<ModuleAppPaymentProvider>().notNull(),
    providerRefundId: text('provider_refund_id').notNull(),
    refundAmount: numeric('refund_amount', { precision: 20, scale: 6 }).notNull(),
    currency: varchar('currency', { length: 16 }).notNull(),
    reason: text('reason').notNull(),
    status: text('status').$type<ModuleAppPaymentRefundStatus>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_payment_refunds_provider_refund_unique').on(
      table.provider,
      table.providerRefundId,
    ),
    index('module_app_payment_refunds_order_created_idx').on(table.orderId, table.createdAt),
    check(
      'module_app_payment_refunds_provider_check',
      sql`${table.provider} IN ('alipay', 'wechat_pay', 'zpay')`,
    ),
    check(
      'module_app_payment_refunds_status_check',
      sql`${table.status} IN ('requested', 'succeeded', 'failed')`,
    ),
    check('module_app_payment_refunds_amount_check', sql`${table.refundAmount} > 0`),
  ],
);

export const moduleAppPaymentDiscrepancies = pgTable(
  'module_app_payment_discrepancies',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    provider: text('provider').$type<ModuleAppPaymentProvider>().notNull(),
    discrepancyKey: text('discrepancy_key').notNull(),
    kind: text('kind').$type<ModuleAppPaymentDiscrepancyKind>().notNull(),
    orderId: uuid('order_id').references(() => moduleAppOrders.id, { onDelete: 'set null' }),
    outTradeNo: text('out_trade_no').notNull(),
    expectedAmount: numeric('expected_amount', { precision: 20, scale: 6 }),
    actualAmount: numeric('actual_amount', { precision: 20, scale: 6 }),
    expectedCurrency: varchar('expected_currency', { length: 16 }),
    actualCurrency: varchar('actual_currency', { length: 16 }),
    details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
    status: text('status').default('open').notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamptz('resolved_at'),
  },
  (table) => [
    uniqueIndex('module_app_payment_discrepancies_provider_key_unique').on(
      table.provider,
      table.discrepancyKey,
    ),
    index('module_app_payment_discrepancies_status_created_idx').on(table.status, table.createdAt),
    check(
      'module_app_payment_discrepancies_provider_check',
      sql`${table.provider} IN ('alipay', 'wechat_pay', 'zpay')`,
    ),
    check(
      'module_app_payment_discrepancies_kind_check',
      sql`${table.kind} IN ('amount_mismatch', 'currency_mismatch', 'duplicate_event', 'local_paid_provider_unpaid', 'local_unpaid_provider_paid', 'order_not_found', 'provider_mismatch', 'refund_mismatch', 'settlement_failed', 'wrong_seller')`,
    ),
    check(
      'module_app_payment_discrepancies_status_check',
      sql`${table.status} IN ('open', 'resolved')`,
    ),
  ],
);

export const moduleAppLicenses = pgTable('module_app_licenses', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  appId: uuid('app_id')
    .references(() => moduleApps.id, { onDelete: 'restrict' })
    .notNull(),
  orderId: uuid('order_id')
    .references(() => moduleAppOrders.id, { onDelete: 'restrict' })
    .notNull(),
  licenseScope: text('license_scope').notNull(),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'restrict' }),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'restrict' }),
  seatCount: integer('seat_count'),
  status: text('status').default('active').notNull(),
  startsAt: timestamptz('starts_at').defaultNow().notNull(),
  endsAt: timestamptz('ends_at'),
  revokedAt: timestamptz('revoked_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const moduleAppSubscriptions = pgTable('module_app_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  licenseId: uuid('license_id')
    .references(() => moduleAppLicenses.id, { onDelete: 'restrict' })
    .notNull(),
  orderId: uuid('order_id')
    .references(() => moduleAppOrders.id, { onDelete: 'restrict' })
    .notNull(),
  status: text('status').notNull(),
  currentPeriodStart: timestamptz('current_period_start').notNull(),
  currentPeriodEnd: timestamptz('current_period_end').notNull(),
  trialEndsAt: timestamptz('trial_ends_at'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const moduleAppRevenueEntries = pgTable(
  'module_app_revenue_entries',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    appId: uuid('app_id')
      .references(() => moduleApps.id, { onDelete: 'restrict' })
      .notNull(),
    orderId: uuid('order_id')
      .references(() => moduleAppOrders.id, { onDelete: 'restrict' })
      .notNull(),
    publisherUserId: text('publisher_user_id').references(() => users.id, { onDelete: 'set null' }),
    publisherId: uuid('publisher_id').references(() => moduleAppPublishers.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    grossAmount: numeric('gross_amount', { mode: 'number', precision: 20, scale: 6 }).notNull(),
    platformFee: numeric('platform_fee', { mode: 'number', precision: 20, scale: 6 }).notNull(),
    reserveAmount: numeric('reserve_amount', { mode: 'number', precision: 20, scale: 6 }).notNull(),
    developerAmount: numeric('developer_amount', {
      mode: 'number',
      precision: 20,
      scale: 6,
    }).notNull(),
    currency: varchar('currency', { length: 16 }).notNull(),
    status: text('status').default('pending').notNull(),
    settlementBatchId: uuid('settlement_batch_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
    settledAt: timestamptz('settled_at'),
  },
  (table) => [
    uniqueIndex('module_app_revenue_entries_order_type_unique').on(table.orderId, table.type),
    index('module_app_revenue_entries_publisher_status_created_idx').on(
      table.publisherUserId,
      table.status,
      table.createdAt,
    ),
    index('module_app_revenue_entries_publisher_id_status_idx').on(table.publisherId, table.status),
  ],
);

export const moduleAppPayoutBatches = pgTable(
  'module_app_payout_batches',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    publisherId: uuid('publisher_id')
      .references(() => moduleAppPublishers.id, { onDelete: 'restrict' })
      .notNull(),
    status: text('status').$type<ModuleAppPayoutStatus>().default('pending').notNull(),
    currency: varchar('currency', { length: 16 }).notNull(),
    totalAmount: numeric('total_amount', { mode: 'number', precision: 20, scale: 6 }).notNull(),
    paymentMethod: text('payment_method').default('alipay').notNull(),
    recipientMask: text('recipient_mask'),
    transactionNo: text('transaction_no'),
    evidenceReference: text('evidence_reference'),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    failureReason: text('failure_reason'),
    processedAt: timestamptz('processed_at'),
    paidAt: timestamptz('paid_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_payout_batches_transaction_unique').on(table.transactionNo),
    index('module_app_payout_batches_publisher_status_created_idx').on(
      table.publisherId,
      table.status,
      table.createdAt,
    ),
    check(
      'module_app_payout_batches_status_check',
      sql`${table.status} IN ('pending', 'eligible', 'processing', 'paid', 'failed', 'reversed')`,
    ),
    check('module_app_payout_batches_amount_check', sql`${table.totalAmount} > 0`),
    check('module_app_payout_batches_method_check', sql`${table.paymentMethod} IN ('alipay')`),
  ],
);

export const moduleAppPayoutEntries = pgTable(
  'module_app_payout_entries',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    batchId: uuid('batch_id')
      .references(() => moduleAppPayoutBatches.id, { onDelete: 'cascade' })
      .notNull(),
    revenueEntryId: uuid('revenue_entry_id')
      .references(() => moduleAppRevenueEntries.id, { onDelete: 'restrict' })
      .notNull(),
    amount: numeric('amount', { mode: 'number', precision: 20, scale: 6 }).notNull(),
    status: text('status').$type<ModuleAppPayoutStatus>().default('eligible').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('module_app_payout_entries_revenue_unique')
      .on(table.revenueEntryId)
      .where(sql`${table.status} <> 'reversed'`),
    index('module_app_payout_entries_batch_status_idx').on(table.batchId, table.status),
    check(
      'module_app_payout_entries_status_check',
      sql`${table.status} IN ('pending', 'eligible', 'processing', 'paid', 'failed', 'reversed')`,
    ),
    check('module_app_payout_entries_amount_check', sql`${table.amount} > 0`),
  ],
);

export const moduleAppAuditLogs = pgTable(
  'module_app_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    eventType: text('event_type').notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('module_app_audit_logs_resource_type_resource_id_created_at_idx').on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
  ],
);

export type NewModuleAppAuditLog = typeof moduleAppAuditLogs.$inferInsert;
export type ModuleAppAuditLogItem = typeof moduleAppAuditLogs.$inferSelect;
