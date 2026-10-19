// @vitest-environment node
import { moduleAppPackageManifestSchema } from '@lobechat/types';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppBuilds,
  moduleAppInstallations,
  moduleAppInstallationVersionRefs,
  moduleAppPackages,
  moduleApps,
  moduleAppVersions,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppBuildModel } from '../moduleAppBuild';

const USER_ID = 'module-app-build-user';
const serverDB: LobeChatDatabase = await getTestDB();

const buildManifest = moduleAppPackageManifestSchema.parse({
  app: {
    actions: [],
    appType: 'hybrid_app',
    billing: {},
    category: 'business',
    description: 'Build test app.',
    displayName: 'Build Test',
    icon: 'Package',
    pages: [],
    slug: 'build-test',
    tags: [],
  },
  build: { frontend: { output: 'dist', profile: 'node22-static' } },
  entitlements: [],
  manifestVersion: 2,
  packageVersion: '1.0.0',
  runtime: { functions: [], permissions: [] },
});

const createPackageVersion = async () => {
  const [app] = await serverDB
    .insert(moduleApps)
    .values({
      appType: 'hybrid_app',
      category: 'business',
      description: 'Build test app.',
      displayName: 'Build Test',
      icon: 'Package',
      slug: `build-test-${crypto.randomUUID()}`,
    })
    .returning();
  const [version] = await serverDB
    .insert(moduleAppVersions)
    .values({ appId: app.id, version: '1.0.0' })
    .returning();
  const [packageRow] = await serverDB
    .insert(moduleAppPackages)
    .values({
      appId: app.id,
      archive: {
        fileName: 'build.zip',
        mimeType: 'application/zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 100,
        storageKey: 'module-app-packages/build.zip',
      },
      fileManifest: [{ path: 'module-app.yaml', sizeBytes: 100 }],
      manifestSnapshot: {
        ...buildManifest,
        app: { ...buildManifest.app, slug: app.slug },
      },
      reviewStatus: 'approved',
      submittedByUserId: USER_ID,
      validationReport: [],
      versionId: version.id,
    })
    .returning();

  return { appId: app.id, packageId: packageRow.id, versionId: version.id };
};

beforeEach(async () => {
  await serverDB.delete(moduleAppInstallations);
  await serverDB.delete(moduleAppBuilds);
  await serverDB.delete(moduleAppPackages);
  await serverDB.delete(moduleAppVersions);
  await serverDB.delete(moduleApps);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: USER_ID });
});

