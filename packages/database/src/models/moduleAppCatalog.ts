import type {
  ModuleAppActionConfig,
  ModuleAppAdminUpsertInput,
  ModuleAppMarketplaceListInput,
  ModuleAppOutboundHostPolicy,
  ModuleAppPackageReviewStatus,
  ModuleAppPackageScanStatus,
  ModuleAppPackageSubmitInput,
  ModuleAppPackageValidationIssue,
  ModuleAppPage,
  ModuleAppPlanEntitlement,
  ModuleAppStatus,
} from '@lobechat/types';
import {
  assertModuleAppOutboundHostPolicyCoverage,
  MODULE_APP_PACKAGE_MAX_SCAN_ISSUES,
  moduleAppPackageManifestSchema,
  moduleAppPackageSubmitSchema,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import {
  moduleAppActions,
  moduleAppBuilds,
  moduleAppEntitlements,
  moduleAppInstallations,
  moduleAppPackages,
  moduleAppPackageUploads,
  moduleAppPages,
  moduleAppPublishers,
  moduleApps,
  moduleAppVersions,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

const DEFAULT_VERSION = '1.0.0';
const INSTALL_STATUS_ACTIVE = 'installed';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DbExecutor = LobeChatDatabase | Transaction;
type ModuleAppRow = typeof moduleApps.$inferSelect;
type ModuleAppActionRow = typeof moduleAppActions.$inferSelect;
type ModuleAppEntitlementRow = typeof moduleAppEntitlements.$inferSelect;
type ModuleAppPackageRow = typeof moduleAppPackages.$inferSelect;
type ModuleAppPageRow = typeof moduleAppPages.$inferSelect;
type ModuleAppVersionRow = typeof moduleAppVersions.$inferSelect;

const serializeAdminPackageSubmission = (
  packageRow: ModuleAppPackageRow,
  scanStatus: ModuleAppPackageScanStatus | null,
  build?: { failureCode: null | string; status: null | string },
) => ({
  ...packageRow,
  archive: {
    fileName: packageRow.archive.fileName,
    mimeType: packageRow.archive.mimeType,
    sizeBytes: packageRow.archive.sizeBytes,
  },
  fileManifest: packageRow.fileManifest.map(({ path, sizeBytes }) => ({ path, sizeBytes })),
  scanStatus: scanStatus ?? 'pending',
  buildFailureCode: build?.failureCode ?? null,
  buildStatus: build?.status ?? null,
  validationReport: packageRow.validationReport.slice(0, MODULE_APP_PACKAGE_MAX_SCAN_ISSUES),
});

const buildPlanState = (entitlement?: ModuleAppEntitlementRow | null) => ({
  installable: entitlement?.installable ?? false,
  runnable: entitlement?.runnable ?? false,
  visible: entitlement?.visible ?? false,
});

const aggregatePlanState = (entitlements: ModuleAppEntitlementRow[]) =>
  entitlements.reduce(
    (state, entitlement) => ({
      installable: state.installable || entitlement.installable,
      runnable: state.runnable || entitlement.runnable,
      visible: state.visible || entitlement.visible,
    }),
    { installable: false, runnable: false, visible: false },
  );

const toListItem = (
  app: ModuleAppRow,
  entitlement: ModuleAppEntitlementRow | null | undefined,
  installed: boolean,
) => ({
  appType: app.appType,
  billing: app.billing,
  category: app.category,
  displayName: app.displayName,
  icon: app.icon,
  id: app.id,
  installed,
  planState: buildPlanState(entitlement),
  slug: app.slug,
  source: app.source,
  status: app.status,
  tags: app.tags,
});

const toPageConfig = (page: ModuleAppPageRow): ModuleAppPage => ({
  actionBindings: page.actionBindings,
  dataSource: page.dataSource,
  key: page.pageKey,
  layoutSchema: page.layoutSchema,
  routePath: page.routePath,
  sortOrder: page.sortOrder,
  title: page.title,
  type: page.pageType as ModuleAppPage['type'],
});

const toActionConfig = (action: ModuleAppActionRow): ModuleAppActionConfig => ({
  id: action.actionKey,
  inputSchema: action.inputSchema,
  moduleMultiplier: action.moduleMultiplier,
  name: action.name,
  outputSchema: action.outputSchema,
  runtimeConfig: action.runtimeConfig,
  runtimeType: action.runtimeType,
});

const toEntitlementConfig = (entitlement: ModuleAppEntitlementRow): ModuleAppPlanEntitlement => ({
  discountPercent: entitlement.discountPercent,
  freeQuotaCredits: entitlement.freeQuotaCredits,
  installable: entitlement.installable,
  plan: entitlement.plan,
  runnable: entitlement.runnable,
  visible: entitlement.visible,
});

const normalizePackageManifestForApproval = (manifest: ModuleAppPackageRow['manifestSnapshot']) => {
  const parsed = moduleAppPackageManifestSchema.parse(manifest);

  return {
    app: parsed.app,
    build: parsed.manifestVersion === 2 ? parsed.build : undefined,
    entitlements: parsed.entitlements,
    manifestVersion: parsed.manifestVersion,
    packageVersion: parsed.packageVersion,
    runtime: parsed.runtime,
  };
};

export const assertModuleAppPackageAppOwnership = (
  existingApp: null | Pick<ModuleAppRow, 'publisherId'> | undefined,
  publisherId: string,
) => {
  if (existingApp && existingApp.publisherId !== publisherId) {
    throw new Error('MODULE_APP_PACKAGE_APP_OWNERSHIP_MISMATCH');
  }
};

const matchesMarketplaceFilters = (
  app: ReturnType<typeof toListItem>,
  filters?: ModuleAppMarketplaceListInput,
) => {
  const query = filters?.query?.toLowerCase();
  const matchesCategory = !filters?.category || app.category === filters.category;
  const matchesType = !filters?.appType || app.appType === filters.appType;
  const matchesQuery =
    !query ||
    app.displayName.toLowerCase().includes(query) ||
    app.slug.toLowerCase().includes(query) ||
    app.category.toLowerCase().includes(query) ||
    app.tags.some((tag) => tag.toLowerCase().includes(query));

  return matchesCategory && matchesType && matchesQuery;
};

export class ModuleAppCatalogModel {
  constructor(protected readonly db: LobeChatDatabase) {}

  protected aggregatePlanState = aggregatePlanState;

  protected toListItem = toListItem;

  private findAppBySlug = async (slug: string, db: DbExecutor = this.db) => {
    return db.query.moduleApps.findFirst({
      where: eq(moduleApps.slug, slug),
    });
  };

  private findAppByIdOrSlug = async (appIdOrSlug: string, db: DbExecutor = this.db) => {
    if (UUID_PATTERN.test(appIdOrSlug)) {
      return db.query.moduleApps.findFirst({
        where: eq(moduleApps.id, appIdOrSlug),
      });
    }

    return this.findAppBySlug(appIdOrSlug, db);
  };

  private findAppForUpsert = async (input: ModuleAppAdminUpsertInput, db: DbExecutor = this.db) => {
    if (input.id) {
      const byId = await db.query.moduleApps.findFirst({
        where: eq(moduleApps.id, input.id),
      });

      if (byId) return byId;
    }

    return this.findAppBySlug(input.slug, db);
  };

  private getLatestVersion = async (appId: string, db: DbExecutor = this.db) => {
    return db.query.moduleAppVersions.findFirst({
      orderBy: [desc(moduleAppVersions.createdAt)],
      where: eq(moduleAppVersions.appId, appId),
    });
  };

  protected getCurrentPublishedVersion = async (appId: string, db: DbExecutor = this.db) => {
    const app = await db.query.moduleApps.findFirst({
      where: and(eq(moduleApps.id, appId), eq(moduleApps.status, 'published')),
    });
    if (!app?.currentPublishedVersionId) return null;

    return (
      (await db.query.moduleAppVersions.findFirst({
        where: and(
          eq(moduleAppVersions.id, app.currentPublishedVersionId),
          eq(moduleAppVersions.appId, appId),
          isNotNull(moduleAppVersions.publishedAt),
        ),
      })) ?? null
    );
  };

  protected getCurrentPublishedVersionId = async (appId: string) => {
    const version = await this.getCurrentPublishedVersion(appId);
    if (!version) throw new Error('MODULE_APP_PUBLISHED_VERSION_NOT_FOUND');
    return version.id;
  };

  protected getLatestVersionId = async (appId: string) => {
    const version = await this.getLatestVersion(appId);

    if (!version) throw new Error('MODULE_APP_VERSION_NOT_FOUND');

    return version.id;
  };

  private ensureVersionSnapshot = async (
    appId: string,
    input: ModuleAppAdminUpsertInput,
    db: DbExecutor,
  ): Promise<ModuleAppVersionRow> => {
    const existingVersion = await this.getLatestVersion(appId, db);
    const publishedAt =
      input.status === 'published' ? (existingVersion?.publishedAt ?? new Date()) : null;
    const manifestSnapshot = {
      actions: input.actions,
      appType: input.appType,
      billing: input.billing,
      category: input.category,
      description: input.description,
      displayName: input.displayName,
      icon: input.icon,
      pages: input.pages,
      slug: input.slug,
      source: input.source,
      status: input.status,
      tags: input.tags,
    } satisfies Record<string, unknown>;

    if (existingVersion && !existingVersion.publishedAt) {
      const [version] = await db
        .update(moduleAppVersions)
        .set({
          changelog: '',
          manifestSnapshot,
          publishedAt,
          rollbackSourceVersionId: null,
          version: existingVersion.version || DEFAULT_VERSION,
        })
        .where(eq(moduleAppVersions.id, existingVersion.id))
        .returning();

      return version;
    }

    const [version] = await db
      .insert(moduleAppVersions)
      .values({
        appId,
        changelog: '',
        manifestSnapshot,
        publishedAt,
        rollbackSourceVersionId: existingVersion?.id ?? null,
        version: existingVersion?.version || DEFAULT_VERSION,
      })
      .returning();

    return version;
  };

  private ensureMutableDraftVersion = async (appId: string, db: DbExecutor) => {
    const latest = await this.getLatestVersion(appId, db);
    if (!latest) throw new Error('MODULE_APP_VERSION_NOT_FOUND');
    if (!latest.publishedAt) return latest;

    const [draft] = await db
      .insert(moduleAppVersions)
      .values({
        appId,
        changelog: latest.changelog,
        manifestSnapshot: latest.manifestSnapshot,
        publishedAt: null,
        rollbackSourceVersionId: latest.id,
        runtimeManifest: latest.runtimeManifest,
        version: latest.version,
      })
      .returning();
    if (!draft) throw new Error('MODULE_APP_VERSION_CREATE_FAILED');

    const [pages, actions] = await Promise.all([
      db.query.moduleAppPages.findMany({
        where: and(eq(moduleAppPages.appId, appId), eq(moduleAppPages.versionId, latest.id)),
      }),
      db.query.moduleAppActions.findMany({
        where: and(eq(moduleAppActions.appId, appId), eq(moduleAppActions.versionId, latest.id)),
      }),
    ]);
    if (pages.length > 0) {
      await db.insert(moduleAppPages).values(
        pages.map((page) => ({
          actionBindings: page.actionBindings,
          appId,
          dataSource: page.dataSource,
          layoutSchema: page.layoutSchema,
          pageKey: page.pageKey,
          pageType: page.pageType,
          routePath: page.routePath,
          sortOrder: page.sortOrder,
          title: page.title,
          versionId: draft.id,
        })),
      );
    }
    if (actions.length > 0) {
      await db.insert(moduleAppActions).values(
        actions.map((action) => ({
          actionKey: action.actionKey,
          appId,
          inputSchema: action.inputSchema,
          moduleMultiplier: action.moduleMultiplier,
          name: action.name,
          outputSchema: action.outputSchema,
          runtimeConfig: action.runtimeConfig,
          runtimeType: action.runtimeType,
          versionId: draft.id,
        })),
      );
    }

    return draft;
  };

  private replacePagesAndActions = async (
    appId: string,
    versionId: string,
    input: Pick<ModuleAppAdminUpsertInput, 'actions' | 'pages'>,
    db: DbExecutor,
  ) => {
    await db
      .delete(moduleAppPages)
      .where(and(eq(moduleAppPages.appId, appId), eq(moduleAppPages.versionId, versionId)));
    await db
      .delete(moduleAppActions)
      .where(and(eq(moduleAppActions.appId, appId), eq(moduleAppActions.versionId, versionId)));

    if (input.pages.length > 0) {
      await db.insert(moduleAppPages).values(
        input.pages.map((page) => ({
          actionBindings: page.actionBindings,
          appId,
          dataSource: page.dataSource,
          layoutSchema: page.layoutSchema,
          pageKey: page.key,
          pageType: page.type,
          routePath: page.routePath,
          sortOrder: page.sortOrder,
          title: page.title,
          versionId,
        })),
      );
    }

    if (input.actions.length > 0) {
      await db.insert(moduleAppActions).values(
        input.actions.map((action) => ({
          actionKey: action.id,
          appId,
          inputSchema: action.inputSchema,
          moduleMultiplier: action.moduleMultiplier,
          name: action.name,
          outputSchema: action.outputSchema,
          runtimeConfig: action.runtimeConfig,
          runtimeType: action.runtimeType,
          versionId,
        })),
      );
    }
  };

  private upsertAppForAdminWithExecutor = async (
    input: ModuleAppAdminUpsertInput,
    db: DbExecutor,
    publisherId?: string,
  ): Promise<{ id: string; slug: string }> => {
    const found = await this.findAppForUpsert(input, db);
    const [existing] = found
      ? await db.select().from(moduleApps).where(eq(moduleApps.id, found.id)).for('update')
      : [];
    const preserveCurrentPublication =
      existing?.status === 'published' &&
      input.status === 'draft' &&
      Boolean(existing.currentPublishedVersionId);
    const appValues = {
      appType: input.appType,
      billing: input.billing,
      category: input.category,
      description: input.description,
      displayName: input.displayName,
      icon: input.icon,
      metadata: {},
      ...(publisherId ? { publisherId } : {}),
      slug: input.slug,
      source: input.source,
      status: preserveCurrentPublication ? ('published' as const) : input.status,
      tags: input.tags,
    };

    let app: ModuleAppRow;

    if (existing) {
      const [updated] = await db
        .update(moduleApps)
        .set({ ...appValues, updatedAt: new Date() })
        .where(
          publisherId
            ? and(eq(moduleApps.id, existing.id), eq(moduleApps.publisherId, publisherId))
            : eq(moduleApps.id, existing.id),
        )
        .returning();
      if (!updated && publisherId) {
        throw new Error('MODULE_APP_PACKAGE_APP_OWNERSHIP_MISMATCH');
      }
      app = updated;
    } else {
      const [inserted] = await db
        .insert(moduleApps)
        .values({ ...appValues, id: input.id })
        .returning();
      app = inserted;
    }

    const version = await this.ensureVersionSnapshot(app.id, input, db);
    await this.replacePagesAndActions(app.id, version.id, input, db);
    await db
      .update(moduleApps)
      .set({
        currentPublishedVersionId:
          input.status === 'published'
            ? version.id
            : preserveCurrentPublication
              ? existing?.currentPublishedVersionId
              : null,
        updatedAt: new Date(),
      })
      .where(eq(moduleApps.id, app.id));

    return { id: app.id, slug: app.slug };
  };

  private replaceEntitlementsForAdmin = async (
    params: {
      appId: string;
      entitlements: ModuleAppPlanEntitlement[];
    },
    db: DbExecutor,
  ) => {
    await db.delete(moduleAppEntitlements).where(eq(moduleAppEntitlements.appId, params.appId));

    if (params.entitlements.length > 0) {
      await db.insert(moduleAppEntitlements).values(
        params.entitlements.map((entitlement) => ({
          appId: params.appId,
          discountPercent: entitlement.discountPercent,
          freeQuotaCredits: entitlement.freeQuotaCredits,
          installable: entitlement.installable,
          plan: entitlement.plan,
          runnable: entitlement.runnable,
          visible: entitlement.visible,
        })),
      );
    }
  };

  upsertAppForAdmin = async (
    input: ModuleAppAdminUpsertInput,
  ): Promise<{ id: string; slug: string }> => {
    return this.db.transaction((tx) => this.upsertAppForAdminWithExecutor(input, tx));
  };

  createPackageSubmission = async (
    params: ModuleAppPackageSubmitInput & {
      submittedByUserId: string;
      validationReport?: ModuleAppPackageValidationIssue[];
    },
  ) => {
    const parsed = moduleAppPackageSubmitSchema.parse(params);
    const manifestSnapshot = {
      ...parsed.manifest,
      app: { ...parsed.manifest.app, source: 'developer' as const },
    };
    const [submission] = await this.db
      .insert(moduleAppPackages)
      .values({
        archive: parsed.archive,
        fileManifest: parsed.fileManifest,
        manifestSnapshot,
        reviewStatus: 'pending_review',
        submittedByUserId: params.submittedByUserId,
        validationReport: params.validationReport ?? [],
      })
      .returning();

    return submission;
  };

  getPackageSubmissionForLifecycle = async (params: { packageId: string }) => {
    return (
      (await this.db.query.moduleAppPackages.findFirst({
        where: eq(moduleAppPackages.id, params.packageId),
      })) ?? null
    );
  };

  listAdminPackageSubmissions = async (
    params: {
      appId?: string;
      cursor?: number;
      limit?: number;
      reviewStatus?: ModuleAppPackageReviewStatus;
      submittedByUserId?: string;
    } = {},
  ) => {
    const limit = params.limit ?? 50;
    const cursor = params.cursor ?? 0;
    const conditions: Array<SQL | undefined> = [
      params.reviewStatus ? eq(moduleAppPackages.reviewStatus, params.reviewStatus) : undefined,
      params.submittedByUserId
        ? eq(moduleAppPackages.submittedByUserId, params.submittedByUserId)
        : undefined,
      params.appId ? eq(moduleAppPackages.appId, params.appId) : undefined,
    ];
    const filters = conditions.filter((condition): condition is SQL => condition !== undefined);

    const rows = await this.db
      .select({
        buildFailureCode: moduleAppBuilds.failureCode,
        buildStatus: moduleAppBuilds.status,
        packageRow: moduleAppPackages,
        scanStatus: moduleAppPackageUploads.scanStatus,
      })
      .from(moduleAppPackages)
      .leftJoin(
        moduleAppPackageUploads,
        eq(moduleAppPackageUploads.packageId, moduleAppPackages.id),
      )
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.packageId, moduleAppPackages.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(moduleAppPackages.createdAt))
      .limit(limit)
      .offset(cursor);
    const items = rows.map(({ buildFailureCode, buildStatus, packageRow, scanStatus }) =>
      serializeAdminPackageSubmission(packageRow, scanStatus, {
        failureCode: buildFailureCode,
        status: buildStatus,
      }),
    );

    return { items, nextCursor: items.length === limit ? cursor + limit : null };
  };

  getAdminPackageSubmission = async (params: { packageId: string }) => {
    const [row] = await this.db
      .select({
        buildFailureCode: moduleAppBuilds.failureCode,
        buildStatus: moduleAppBuilds.status,
        packageRow: moduleAppPackages,
        scanStatus: moduleAppPackageUploads.scanStatus,
      })
      .from(moduleAppPackages)
      .leftJoin(
        moduleAppPackageUploads,
        eq(moduleAppPackageUploads.packageId, moduleAppPackages.id),
      )
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.packageId, moduleAppPackages.id))
      .where(eq(moduleAppPackages.id, params.packageId))
      .limit(1);

    return row
      ? serializeAdminPackageSubmission(row.packageRow, row.scanStatus, {
          failureCode: row.buildFailureCode,
          status: row.buildStatus,
        })
      : null;
  };

  approvePackageSubmissionForAdmin = async (params: {
    outboundHostPolicies: ModuleAppOutboundHostPolicy[];
    packageId: string;
    reviewedByUserId: string;
  }) => {
    return this.db.transaction(async (tx) => {
      const [submission] = await tx
        .select()
        .from(moduleAppPackages)
        .where(eq(moduleAppPackages.id, params.packageId))
        .for('update');

      if (!submission) throw new Error('MODULE_APP_PACKAGE_NOT_FOUND');
      if (submission.reviewStatus !== 'pending_review') {
        throw new Error('MODULE_APP_PACKAGE_NOT_PENDING_REVIEW');
      }

      const upload = await tx.query.moduleAppPackageUploads.findFirst({
        where: eq(moduleAppPackageUploads.packageId, params.packageId),
      });
      if (!upload || upload.status !== 'submitted' || upload.scanStatus !== 'clean') {
        throw new Error('MODULE_APP_PACKAGE_SCAN_NOT_CLEAN');
      }

      const normalized = normalizePackageManifestForApproval(submission.manifestSnapshot);
      const outboundHostPolicies = assertModuleAppOutboundHostPolicyCoverage(
        normalized.runtime.outboundHosts ?? [],
        params.outboundHostPolicies,
      );
      const appInput = {
        ...normalized.app,
        source: 'developer' as const,
        status: normalized.manifestVersion === 2 ? ('draft' as const) : normalized.app.status,
      };
      if (!submission.submittedByUserId) {
        throw new Error('MODULE_APP_PACKAGE_SUBMITTER_REQUIRED');
      }
      const [publisher] = await tx
        .select()
        .from(moduleAppPublishers)
        .where(
          and(
            eq(moduleAppPublishers.userId, submission.submittedByUserId),
            eq(moduleAppPublishers.status, 'verified'),
          ),
        )
        .for('update');
      if (!publisher) throw new Error('MODULE_APP_PACKAGE_PUBLISHER_NOT_VERIFIED');

      const existingApp = await this.findAppForUpsert(appInput, tx);
      assertModuleAppPackageAppOwnership(existingApp, publisher.id);

      const app = await this.upsertAppForAdminWithExecutor(appInput, tx, publisher.id);
      await this.replaceEntitlementsForAdmin(
        { appId: app.id, entitlements: normalized.entitlements },
        tx,
      );

      const version = await this.getLatestVersion(app.id, tx);
      if (!version) throw new Error('MODULE_APP_VERSION_NOT_FOUND');

      const runtimeManifest = {
        ...(normalized.build ? { build: normalized.build } : {}),
        manifestVersion: normalized.manifestVersion,
        outboundHostPolicies,
        runtime: normalized.runtime,
      };
      await tx
        .update(moduleAppVersions)
        .set({
          publishedAt: normalized.manifestVersion === 2 ? null : version.publishedAt,
          runtimeManifest,
          version: normalized.packageVersion,
        })
        .where(eq(moduleAppVersions.id, version.id));

      let build = null;
      if (normalized.manifestVersion === 2 && normalized.build) {
        [build] = await tx
          .insert(moduleAppBuilds)
          .values({
            buildProfile: normalized.build.frontend.profile,
            packageId: submission.id,
            sourceSha256: submission.archive.sha256,
            versionId: version.id,
          })
          .returning();
        if (!build) throw new Error('MODULE_APP_BUILD_CREATE_FAILED');
      }

      const now = new Date();
      const [updatedPackage] = await tx
        .update(moduleAppPackages)
        .set({
          appId: app.id,
          publisherId: publisher.id,
          publishedAt: appInput.status === 'published' ? (version.publishedAt ?? now) : null,
          rejectionReason: null,
          reviewStatus: 'approved',
          reviewedAt: now,
          reviewedByUserId: params.reviewedByUserId,
          updatedAt: now,
          versionId: version.id,
        })
        .where(eq(moduleAppPackages.id, params.packageId))
        .returning();

      return {
        appId: app.id,
        build,
        outboundHostPolicies,
        package: updatedPackage,
        slug: app.slug,
        versionId: version.id,
      };
    });
  };

  rejectPackageSubmissionForAdmin = async (params: {
    packageId: string;
    reason?: string;
    reviewedByUserId: string;
  }) => {
    return this.db.transaction(async (tx) => {
      const submission = await tx.query.moduleAppPackages.findFirst({
        where: eq(moduleAppPackages.id, params.packageId),
      });

      if (!submission) throw new Error('MODULE_APP_PACKAGE_NOT_FOUND');
      if (submission.reviewStatus !== 'pending_review') {
        throw new Error('MODULE_APP_PACKAGE_NOT_PENDING_REVIEW');
      }

      const [updatedPackage] = await tx
        .update(moduleAppPackages)
        .set({
          rejectionReason: params.reason,
          reviewStatus: 'rejected',
          reviewedAt: new Date(),
          reviewedByUserId: params.reviewedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(moduleAppPackages.id, params.packageId))
        .returning();

      return updatedPackage;
    });
  };

  listAdminApps = async (
    params: {
      category?: string;
      cursor?: number;
      limit?: number;
      status?: ModuleAppStatus;
    } = {},
  ) => {
    const limit = params.limit ?? 50;
    const cursor = params.cursor ?? 0;
    const where =
      params.status && params.category
        ? and(eq(moduleApps.status, params.status), eq(moduleApps.category, params.category))
        : params.status
          ? eq(moduleApps.status, params.status)
          : params.category
            ? eq(moduleApps.category, params.category)
            : undefined;

    const items = await this.db.query.moduleApps.findMany({
      limit,
      offset: cursor,
      orderBy: [asc(moduleApps.sortOrder), asc(moduleApps.displayName)],
      where,
    });

    return {
      items,
      nextCursor: items.length === limit ? cursor + limit : null,
    };
  };

  getAdminApp = async (params: { appId: string }) => {
    const app = await this.db.query.moduleApps.findFirst({
      where: eq(moduleApps.id, params.appId),
    });

    if (!app) return null;

    const version = await this.getLatestVersion(app.id);
    const [pages, actions, entitlements] = await Promise.all([
      version
        ? this.db.query.moduleAppPages.findMany({
            orderBy: [asc(moduleAppPages.sortOrder), asc(moduleAppPages.createdAt)],
            where: and(eq(moduleAppPages.appId, app.id), eq(moduleAppPages.versionId, version.id)),
          })
        : Promise.resolve([]),
      version
        ? this.db.query.moduleAppActions.findMany({
            orderBy: [asc(moduleAppActions.createdAt)],
            where: and(
              eq(moduleAppActions.appId, app.id),
              eq(moduleAppActions.versionId, version.id),
            ),
          })
        : Promise.resolve([]),
      this.db.query.moduleAppEntitlements.findMany({
        orderBy: [asc(moduleAppEntitlements.plan)],
        where: eq(moduleAppEntitlements.appId, app.id),
      }),
    ]);

    return {
      ...app,
      actions: actions.map(toActionConfig),
      entitlements: entitlements.map(toEntitlementConfig),
      pages: pages.map(toPageConfig),
      version: version?.version ?? DEFAULT_VERSION,
      versionId: version?.id,
    };
  };

  protected setStatusWithExecutor = async (
    params: { appId: string; status: ModuleAppStatus },
    db: DbExecutor,
  ) => {
    const version = await this.getLatestVersion(params.appId, db);
    if (params.status === 'published' && !version) {
      throw new Error('MODULE_APP_VERSION_NOT_FOUND');
    }
    const runtimeManifest = version?.runtimeManifest as { manifestVersion?: unknown } | undefined;

    if (version && params.status === 'published' && runtimeManifest?.manifestVersion === 2) {
      const build = await db.query.moduleAppBuilds.findFirst({
        where: eq(moduleAppBuilds.versionId, version.id),
      });
      const hasReadyArtifact =
        build?.status === 'ready' &&
        Boolean(build.artifactKey) &&
        Boolean(build.artifactSha256) &&
        build.artifactKey === version.runtimeArtifactKey &&
        build.artifactSha256 === version.runtimeArtifactSha256;

      if (!hasReadyArtifact) throw new Error('MODULE_APP_BUILD_NOT_READY');
    }

    await db
      .update(moduleApps)
      .set({
        currentPublishedVersionId: params.status === 'published' ? version!.id : null,
        status: params.status,
        updatedAt: new Date(),
      })
      .where(eq(moduleApps.id, params.appId));

    if (version && params.status === 'published' && !version.publishedAt) {
      await db
        .update(moduleAppVersions)
        .set({ publishedAt: new Date() })
        .where(eq(moduleAppVersions.id, version.id));
    }

    return { ok: true as const };
  };

  setStatus = async (params: { appId: string; status: ModuleAppStatus }) => {
    return this.db.transaction((tx) => this.setStatusWithExecutor(params, tx));
  };

  private upsertConfigurationForAdminWithExecutor = async (
    params: {
      actions: ModuleAppActionConfig[];
      appId: string;
      expectedVersionId: string;
      pages: ModuleAppPage[];
    },
    db: DbExecutor,
  ) => {
    const [app] = await db
      .select({ id: moduleApps.id })
      .from(moduleApps)
      .where(eq(moduleApps.id, params.appId))
      .for('update');
    if (!app) throw new Error('MODULE_APP_NOT_FOUND');

    const currentVersion = await this.getLatestVersion(params.appId, db);
    if (!currentVersion) throw new Error('MODULE_APP_VERSION_NOT_FOUND');
    if (currentVersion.id !== params.expectedVersionId) {
      throw new Error('MODULE_APP_CONFIGURATION_CONFLICT');
    }

    const draftVersion = await this.ensureMutableDraftVersion(params.appId, db);
    await this.replacePagesAndActions(params.appId, draftVersion.id, params, db);

    return { ok: true as const, versionId: draftVersion.id };
  };

  upsertConfigurationForAdmin = async (
    params: {
      actions: ModuleAppActionConfig[];
      appId: string;
      expectedVersionId: string;
      pages: ModuleAppPage[];
    },
    db?: DbExecutor,
  ) => {
    if (db) return this.upsertConfigurationForAdminWithExecutor(params, db);

    return this.db.transaction((tx) => this.upsertConfigurationForAdminWithExecutor(params, tx));
  };

  upsertBillingForAdmin = async (params: {
    appId: string;
    billing: ModuleAppAdminUpsertInput['billing'];
  }) => {
    await this.db
      .update(moduleApps)
      .set({ billing: params.billing, updatedAt: new Date() })
      .where(eq(moduleApps.id, params.appId));

    return { ok: true as const };
  };

  upsertEntitlementsForAdmin = async (
    params: {
      appId: string;
      entitlements: ModuleAppPlanEntitlement[];
    },
    db: DbExecutor = this.db,
  ) => {
    await this.replaceEntitlementsForAdmin(params, db);

    return { ok: true as const };
  };

  listMarketplaceApps = async (params: {
    filters?: ModuleAppMarketplaceListInput;
    includeHidden?: boolean;
    plan: string;
    userId: string;
  }) => {
    const rows = await this.db
      .select({
        app: moduleApps,
        entitlement: moduleAppEntitlements,
        installationId: moduleAppInstallations.id,
      })
      .from(moduleApps)
      .innerJoin(
        moduleAppEntitlements,
        and(
          eq(moduleAppEntitlements.appId, moduleApps.id),
          eq(moduleAppEntitlements.plan, params.plan),
          params.includeHidden ? undefined : eq(moduleAppEntitlements.visible, true),
        ),
      )
      .leftJoin(
        moduleAppInstallations,
        and(
          eq(moduleAppInstallations.appId, moduleApps.id),
          eq(moduleAppInstallations.scopeType, 'personal'),
          eq(moduleAppInstallations.userId, params.userId),
          eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
          isNull(moduleAppInstallations.uninstalledAt),
        ),
      )
      .where(
        and(eq(moduleApps.status, 'published'), isNotNull(moduleApps.currentPublishedVersionId)),
      )
      .orderBy(asc(moduleApps.sortOrder), asc(moduleApps.displayName));

    return rows
      .map((row) => toListItem(row.app, row.entitlement, !!row.installationId))
      .filter((app) => matchesMarketplaceFilters(app, params.filters));
  };

  getAppDetail = async (params: {
    appIdOrSlug: string;
    includeHidden?: boolean;
    plan: string;
    userId: string;
    workspaceId?: string;
  }) => {
    const app = await this.findAppByIdOrSlug(params.appIdOrSlug);

    if (!app || app.status !== 'published') return null;

    const [planEntitlement, version, entitlements, installation] = await Promise.all([
      this.db.query.moduleAppEntitlements.findFirst({
        where: and(
          eq(moduleAppEntitlements.appId, app.id),
          eq(moduleAppEntitlements.plan, params.plan),
        ),
      }),
      this.getCurrentPublishedVersion(app.id),
      this.db.query.moduleAppEntitlements.findMany({
        orderBy: [asc(moduleAppEntitlements.plan)],
        where: eq(moduleAppEntitlements.appId, app.id),
      }),
      this.db.query.moduleAppInstallations.findFirst({
        where: and(
          eq(moduleAppInstallations.appId, app.id),
          params.workspaceId
            ? and(
                eq(moduleAppInstallations.scopeType, 'workspace'),
                eq(moduleAppInstallations.workspaceId, params.workspaceId),
              )
            : and(
                eq(moduleAppInstallations.scopeType, 'personal'),
                eq(moduleAppInstallations.userId, params.userId),
              ),
          eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
          isNull(moduleAppInstallations.uninstalledAt),
        ),
      }),
    ]);

    if (!version || (!params.includeHidden && !planEntitlement?.visible)) return null;

    const [pages, actions] = await Promise.all([
      this.db.query.moduleAppPages.findMany({
        orderBy: [asc(moduleAppPages.sortOrder), asc(moduleAppPages.createdAt)],
        where: and(eq(moduleAppPages.appId, app.id), eq(moduleAppPages.versionId, version.id)),
      }),
      this.db.query.moduleAppActions.findMany({
        orderBy: [asc(moduleAppActions.createdAt)],
        where: and(eq(moduleAppActions.appId, app.id), eq(moduleAppActions.versionId, version.id)),
      }),
    ]);

    return {
      ...toListItem(app, planEntitlement, !!installation),
      actions: actions.map(toActionConfig),
      description: app.description,
      entitlements: entitlements.map(toEntitlementConfig),
      installationId: installation?.id,
      pages: pages.map(toPageConfig),
      version: version.version,
    };
  };
}
