// @vitest-environment node
import { moduleAppPackageManifestSchema } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppActions,
  moduleAppBuilds,
  moduleAppEntitlements,
  moduleAppPackages,
  moduleAppPackageUploads,
  moduleAppPages,
  moduleAppPublishers,
  moduleApps,
  moduleAppVersions,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppModel } from '../moduleApp';
import { ModuleAppBuildModel } from '../moduleAppBuild';

const DEVELOPER_ID = 'module-app-approval-developer';
const OTHER_DEVELOPER_ID = 'module-app-approval-other-developer';
const ADMIN_ID = 'module-app-approval-admin';
const serverDB: LobeChatDatabase = await getTestDB();

const executableManifest = moduleAppPackageManifestSchema.parse({
  app: {
    actions: [],
    appType: 'hybrid_app' as const,
    billing: {},
    category: 'business',
    description: 'Executable approval test.',
    displayName: 'Executable Approval',
    icon: 'Package',
    pages: [],
    slug: 'executable-approval',
    source: 'developer' as const,
    status: 'published' as const,
    tags: [],
  },
  build: { frontend: { output: 'dist', profile: 'node22-static' as const } },
  entitlements: [],
  manifestVersion: 2 as const,
  packageVersion: '2.1.0',
  runtime: { functions: [], outboundHosts: ['api.example.com'], permissions: [] },
});

beforeEach(async () => {
  await serverDB.delete(moduleAppBuilds);
  await serverDB.delete(moduleAppPackageUploads);
  await serverDB.delete(moduleAppPackages);
  await serverDB.delete(moduleAppEntitlements);
  await serverDB.delete(moduleAppActions);
  await serverDB.delete(moduleAppPages);
  await serverDB.delete(moduleAppVersions);
  await serverDB.delete(moduleApps);
  await serverDB.delete(moduleAppPublishers);
  await serverDB.delete(users);
  await serverDB
    .insert(users)
    .values([{ id: DEVELOPER_ID }, { id: OTHER_DEVELOPER_ID }, { id: ADMIN_ID }]);
});