describe('ModuleAppBuildModel', () => {
  it('retains a build while an active installation references its version', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    const build = await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: 'b'.repeat(64),
      versionId: ids.versionId,
    });
    const [installation] = await serverDB
      .insert(moduleAppInstallations)
      .values({
        appId: ids.appId,
        scopeType: 'personal',
        userId: USER_ID,
        versionId: ids.versionId,
      })
      .returning();
    await expect(
      serverDB.query.moduleAppInstallationVersionRefs.findFirst({
        where: eq(moduleAppInstallationVersionRefs.installationId, installation.id),
      }),
    ).resolves.toMatchObject({
      buildId: build.id,
      packageId: ids.packageId,
      versionId: ids.versionId,
    });

    await expect(
      serverDB.delete(moduleAppBuilds).where(eq(moduleAppBuilds.id, build.id)),
    ).rejects.toThrow();

    await serverDB
      .update(moduleAppInstallations)
      .set({ status: 'uninstalled', uninstalledAt: new Date(), versionId: null })
      .where(eq(moduleAppInstallations.id, installation.id));
    await expect(
      serverDB.query.moduleAppInstallationVersionRefs.findFirst({
        where: eq(moduleAppInstallationVersionRefs.installationId, installation.id),
      }),
    ).resolves.toBeUndefined();
    await expect(
      serverDB.delete(moduleAppBuilds).where(eq(moduleAppBuilds.id, build.id)),
    ).resolves.toBeDefined();
  });

  it('cascades retained version references when deleting an app', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: 'b'.repeat(64),
      versionId: ids.versionId,
    });
    const [installation] = await serverDB
      .insert(moduleAppInstallations)
      .values({
        appId: ids.appId,
        scopeType: 'personal',
        userId: USER_ID,
        versionId: ids.versionId,
      })
      .returning();

    await expect(
      serverDB.delete(moduleApps).where(eq(moduleApps.id, ids.appId)),
    ).resolves.toBeDefined();
    await expect(
      serverDB.query.moduleAppInstallationVersionRefs.findFirst({
        where: eq(moduleAppInstallationVersionRefs.installationId, installation.id),
      }),
    ).resolves.toBeUndefined();
  });

  it('claims a queued build with a lease and completes it immutably', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    const build = await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: 'b'.repeat(64),
      versionId: ids.versionId,
    });

    const beforeClaim = Date.now();
    const claim = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'builder-1' });
    const afterClaim = Date.now();
    expect(claim).toMatchObject({
      attemptCount: 1,
      id: build.id,
      sourceStorageKey: 'module-app-packages/build.zip',
      status: 'building',
      workerId: 'builder-1',
    });
    expect(claim!.claimExpiresAt.getTime()).toBeGreaterThanOrEqual(beforeClaim + 55_000);
    expect(claim!.claimExpiresAt.getTime()).toBeLessThanOrEqual(afterClaim + 65_000);
    expect(claim?.claimToken).toEqual(expect.any(String));
    await expect(model.getById(build.id)).resolves.toMatchObject({ id: build.id });
    await expect(
      model.claimNext({ leaseDurationMs: 60_000, workerId: 'builder-2' }),
    ).resolves.toBeNull();

    const completed = await model.complete({
      artifactKey: 'module-app-builds/app/hash.tgz',
      artifactSha256: 'c'.repeat(64),
      buildId: build.id,
      claimToken: claim!.claimToken,
    });
    expect(completed).toMatchObject({
      artifactSha256: 'c'.repeat(64),
      claimExpiresAt: null,
      claimToken: null,
      status: 'ready',
      workerId: null,
    });
    await expect(
      model.complete({
        artifactKey: 'module-app-builds/app/other.tgz',
        artifactSha256: 'd'.repeat(64),
        buildId: build.id,
        claimToken: claim!.claimToken,
      }),
    ).rejects.toThrow('MODULE_APP_BUILD_IMMUTABLE');
  });

  it('does not return the same queued row to concurrent claimers', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: 'e'.repeat(64),
      versionId: ids.versionId,
    });

    const results = await Promise.all([
      model.claimNext({ leaseDurationMs: 60_000, workerId: 'builder-a' }),
      model.claimNext({ leaseDurationMs: 60_000, workerId: 'builder-b' }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('does not let an ahead worker clock reclaim an active database lease', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: '6'.repeat(64),
      versionId: ids.versionId,
    });
    const claim = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-a' });

    const aheadModel = Reflect.construct(ModuleAppBuildModel, [
      serverDB,
      { now: () => new Date(claim!.claimExpiresAt.getTime() + 90_000) },
    ]) as ModuleAppBuildModel;
    await expect(
      aheadModel.claimNext({
        leaseDurationMs: 60_000,
        workerId: 'worker-ahead',
      }),
    ).resolves.toBeNull();
  });

  it('does not let a behind worker clock renew a lease into the database past', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: '7'.repeat(64),
      versionId: ids.versionId,
    });
    const claim = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-a' });

    const behindModel = Reflect.construct(ModuleAppBuildModel, [
      serverDB,
      { now: () => new Date('2000-01-01T00:00:00.000Z') },
    ]) as ModuleAppBuildModel;
    await behindModel.renewLease({
      buildId: claim!.id,
      claimToken: claim!.claimToken,
      leaseDurationMs: 60_000,
    });

    await expect(
      new ModuleAppBuildModel(serverDB).claimNext({
        leaseDurationMs: 60_000,
        workerId: 'worker-b',
      }),
    ).resolves.toBeNull();
  });

  it('reclaims an expired lease with a fresh token and denies stale mutations', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    const build = await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: 'f'.repeat(64),
      versionId: ids.versionId,
    });

    const first = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-a' });
    expect(first).toMatchObject({ attemptCount: 1, status: 'building', workerId: 'worker-a' });

    await expect(
      model.renewLease({
        buildId: first!.id,
        claimToken: 'stale-token',
        leaseDurationMs: 60_000,
      }),
    ).rejects.toThrow('MODULE_APP_BUILD_LEASE_LOST');
    await expect(
      model.retry({
        buildId: first!.id,
        claimToken: 'stale-token',
        failureCode: 'MODULE_APP_BUILD_TEMPORARY_FAILURE',
        retryDelayMs: 30_000,
      }),
    ).rejects.toThrow('MODULE_APP_BUILD_LEASE_LOST');
    await expect(
      model.fail({
        buildId: first!.id,
        claimToken: 'stale-token',
        failureCode: 'MODULE_APP_BUILD_WORKER_FAILED',
      }),
    ).rejects.toThrow('MODULE_APP_BUILD_LEASE_LOST');

    await serverDB
      .update(moduleAppBuilds)
      .set({ claimExpiresAt: sql`NOW() - INTERVAL '1 millisecond'` })
      .where(eq(moduleAppBuilds.id, build.id));
    const reclaimed = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-b' });
    expect(reclaimed).toMatchObject({
      attemptCount: 2,
      id: build.id,
      status: 'building',
      workerId: 'worker-b',
    });
    expect(reclaimed!.claimToken).not.toBe(first!.claimToken);

    await expect(
      model.complete({
        artifactKey: `module-app-builds/${build.id}/${'c'.repeat(64)}.tgz`,
        artifactSha256: 'c'.repeat(64),
        buildId: build.id,
        claimToken: first!.claimToken,
      }),
    ).rejects.toThrow('MODULE_APP_BUILD_LEASE_LOST');

    const beforeRenewal = Date.now();
    const renewed = await model.renewLease({
      buildId: build.id,
      claimToken: reclaimed!.claimToken,
      leaseDurationMs: 120_000,
    });
    const afterRenewal = Date.now();
    expect(renewed.claimExpiresAt!.getTime()).toBeGreaterThanOrEqual(beforeRenewal + 115_000);
    expect(renewed.claimExpiresAt!.getTime()).toBeLessThanOrEqual(afterRenewal + 125_000);
  });

  it('orders due retries before later queued builds and clears the lease when retrying', async () => {
    const firstIds = await createPackageVersion();
    const secondIds = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    const firstBuild = await model.create({
      buildProfile: 'node22-static',
      packageId: firstIds.packageId,
      sourceSha256: '1'.repeat(64),
      versionId: firstIds.versionId,
    });
    const secondBuild = await model.create({
      buildProfile: 'node22-static',
      packageId: secondIds.packageId,
      sourceSha256: '2'.repeat(64),
      versionId: secondIds.versionId,
    });

    const firstClaim = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-a' });
    const retried = await model.retry({
      buildId: firstClaim!.id,
      claimToken: firstClaim!.claimToken,
      failureCode: 'MODULE_APP_BUILD_TEMPORARY_FAILURE',
      retryDelayMs: 60_000,
    });
    expect(retried).toMatchObject({
      claimExpiresAt: null,
      claimToken: null,
      claimedAt: null,
      failureCode: 'MODULE_APP_BUILD_TEMPORARY_FAILURE',
      status: 'queued',
      workerId: null,
    });

    const secondClaim = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-b' });
    expect(secondClaim?.id).toBe(secondBuild.id);

    await serverDB
      .update(moduleAppBuilds)
      .set({
        claimExpiresAt: sql`NOW() - INTERVAL '1 millisecond'`,
        nextAttemptAt: sql`NOW() - INTERVAL '2 seconds'`,
      })
      .where(eq(moduleAppBuilds.id, secondBuild.id));
    await serverDB
      .update(moduleAppBuilds)
      .set({ nextAttemptAt: sql`NOW() - INTERVAL '1 second'` })
      .where(eq(moduleAppBuilds.id, firstBuild.id));
    const earlierDueClaim = await model.claimNext({
      leaseDurationMs: 60_000,
      workerId: 'worker-c',
    });
    expect(earlierDueClaim).toMatchObject({ attemptCount: 2, id: secondBuild.id });
    const retryClaim = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-d' });
    expect(retryClaim).toMatchObject({ attemptCount: 2, id: firstBuild.id });
  });

  it('allows three retries and terminalizes an expired fourth attempt', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    const build = await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: '3'.repeat(64),
      versionId: ids.versionId,
    });

    let claim = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-1' });
    const retryDelays = [30_000, 120_000, 600_000];
    for (const [index, retryDelay] of retryDelays.entries()) {
      const attempt = index + 1;
      await expect(
        model.retry({
          buildId: build.id,
          claimToken: claim!.claimToken,
          failureCode: `MODULE_APP_BUILD_RETRY_${attempt}`,
          retryDelayMs: retryDelay,
        }),
      ).resolves.toMatchObject({ attemptCount: attempt, status: 'queued' });
      await serverDB
        .update(moduleAppBuilds)
        .set({ nextAttemptAt: sql`NOW() - INTERVAL '1 millisecond'` })
        .where(eq(moduleAppBuilds.id, build.id));
      claim = await model.claimNext({ leaseDurationMs: 60_000, workerId: `worker-${attempt + 1}` });
      expect(claim).toMatchObject({ attemptCount: attempt + 1, status: 'building' });
    }

    await serverDB
      .update(moduleAppBuilds)
      .set({ claimExpiresAt: sql`NOW() - INTERVAL '1 millisecond'` })
      .where(eq(moduleAppBuilds.id, build.id));
    await expect(model.failExpiredExhausted()).resolves.toHaveLength(1);
    await expect(model.getById(build.id)).resolves.toMatchObject({
      claimExpiresAt: null,
      claimToken: null,
      failureCode: 'MODULE_APP_BUILD_RETRY_EXHAUSTED',
      status: 'failed',
      workerId: null,
    });
    await expect(
      model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-5' }),
    ).resolves.toBeNull();
  });

  it('terminalizes an active fourth attempt instead of returning it to queued', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    const build = await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: '4'.repeat(64),
      versionId: ids.versionId,
    });

    let claim = await model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-1' });
    for (let attempt = 1; attempt < 4; attempt++) {
      await model.retry({
        buildId: build.id,
        claimToken: claim!.claimToken,
        failureCode: `MODULE_APP_BUILD_RETRY_${attempt}`,
        retryDelayMs: 1,
      });
      await serverDB
        .update(moduleAppBuilds)
        .set({ nextAttemptAt: sql`NOW() - INTERVAL '1 millisecond'` })
        .where(eq(moduleAppBuilds.id, build.id));
      claim = await model.claimNext({ leaseDurationMs: 60_000, workerId: `worker-${attempt + 1}` });
    }

    await expect(
      model.retry({
        buildId: build.id,
        claimToken: claim!.claimToken,
        failureCode: 'MODULE_APP_BUILD_TEMPORARY_FAILURE',
        retryDelayMs: 60_000,
      }),
    ).resolves.toMatchObject({
      attemptCount: 4,
      claimToken: null,
      failureCode: 'MODULE_APP_BUILD_RETRY_EXHAUSTED',
      status: 'failed',
      workerId: null,
    });
    await expect(
      model.claimNext({ leaseDurationMs: 60_000, workerId: 'worker-5' }),
    ).resolves.toBeNull();
  });

  it('reclaims a legacy building row with null claim token and expiry', async () => {
    const ids = await createPackageVersion();
    const model = new ModuleAppBuildModel(serverDB);
    const build = await model.create({
      buildProfile: 'node22-static',
      packageId: ids.packageId,
      sourceSha256: '5'.repeat(64),
      versionId: ids.versionId,
    });
    await serverDB
      .update(moduleAppBuilds)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        status: 'building',
        workerId: 'legacy-worker',
      })
      .where(eq(moduleAppBuilds.id, build.id));

    await expect(
      model.claimNext({ leaseDurationMs: 60_000, workerId: 'replacement-worker' }),
    ).resolves.toMatchObject({
      attemptCount: 1,
      id: build.id,
      status: 'building',
      workerId: 'replacement-worker',
    });
  });
});
