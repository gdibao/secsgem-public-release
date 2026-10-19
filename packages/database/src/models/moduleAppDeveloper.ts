import type {
  ModuleAppBuildStatus,
  ModuleAppDeveloperAppListResult,
  ModuleAppDeveloperFinance,
  ModuleAppDeveloperPackageSummary,
  ModuleAppDeveloperPayoutListResult,
  ModuleAppDeveloperPublisherProfile,
  ModuleAppDeveloperRevenueListResult,
  ModuleAppDeveloperRevenueSummary,
  ModuleAppDeveloperSubmissionListResult,
  ModuleAppDeveloperVersionSummary,
  ModuleAppPublisherProfileInput,
} from '@lobechat/types';
import { moduleAppPackageManifestSchema } from '@lobechat/types';
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  moduleAppAuditLogs,
  moduleAppBuilds,
  moduleAppInstallations,
  moduleAppPackages,
  moduleAppPackageUploads,
  moduleAppPayoutBatches,
  moduleAppPublishers,
  moduleAppRevenueEntries,
  moduleAppRuns,
  moduleApps,
  moduleAppVersions,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { ModuleAppCatalogModel } from './moduleAppCatalog';

type DbExecutor = LobeChatDatabase | Transaction;
type PackageRow = typeof moduleAppPackages.$inferSelect;

const moduleAppRevenueAccruals = alias(moduleAppRevenueEntries, 'module_app_revenue_accruals');

const readManifestIdentity = (manifest: PackageRow['manifestSnapshot']) => {
  const parsed = moduleAppPackageManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return { displayName: 'Invalid package', packageVersion: 'unknown', slug: 'invalid-package' };
  }

  return {
    displayName: parsed.data.app.displayName,
    packageVersion: parsed.data.packageVersion,
    slug: parsed.data.app.slug,
  };
};

const toPackageSummary = (row: {
  buildFailureCode: null | string;
  buildStatus: ModuleAppBuildStatus | null;
  packageRow: PackageRow;
  scanStatus: ModuleAppDeveloperPackageSummary['scanStatus'] | null;
}): ModuleAppDeveloperPackageSummary => {
  const identity = readManifestIdentity(row.packageRow.manifestSnapshot);

  return {
    appDisplayName: identity.displayName,
    appId: row.packageRow.appId,
    appSlug: identity.slug,
    build: row.buildStatus ? { failureCode: row.buildFailureCode, status: row.buildStatus } : null,
    createdAt: row.packageRow.createdAt,
    fileName: row.packageRow.archive.fileName,
    id: row.packageRow.id,
    packageVersion: identity.packageVersion,
    publishedAt: row.packageRow.publishedAt,
    rejectionReason: row.packageRow.rejectionReason,
    reviewStatus: row.packageRow.reviewStatus,
    scanStatus: row.scanStatus ?? 'pending',
    validationReport: row.packageRow.validationReport,
  };
};

export class ModuleAppDeveloperModel extends ModuleAppCatalogModel {
  constructor(db: LobeChatDatabase) {
    super(db);
  }

  private getPublisherByUserId = async (userId: string, db: DbExecutor = this.db) =>
    db.query.moduleAppPublishers.findFirst({
      where: eq(moduleAppPublishers.userId, userId),
    });