describe('ModuleAppModel executable package approval', () => {
  it('binds a new developer app to the verified publisher that submitted it', async () => {
    const [publisher] = await serverDB
      .insert(moduleAppPublishers)
      .values({
        displayName: 'Approval Developer',
        status: 'verified',
        userId: DEVELOPER_ID,
      })
      .returning();
    const [packageRow] = await serverDB
      .insert(moduleAppPackages)
      .values({
        archive: {
          fileName: 'new-app.zip',
          mimeType: 'application/zip',
          sha256: 'c'.repeat(64),
          sizeBytes: 1024,
          storageKey: 'module-app-packages/new-app.zip',
        },
        fileManifest: [{ path: 'module-app.yaml', sizeBytes: 512 }],
        manifestSnapshot: {
          ...executableManifest,
          app: { ...executableManifest.app, slug: 'new-developer-app' },
        },
        reviewStatus: 'pending_review',
        submittedByUserId: DEVELOPER_ID,
        validationReport: [],
      })
      .returning();
    await serverDB.insert(moduleAppPackageUploads).values({
      actualSizeBytes: 1024,
      completedAt: new Date(),
      declaredSizeBytes: 1024,
      expiresAt: new Date(Date.now() + 60_000),
      fileName: 'new-app.zip',
      mimeType: 'application/zip',
      packageId: packageRow.id,
      scanStatus: 'clean',
      status: 'submitted',
      storageKey: 'module-app-packages/new-app.zip',
      userId: DEVELOPER_ID,
    });

    const result = await new ModuleAppModel(serverDB).approvePackageSubmissionForAdmin({
      outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
      packageId: packageRow.id,
      reviewedByUserId: ADMIN_ID,
    });

    expect(await serverDB.query.moduleApps.findFirst()).toMatchObject({
      id: result.appId,
      publisherId: publisher.id,
      slug: 'new-developer-app',
    });
    expect(result.package).toMatchObject({ publisherId: publisher.id });
  });

  it('rejects a package that attempts to replace another publisher app by slug', async () => {
    const [owner, attacker] = await serverDB
      .insert(moduleAppPublishers)
      .values([
        { displayName: 'Owner', status: 'verified', userId: DEVELOPER_ID },
        { displayName: 'Attacker', status: 'verified', userId: OTHER_DEVELOPER_ID },
      ])
      .returning();
    const [ownedApp] = await serverDB
      .insert(moduleApps)
      .values({
        appType: 'hybrid_app',
        category: 'business',
        description: 'Original description.',
        displayName: 'Owned App',
        icon: 'Package',
        publisherId: owner.id,
        slug: 'protected-developer-app',
        status: 'draft',
      })
      .returning();
    const [packageRow] = await serverDB
      .insert(moduleAppPackages)
      .values({
        archive: {
          fileName: 'takeover.zip',
          mimeType: 'application/zip',
          sha256: 'd'.repeat(64),
          sizeBytes: 1024,
          storageKey: 'module-app-packages/takeover.zip',
        },
        fileManifest: [{ path: 'module-app.yaml', sizeBytes: 512 }],
        manifestSnapshot: {
          ...executableManifest,
          app: {
            ...executableManifest.app,
            description: 'Replaced description.',
            slug: 'protected-developer-app',
          },
        },
        reviewStatus: 'pending_review',
        submittedByUserId: OTHER_DEVELOPER_ID,
        validationReport: [],
      })
      .returning();
    await serverDB.insert(moduleAppPackageUploads).values({
      actualSizeBytes: 1024,
      completedAt: new Date(),
      declaredSizeBytes: 1024,
      expiresAt: new Date(Date.now() + 60_000),
      fileName: 'takeover.zip',
      mimeType: 'application/zip',
      packageId: packageRow.id,
      scanStatus: 'clean',
      status: 'submitted',
      storageKey: 'module-app-packages/takeover.zip',
      userId: OTHER_DEVELOPER_ID,
    });

    await expect(
      new ModuleAppModel(serverDB).approvePackageSubmissionForAdmin({
        outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
        packageId: packageRow.id,
        reviewedByUserId: ADMIN_ID,
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_APP_OWNERSHIP_MISMATCH');
    expect(await serverDB.query.moduleApps.findFirst()).toMatchObject({
      description: 'Original description.',
      id: ownedApp.id,
      publisherId: owner.id,
    });
    expect(attacker.id).not.toBe(owner.id);
  });

  it('queues a build and keeps a reviewed executable app unpublished', async () => {
    const [publisher] = await serverDB
      .insert(moduleAppPublishers)
      .values({
        displayName: 'Approval Developer',
        status: 'verified',
        userId: DEVELOPER_ID,
      })
      .returning();
    const [ownedApp] = await serverDB
      .insert(moduleApps)
      .values({
        appType: 'hybrid_app',
        category: 'business',
        description: 'Executable approval test.',
        displayName: 'Executable Approval',
        icon: 'Package',
        publisherId: publisher.id,
        slug: 'executable-approval',
        status: 'draft',
      })
      .returning();
    const [packageRow] = await serverDB
      .insert(moduleAppPackages)
      .values({
        archive: {
          fileName: 'executable.zip',
          mimeType: 'application/zip',
          sha256: 'a'.repeat(64),
          sizeBytes: 1024,
          storageKey: 'module-app-packages/executable.zip',
        },
        fileManifest: [{ path: 'module-app.yaml', sizeBytes: 512 }],
        manifestSnapshot: executableManifest,
        reviewStatus: 'pending_review',
        submittedByUserId: DEVELOPER_ID,
        validationReport: [],
      })
      .returning();
    await serverDB.insert(moduleAppPackageUploads).values({
      actualSizeBytes: 1024,
      completedAt: new Date(),
      declaredSizeBytes: 1024,
      expiresAt: new Date(Date.now() + 60_000),
      fileName: 'executable.zip',
      mimeType: 'application/zip',
      packageId: packageRow.id,
      scanStatus: 'clean',
      status: 'submitted',
      storageKey: 'module-app-packages/executable.zip',
      userId: DEVELOPER_ID,
    });

    const result = await new ModuleAppModel(serverDB).approvePackageSubmissionForAdmin({
      outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
      packageId: packageRow.id,
      reviewedByUserId: ADMIN_ID,
    });

    expect(result.build).toMatchObject({ status: 'queued', sourceSha256: 'a'.repeat(64) });
    expect(result.appId).toBe(ownedApp.id);
    expect(await serverDB.query.moduleApps.findFirst()).toMatchObject({
      publisherId: publisher.id,
      status: 'draft',
    });
    expect(result.package).toMatchObject({ publisherId: publisher.id });
    expect(await serverDB.query.moduleAppVersions.findFirst()).toMatchObject({
      runtimeManifest: expect.objectContaining({
        manifestVersion: 2,
        outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
      }),
      version: '2.1.0',
    });

    const model = new ModuleAppModel(serverDB);
    await expect(model.setStatus({ appId: result.appId, status: 'published' })).rejects.toThrow(
      'MODULE_APP_BUILD_NOT_READY',
    );

    const buildModel = new ModuleAppBuildModel(serverDB);
    const claimed = await buildModel.claimNext({ leaseDurationMs: 60_000, workerId: 'builder-1' });
    await buildModel.complete({
      artifactKey: `module-app-builds/${claimed!.id}/${'b'.repeat(64)}.tgz`,
      artifactSha256: 'b'.repeat(64),
      buildId: claimed!.id,
      claimToken: claimed!.claimToken,
    });

    await expect(model.setStatus({ appId: result.appId, status: 'published' })).resolves.toEqual({
      ok: true,
    });
    expect(await serverDB.query.moduleApps.findFirst()).toMatchObject({ status: 'published' });
  });
});
