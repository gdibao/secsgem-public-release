// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppActions,
  moduleAppArtifactCleanupJobs,
  moduleAppArtifacts,
  moduleAppEntitlements,
  moduleAppInstallations,
  moduleAppInstallationSecrets,
  moduleAppInstallationVersionRefs,
  moduleAppRecordEvents,
  moduleAppRecords,
  moduleApps,
  moduleAppVersions,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppModel } from '../moduleApp';

const serverDB: LobeChatDatabase = await getTestDB();
const model = new ModuleAppModel(serverDB);

const userId = 'module-app-user';
const otherUserId = 'module-app-other-user';
const workspaceId = 'module-app-workspace';
const baseBilling = {
  chargeMode: 'free' as const,
  defaultMultiplier: 1,
  externalApiCostCredits: 0,
  failureFixedFeePolicy: 'do_not_charge' as const,
  fixedServiceFeeCredits: 0,
};

beforeEach(async () => {
  await serverDB.delete(moduleAppArtifactCleanupJobs);
  await serverDB.delete(moduleApps);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Module App Team',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

const createRecordDesk = async (
  overrides: {
    description?: string;
    displayName?: string;
    slug?: string;
  } = {},
) => {
  const app = await model.upsertAppForAdmin({
    actions: [
      {
        id: 'create_record',
        inputSchema: { fields: [] },
        moduleMultiplier: 1.35,
        name: 'Create',
        outputSchema: {},
        runtimeConfig: {},
        runtimeType: 'record_create',
      },
    ],
    appType: 'standard_app',
    billing: baseBilling,
    category: 'productivity',
    description: overrides.description ?? 'A saved records app',
    displayName: overrides.displayName ?? 'Record Desk',
    icon: 'Notebook',
    pages: [
      {
        actionBindings: [],
        dataSource: {},
        key: 'overview',
        layoutSchema: {},
        routePath: '/',
        sortOrder: 0,
        title: 'Overview',
        type: 'overview',
      },
      {
        actionBindings: [],
        dataSource: {},
        key: 'records',
        layoutSchema: {},
        routePath: '/records',
        sortOrder: 1,
        title: 'Records',
        type: 'list',
      },
    ],
    slug: overrides.slug ?? 'record-desk',
    source: 'admin',
    status: 'published',
    tags: ['records'],
  });

  await serverDB.insert(moduleAppEntitlements).values({
    appId: app.id,
    installable: true,
    plan: 'free',
    runnable: true,
    visible: true,
  });

  return app;
};

const withFailingRecordEventInsert = async <T>(operation: () => Promise<T>) => {
  await serverDB.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION fail_module_app_record_event_insert()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'module_app_record_event_failure';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER fail_module_app_record_event_insert
    BEFORE INSERT ON module_app_record_events
    FOR EACH ROW EXECUTE FUNCTION fail_module_app_record_event_insert();
  `),
  );

  try {
    return await operation();
  } finally {
    await serverDB.execute(
      sql.raw(`
      DROP TRIGGER IF EXISTS fail_module_app_record_event_insert ON module_app_record_events;
      DROP FUNCTION IF EXISTS fail_module_app_record_event_insert();
    `),
    );
  }
};

const hasErrorMessageInCauseChain = (error: unknown, expected: string) => {
  const visited = new Set<unknown>();
  let current = error;

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (
      'message' in current &&
      typeof current.message === 'string' &&
      current.message.includes(expected)
    ) {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }

  return false;
};

const expectRecordEventInsertFailure = async (operation: () => Promise<unknown>) => {
  let failure: unknown;
  try {
    await withFailingRecordEventInsert(operation);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeDefined();
  expect(hasErrorMessageInCauseChain(failure, 'module_app_record_event_failure')).toBe(true);
};

describe('ModuleAppModel marketplace behavior', () => {
  it('uses the explicit published version pointer and preserves published version content', async () => {
    const app = await createRecordDesk();
    const originalApp = await serverDB.query.moduleApps.findFirst({
      where: eq(moduleApps.id, app.id),
    });
    const originalVersionId = (originalApp as any).currentPublishedVersionId as string;
    expect(originalVersionId).toBeTruthy();

    const [draft] = await serverDB
      .insert(moduleAppVersions)
      .values({ appId: app.id, version: '2.0.0' })
      .returning();
    await model.installPersonalApp({ appId: app.id, userId });

    await expect(
      serverDB.query.moduleAppInstallations.findFirst({
        where: eq(moduleAppInstallations.appId, app.id),
      }),
    ).resolves.toMatchObject({ versionId: originalVersionId });

    await model.upsertAppForAdmin({
      actions: [],
      appType: 'standard_app',
      billing: baseBilling,
      category: 'productivity',
      description: 'Updated record desk',
      displayName: 'Record Desk',
      icon: 'Notebook',
      pages: [
        {
          actionBindings: [],
          dataSource: {},
          key: 'overview',
          layoutSchema: {},
          routePath: '/',
          sortOrder: 0,
          title: 'Updated Overview',
          type: 'overview',
        },
      ],
      slug: 'record-desk',
      source: 'admin',
      status: 'published',
      tags: ['records'],
    });

    const updatedApp = await serverDB.query.moduleApps.findFirst({
      where: eq(moduleApps.id, app.id),
    });
    expect((updatedApp as any).currentPublishedVersionId).toBe(draft.id);
    await expect(
      serverDB.query.moduleAppPages.findFirst({
        where: (rows, { and, eq }) =>
          and(eq(rows.versionId, originalVersionId), eq(rows.pageKey, 'overview')),
      }),
    ).resolves.toMatchObject({ title: 'Overview' });
    await expect(
      serverDB.query.moduleAppVersions.findFirst({
        where: eq(moduleAppVersions.id, originalVersionId),
      }),
    ).resolves.toMatchObject({ publishedAt: expect.any(Date) });
    await expect(
      model.getAppDetail({ appIdOrSlug: app.id, plan: 'free', userId }),
    ).resolves.toMatchObject({ pages: [expect.objectContaining({ title: 'Updated Overview' })] });
    const adminApp = await model.getAdminApp({ appId: app.id });
    expect(adminApp?.pages).toEqual([
      expect.objectContaining({ key: 'overview', title: 'Updated Overview' }),
    ]);
  });

  it('upgrades and rolls back an installation with optimistic version checks', async () => {
    const app = await createRecordDesk();
    await model.installPersonalApp({ appId: app.id, userId });
    const installed = await serverDB.query.moduleAppInstallations.findFirst({
      where: eq(moduleAppInstallations.appId, app.id),
    });
    if (!installed?.versionId) throw new Error('module_app_test_installation_missing');
    const initialVersionId = installed.versionId;

    const [nextVersion] = await serverDB
      .insert(moduleAppVersions)
      .values({ appId: app.id, version: '2.0.0' })
      .returning();
    await model.upsertAppForAdmin({
      actions: [],
      appType: 'standard_app',
      billing: baseBilling,
      category: 'productivity',
      description: 'Record desk version 2',
      displayName: 'Record Desk',
      icon: 'Notebook',
      pages: [
        {
          actionBindings: [],
          dataSource: {},
          key: 'overview',
          layoutSchema: {},
          routePath: '/',
          sortOrder: 0,
          title: 'Version 2 Overview',
          type: 'overview',
        },
      ],
      slug: 'record-desk',
      source: 'admin',
      status: 'published',
      tags: ['records'],
    });

    await expect(
      model.getInstallationVersionState({ appId: app.id, userId }),
    ).resolves.toMatchObject({
      installedVersion: { id: initialVersionId, version: '1.0.0' },
      publishedVersion: { id: nextVersion.id, version: '2.0.0' },
      rollbackVersions: [],
      updateAvailable: true,
    });
    await expect(
      model.listInstalledAppsPage({ cursor: 0, limit: 20, scopeType: 'personal', userId }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          installedVersion: { id: initialVersionId, version: '1.0.0' },
          publishedVersion: { id: nextVersion.id, version: '2.0.0' },
          updateAvailable: true,
          version: '1.0.0',
        }),
      ],
    });
    await expect(model.installPersonalApp({ appId: app.id, userId })).rejects.toThrow(
      'MODULE_APP_INSTALLATION_VERSION_CONFLICT',
    );

    await expect(
      model.changeInstallationVersion({
        appId: app.id,
        expectedVersionId: initialVersionId,
        operation: 'upgrade',
        scopeType: 'personal',
        userId,
      }),
    ).resolves.toMatchObject({
      changed: true,
      previousVersionId: initialVersionId,
      versionId: nextVersion.id,
    });
    await expect(
      model.changeInstallationVersion({
        appId: app.id,
        expectedVersionId: initialVersionId,
        operation: 'upgrade',
        scopeType: 'personal',
        userId,
      }),
    ).rejects.toThrow('MODULE_APP_INSTALLATION_VERSION_CONFLICT');
    await expect(
      model.getInstallationVersionState({ appId: app.id, userId }),
    ).resolves.toMatchObject({
      installedVersion: { id: nextVersion.id, version: '2.0.0' },
      rollbackVersions: [{ id: initialVersionId, version: '1.0.0' }],
      updateAvailable: false,
    });
    await expect(
      model.listInstalledAppsPage({ cursor: 0, limit: 20, scopeType: 'personal', userId }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          installedVersion: { id: nextVersion.id, version: '2.0.0' },
          publishedVersion: { id: nextVersion.id, version: '2.0.0' },
          updateAvailable: false,
          version: '2.0.0',
        }),
      ],
    });

    await expect(
      model.changeInstallationVersion({
        appId: app.id,
        expectedVersionId: nextVersion.id,
        operation: 'rollback',
        scopeType: 'personal',
        targetVersionId: initialVersionId,
        userId,
      }),
    ).resolves.toMatchObject({
      changed: true,
      previousVersionId: nextVersion.id,
      versionId: initialVersionId,
    });
    await expect(
      model.getInstallationVersionState({ appId: app.id, userId }),
    ).resolves.toMatchObject({
      installedVersion: { id: initialVersionId, version: '1.0.0' },
      rollbackVersions: [{ id: nextVersion.id, version: '2.0.0' }],
      updateAvailable: true,
    });
  });

  it('requires an exact confirmation snapshot for expanded version grants', async () => {
    const app = await createRecordDesk();
    await model.installPersonalApp({ appId: app.id, userId });
    const installation = await serverDB.query.moduleAppInstallations.findFirst({
      where: eq(moduleAppInstallations.appId, app.id),
    });
    if (!installation?.versionId) throw new Error('module_app_test_installation_missing');

    const [nextVersion] = await serverDB
      .insert(moduleAppVersions)
      .values({
        appId: app.id,
        manifestSnapshot: { actions: [] },
        publishedAt: new Date(),
        runtimeManifest: {
          runtime: {
            kind: 'sandboxed_app',
            outboundHosts: ['api.example.com'],
            permissions: ['records.write'],
          },
        },
        version: '2.0.0',
      })
      .returning();
    await serverDB
      .update(moduleApps)
      .set({ currentPublishedVersionId: nextVersion.id, status: 'published' })
      .where(eq(moduleApps.id, app.id));

    const state = await model.getInstallationVersionState({ appId: app.id, userId });
    expect(state?.publishedVersion?.grantChange).toMatchObject({
      added: {
        outboundHosts: ['api.example.com'],
        permissions: ['records.write'],
      },
      hasExpansion: true,
    });
    await expect(
      model.changeInstallationVersion({
        appId: app.id,
        expectedVersionId: installation.versionId,
        operation: 'upgrade',
        scopeType: 'personal',
        userId,
      }),
    ).rejects.toThrow('MODULE_APP_GRANT_CONFIRMATION_REQUIRED');

    await expect(
      model.changeInstallationVersion({
        acceptedGrantSnapshot: state!.publishedVersion!.grantChange.targetSnapshot,
        appId: app.id,
        expectedVersionId: installation.versionId,
        operation: 'upgrade',
        scopeType: 'personal',
        userId,
      }),
    ).resolves.toMatchObject({
      grantSnapshot: expect.objectContaining({
        outboundHosts: ['api.example.com'],
        permissions: ['records.write'],
      }),
      versionId: nextVersion.id,
    });
  });

  it('resolves an execution action from the installed version only', async () => {
    const app = await createRecordDesk();
    await model.installPersonalApp({ appId: app.id, userId });

    const installed = await serverDB.query.moduleAppInstallations.findFirst({
      where: eq(moduleAppInstallations.appId, app.id),
    });
    expect(installed?.versionId).toBeTruthy();

    const [newVersion] = await serverDB
      .insert(moduleAppVersions)
      .values({ appId: app.id, version: '2.0.0' })
      .returning();
    await serverDB.insert(moduleAppActions).values({
      actionKey: 'create_record',
      appId: app.id,
      inputSchema: { fields: [] },
      moduleMultiplier: 2,
      name: 'Create v2',
      outputSchema: {},
      runtimeConfig: {},
      runtimeType: 'record_create',
      versionId: newVersion.id,
    });

    const run = await model.createRun({
      actionId: 'create_record',
      appId: app.id,
      input: { title: 'Installed version' },
      scopeType: 'personal',
      userId,
    });

    await expect(
      serverDB.query.moduleAppActions.findFirst({
        where: eq(moduleAppActions.id, run.actionId!),
      }),
    ).resolves.toMatchObject({ name: 'Create' });
    expect(run.versionId).toBe(installed?.versionId);
  });

  it('lists only published module apps visible to a plan', async () => {
    await createRecordDesk();

    const hidden = await model.upsertAppForAdmin({
      actions: [],
      appType: 'standard_app',
      billing: baseBilling,
      category: 'productivity',
      description: 'Hidden app',
      displayName: 'Hidden Desk',
      icon: 'Notebook',
      pages: [
        {
          actionBindings: [],
          dataSource: {},
          key: 'overview',
          layoutSchema: {},
          routePath: '/',
          sortOrder: 0,
          title: 'Overview',
          type: 'overview',
        },
      ],
      slug: 'hidden-desk',
      source: 'admin',
      status: 'published',
      tags: ['records'],
    });
    await serverDB.insert(moduleAppEntitlements).values({
      appId: hidden.id,
      plan: 'free',
      visible: false,
    });

    const rows = await model.listMarketplaceApps({ plan: 'free', userId });

    expect(rows.map((item) => item.slug)).toEqual(['record-desk']);
    expect(rows[0]).toMatchObject({
      appType: 'standard_app',
      installed: false,
      planState: { installable: true, runnable: true, visible: true },
      status: 'published',
    });

    await expect(
      model.listMarketplaceApps({ includeHidden: true, plan: 'free', userId }),
    ).resolves.toEqual([
      expect.objectContaining({ slug: 'hidden-desk' }),
      expect.objectContaining({ slug: 'record-desk' }),
    ]);
  });

  it('returns app detail with pages, actions, entitlements, and installation state', async () => {
    const app = await createRecordDesk();
    const [version] = await serverDB
      .select({ id: moduleAppVersions.id })
      .from(moduleAppVersions)
      .where(eq(moduleAppVersions.appId, app.id));

    await model.installApp({
      appId: app.id,
      scopeType: 'personal',
      userId,
      versionId: version!.id,
    });

    const detail = await model.getAppDetail({
      appIdOrSlug: 'record-desk',
      plan: 'free',
      userId,
    });

    expect(detail).toMatchObject({
      description: 'A saved records app',
      installed: true,
      slug: 'record-desk',
    });
    expect(detail?.pages.map((page) => page.key)).toEqual(['overview', 'records']);
    expect(detail?.actions).toEqual([
      expect.objectContaining({ id: 'create_record', moduleMultiplier: 1.35 }),
    ]);
    expect(detail?.entitlements).toEqual(
      expect.arrayContaining([expect.objectContaining({ plan: 'free', visible: true })]),
    );
  });

  it('lists and uninstalls personal module apps', async () => {
    const app = await createRecordDesk();

    await model.installPersonalApp({ appId: app.id, userId });
    const installation = await serverDB.query.moduleAppInstallations.findFirst({
      where: eq(moduleAppInstallations.appId, app.id),
    });
    await serverDB.insert(moduleAppInstallationSecrets).values({
      encryptedValue: 'encrypted-value',
      installationId: installation!.id,
      secretKey: 'CRM_TOKEN',
    });
    await serverDB.insert(moduleAppRecords).values({
      appId: app.id,
      collectionKey: 'notes',
      installationId: installation!.id,
      ownerUserId: userId,
      scopeType: 'personal',
    });
    const run = await model.createRun({
      actionId: 'create_record',
      appId: app.id,
      input: { title: 'Queued artifact' },
      scopeType: 'personal',
      userId,
    });
    const artifactStorageKey = `module-apps/${app.id}/${run.id}/result.txt`;
    await serverDB.insert(moduleAppArtifacts).values({
      appId: app.id,
      fileName: 'result.txt',
      installationId: installation!.id,
      mimeType: 'text/plain',
      runId: run.id,
      scopeType: 'personal',
      sizeBytes: 12,
      storageKey: artifactStorageKey,
      userId,
    });

    await expect(model.listInstalledApps({ scopeType: 'personal', userId })).resolves.toEqual([
      expect.objectContaining({ id: app.id, installed: true, slug: 'record-desk' }),
    ]);

    await model.uninstallPersonalApp({ appId: app.id, userId });

    await expect(model.listInstalledApps({ scopeType: 'personal', userId })).resolves.toEqual([]);
    await expect(
      serverDB.query.moduleAppInstallationSecrets.findFirst({
        where: eq(moduleAppInstallationSecrets.installationId, installation!.id),
      }),
    ).resolves.toBeUndefined();
    await expect(
      serverDB.query.moduleAppInstallations.findFirst({
        where: eq(moduleAppInstallations.appId, app.id),
      }),
    ).resolves.toMatchObject({ status: 'uninstalled', versionId: null });
    await expect(
      serverDB.query.moduleAppInstallationVersionRefs.findFirst({
        where: eq(moduleAppInstallationVersionRefs.installationId, installation!.id),
      }),
    ).resolves.toBeUndefined();
    await expect(
      serverDB.query.moduleAppRecords.findFirst({
        where: eq(moduleAppRecords.installationId, installation!.id),
      }),
    ).resolves.toBeDefined();
    await expect(
      serverDB.query.moduleAppArtifacts.findFirst({
        where: eq(moduleAppArtifacts.installationId, installation!.id),
      }),
    ).resolves.toBeDefined();

    await model.installPersonalApp({ appId: app.id, userId });
    await expect(
      model.uninstallPersonalApp({ appId: app.id, dataPolicy: 'delete', userId }),
    ).resolves.toMatchObject({ dataPolicy: 'delete', dataPurgedAt: expect.any(Date) });
    await expect(
      serverDB.query.moduleAppRecords.findFirst({
        where: eq(moduleAppRecords.installationId, installation!.id),
      }),
    ).resolves.toBeUndefined();
    await expect(
      serverDB.query.moduleAppInstallations.findFirst({
        where: eq(moduleAppInstallations.id, installation!.id),
      }),
    ).resolves.toMatchObject({ dataPurgedAt: expect.any(Date), status: 'uninstalled' });
    await expect(
      serverDB.query.moduleAppArtifactCleanupJobs.findFirst({
        where: eq(moduleAppArtifactCleanupJobs.installationId, installation!.id),
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      storageKey: artifactStorageKey,
    });
  });

  it('reports configuration and runtime readiness from the installed version snapshot', async () => {
    const app = await createRecordDesk();
    await model.installPersonalApp({ appId: app.id, userId });
    const installation = await serverDB.query.moduleAppInstallations.findFirst({
      where: eq(moduleAppInstallations.appId, app.id),
    });
    if (!installation?.versionId) throw new Error('module_app_test_installation_missing');

    await serverDB
      .update(moduleAppActions)
      .set({ runtimeConfig: { secretKeys: ['CRM_TOKEN'] } })
      .where(eq(moduleAppActions.appId, app.id));

    await expect(
      model.listInstalledAppsPage({ cursor: 0, limit: 20, scopeType: 'personal', userId }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          installationReadiness: {
            configuration: 'required',
            missingSecretCount: 1,
            runtime: 'ready',
          },
        }),
      ],
    });

    await serverDB.insert(moduleAppInstallationSecrets).values({
      encryptedValue: 'encrypted-value',
      installationId: installation.id,
      secretKey: 'CRM_TOKEN',
    });
    await expect(
      model.getInstallationVersionState({ appId: app.id, userId }),
    ).resolves.toMatchObject({
      installationReadiness: {
        configuration: 'ready',
        missingSecretCount: 0,
        runtime: 'ready',
      },
    });

    await serverDB
      .update(moduleAppVersions)
      .set({ runtimeManifest: { manifestVersion: 2 } })
      .where(eq(moduleAppVersions.id, installation.versionId));
    await expect(
      model.listInstalledAppsPage({ cursor: 0, limit: 20, scopeType: 'personal', userId }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          installationReadiness: {
            configuration: 'ready',
            missingSecretCount: 0,
            runtime: 'unavailable',
          },
        }),
      ],
    });
  });

  it('paginates and searches installed apps with stable ordering', async () => {
    const gamma = await createRecordDesk({ displayName: 'Gamma Desk', slug: 'gamma-desk' });
    const alpha = await createRecordDesk({ displayName: 'Alpha Desk', slug: 'alpha-desk' });
    const beta = await createRecordDesk({
      description: 'Handles private customer records',
      displayName: 'Beta Desk',
      slug: 'beta-desk',
    });
    await model.installPersonalApp({ appId: gamma.id, userId });
    await model.installPersonalApp({ appId: alpha.id, userId });
    await model.installPersonalApp({ appId: beta.id, userId });

    await expect(
      model.listInstalledAppsPage({ cursor: 0, limit: 2, scopeType: 'personal', userId }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({ displayName: 'Alpha Desk', id: alpha.id }),
        expect.objectContaining({ displayName: 'Beta Desk', id: beta.id }),
      ],
      nextCursor: 2,
    });
    await expect(
      model.listInstalledAppsPage({ cursor: 2, limit: 2, scopeType: 'personal', userId }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ displayName: 'Gamma Desk', id: gamma.id })],
      nextCursor: null,
    });
    await expect(
      model.listInstalledAppsPage({
        cursor: 0,
        limit: 20,
        query: 'PRIVATE CUSTOMER',
        scopeType: 'personal',
        userId,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: beta.id })],
      nextCursor: null,
    });
    await expect(
      model.listInstalledAppsPage({
        cursor: 0,
        limit: 20,
        query: 'alpha-desk',
        scopeType: 'personal',
        userId,
      }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: alpha.id })] });
  });

  it('installs, resolves, lists, and uninstalls workspace module apps', async () => {
    const app = await createRecordDesk();

    await model.installWorkspaceApp({ appId: app.id, userId, workspaceId });

    await expect(
      model.getAppDetail({
        appIdOrSlug: app.id,
        plan: 'free',
        userId,
        workspaceId,
      }),
    ).resolves.toMatchObject({ installed: true });
    await expect(
      model.listInstalledApps({ scopeType: 'workspace', userId, workspaceId }),
    ).resolves.toEqual([
      expect.objectContaining({ id: app.id, installed: true, slug: 'record-desk' }),
    ]);

    await model.uninstallWorkspaceApp({ appId: app.id, workspaceId });

    await expect(
      model.listInstalledApps({ scopeType: 'workspace', userId, workspaceId }),
    ).resolves.toEqual([]);
  });

  it('returns admin list/detail data and updates status/entitlements', async () => {
    const app = await createRecordDesk();

    await expect(model.listAdminApps({ status: 'published' })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: app.id, slug: 'record-desk' })],
      nextCursor: null,
    });

    await expect(model.getAdminApp({ appId: app.id })).resolves.toMatchObject({
      actions: expect.arrayContaining([expect.objectContaining({ id: 'create_record' })]),
      entitlements: expect.arrayContaining([
        expect.objectContaining({ plan: 'free', runnable: true }),
      ]),
      id: app.id,
      pages: expect.arrayContaining([expect.objectContaining({ key: 'overview' })]),
      version: '1.0.0',
    });

    await model.setStatus({ appId: app.id, status: 'unpublished' });
    await expect(model.getAdminApp({ appId: app.id })).resolves.toMatchObject({
      status: 'unpublished',
    });

    await model.upsertEntitlementsForAdmin({
      appId: app.id,
      entitlements: [
        {
          discountPercent: 20,
          freeQuotaCredits: 100,
          installable: false,
          plan: 'premium',
          runnable: true,
          visible: true,
        },
      ],
    });

    await expect(model.getAdminApp({ appId: app.id })).resolves.toMatchObject({
      entitlements: expect.arrayContaining([
        expect.objectContaining({ discountPercent: 20, plan: 'premium' }),
      ]),
    });
  });

  it('atomically replaces pages and actions with optimistic version protection', async () => {
    const app = await createRecordDesk();
    const before = await model.getAdminApp({ appId: app.id });
    if (!before?.versionId) throw new Error('module_app_test_version_missing');

    await expect(
      model.upsertConfigurationForAdmin({
        actions: [],
        appId: app.id,
        expectedVersionId: before.versionId,
        pages: [
          {
            actionBindings: [],
            dataSource: {},
            key: 'dashboard',
            layoutSchema: {},
            routePath: '/',
            sortOrder: 0,
            title: 'Dashboard',
            type: 'overview',
          },
        ],
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));

    const after = await model.getAdminApp({ appId: app.id });
    expect(after).toMatchObject({
      actions: [],
      pages: [expect.objectContaining({ key: 'dashboard' })],
    });
    expect(after?.versionId).not.toBe(before.versionId);

    await expect(
      model.upsertConfigurationForAdmin({
        actions: before.actions,
        appId: app.id,
        expectedVersionId: before.versionId,
        pages: before.pages,
      }),
    ).rejects.toThrow('MODULE_APP_CONFIGURATION_CONFLICT');
    await expect(model.getAdminApp({ appId: app.id })).resolves.toMatchObject({
      actions: [],
      pages: [expect.objectContaining({ key: 'dashboard' })],
    });
  });

  it('isolates personal and workspace records and hides archived records', async () => {
    const app = await createRecordDesk();
    const version = await serverDB.query.moduleAppVersions.findFirst({
      where: eq(moduleAppVersions.appId, app.id),
    });
    if (!version) throw new Error('module_app_test_version_missing');
    await model.installPersonalApp({ appId: app.id, userId });
    await model.installPersonalApp({ appId: app.id, userId: otherUserId });
    await model.installApp({
      appId: app.id,
      scopeType: 'workspace',
      userId,
      versionId: version.id,
      workspaceId,
    });

    const personal = await model.createRecord({
      appId: app.id,
      collectionKey: 'records',
      data: { title: 'Personal A' },
      scopeType: 'personal',
      title: 'Personal A',
      userId,
    });
    await model.createRecord({
      appId: app.id,
      collectionKey: 'records',
      data: { title: 'Other Personal' },
      scopeType: 'personal',
      title: 'Other Personal',
      userId: otherUserId,
    });
    const workspace = await model.createRecord({
      appId: app.id,
      collectionKey: 'records',
      data: { title: 'Team A' },
      scopeType: 'workspace',
      title: 'Team A',
      userId,
      workspaceId,
    });

    await model.archiveRecord({ appId: app.id, recordId: personal.id, userId });

    await expect(
      model.getRecord({ appId: app.id, recordId: personal.id, userId }),
    ).resolves.toBeNull();
    await expect(
      model.getRecord({ appId: app.id, recordId: workspace.id, userId, workspaceId }),
    ).resolves.toMatchObject({ id: workspace.id, scopeType: 'workspace' });

    await expect(
      model.listRecords({
        appId: app.id,
        collectionKey: 'records',
        limit: 20,
        offset: 0,
        scopeType: 'personal',
        userId,
      }),
    ).resolves.toEqual({ items: [], total: 0 });

    await expect(
      model.listRecords({
        appId: app.id,
        collectionKey: 'records',
        limit: 20,
        offset: 0,
        scopeType: 'workspace',
        userId,
        workspaceId,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: workspace.id, title: 'Team A' })],
      total: 1,
    });

    const events = await serverDB.query.moduleAppRecordEvents.findMany({
      where: eq(moduleAppRecordEvents.appId, app.id),
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([
      'archived',
      'created',
      'created',
      'created',
    ]);
  });

  it('rolls back record creates, updates, and archives when the audit event insert fails', async () => {
    const app = await createRecordDesk();
    await model.installPersonalApp({ appId: app.id, userId });
    const record = await model.createRecord({
      appId: app.id,
      collectionKey: 'records',
      data: { title: 'Original' },
      scopeType: 'personal',
      title: 'Original',
      userId,
    });

    await expectRecordEventInsertFailure(() =>
      model.createRecord({
        appId: app.id,
        collectionKey: 'records',
        data: { title: 'Create should roll back' },
        scopeType: 'personal',
        title: 'Create should roll back',
        userId,
      }),
    );
    await expect(
      serverDB.query.moduleAppRecords.findMany({ where: eq(moduleAppRecords.appId, app.id) }),
    ).resolves.toEqual([expect.objectContaining({ id: record.id, title: 'Original' })]);

    await expectRecordEventInsertFailure(() =>
      model.updateRecord({
        appId: app.id,
        collectionKey: 'records',
        data: { title: 'Updated' },
        recordId: record.id,
        scopeType: 'personal',
        title: 'Updated',
        userId,
      }),
    );
    await expect(
      serverDB.query.moduleAppRecords.findFirst({
        where: eq(moduleAppRecords.id, record.id),
      }),
    ).resolves.toMatchObject({ data: { title: 'Original' }, status: 'active', title: 'Original' });

    await expectRecordEventInsertFailure(() =>
      model.archiveRecord({ appId: app.id, recordId: record.id, userId }),
    );
    await expect(
      serverDB.query.moduleAppRecords.findFirst({
        where: eq(moduleAppRecords.id, record.id),
      }),
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('persists run updates and lists artifacts by user scope', async () => {
    const app = await createRecordDesk();
    await model.installPersonalApp({ appId: app.id, userId });
    const run = await model.createRun({
      actionId: 'create_record',
      appId: app.id,
      input: { title: 'A' },
      scopeType: 'personal',
      userId,
    });

    await model.updateRun({
      billing: { chargedCredits: 0 },
      output: { preview: 'Created A' },
      runId: run.id,
      status: 'succeeded',
    });
    await serverDB.insert(moduleAppArtifacts).values({
      appId: app.id,
      fileName: 'result.txt',
      installationId: run.installationId,
      mimeType: 'text/plain',
      runId: run.id,
      scopeType: 'personal',
      sizeBytes: 12,
      storageKey: 'module-app/result.txt',
      userId,
    });

    const runs = await model.listRuns({ installationId: run.installationId!, userId });
    expect(runs.items).toEqual([
      expect.objectContaining({
        outputSnapshot: { preview: 'Created A' },
        status: 'succeeded',
      }),
    ]);

    const artifacts = await model.listArtifacts({ installationId: run.installationId!, userId });
    expect(artifacts.items).toEqual([
      expect.objectContaining({
        fileName: 'result.txt',
        runId: run.id,
      }),
    ]);
  });

  it('rejects new records when no active installation owns the scope', async () => {
    const app = await createRecordDesk();

    await expect(
      model.createRecord({
        appId: app.id,
        collectionKey: 'records',
        data: { title: 'Unowned' },
        scopeType: 'personal',
        userId,
      }),
    ).rejects.toThrow('MODULE_APP_INSTALLATION_REQUIRED');
  });
});