  private assertOwnedApplication = async (params: {
    appId: string;
    db?: DbExecutor;
    lock?: boolean;
    requireVerified?: boolean;
    userId: string;
  }) => {
    const db = params.db ?? this.db;
    if (params.lock) {
      const [publisher] = await db
        .select()
        .from(moduleAppPublishers)
        .where(eq(moduleAppPublishers.userId, params.userId))
        .limit(1)
        .for('update');
      if (!publisher) throw new Error('MODULE_APP_DEVELOPER_APP_NOT_FOUND');

      const [app] = await db
        .select()
        .from(moduleApps)
        .where(and(eq(moduleApps.id, params.appId), eq(moduleApps.publisherId, publisher.id)))
        .limit(1)
        .for('update');
      if (!app) throw new Error('MODULE_APP_DEVELOPER_APP_NOT_FOUND');
      if (params.requireVerified && publisher.status !== 'verified') {
        throw new Error('MODULE_APP_PACKAGE_PUBLISHER_NOT_VERIFIED');
      }

      return { app, publisher };
    }

    const query = db
      .select({ app: moduleApps, publisher: moduleAppPublishers })
      .from(moduleApps)
      .innerJoin(moduleAppPublishers, eq(moduleAppPublishers.id, moduleApps.publisherId))
      .where(and(eq(moduleApps.id, params.appId), eq(moduleAppPublishers.userId, params.userId)))
      .limit(1);
    const [row] = await query;
    if (!row) throw new Error('MODULE_APP_DEVELOPER_APP_NOT_FOUND');
    if (params.requireVerified && row.publisher.status !== 'verified') {
      throw new Error('MODULE_APP_PACKAGE_PUBLISHER_NOT_VERIFIED');
    }

    return row;
  };

  getPublisherProfile = async (
    userId: string,
  ): Promise<ModuleAppDeveloperPublisherProfile | null> => {
    const publisher = await this.getPublisherByUserId(userId);
    if (!publisher) return null;

    return {
      createdAt: publisher.createdAt,
      displayName: publisher.displayName,
      id: publisher.id,
      status: publisher.status,
      updatedAt: publisher.updatedAt,
      verifiedAt: publisher.verifiedAt,
    };
  };

  upsertPublisherProfile = async (
    userId: string,
    input: ModuleAppPublisherProfileInput,
  ): Promise<ModuleAppDeveloperPublisherProfile> => {
    const displayName = input.displayName.trim();
    return this.db.transaction(async (tx) => {
      const existing = await this.getPublisherByUserId(userId, tx);
      if (existing?.status === 'suspended') {
        throw new Error('MODULE_APP_PUBLISHER_SUSPENDED');
      }

      const [publisher] = existing
        ? await tx
            .update(moduleAppPublishers)
            .set({ displayName, updatedAt: new Date() })
            .where(eq(moduleAppPublishers.id, existing.id))
            .returning()
        : await tx
            .insert(moduleAppPublishers)
            .values({ displayName, status: 'pending', userId })
            .returning();
      if (!publisher) throw new Error('MODULE_APP_PUBLISHER_CREATE_FAILED');

      await tx.insert(moduleAppAuditLogs).values({
        actorUserId: userId,
        eventType: existing
          ? 'module_app.publisher_profile_updated'
          : 'module_app.publisher_applied',
        resourceId: publisher.id,
        resourceType: 'moduleAppPublisher',
      });

      return {
        createdAt: publisher.createdAt,
        displayName: publisher.displayName,
        id: publisher.id,
        status: publisher.status,
        updatedAt: publisher.updatedAt,
        verifiedAt: publisher.verifiedAt,
      };
    });
  };

