import {
  EMPTY_MODULE_APP_GRANT_SNAPSHOT,
  getModuleAppDeclaredSecretKeys,
  getModuleAppGrantDiff,
  type ModuleAppActionConfig,
  moduleAppActionListSchema,
  moduleAppExecutableRuntimeSchema,
  type ModuleAppGrantSnapshot,
  moduleAppGrantSnapshotSchema,
  type ModuleAppInstallationReadiness,
  moduleAppPackageRuntimeSchema,
  type ModuleAppPage,
  type ModuleAppScopeType,
} from '@lobechat/types';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  moduleAppActions,
  moduleAppArtifactCleanupJobs,
  moduleAppArtifacts,
  moduleAppBuilds,
  moduleAppDataRows,
  moduleAppDataSchemas,
  moduleAppEntitlements,
  moduleAppInstallations,
  moduleAppInstallationSecrets,
  moduleAppInstallationVersionRefs,
  moduleAppPages,
  moduleAppRecords,
  moduleAppRuns,
  moduleApps,
  moduleAppSchedules,
  moduleAppVersions,
  moduleAppWebhooks,
  moduleAppWorkflowNodes,
  moduleAppWorkflowRuns,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { ModuleAppCatalogModel } from './moduleAppCatalog';

const INSTALL_STATUS_ACTIVE = 'installed';
const INSTALL_STATUS_INACTIVE = 'uninstalled';
const installedModuleAppVersions = alias(moduleAppVersions, 'installed_module_app_versions');
const publishedModuleAppVersions = alias(moduleAppVersions, 'published_module_app_versions');

const normalizeGrantSnapshot = (snapshot: ModuleAppGrantSnapshot): ModuleAppGrantSnapshot =>
  Object.fromEntries(
    Object.entries(snapshot).map(([key, items]) => [key, [...new Set(items)].sort()]),
  ) as ModuleAppGrantSnapshot;

const getVersionGrantSnapshot = (version: {
  manifestSnapshot: Record<string, unknown>;
  runtimeManifest: Record<string, unknown>;
}): ModuleAppGrantSnapshot => {
  const runtimeCandidate = version.runtimeManifest.runtime;
  const executableRuntime = moduleAppExecutableRuntimeSchema.safeParse(runtimeCandidate);
  const packageRuntime = moduleAppPackageRuntimeSchema.safeParse(runtimeCandidate);
  const manifestActions = moduleAppActionListSchema.safeParse(version.manifestSnapshot.actions);
  const runtime = executableRuntime.success ? executableRuntime.data : null;

  return normalizeGrantSnapshot({
    functionKeys: runtime?.functions.map(({ key }) => key) ?? [],
    outboundHosts:
      runtime?.outboundHosts ??
      (packageRuntime.success ? (packageRuntime.data.outboundHosts ?? []) : []),
    permissions:
      runtime?.permissions ?? (packageRuntime.success ? packageRuntime.data.permissions : []),
    secretKeys: manifestActions.success ? getModuleAppDeclaredSecretKeys(manifestActions.data) : [],
    tableKeys: runtime?.data?.tables.map(({ key }) => key) ?? [],
    workflowKeys: runtime?.workflows?.map(({ key }) => key) ?? [],
  });
};

const parseStoredGrantSnapshot = (value: unknown) => {
  const parsed = moduleAppGrantSnapshotSchema.safeParse(value);

  return normalizeGrantSnapshot(parsed.success ? parsed.data : EMPTY_MODULE_APP_GRANT_SNAPSHOT);
};

const grantSnapshotsEqual = (left: ModuleAppGrantSnapshot, right: ModuleAppGrantSnapshot) =>
  JSON.stringify(normalizeGrantSnapshot(left)) === JSON.stringify(normalizeGrantSnapshot(right));

type ModuleAppActionRow = typeof moduleAppActions.$inferSelect;
type ModuleAppEntitlementRow = typeof moduleAppEntitlements.$inferSelect;
type ModuleAppPageRow = typeof moduleAppPages.$inferSelect;
type ModuleAppRow = typeof moduleApps.$inferSelect;
type TransactionDatabase = Parameters<Parameters<LobeChatDatabase['transaction']>[0]>[0];

type InstalledModuleAppListRow = {
  app: ModuleAppRow;
  installationId: string;
  installedBuildArtifactKey: null | string;
  installedBuildArtifactSha256: null | string;
  installedBuildStatus: null | string;
  installedRuntimeArtifactKey: null | string;
  installedRuntimeArtifactSha256: null | string;
  installedRuntimeManifest: null | Record<string, unknown>;
  installedVersionId: null | string;
  installedVersionNumber: null | string;
  publishedVersionId: null | string;
  publishedVersionNumber: null | string;
};

type InstallationReadinessSource = Pick<
  InstalledModuleAppListRow,
  | 'installationId'
  | 'installedBuildArtifactKey'
  | 'installedBuildArtifactSha256'
  | 'installedBuildStatus'
  | 'installedRuntimeArtifactKey'
  | 'installedRuntimeArtifactSha256'
  | 'installedRuntimeManifest'
  | 'installedVersionId'
>;

type InstallationScope = {
  appId: string;
  scopeType: ModuleAppScopeType;
  userId: string;
  workspaceId?: string;
};

const getInstallationScopeCondition = (params: InstallationScope) =>
  params.scopeType === 'personal'
    ? and(
        eq(moduleAppInstallations.appId, params.appId),
        eq(moduleAppInstallations.scopeType, 'personal'),
        eq(moduleAppInstallations.userId, params.userId),
      )
    : and(
        eq(moduleAppInstallations.appId, params.appId),
        eq(moduleAppInstallations.scopeType, 'workspace'),
        eq(moduleAppInstallations.workspaceId, params.workspaceId ?? ''),
      );

