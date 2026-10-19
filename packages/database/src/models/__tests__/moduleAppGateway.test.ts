// @vitest-environment node
import { moduleAppPackageManifestSchema } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppActions,
  moduleAppBuilds,
  moduleAppInstallations,
  moduleAppInstallationSecrets,
  moduleAppPackages,
  moduleAppPages,
  moduleApps,
  moduleAppVersions,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppModel } from '../moduleApp';

const USER_ID = 'module-app-gateway-user';
const OTHER_USER_ID = 'module-app-gateway-other';
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(moduleAppInstallationSecrets);
  await serverDB.delete(moduleAppInstallations);
  await serverDB.delete(moduleAppBuilds);
  await serverDB.delete(moduleAppPackages);
  await serverDB.delete(moduleAppPages);
  await serverDB.delete(moduleAppActions);
  await serverDB.delete(moduleAppVersions);
  await serverDB.delete(moduleApps);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: USER_ID }, { id: OTHER_USER_ID }]);
});

describe('ModuleAppModel capability gateway isolation', () => {
  it('manages installation secrets without exposing encrypted values', async () => {
    const [app] = await serverDB
      .insert(moduleApps)
      .values({
        appType: 'hybrid_app',
        billing: {
          chargeMode: 'free',
          defaultMultiplier: 1,
          externalApiCostCredits: 0,
          failureFixedFeePolicy: 'do_not_charge',
          fixedServiceFeeCredits: 0,
        },
        category: 'business',
        description: 'Secret lifecycle test app.',
        displayName: 'Secret App',
        icon: 'KeyRound',
        slug: `secret-${crypto.randomUUID()}`,
        status: 'published',
      })
      .returning();
    const [version] = await serverDB
      .insert(moduleAppVersions)
      .values({ appId: app.id, version: '1.0.0' })
      .returning();
    await serverDB.insert(moduleAppActions).values({
      actionKey: 'sync_crm',
      appId: app.id,
      inputSchema: { fields: [] },
      moduleMultiplier: 1,
      name: 'Sync CRM',
      outputSchema: {},
      runtimeConfig: { secretKeys: ['CRM_TOKEN'] },
      runtimeType: 'api_action',
      versionId: version.id,
    });
    const [installation] = await serverDB
      .insert(moduleAppInstallations)
      .values({
        appId: app.id,
        scopeType: 'personal',
        status: 'installed',
        userId: USER_ID,
        versionId: version.id,
      })
      .returning();
    const model = new ModuleAppModel(serverDB);

    await model.upsertInstallationSecret({
      createdBy: USER_ID,
      encryptedValue: 'encrypted-value-v1',
      installationId: installation.id,
      secretKey: 'CRM_TOKEN',
    });
    await model.upsertInstallationSecret({
      createdBy: USER_ID,
      encryptedValue: 'encrypted-value-v2',
      installationId: installation.id,
      secretKey: 'CRM_TOKEN',
    });

    await expect(
      model.listInstallationSecrets({ installationId: installation.id }),
    ).resolves.toEqual([
      expect.objectContaining({
        createdAt: expect.any(Date),
        secretKey: 'CRM_TOKEN',
        updatedAt: expect.any(Date),
      }),
    ]);
    const listedSecrets = await model.listInstallationSecrets({ installationId: installation.id });
    expect(listedSecrets[0]).not.toHaveProperty('encryptedValue');
    await expect(
      model.getInstallationSecretState({ installationId: installation.id }),
    ).resolves.toMatchObject({
      missingKeys: [],
      ready: true,
      requiredKeys: ['CRM_TOKEN'],
    });
    await expect(
      model.getInstallationSecret({ installationId: installation.id, key: 'CRM_TOKEN' }),
    ).resolves.toBe('encrypted-value-v2');
    await expect(
      model.upsertInstallationSecret({
        createdBy: USER_ID,
        encryptedValue: 'encrypted-undeclared',
        installationId: installation.id,
        secretKey: 'UNDECLARED_TOKEN',
      }),
    ).rejects.toThrow('MODULE_APP_SECRET_NOT_DECLARED');

    await expect(
      model.deleteInstallationSecret({
        installationId: installation.id,
        secretKey: 'CRM_TOKEN',
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      model.deleteInstallationSecret({
        installationId: installation.id,
        secretKey: 'CRM_TOKEN',
      }),
    ).resolves.toEqual({ ok: true });

    const [, uninstallResult] = await Promise.allSettled([
      model.upsertInstallationSecret({
        createdBy: USER_ID,
        encryptedValue: 'encrypted-value-during-uninstall',
        installationId: installation.id,
        secretKey: 'CRM_TOKEN',
      }),
      model.uninstallPersonalApp({ appId: app.id, userId: USER_ID }),
    ]);
    expect(uninstallResult.status).toBe('fulfilled');
    await expect(
      serverDB.query.moduleAppInstallationSecrets.findFirst({
        where: eq(moduleAppInstallationSecrets.installationId, installation.id),
      }),
    ).resolves.toBeUndefined();
    await expect(
      model.upsertInstallationSecret({
        createdBy: USER_ID,
        encryptedValue: 'encrypted-value-v3',
        installationId: installation.id,
        secretKey: 'CRM_TOKEN',
      }),
    ).rejects.toThrow('MODULE_APP_INSTALLATION_REQUIRED');
  });

  it('resolves only the matching active installation and encrypted installation secret', async () => {
    const [app] = await serverDB
      .insert(moduleApps)
      .values({
        appType: 'hybrid_app',
        billing: {
          chargeMode: 'external_api',
          defaultMultiplier: 2,
          externalApiCostCredits: 3,
          failureFixedFeePolicy: 'do_not_charge',
          fixedServiceFeeCredits: 1,
        },
        category: 'business',
        description: 'Gateway test app.',
        displayName: 'Gateway App',
        icon: 'Package',
        slug: `gateway-${crypto.randomUUID()}`,
        status: 'published',
      })
      .returning();
    const [version] = await serverDB
      .insert(moduleAppVersions)
      .values({
        appId: app.id,
        runtimeManifest: {
          manifestVersion: 2,
          runtime: { outboundHosts: ['api.example.com'] },
        },
        version: '1.0.0',
      })
      .returning();
    const [installation] = await serverDB
      .insert(moduleAppInstallations)
      .values({
        appId: app.id,
        scopeType: 'personal',
        status: 'installed',
        userId: USER_ID,
        versionId: version.id,
      })
      .returning();
    await serverDB.insert(moduleAppInstallationSecrets).values({
      encryptedValue: 'encrypted-value',
      installationId: installation.id,
      secretKey: 'CRM_TOKEN',
    });
    const model = new ModuleAppModel(serverDB);

    await expect(
      model.getRuntimeInstallationContext({
        appId: app.id,
        installationId: installation.id,
        userId: USER_ID,
        versionId: version.id,
      }),
    ).resolves.toMatchObject({
      displayName: 'Gateway App',
      installationId: installation.id,
      runtimeManifest: expect.objectContaining({ manifestVersion: 2 }),
      secretKeys: [],
      scopeType: 'personal',
    });
    await expect(
      model.getRuntimeInstallationContext({
        appId: app.id,
        installationId: installation.id,
        userId: OTHER_USER_ID,
        versionId: version.id,
      }),
    ).resolves.toBeNull();
    await expect(
      model.getInstallationSecret({ installationId: installation.id, key: 'CRM_TOKEN' }),
    ).resolves.toBe('encrypted-value');
  });

  it('returns only a matching active installation with its immutable ready build', async () => {
    const artifactSha256 = 'a'.repeat(64);
    const [app] = await serverDB
      .insert(moduleApps)
      .values({
        appType: 'hybrid_app',
        billing: {
          chargeMode: 'external_api',
          defaultMultiplier: 2,
          externalApiCostCredits: 3,
          failureFixedFeePolicy: 'do_not_charge',
          fixedServiceFeeCredits: 1,
        },
        category: 'business',
        description: 'Launch context app.',
        displayName: 'Jobs Board',
        icon: 'Package',
        slug: `launch-${crypto.randomUUID()}`,
        status: 'published',
      })
      .returning();
    const runtimeManifest = {
      build: { frontend: { output: 'dist', profile: 'node22-static' } },
      manifestVersion: 2,
      runtime: {
        functions: [],
        kind: 'sandboxed_app',
        outboundHosts: [],
        permissions: ['context.read'],
      },
    } as const;
    const [version] = await serverDB
      .insert(moduleAppVersions)
      .values({
        appId: app.id,
        runtimeArtifactKey: `module-app-builds/build/${artifactSha256}.tgz`,
        runtimeArtifactSha256: artifactSha256,
        runtimeManifest,
        version: '1.0.0',
      })
      .returning();
    await serverDB.insert(moduleAppPages).values({
      actionBindings: [],
      appId: app.id,
      dataSource: {},
      layoutSchema: {},
      pageKey: 'installed_page',
      pageType: 'overview',
      routePath: '/',
      sortOrder: 0,
      title: 'Installed page',
      versionId: version.id,
    });
    const manifestSnapshot = moduleAppPackageManifestSchema.parse({
      app: {
        actions: [],
        appType: 'hybrid_app',
        billing: {},
        category: 'business',
        description: 'Launch context app.',
        displayName: 'Jobs Board',
        icon: 'Package',
        pages: [],
        slug: app.slug,
        source: 'developer',
        status: 'draft',
        tags: [],
      },
      build: runtimeManifest.build,
      entitlements: [],
      manifestVersion: 2,
      packageVersion: '1.0.0',
      runtime: runtimeManifest.runtime,
    });
    await serverDB.insert(moduleAppActions).values({
      actionKey: 'search',
      appId: app.id,
      inputSchema: { fields: [] },
      moduleMultiplier: 1,
      name: 'Search',
      outputSchema: {},
      runtimeConfig: { functionKey: 'search_jobs', timeoutMs: 10_000 },
      runtimeType: 'executable_action',
      versionId: version.id,
    });
    const [packageRow] = await serverDB
      .insert(moduleAppPackages)
      .values({
        appId: app.id,
        archive: {
          fileName: 'jobs-board.zip',
          mimeType: 'application/zip',
          sha256: 'b'.repeat(64),
          sizeBytes: 1024,
          storageKey: 'module-app-packages/jobs-board.zip',
        },
        fileManifest: [],
        manifestSnapshot,
        reviewStatus: 'approved',
        validationReport: [],
        versionId: version.id,
      })
      .returning();
    await serverDB.insert(moduleAppBuilds).values({
      artifactKey: `module-app-builds/build/${artifactSha256}.tgz`,
      artifactSha256,
      buildProfile: 'node22-static',
      packageId: packageRow.id,
      sourceSha256: 'b'.repeat(64),
      status: 'ready',
      versionId: version.id,
    });
    const [installation] = await serverDB
      .insert(moduleAppInstallations)
      .values({
        appId: app.id,
        scopeType: 'personal',
        status: 'installed',
        userId: USER_ID,
        versionId: version.id,
      })
      .returning();
    const [newerVersion] = await serverDB
      .insert(moduleAppVersions)
      .values({ appId: app.id, publishedAt: new Date(), version: '2.0.0' })
      .returning();
    await serverDB.insert(moduleAppPages).values({
      actionBindings: [],
      appId: app.id,
      dataSource: {},
      layoutSchema: {},
      pageKey: 'latest_page',
      pageType: 'overview',
      routePath: '/',
      sortOrder: 0,
      title: 'Latest page',
      versionId: newerVersion.id,
    });
    await serverDB
      .update(moduleApps)
      .set({ currentPublishedVersionId: newerVersion.id })
      .where(eq(moduleApps.id, app.id));
    const model = new ModuleAppModel(serverDB);

    await expect(
      model.getLaunchInstallationContext({ appId: app.id, userId: USER_ID }),
    ).resolves.toMatchObject({
      actions: [
        expect.objectContaining({
          id: 'search',
          runtimeConfig: { functionKey: 'search_jobs', timeoutMs: 10_000 },
          runtimeType: 'executable_action',
        }),
      ],
      artifactSha256,
      billing: expect.objectContaining({
        chargeMode: 'external_api',
        defaultMultiplier: 2,
      }),
      buildArtifactSha256: artifactSha256,
      buildStatus: 'ready',
      displayName: 'Jobs Board',
      installationId: installation.id,
      publisherId: null,
      runtimeManifest,
      pages: [expect.objectContaining({ key: 'installed_page' })],
      versionId: version.id,
    });
    await expect(
      model.getLaunchInstallationContext({ appId: app.id, userId: OTHER_USER_ID }),
    ).resolves.toBeNull();
    await expect(
      model.getLaunchInstallationContext({
        appId: app.id,
        userId: USER_ID,
        workspaceId: 'wrong-workspace',
      }),
    ).resolves.toBeNull();
    await expect(
      model.getRuntimeManifest({ appId: app.id, userId: USER_ID }),
    ).resolves.toMatchObject({
      pages: [expect.objectContaining({ key: 'installed_page' })],
      version: '1.0.0',
    });
  });
});