  listApplications = async (params: {
    cursor?: number;
    limit?: number;
    userId: string;
  }): Promise<ModuleAppDeveloperAppListResult> => {
    const cursor = Math.max(0, Math.floor(params.cursor ?? 0));
    const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 20)));
    const publisher = await this.getPublisherByUserId(params.userId);
    if (!publisher) return { items: [], nextCursor: null };

    const appRows = await this.db.query.moduleApps.findMany({
      limit: limit + 1,
      offset: cursor,
      orderBy: [desc(moduleApps.updatedAt), desc(moduleApps.id)],
      where: eq(moduleApps.publisherId, publisher.id),
    });
    const page = appRows.slice(0, limit);
    const appIds = page.map((app) => app.id);
    if (appIds.length === 0) return { items: [], nextCursor: null };

    const currentVersionIds = page
      .map((app) => app.currentPublishedVersionId)
      .filter((id): id is string => Boolean(id));
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [versions, currentVersions, packages, installations, runMetrics] = await Promise.all([
      this.db.query.moduleAppVersions.findMany({
        orderBy: [desc(moduleAppVersions.createdAt)],
        where: inArray(moduleAppVersions.appId, appIds),
      }),
      currentVersionIds.length
        ? this.db.query.moduleAppVersions.findMany({
            where: inArray(moduleAppVersions.id, currentVersionIds),
          })
        : Promise.resolve([]),
      this.db
        .select({
          buildFailureCode: moduleAppBuilds.failureCode,
          buildStatus: moduleAppBuilds.status,
          packageRow: moduleAppPackages,
          scanStatus: moduleAppPackageUploads.scanStatus,
        })
        .from(moduleAppPackages)
        .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.packageId, moduleAppPackages.id))
        .leftJoin(
          moduleAppPackageUploads,
          eq(moduleAppPackageUploads.packageId, moduleAppPackages.id),
        )
        .where(inArray(moduleAppPackages.appId, appIds))
        .orderBy(desc(moduleAppPackages.createdAt)),
      this.db
        .select({ appId: moduleAppInstallations.appId, count: sql<number>`count(*)::int` })
        .from(moduleAppInstallations)
        .where(
          and(
            inArray(moduleAppInstallations.appId, appIds),
            eq(moduleAppInstallations.status, 'installed'),
          ),
        )
        .groupBy(moduleAppInstallations.appId),
      this.db
        .select({
          appId: moduleAppRuns.appId,
          failed: sql<number>`count(*) filter (where ${moduleAppRuns.status} in ('failed', 'denied'))::int`,
          succeeded: sql<number>`count(*) filter (where ${moduleAppRuns.status} = 'succeeded')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(moduleAppRuns)
        .where(and(inArray(moduleAppRuns.appId, appIds), gte(moduleAppRuns.createdAt, cutoff)))
        .groupBy(moduleAppRuns.appId),
    ]);

    const latestVersions = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      if (!latestVersions.has(version.appId)) latestVersions.set(version.appId, version);
    }
    const currentVersionMap = new Map(currentVersions.map((version) => [version.id, version]));
    const latestPackages = new Map<string, ModuleAppDeveloperPackageSummary>();
    for (const packageRow of packages) {
      if (packageRow.packageRow.appId && !latestPackages.has(packageRow.packageRow.appId)) {
        latestPackages.set(packageRow.packageRow.appId, toPackageSummary(packageRow));
      }
    }
    const installationMap = new Map(installations.map((row) => [row.appId, Number(row.count)]));
    const metricMap = new Map(runMetrics.map((row) => [row.appId, row]));

    return {
      items: page.map((app) => {
        const latestVersion = latestVersions.get(app.id);
        const currentVersion = app.currentPublishedVersionId
          ? currentVersionMap.get(app.currentPublishedVersionId)
          : undefined;
        const metrics = metricMap.get(app.id);

        return {
          currentPublishedVersion: currentVersion
            ? { id: currentVersion.id, version: currentVersion.version }
            : null,
          displayName: app.displayName,
          id: app.id,
          latestPackage: latestPackages.get(app.id) ?? null,
          latestVersion: latestVersion
            ? {
                id: latestVersion.id,
                publishedAt: latestVersion.publishedAt,
                version: latestVersion.version,
              }
            : null,
          metrics: {
            activeInstallations: installationMap.get(app.id) ?? 0,
            failedRuns30d: Number(metrics?.failed ?? 0),
            successfulRuns30d: Number(metrics?.succeeded ?? 0),
            totalRuns30d: Number(metrics?.total ?? 0),
          },
          slug: app.slug,
          status: app.status,
          updatedAt: app.updatedAt,
        };
      }),
      nextCursor: appRows.length > limit ? cursor + limit : null,
    };
  };

  listSubmissions = async (params: {
    cursor?: number;
    limit?: number;
    userId: string;
  }): Promise<ModuleAppDeveloperSubmissionListResult> => {
    const cursor = Math.max(0, Math.floor(params.cursor ?? 0));
    const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 20)));
    const rows = await this.db
      .select({
        buildFailureCode: moduleAppBuilds.failureCode,
        buildStatus: moduleAppBuilds.status,
        packageRow: moduleAppPackages,
        scanStatus: moduleAppPackageUploads.scanStatus,
      })
      .from(moduleAppPackages)
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.packageId, moduleAppPackages.id))
      .leftJoin(
        moduleAppPackageUploads,
        eq(moduleAppPackageUploads.packageId, moduleAppPackages.id),
      )
      .where(eq(moduleAppPackages.submittedByUserId, params.userId))
      .orderBy(desc(moduleAppPackages.createdAt), desc(moduleAppPackages.id))
      .limit(limit + 1)
      .offset(cursor);

    return {
      items: rows.slice(0, limit).map(toPackageSummary),
      nextCursor: rows.length > limit ? cursor + limit : null,
    };
  };

  listVersions = async (params: {
    appId: string;
    userId: string;
  }): Promise<ModuleAppDeveloperVersionSummary[]> => {
    const { app } = await this.assertOwnedApplication(params);
    const rows = await this.db
      .select({ build: moduleAppBuilds, version: moduleAppVersions })
      .from(moduleAppVersions)
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.versionId, moduleAppVersions.id))
      .where(eq(moduleAppVersions.appId, app.id))
      .orderBy(desc(moduleAppVersions.createdAt));

    return rows.map(({ build, version }) => ({
      build: build ? { failureCode: build.failureCode, status: build.status } : null,
      createdAt: version.createdAt,
      current: version.id === app.currentPublishedVersionId,
      id: version.id,
      publishedAt: version.publishedAt,
      version: version.version,
    }));
  };

  setPublication = async (params: { appId: string; published: boolean; userId: string }) =>
    this.db.transaction(async (tx) => {
      await this.assertOwnedApplication({
        ...params,
        db: tx,
        lock: true,
        requireVerified: true,
      });
      await this.setStatusWithExecutor(
        { appId: params.appId, status: params.published ? 'published' : 'unpublished' },
        tx,
      );
      await tx.insert(moduleAppAuditLogs).values({
        actorUserId: params.userId,
        eventType: params.published
          ? 'module_app.developer_published'
          : 'module_app.developer_unpublished',
        resourceId: params.appId,
        resourceType: 'moduleApp',
      });

      return { ok: true as const };
    });

  rollbackVersion = async (params: { appId: string; userId: string; versionId: string }) =>
    this.db.transaction(async (tx) => {
      const { app } = await this.assertOwnedApplication({
        ...params,
        db: tx,
        lock: true,
        requireVerified: true,
      });
      const version = await tx.query.moduleAppVersions.findFirst({
        where: and(
          eq(moduleAppVersions.id, params.versionId),
          eq(moduleAppVersions.appId, app.id),
          isNotNull(moduleAppVersions.publishedAt),
        ),
      });
      if (!version) throw new Error('MODULE_APP_DEVELOPER_VERSION_NOT_ROLLBACKABLE');
      const runtimeManifest = version.runtimeManifest as { manifestVersion?: unknown };
      if (runtimeManifest.manifestVersion === 2) {
        const build = await tx.query.moduleAppBuilds.findFirst({
          where: eq(moduleAppBuilds.versionId, version.id),
        });
        const ready =
          build?.status === 'ready' &&
          Boolean(build.artifactKey) &&
          Boolean(build.artifactSha256) &&
          build.artifactKey === version.runtimeArtifactKey &&
          build.artifactSha256 === version.runtimeArtifactSha256;
        if (!ready) throw new Error('MODULE_APP_BUILD_NOT_READY');
      }

      await tx
        .update(moduleApps)
        .set({ currentPublishedVersionId: version.id, status: 'published', updatedAt: new Date() })
        .where(eq(moduleApps.id, app.id));
      await tx.insert(moduleAppAuditLogs).values({
        actorUserId: params.userId,
        eventType: 'module_app.developer_version_rolled_back',
        metadata: { fromVersionId: app.currentPublishedVersionId, toVersionId: version.id },
        resourceId: app.id,
        resourceType: 'moduleApp',
      });

      return { ok: true as const };
    });

  getFinance = async (userId: string): Promise<ModuleAppDeveloperFinance> => {
    const [summary, revenue, payouts] = await Promise.all([
      this.getFinanceSummary(userId),
      this.listRevenue({ limit: 50, userId }),
      this.listPayouts({ limit: 20, userId }),
    ]);

    return { payouts: payouts.items, revenue: revenue.items, summary };
  };

  getFinanceSummary = async (userId: string): Promise<ModuleAppDeveloperRevenueSummary[]> => {
    const publisher = await this.getPublisherByUserId(userId);
    if (!publisher) return [];
    const summaryRows = await this.db
      .select({
        currency: moduleAppRevenueEntries.currency,
        pendingAmount: sql<number>`coalesce(sum(case when ${moduleAppRevenueEntries.status} = 'pending' or (${moduleAppRevenueEntries.type} = 'reversal' and ${moduleAppRevenueAccruals.status} = 'pending') then ${moduleAppRevenueEntries.developerAmount} else 0 end), 0)`,
        settledAmount: sql<number>`coalesce(sum(case when ${moduleAppRevenueEntries.status} = 'settled' or (${moduleAppRevenueEntries.type} = 'reversal' and ${moduleAppRevenueAccruals.status} = 'settled') then ${moduleAppRevenueEntries.developerAmount} else 0 end), 0)`,
        totalAmount: sql<number>`coalesce(sum(${moduleAppRevenueEntries.developerAmount}), 0)`,
      })
      .from(moduleAppRevenueEntries)
      .leftJoin(
        moduleAppRevenueAccruals,
        and(
          eq(moduleAppRevenueAccruals.orderId, moduleAppRevenueEntries.orderId),
          eq(moduleAppRevenueAccruals.type, 'accrual'),
        ),
      )
      .where(eq(moduleAppRevenueEntries.publisherId, publisher.id))
      .groupBy(moduleAppRevenueEntries.currency);

    return summaryRows.map((row) => ({
      currency: row.currency,
      pendingAmount: Number(row.pendingAmount),
      settledAmount: Number(row.settledAmount),
      totalAmount: Number(row.totalAmount),
    }));
  };

  listPayouts = async (params: {
    cursor?: number;
    limit?: number;
    userId: string;
  }): Promise<ModuleAppDeveloperPayoutListResult> => {
    const cursor = Math.max(0, Math.floor(params.cursor ?? 0));
    const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 20)));
    const publisher = await this.getPublisherByUserId(params.userId);
    if (!publisher) return { items: [], nextCursor: null };
    const rows = await this.db.query.moduleAppPayoutBatches.findMany({
      limit: limit + 1,
      offset: cursor,
      orderBy: [desc(moduleAppPayoutBatches.createdAt), desc(moduleAppPayoutBatches.id)],
      where: eq(moduleAppPayoutBatches.publisherId, publisher.id),
    });

    return {
      items: rows.slice(0, limit).map((payout) => ({
        createdAt: payout.createdAt,
        currency: payout.currency,
        id: payout.id,
        paidAt: payout.paidAt,
        recipientMask: payout.recipientMask,
        status: payout.status,
        totalAmount: payout.totalAmount,
      })),
      nextCursor: rows.length > limit ? cursor + limit : null,
    };
  };

  listRevenue = async (params: {
    cursor?: number;
    limit?: number;
    userId: string;
  }): Promise<ModuleAppDeveloperRevenueListResult> => {
    const cursor = Math.max(0, Math.floor(params.cursor ?? 0));
    const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 20)));
    const publisher = await this.getPublisherByUserId(params.userId);
    if (!publisher) return { items: [], nextCursor: null };
    const rows = await this.db.query.moduleAppRevenueEntries.findMany({
      limit: limit + 1,
      offset: cursor,
      orderBy: [desc(moduleAppRevenueEntries.createdAt), desc(moduleAppRevenueEntries.id)],
      where: eq(moduleAppRevenueEntries.publisherId, publisher.id),
    });

    return {
      items: rows.slice(0, limit).map((entry) => ({
        appId: entry.appId,
        createdAt: entry.createdAt,
        currency: entry.currency,
        developerAmount: entry.developerAmount,
        id: entry.id,
        status: entry.status as 'pending' | 'reversed' | 'settled',
        type: entry.type,
      })),
      nextCursor: rows.length > limit ? cursor + limit : null,
    };
  };
}