const getInstallationListScopeCondition = (params: {
  scopeType: ModuleAppScopeType;
  userId: string;
  workspaceId?: string;
}) =>
  params.scopeType === 'personal'
    ? and(
        eq(moduleAppInstallations.scopeType, 'personal'),
        eq(moduleAppInstallations.userId, params.userId),
        eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
        isNull(moduleAppInstallations.uninstalledAt),
      )
    : and(
        eq(moduleAppInstallations.scopeType, 'workspace'),
        eq(moduleAppInstallations.workspaceId, params.workspaceId ?? ''),
        eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
        isNull(moduleAppInstallations.uninstalledAt),
      );

const escapeLikePattern = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');

const getRuntimeReadiness = (
  row: InstallationReadinessSource,
): ModuleAppInstallationReadiness['runtime'] => {
  if (row.installedRuntimeManifest?.manifestVersion !== 2) return 'ready';

  const artifactMatches =
    Boolean(row.installedBuildArtifactKey) &&
    Boolean(row.installedBuildArtifactSha256) &&
    row.installedBuildArtifactKey === row.installedRuntimeArtifactKey &&
    row.installedBuildArtifactSha256 === row.installedRuntimeArtifactSha256;

  return row.installedBuildStatus === 'ready' && artifactMatches ? 'ready' : 'unavailable';
};

const INVALID_INSTALLATION_READINESS: ModuleAppInstallationReadiness = {
  configuration: 'invalid',
  missingSecretCount: 0,
  runtime: 'unavailable',
};

const toActionConfig = (action: ModuleAppActionRow): ModuleAppActionConfig => ({
  id: action.actionKey,
  inputSchema: action.inputSchema,
  moduleMultiplier: action.moduleMultiplier,
  name: action.name,
  outputSchema: action.outputSchema,
  runtimeConfig: action.runtimeConfig,
  runtimeType: action.runtimeType,
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

export class ModuleAppInstallationModel extends ModuleAppCatalogModel {
  private resolveInstallationReadiness = async (rows: InstallationReadinessSource[]) => {
    if (rows.length === 0) return new Map<string, ModuleAppInstallationReadiness>();

    const installationIds = rows.map(({ installationId }) => installationId);
    const versionIds = rows
      .map(({ installedVersionId }) => installedVersionId)
      .filter((versionId): versionId is string => Boolean(versionId));
    const [actions, secrets] = await Promise.all([
      versionIds.length > 0
        ? this.db.query.moduleAppActions.findMany({
            columns: { runtimeConfig: true, versionId: true },
            where: inArray(moduleAppActions.versionId, versionIds),
          })
        : Promise.resolve([]),
      this.db.query.moduleAppInstallationSecrets.findMany({
        columns: { installationId: true, secretKey: true },
        where: inArray(moduleAppInstallationSecrets.installationId, installationIds),
      }),
    ]);
    const actionsByVersion = new Map<string, Array<Pick<ModuleAppActionConfig, 'runtimeConfig'>>>();
    const configuredKeysByInstallation = new Map<string, Set<string>>();

    for (const action of actions) {
      const versionActions = actionsByVersion.get(action.versionId) ?? [];
      versionActions.push({ runtimeConfig: action.runtimeConfig });
      actionsByVersion.set(action.versionId, versionActions);
    }
    for (const secret of secrets) {
      const configuredKeys = configuredKeysByInstallation.get(secret.installationId) ?? new Set();
      configuredKeys.add(secret.secretKey);
      configuredKeysByInstallation.set(secret.installationId, configuredKeys);
    }

    return new Map(
      rows.map((row) => {
        let configuration: ModuleAppInstallationReadiness['configuration'];
        let missingSecretCount: number;

        try {
          const requiredKeys = row.installedVersionId
            ? getModuleAppDeclaredSecretKeys(actionsByVersion.get(row.installedVersionId) ?? [])
            : [];
          const configuredKeys = configuredKeysByInstallation.get(row.installationId) ?? new Set();
          missingSecretCount = requiredKeys.filter((key) => !configuredKeys.has(key)).length;
          configuration = missingSecretCount > 0 ? 'required' : 'ready';
        } catch {
          configuration = 'invalid';
          missingSecretCount = 0;
        }

        return [
          row.installationId,
          {
            configuration,
            missingSecretCount,
            runtime: getRuntimeReadiness(row),
          } satisfies ModuleAppInstallationReadiness,
        ] as const;
      }),
    );
  };

  private serializeInstalledApps = async (rows: InstalledModuleAppListRow[]) => {
    if (rows.length === 0) return [];

    const appIds = rows.map((row) => row.app.id);
    const [entitlements, readinessByInstallation] = await Promise.all([
      this.db.query.moduleAppEntitlements.findMany({
        where: inArray(moduleAppEntitlements.appId, appIds),
      }),
      this.resolveInstallationReadiness(rows),
    ]);
    const entitlementsByAppId = new Map<string, ModuleAppEntitlementRow[]>();

    for (const entitlement of entitlements) {
      const items = entitlementsByAppId.get(entitlement.appId) ?? [];
      items.push(entitlement);
      entitlementsByAppId.set(entitlement.appId, items);
    }

    return rows.map(
      ({
        app,
        installationId,
        installedVersionId,
        installedVersionNumber,
        publishedVersionId,
        publishedVersionNumber,
      }) => {
        const installedVersion =
          installedVersionId && installedVersionNumber
            ? { id: installedVersionId, version: installedVersionNumber }
            : null;
        const publishedVersion =
          publishedVersionId && publishedVersionNumber
            ? { id: publishedVersionId, version: publishedVersionNumber }
            : null;

        return {
          ...this.toListItem(app, null, true),
          description: app.description,
          installationReadiness:
            readinessByInstallation.get(installationId) ?? INVALID_INSTALLATION_READINESS,
          installedVersion,
          planState: this.aggregatePlanState(entitlementsByAppId.get(app.id) ?? []),
          publishedVersion,
          updateAvailable: Boolean(
            installedVersion && publishedVersion && installedVersion.id !== publishedVersion.id,
          ),
          version: installedVersion?.version ?? null,
        };
      },
    );
  };

  protected requireActiveInstallation = async (params: {
    appId: string;
    scopeType: ModuleAppScopeType;
    userId: string;
    workspaceId?: string;
  }) => {
    const installation = await this.db.query.moduleAppInstallations.findFirst({
      columns: { id: true, versionId: true },
      where: and(
        getInstallationScopeCondition(params),
        eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
        isNull(moduleAppInstallations.uninstalledAt),
      ),
    });
    if (!installation?.versionId) throw new Error('MODULE_APP_INSTALLATION_REQUIRED');
    return { id: installation.id, versionId: installation.versionId };
  };

  protected assertInstallationActive = async (installationId?: null | string) => {
    if (!installationId) throw new Error('MODULE_APP_INSTALLATION_REQUIRED');
    const installation = await this.db.query.moduleAppInstallations.findFirst({
      columns: { id: true },
      where: and(
        eq(moduleAppInstallations.id, installationId),
        eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
        isNull(moduleAppInstallations.uninstalledAt),
      ),
    });
    if (!installation) throw new Error('MODULE_APP_INSTALLATION_REQUIRED');
    return installation;
  };

  listAdminInstalls = async (params: { appId: string; cursor?: number; limit?: number }) => {
    const limit = params.limit ?? 50;
    const cursor = params.cursor ?? 0;
    const items = await this.db.query.moduleAppInstallations.findMany({
      limit,
      offset: cursor,
      orderBy: [desc(moduleAppInstallations.createdAt)],
      where: eq(moduleAppInstallations.appId, params.appId),
    });

    return { items, nextCursor: items.length === limit ? cursor + limit : null };
  };

  installApp = async (params: {
    appId: string;
    scopeType: ModuleAppScopeType;
    userId: string;
    versionId?: string;
    workspaceId?: string;
  }) => {
    return this.db.transaction(async (tx) => {
      const [app] = await tx
        .select({
          currentPublishedVersionId: moduleApps.currentPublishedVersionId,
          id: moduleApps.id,
          status: moduleApps.status,
        })
        .from(moduleApps)
        .where(eq(moduleApps.id, params.appId))
        .for('update');
      if (!app) throw new Error('MODULE_APP_NOT_FOUND');
      if (app.status !== 'published' || !app.currentPublishedVersionId) {
        throw new Error('MODULE_APP_NOT_INSTALLABLE');
      }

      const versionId = params.versionId ?? app.currentPublishedVersionId;
      if (versionId !== app.currentPublishedVersionId) {
        throw new Error('MODULE_APP_VERSION_NOT_CURRENT');
      }

      const version = await tx.query.moduleAppVersions.findFirst({
        where: and(
          eq(moduleAppVersions.id, versionId),
          eq(moduleAppVersions.appId, params.appId),
          isNotNull(moduleAppVersions.publishedAt),
        ),
      });
      if (!version) throw new Error('MODULE_APP_VERSION_NOT_FOUND');
      const grantSnapshot = getVersionGrantSnapshot(version);

      const [existing] = await tx
        .select({
          id: moduleAppInstallations.id,
          status: moduleAppInstallations.status,
          versionId: moduleAppInstallations.versionId,
        })
        .from(moduleAppInstallations)
        .where(getInstallationScopeCondition(params))
        .for('update');
      const now = new Date();

      if (existing?.status === INSTALL_STATUS_ACTIVE && existing.versionId) {
        if (existing.versionId !== versionId) {
          throw new Error('MODULE_APP_INSTALLATION_VERSION_CONFLICT');
        }

        await tx
          .update(moduleAppInstallations)
          .set({ grantSnapshot, updatedAt: now })
          .where(eq(moduleAppInstallations.id, existing.id));

        return { changed: false as const, grantSnapshot, installationId: existing.id, versionId };
      }

      let installationId: string | undefined;
      if (existing) {
        const [restored] = await tx
          .update(moduleAppInstallations)
          .set({
            installedAt: now,
            grantSnapshot,
            status: INSTALL_STATUS_ACTIVE,
            uninstalledAt: null,
            updatedAt: now,
            versionId,
          })
          .where(eq(moduleAppInstallations.id, existing.id))
          .returning({ id: moduleAppInstallations.id });
        installationId = restored?.id;
      } else {
        const [created] = await tx
          .insert(moduleAppInstallations)
          .values({
            appId: params.appId,
            grantSnapshot,
            installedAt: now,
            scopeType: params.scopeType,
            status: INSTALL_STATUS_ACTIVE,
            uninstalledAt: null,
            userId: params.userId,
            versionId,
            workspaceId: params.scopeType === 'workspace' ? params.workspaceId : undefined,
          })
          .returning({ id: moduleAppInstallations.id });
        installationId = created?.id;
      }
      if (!installationId) throw new Error('MODULE_APP_INSTALLATION_CREATE_FAILED');

      return { changed: true as const, grantSnapshot, installationId, versionId };
    });
  };

  installPersonalApp = async (params: { appId: string; userId: string }) =>
    this.installApp({
      appId: params.appId,
      scopeType: 'personal',
      userId: params.userId,
    });

  installWorkspaceApp = async (params: { appId: string; userId: string; workspaceId: string }) =>
    this.installApp({
      ...params,
      scopeType: 'workspace',
    });

  private purgeInstallationData = async (tx: TransactionDatabase, installationId: string) => {
    await tx.execute(sql`
      INSERT INTO ${moduleAppArtifactCleanupJobs} (app_id, installation_id, artifact_id, storage_key)
      SELECT
        ${moduleAppArtifacts.appId},
        ${moduleAppArtifacts.installationId},
        ${moduleAppArtifacts.id},
        ${moduleAppArtifacts.storageKey}
      FROM ${moduleAppArtifacts}
      WHERE ${moduleAppArtifacts.installationId} = ${installationId}
      ON CONFLICT (storage_key) DO NOTHING
    `);

    await tx
      .delete(moduleAppWorkflowNodes)
      .where(eq(moduleAppWorkflowNodes.installationId, installationId));
    await tx
      .delete(moduleAppWorkflowRuns)
      .where(eq(moduleAppWorkflowRuns.installationId, installationId));
    await tx
      .delete(moduleAppSchedules)
      .where(eq(moduleAppSchedules.installationId, installationId));
    await tx.delete(moduleAppWebhooks).where(eq(moduleAppWebhooks.installationId, installationId));
    await tx.delete(moduleAppDataRows).where(eq(moduleAppDataRows.installationId, installationId));
    await tx
      .delete(moduleAppDataSchemas)
      .where(eq(moduleAppDataSchemas.installationId, installationId));
    await tx.delete(moduleAppRuns).where(eq(moduleAppRuns.installationId, installationId));
    await tx.delete(moduleAppRecords).where(eq(moduleAppRecords.installationId, installationId));
  };

  private uninstallApp = async (
    params: InstallationScope & { dataPolicy: 'delete' | 'retain' },
  ) => {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: moduleAppInstallations.id,
          status: moduleAppInstallations.status,
          versionId: moduleAppInstallations.versionId,
        })
        .from(moduleAppInstallations)
        .where(getInstallationScopeCondition(params))
        .for('update');
      if (!existing) {
        return {
          changed: false as const,
          dataPolicy: params.dataPolicy,
          dataPurgedAt: null,
          ok: true as const,
        };
      }

      const now = new Date();
      const wasActive = existing.status === INSTALL_STATUS_ACTIVE && Boolean(existing.versionId);
      if (wasActive) {
        await tx
          .update(moduleAppInstallations)
          .set({
            status: INSTALL_STATUS_INACTIVE,
            uninstalledAt: now,
            updatedAt: now,
            versionId: null,
          })
          .where(eq(moduleAppInstallations.id, existing.id));
      }

      await tx
        .delete(moduleAppInstallationVersionRefs)
        .where(eq(moduleAppInstallationVersionRefs.installationId, existing.id));
      await tx
        .delete(moduleAppInstallationSecrets)
        .where(eq(moduleAppInstallationSecrets.installationId, existing.id));

      const dataPurgedAt = params.dataPolicy === 'delete' ? now : null;
      if (dataPurgedAt) {
        await this.purgeInstallationData(tx, existing.id);
        await tx
          .update(moduleAppInstallations)
          .set({ dataPurgedAt, updatedAt: now })
          .where(eq(moduleAppInstallations.id, existing.id));
      }

      return {
        changed: wasActive,
        dataPolicy: params.dataPolicy,
        dataPurgedAt,
        ok: true as const,
      };
    });
  };

  uninstallPersonalApp = (params: {
    appId: string;
    dataPolicy?: 'delete' | 'retain';
    userId: string;
  }) =>
    this.uninstallApp({
      ...params,
      dataPolicy: params.dataPolicy ?? 'retain',
      scopeType: 'personal',
    });

  uninstallWorkspaceApp = (params: {
    appId: string;
    dataPolicy?: 'delete' | 'retain';
    workspaceId: string;
  }) =>
    this.uninstallApp({
      appId: params.appId,
      dataPolicy: params.dataPolicy ?? 'retain',
      scopeType: 'workspace',
      userId: '',
      workspaceId: params.workspaceId,
    });

  private assertVersionTransitionReady = async (
    tx: TransactionDatabase,
    params: { appId: string; versionId: string },
  ) => {
    const version = await tx.query.moduleAppVersions.findFirst({
      where: and(
        eq(moduleAppVersions.id, params.versionId),
        eq(moduleAppVersions.appId, params.appId),
        isNotNull(moduleAppVersions.publishedAt),
      ),
    });
    if (!version) throw new Error('MODULE_APP_VERSION_NOT_FOUND');

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
      if (!ready) throw new Error('MODULE_APP_VERSION_ARTIFACT_NOT_READY');
    }

    return version;
  };

  changeInstallationVersion = async (params: {
    acceptedGrantSnapshot?: ModuleAppGrantSnapshot;
    appId: string;
    expectedVersionId: string;
    operation: 'rollback' | 'upgrade';
    scopeType: ModuleAppScopeType;
    targetVersionId?: string;
    userId: string;
    workspaceId?: string;
  }) => {
    return this.db.transaction(async (tx) => {
      const [app] = await tx
        .select({
          currentPublishedVersionId: moduleApps.currentPublishedVersionId,
          status: moduleApps.status,
        })
        .from(moduleApps)
        .where(eq(moduleApps.id, params.appId))
        .for('update');
      if (!app) throw new Error('MODULE_APP_NOT_FOUND');
      if (app.status !== 'published' || !app.currentPublishedVersionId) {
        throw new Error('MODULE_APP_NOT_INSTALLABLE');
      }

      const [installation] = await tx
        .select({
          grantSnapshot: moduleAppInstallations.grantSnapshot,
          id: moduleAppInstallations.id,
          versionId: moduleAppInstallations.versionId,
        })
        .from(moduleAppInstallations)
        .where(
          and(
            getInstallationScopeCondition(params),
            eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
            isNull(moduleAppInstallations.uninstalledAt),
          ),
        )
        .for('update');
      if (!installation?.versionId) throw new Error('MODULE_APP_INSTALLATION_REQUIRED');
      if (installation.versionId !== params.expectedVersionId) {
        throw new Error('MODULE_APP_INSTALLATION_VERSION_CONFLICT');
      }

      const targetVersionId =
        params.operation === 'upgrade' ? app.currentPublishedVersionId : params.targetVersionId;
      if (!targetVersionId) throw new Error('MODULE_APP_VERSION_NOT_FOUND');

      if (params.operation === 'rollback') {
        const retained = await tx.query.moduleAppInstallationVersionRefs.findFirst({
          where: and(
            eq(moduleAppInstallationVersionRefs.installationId, installation.id),
            eq(moduleAppInstallationVersionRefs.versionId, targetVersionId),
          ),
        });
        if (!retained) throw new Error('MODULE_APP_ROLLBACK_VERSION_NOT_RETAINED');
      }

      if (targetVersionId === installation.versionId) {
        return {
          changed: false as const,
          installationId: installation.id,
          operation: params.operation,
          previousVersionId: installation.versionId,
          versionId: installation.versionId,
        };
      }

      const targetVersion = await this.assertVersionTransitionReady(tx, {
        appId: params.appId,
        versionId: targetVersionId,
      });
      const currentGrantSnapshot = parseStoredGrantSnapshot(installation.grantSnapshot);
      const targetGrantSnapshot = getVersionGrantSnapshot(targetVersion);
      const grantDiff = getModuleAppGrantDiff(currentGrantSnapshot, targetGrantSnapshot);
      if (
        grantDiff.hasExpansion &&
        (!params.acceptedGrantSnapshot ||
          !grantSnapshotsEqual(params.acceptedGrantSnapshot, targetGrantSnapshot))
      ) {
        throw new Error('MODULE_APP_GRANT_CONFIRMATION_REQUIRED');
      }

      const [updated] = await tx
        .update(moduleAppInstallations)
        .set({
          grantSnapshot: targetGrantSnapshot,
          versionId: targetVersionId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(moduleAppInstallations.id, installation.id),
            eq(moduleAppInstallations.versionId, params.expectedVersionId),
            eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
          ),
        )
        .returning({ id: moduleAppInstallations.id, versionId: moduleAppInstallations.versionId });
      if (!updated?.versionId) throw new Error('MODULE_APP_INSTALLATION_VERSION_CONFLICT');

      return {
        changed: true as const,
        grantSnapshot: targetGrantSnapshot,
        installationId: updated.id,
        operation: params.operation,
        previousVersionId: installation.versionId,
        versionId: updated.versionId,
      };
    });
  };

  getInstallationVersionState = async (params: {
    appId: string;
    userId: string;
    workspaceId?: string;
  }) => {
    const scopeType: ModuleAppScopeType = params.workspaceId ? 'workspace' : 'personal';
    const [installation] = await this.db
      .select({
        installedBuildArtifactKey: moduleAppBuilds.artifactKey,
        installedBuildArtifactSha256: moduleAppBuilds.artifactSha256,
        installedBuildStatus: moduleAppBuilds.status,
        installedRuntimeArtifactKey: moduleAppVersions.runtimeArtifactKey,
        installedRuntimeArtifactSha256: moduleAppVersions.runtimeArtifactSha256,
        installedRuntimeManifest: moduleAppVersions.runtimeManifest,
        installedVersionNumber: moduleAppVersions.version,
        grantSnapshot: moduleAppInstallations.grantSnapshot,
        id: moduleAppInstallations.id,
        versionId: moduleAppVersions.id,
      })
      .from(moduleAppInstallations)
      .innerJoin(moduleAppVersions, eq(moduleAppVersions.id, moduleAppInstallations.versionId))
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.versionId, moduleAppVersions.id))
      .where(
        and(
          getInstallationScopeCondition({ ...params, scopeType }),
          eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
          isNull(moduleAppInstallations.uninstalledAt),
        ),
      )
      .limit(1);
    if (!installation) return null;

    const [publishedVersion, rollbackRows, readinessByInstallation] = await Promise.all([
      this.getCurrentPublishedVersion(params.appId),
      this.db
        .select({
          id: moduleAppVersions.id,
          manifestSnapshot: moduleAppVersions.manifestSnapshot,
          runtimeManifest: moduleAppVersions.runtimeManifest,
          version: moduleAppVersions.version,
        })
        .from(moduleAppInstallationVersionRefs)
        .innerJoin(
          moduleAppVersions,
          eq(moduleAppVersions.id, moduleAppInstallationVersionRefs.versionId),
        )
        .where(
          and(
            eq(moduleAppInstallationVersionRefs.installationId, installation.id),
            isNotNull(moduleAppVersions.publishedAt),
          ),
        )
        .orderBy(desc(moduleAppInstallationVersionRefs.lastActivatedAt)),
      this.resolveInstallationReadiness([
        {
          installationId: installation.id,
          installedBuildArtifactKey: installation.installedBuildArtifactKey,
          installedBuildArtifactSha256: installation.installedBuildArtifactSha256,
          installedBuildStatus: installation.installedBuildStatus,
          installedRuntimeArtifactKey: installation.installedRuntimeArtifactKey,
          installedRuntimeArtifactSha256: installation.installedRuntimeArtifactSha256,
          installedRuntimeManifest: installation.installedRuntimeManifest,
          installedVersionId: installation.versionId,
        },
      ]),
    ]);
    const currentGrantSnapshot = parseStoredGrantSnapshot(installation.grantSnapshot);
    const withGrantChange = (version: {
      id: string;
      manifestSnapshot: Record<string, unknown>;
      runtimeManifest: Record<string, unknown>;
      version: string;
    }) => {
      const targetGrantSnapshot = getVersionGrantSnapshot(version);

      return {
        grantChange: {
          ...getModuleAppGrantDiff(currentGrantSnapshot, targetGrantSnapshot),
          targetSnapshot: targetGrantSnapshot,
        },
        id: version.id,
        version: version.version,
      };
    };

    return {
      installationReadiness:
        readinessByInstallation.get(installation.id) ?? INVALID_INSTALLATION_READINESS,
      installedVersion: {
        id: installation.versionId,
        version: installation.installedVersionNumber,
      },
      installationId: installation.id,
      rollbackVersions: rollbackRows
        .filter(({ id }) => id !== installation.versionId)
        .map(withGrantChange),
      updateAvailable: Boolean(publishedVersion && publishedVersion.id !== installation.versionId),
      publishedVersion: publishedVersion ? withGrantChange(publishedVersion) : null,
    };
  };

  listInstalledApps = async (params: {
    scopeType: ModuleAppScopeType;
    userId: string;
    workspaceId?: string;
  }) => {
    const rows = await this.db
      .select({
        app: moduleApps,
        installationId: moduleAppInstallations.id,
        installedBuildArtifactKey: moduleAppBuilds.artifactKey,
        installedBuildArtifactSha256: moduleAppBuilds.artifactSha256,
        installedBuildStatus: moduleAppBuilds.status,
        installedRuntimeArtifactKey: installedModuleAppVersions.runtimeArtifactKey,
        installedRuntimeArtifactSha256: installedModuleAppVersions.runtimeArtifactSha256,
        installedRuntimeManifest: installedModuleAppVersions.runtimeManifest,
        installedVersionId: installedModuleAppVersions.id,
        installedVersionNumber: installedModuleAppVersions.version,
        publishedVersionId: publishedModuleAppVersions.id,
        publishedVersionNumber: publishedModuleAppVersions.version,
      })
      .from(moduleAppInstallations)
      .innerJoin(moduleApps, eq(moduleAppInstallations.appId, moduleApps.id))
      .leftJoin(
        installedModuleAppVersions,
        eq(moduleAppInstallations.versionId, installedModuleAppVersions.id),
      )
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.versionId, installedModuleAppVersions.id))
      .leftJoin(
        publishedModuleAppVersions,
        and(
          eq(moduleApps.currentPublishedVersionId, publishedModuleAppVersions.id),
          eq(moduleApps.status, 'published'),
          isNotNull(publishedModuleAppVersions.publishedAt),
        ),
      )
      .where(getInstallationListScopeCondition(params))
      .orderBy(asc(moduleApps.sortOrder), asc(moduleApps.displayName), asc(moduleApps.id));

    return this.serializeInstalledApps(rows);
  };

  listInstalledAppsPage = async (params: {
    cursor: number;
    limit: number;
    query?: string;
    scopeType: ModuleAppScopeType;
    userId: string;
    workspaceId?: string;
  }) => {
    const normalizedQuery = params.query?.trim();
    const searchPattern = normalizedQuery ? `%${escapeLikePattern(normalizedQuery)}%` : undefined;
    const rows = await this.db
      .select({
        app: moduleApps,
        installationId: moduleAppInstallations.id,
        installedBuildArtifactKey: moduleAppBuilds.artifactKey,
        installedBuildArtifactSha256: moduleAppBuilds.artifactSha256,
        installedBuildStatus: moduleAppBuilds.status,
        installedRuntimeArtifactKey: installedModuleAppVersions.runtimeArtifactKey,
        installedRuntimeArtifactSha256: installedModuleAppVersions.runtimeArtifactSha256,
        installedRuntimeManifest: installedModuleAppVersions.runtimeManifest,
        installedVersionId: installedModuleAppVersions.id,
        installedVersionNumber: installedModuleAppVersions.version,
        publishedVersionId: publishedModuleAppVersions.id,
        publishedVersionNumber: publishedModuleAppVersions.version,
      })
      .from(moduleAppInstallations)
      .innerJoin(moduleApps, eq(moduleAppInstallations.appId, moduleApps.id))
      .leftJoin(
        installedModuleAppVersions,
        eq(moduleAppInstallations.versionId, installedModuleAppVersions.id),
      )
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.versionId, installedModuleAppVersions.id))
      .leftJoin(
        publishedModuleAppVersions,
        and(
          eq(moduleApps.currentPublishedVersionId, publishedModuleAppVersions.id),
          eq(moduleApps.status, 'published'),
          isNotNull(publishedModuleAppVersions.publishedAt),
        ),
      )
      .where(
        and(
          getInstallationListScopeCondition(params),
          searchPattern
            ? or(
                ilike(moduleApps.displayName, searchPattern),
                ilike(moduleApps.slug, searchPattern),
                ilike(moduleApps.description, searchPattern),
              )
            : undefined,
        ),
      )
      .orderBy(asc(moduleApps.sortOrder), asc(moduleApps.displayName), asc(moduleApps.id))
      .limit(params.limit + 1)
      .offset(params.cursor);

    const hasNextPage = rows.length > params.limit;
    const items = await this.serializeInstalledApps(rows.slice(0, params.limit));

    return {
      items,
      nextCursor: hasNextPage ? params.cursor + params.limit : null,
    };
  };

  getRuntimeManifest = async (params: { appId: string; userId: string; workspaceId?: string }) => {
    const installation = await this.getLaunchInstallationContext(params);
    if (!installation) return null;

    return {
      actions: installation.actions,
      appId: installation.appId,
      appType: installation.appType,
      billing: installation.billing,
      displayName: installation.displayName,
      pages: installation.pages,
      slug: installation.slug,
      version: installation.version,
    };
  };

  getLaunchInstallationContext = async (params: {
    appId: string;
    userId: string;
    workspaceId?: string;
  }) => {
    const [row] = await this.db
      .select({
        appId: moduleApps.id,
        appType: moduleApps.appType,
        artifactKey: moduleAppVersions.runtimeArtifactKey,
        artifactSha256: moduleAppVersions.runtimeArtifactSha256,
        billing: moduleApps.billing,
        buildArtifactKey: moduleAppBuilds.artifactKey,
        buildArtifactSha256: moduleAppBuilds.artifactSha256,
        buildStatus: moduleAppBuilds.status,
        displayName: moduleApps.displayName,
        installationId: moduleAppInstallations.id,
        publisherId: moduleApps.publisherId,
        runtimeManifest: moduleAppVersions.runtimeManifest,
        slug: moduleApps.slug,
        version: moduleAppVersions.version,
        versionId: moduleAppVersions.id,
        workspaceId: moduleAppInstallations.workspaceId,
      })
      .from(moduleAppInstallations)
      .innerJoin(moduleApps, eq(moduleApps.id, moduleAppInstallations.appId))
      .innerJoin(moduleAppVersions, eq(moduleAppVersions.id, moduleAppInstallations.versionId))
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.versionId, moduleAppVersions.id))
      .where(
        and(
          eq(moduleAppInstallations.appId, params.appId),
          eq(moduleApps.status, 'published'),
          eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
          isNull(moduleAppInstallations.uninstalledAt),
          params.workspaceId
            ? and(
                eq(moduleAppInstallations.scopeType, 'workspace'),
                eq(moduleAppInstallations.workspaceId, params.workspaceId),
              )
            : and(
                eq(moduleAppInstallations.scopeType, 'personal'),
                eq(moduleAppInstallations.userId, params.userId),
              ),
        ),
      )
      .limit(1);

    if (!row) return null;

    const [actions, pages] = await Promise.all([
      this.db.query.moduleAppActions.findMany({
        orderBy: [asc(moduleAppActions.createdAt)],
        where: and(
          eq(moduleAppActions.appId, params.appId),
          eq(moduleAppActions.versionId, row.versionId),
        ),
      }),
      this.db.query.moduleAppPages.findMany({
        orderBy: [asc(moduleAppPages.sortOrder), asc(moduleAppPages.createdAt)],
        where: and(
          eq(moduleAppPages.appId, params.appId),
          eq(moduleAppPages.versionId, row.versionId),
        ),
      }),
    ]);

    return {
      ...row,
      actions: actions.map(toActionConfig),
      pages: pages.map(toPageConfig),
    };
  };

  getInstallationEntitlementSubject = async (params: { installationId: string }) => {
    const [row] = await this.db
      .select({
        appId: moduleApps.id,
        appStatus: moduleApps.status,
        scopeType: moduleAppInstallations.scopeType,
        userId: moduleAppInstallations.userId,
        workspaceId: moduleAppInstallations.workspaceId,
      })
      .from(moduleAppInstallations)
      .innerJoin(moduleApps, eq(moduleApps.id, moduleAppInstallations.appId))
      .where(eq(moduleAppInstallations.id, params.installationId))
      .limit(1);

    return row ?? null;
  };

  getRuntimeInstallationContext = async (params: {
    appId: string;
    installationId: string;
    userId: string;
    versionId: string;
    workspaceId?: string;
  }) => {
    const [row] = await this.db
      .select({
        appId: moduleApps.id,
        billing: moduleApps.billing,
        displayName: moduleApps.displayName,
        installationId: moduleAppInstallations.id,
        runtimeManifest: moduleAppVersions.runtimeManifest,
        scopeType: moduleAppInstallations.scopeType,
        userId: moduleAppInstallations.userId,
        versionId: moduleAppVersions.id,
        workspaceId: moduleAppInstallations.workspaceId,
      })
      .from(moduleAppInstallations)
      .innerJoin(moduleApps, eq(moduleApps.id, moduleAppInstallations.appId))
      .innerJoin(moduleAppVersions, eq(moduleAppVersions.id, moduleAppInstallations.versionId))
      .where(
        and(
          eq(moduleAppInstallations.id, params.installationId),
          eq(moduleAppInstallations.appId, params.appId),
          eq(moduleAppInstallations.versionId, params.versionId),
          eq(moduleApps.status, 'published'),
          eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
          isNull(moduleAppInstallations.uninstalledAt),
          or(
            and(
              eq(moduleAppInstallations.scopeType, 'personal'),
              eq(moduleAppInstallations.userId, params.userId),
            ),
            params.workspaceId
              ? and(
                  eq(moduleAppInstallations.scopeType, 'workspace'),
                  eq(moduleAppInstallations.workspaceId, params.workspaceId),
                )
              : undefined,
          ),
        ),
      )
      .limit(1);

    if (!row) return null;

    const actions = await this.db.query.moduleAppActions.findMany({
      columns: { runtimeConfig: true },
      where: and(
        eq(moduleAppActions.appId, row.appId),
        eq(moduleAppActions.versionId, row.versionId),
      ),
    });

    return {
      ...row,
      secretKeys: getModuleAppDeclaredSecretKeys(actions),
    };
  };

  getInstallationSecret = async (params: { installationId: string; key: string }) => {
    const secret = await this.db.query.moduleAppInstallationSecrets.findFirst({
      columns: { encryptedValue: true },
      where: and(
        eq(moduleAppInstallationSecrets.installationId, params.installationId),
        eq(moduleAppInstallationSecrets.secretKey, params.key),
      ),
    });

    return secret?.encryptedValue ?? null;
  };

  listInstallationSecrets = async (params: { installationId: string }) => {
    return (await this.getInstallationSecretState(params)).items;
  };

  getInstallationSecretState = async (params: { installationId: string }) => {
    const installation = await this.db.query.moduleAppInstallations.findFirst({
      columns: { appId: true, versionId: true },
      where: and(
        eq(moduleAppInstallations.id, params.installationId),
        eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
        isNull(moduleAppInstallations.uninstalledAt),
      ),
    });
    if (!installation?.versionId) throw new Error('MODULE_APP_INSTALLATION_REQUIRED');

    const [actions, items] = await Promise.all([
      this.db.query.moduleAppActions.findMany({
        columns: { runtimeConfig: true },
        where: and(
          eq(moduleAppActions.appId, installation.appId),
          eq(moduleAppActions.versionId, installation.versionId),
        ),
      }),
      this.db.query.moduleAppInstallationSecrets.findMany({
        columns: {
          createdAt: true,
          secretKey: true,
          updatedAt: true,
        },
        orderBy: [asc(moduleAppInstallationSecrets.secretKey)],
        where: eq(moduleAppInstallationSecrets.installationId, params.installationId),
      }),
    ]);
    const requiredKeys = getModuleAppDeclaredSecretKeys(actions);
    const configuredKeys = new Set(items.map(({ secretKey }) => secretKey));
    const missingKeys = requiredKeys.filter((key) => !configuredKeys.has(key));

    return {
      items,
      missingKeys,
      ready: missingKeys.length === 0,
      requiredKeys,
    };
  };

  upsertInstallationSecret = async (params: {
    createdBy: string;
    encryptedValue: string;
    installationId: string;
    secretKey: string;
  }) => {
    return this.db.transaction(async (tx) => {
      const [installation] = await tx
        .select({
          appId: moduleAppInstallations.appId,
          id: moduleAppInstallations.id,
          versionId: moduleAppInstallations.versionId,
        })
        .from(moduleAppInstallations)
        .where(
          and(
            eq(moduleAppInstallations.id, params.installationId),
            eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
            isNull(moduleAppInstallations.uninstalledAt),
          ),
        )
        .for('update');
      if (!installation?.versionId) throw new Error('MODULE_APP_INSTALLATION_REQUIRED');

      const actions = await tx.query.moduleAppActions.findMany({
        columns: { runtimeConfig: true },
        where: and(
          eq(moduleAppActions.appId, installation.appId),
          eq(moduleAppActions.versionId, installation.versionId),
        ),
      });
      if (!getModuleAppDeclaredSecretKeys(actions).includes(params.secretKey)) {
        throw new Error('MODULE_APP_SECRET_NOT_DECLARED');
      }

      await tx
        .insert(moduleAppInstallationSecrets)
        .values(params)
        .onConflictDoUpdate({
          set: {
            encryptedValue: params.encryptedValue,
            updatedAt: new Date(),
          },
          target: [
            moduleAppInstallationSecrets.installationId,
            moduleAppInstallationSecrets.secretKey,
          ],
        });

      return { ok: true as const };
    });
  };

  deleteInstallationSecret = async (params: { installationId: string; secretKey: string }) => {
    await this.assertInstallationActive(params.installationId);
    await this.db
      .delete(moduleAppInstallationSecrets)
      .where(
        and(
          eq(moduleAppInstallationSecrets.installationId, params.installationId),
          eq(moduleAppInstallationSecrets.secretKey, params.secretKey),
        ),
      );

    return { ok: true as const };
  };

  assertInstallationAccess = async (params: {
    installationId: string;
    userId: string;
    workspaceId?: string;
  }) => {
    const installation = await this.db.query.moduleAppInstallations.findFirst({
      columns: { id: true },
      where: and(
        eq(moduleAppInstallations.id, params.installationId),
        eq(moduleAppInstallations.status, INSTALL_STATUS_ACTIVE),
        params.workspaceId
          ? and(
              eq(moduleAppInstallations.scopeType, 'workspace'),
              eq(moduleAppInstallations.workspaceId, params.workspaceId),
            )
          : and(
              eq(moduleAppInstallations.scopeType, 'personal'),
              eq(moduleAppInstallations.userId, params.userId),
            ),
      ),
    });
    if (!installation) throw new Error('MODULE_APP_INSTALLATION_ACCESS_DENIED');
  };
}
