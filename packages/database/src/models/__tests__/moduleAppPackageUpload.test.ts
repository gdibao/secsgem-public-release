// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { moduleAppPackages, moduleAppPackageUploads, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppPackageUploadModel } from '../moduleAppPackageUpload';

const USER_ID = 'module-app-upload-user';
const OTHER_USER_ID = 'module-app-upload-other';
const NOW = new Date('2026-07-11T00:00:00.000Z');

const serverDB: LobeChatDatabase = await getTestDB();

const sessionInput = (suffix: string, declaredSizeBytes = 64) => ({
  declaredSizeBytes,
  fileName: `package-${suffix}.zip`,
  mimeType: 'application/zip',
  storageKey: `module-app-packages/user-scope/${suffix}.zip`,
  userId: USER_ID,
});

const packageSubmission = (storageKey: string) => ({
  archive: {
    fileName: 'package-complete.zip',
    mimeType: 'application/zip' as const,
    sha256: 'a'.repeat(64),
    sizeBytes: 64,
    storageKey,
  },
  fileManifest: [{ path: 'manifest.json', sha256: 'b'.repeat(64), sizeBytes: 32 }],
  manifest: {
    app: {
      actions: [],
      appType: 'standard_app' as const,
      billing: {
        chargeMode: 'free' as const,
        defaultMultiplier: 1,
        externalApiCostCredits: 0,
        failureFixedFeePolicy: 'do_not_charge' as const,
        fixedServiceFeeCredits: 0,
      },
      category: 'business',
      description: 'Package upload test app.',
      displayName: 'Package Upload Test',
      icon: 'Package',
      pages: [],
      slug: 'package-upload-test',
      source: 'developer' as const,
      status: 'draft' as const,
      tags: [],
    },
    entitlements: [],
    manifestVersion: 1 as const,
    packageVersion: '1.0.0',
    runtime: { kind: 'manifest_only' as const, permissions: [] },
  },
});

beforeEach(async () => {
  await serverDB.delete(moduleAppPackageUploads);
  await serverDB.delete(moduleAppPackages);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: USER_ID }, { id: OTHER_USER_ID }]);
});

describe('ModuleAppPackageUploadModel', () => {
  it('serializes concurrent creation and never exceeds the open-session limit', async () => {
    const model = new ModuleAppPackageUploadModel(serverDB, { now: () => NOW });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) => model.createSession(sessionInput(`open-${index}`))),
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(3);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(2);
    await expect(
      serverDB.query.moduleAppPackageUploads.findMany({
        where: eq(moduleAppPackageUploads.status, 'issued'),
      }),
    ).resolves.toHaveLength(3);
  });

  it('enforces rolling issuance and retained-byte quotas', async () => {
    const dailyModel = new ModuleAppPackageUploadModel(serverDB, {
      limits: { maxDailyUploads: 1, maxOpenUploads: 3 },
      now: () => NOW,
    });
    const first = await dailyModel.createSession(sessionInput('daily-1'));
    await dailyModel.markStorageReleased({ status: 'failed', uploadId: first.id });

    await expect(dailyModel.createSession(sessionInput('daily-2'))).rejects.toThrow(
      'MODULE_APP_PACKAGE_DAILY_UPLOAD_LIMIT',
    );

    await serverDB.delete(moduleAppPackageUploads);
    const storageModel = new ModuleAppPackageUploadModel(serverDB, {
      limits: { maxRetainedBytes: 100 },
      now: () => NOW,
    });
    const reserved = await storageModel.createSession(sessionInput('storage-1', 80));

    await expect(storageModel.createSession(sessionInput('storage-2', 30))).rejects.toThrow(
      'MODULE_APP_PACKAGE_STORAGE_QUOTA_EXCEEDED',
    );

    await storageModel.markStorageReleased({ status: 'failed', uploadId: reserved.id });
    await expect(storageModel.createSession(sessionInput('storage-3', 80))).resolves.toMatchObject({
      status: 'issued',
    });
  });

  it('claims only the owning non-expired issued session once', async () => {
    const model = new ModuleAppPackageUploadModel(serverDB, { now: () => NOW });
    const session = await model.createSession(sessionInput('claim'));

    await expect(
      model.claimSession({
        fileName: session.fileName,
        storageKey: session.storageKey,
        uploadId: session.id,
        userId: OTHER_USER_ID,
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_UPLOAD_FORBIDDEN');

    await expect(
      model.claimSession({
        fileName: session.fileName,
        storageKey: session.storageKey,
        uploadId: session.id,
        userId: USER_ID,
      }),
    ).resolves.toMatchObject({ status: 'processing' });

    await expect(
      model.claimSession({
        fileName: session.fileName,
        storageKey: session.storageKey,
        uploadId: session.id,
        userId: USER_ID,
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_UPLOAD_CONFLICT');
  });

  it('rejects an expired session and an actual object larger than its reservation', async () => {
    let now = NOW;
    const model = new ModuleAppPackageUploadModel(serverDB, {
      limits: { uploadTtlMs: 1000 },
      now: () => now,
    });
    const expired = await model.createSession(sessionInput('expired'));
    now = new Date(NOW.getTime() + 1001);

    await expect(
      model.claimSession({
        fileName: expired.fileName,
        storageKey: expired.storageKey,
        uploadId: expired.id,
        userId: USER_ID,
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_UPLOAD_EXPIRED');

    now = NOW;
    const sized = await model.createSession(sessionInput('size', 64));
    await model.claimSession({
      fileName: sized.fileName,
      storageKey: sized.storageKey,
      uploadId: sized.id,
      userId: USER_ID,
    });

    await expect(model.recordActualSize({ actualSizeBytes: 65, uploadId: sized.id })).rejects.toThrow(
      'MODULE_APP_PACKAGE_ACTUAL_SIZE_EXCEEDED',
    );
  });

  it('creates a package and marks the clean session submitted atomically', async () => {
    const model = new ModuleAppPackageUploadModel(serverDB, { now: () => NOW });
    const session = await model.createSession({
      ...sessionInput('complete'),
      fileName: 'package-complete.zip',
    });
    await model.claimSession({
      fileName: session.fileName,
      storageKey: session.storageKey,
      uploadId: session.id,
      userId: USER_ID,
    });
    await model.recordActualSize({ actualSizeBytes: 64, uploadId: session.id });

    const created = await model.completeSubmission({
      submission: packageSubmission(session.storageKey),
      uploadId: session.id,
      userId: USER_ID,
      validationReport: [],
    });

    expect(created).toMatchObject({ reviewStatus: 'pending_review' });
    await expect(
      serverDB.query.moduleAppPackageUploads.findFirst({
        where: eq(moduleAppPackageUploads.id, session.id),
      }),
    ).resolves.toMatchObject({
      actualSizeBytes: 64,
      packageId: created.id,
      scanStatus: 'clean',
      status: 'submitted',
    });
  });

  it('does not persist a submission whose parsed archive does not match the claimed session', async () => {
    const model = new ModuleAppPackageUploadModel(serverDB, { now: () => NOW });
    const session = await model.createSession({
      ...sessionInput('mismatch'),
      fileName: 'package-complete.zip',
    });
    await model.claimSession({
      fileName: session.fileName,
      storageKey: session.storageKey,
      uploadId: session.id,
      userId: USER_ID,
    });
    await model.recordActualSize({ actualSizeBytes: 64, uploadId: session.id });

    await expect(
      model.completeSubmission({
        submission: packageSubmission('module-app-packages/user-scope/different.zip'),
        uploadId: session.id,
        userId: USER_ID,
        validationReport: [],
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_UPLOAD_CONFLICT');

    await expect(serverDB.select().from(moduleAppPackages)).resolves.toHaveLength(0);
  });

  it('creates an idempotent legacy session and prepares it for rejection cleanup', async () => {
    const submission = packageSubmission(
      'module-app-packages/user-scope/00000000-0000-4000-8000-000000000030.zip',
    );
    const [packageRow] = await serverDB
      .insert(moduleAppPackages)
      .values({
        archive: submission.archive,
        fileManifest: submission.fileManifest,
        manifestSnapshot: submission.manifest,
        reviewStatus: 'pending_review',
        submittedByUserId: USER_ID,
        validationReport: [],
      })
      .returning();
    const model = new ModuleAppPackageUploadModel(serverDB, { now: () => NOW });
    const input = {
      actualSizeBytes: submission.archive.sizeBytes,
      fileName: submission.archive.fileName,
      mimeType: submission.archive.mimeType,
      packageId: packageRow.id,
      scanReport: [],
      scanStatus: 'clean' as const,
      sha256: submission.archive.sha256,
      status: 'submitted' as const,
      storageKey: submission.archive.storageKey,
      userId: USER_ID,
    };

    const created = await model.createLegacySession(input);
    const repeated = await model.createLegacySession(input);

    expect(repeated.id).toBe(created.id);
    await expect(
      model.prepareRejectedForCleanup({
        failureCode: 'module_app_package_admin_rejected',
        uploadId: created.id,
      }),
    ).resolves.toMatchObject({
      failureCode: 'module_app_package_admin_rejected',
      scanStatus: 'clean',
      status: 'rejected',
    });
  });

  it('claims at most 100 expired rows and leaves future rows untouched', async () => {
    const expiredAt = new Date(NOW.getTime() - 60_000);
    const futureAt = new Date(NOW.getTime() + 60_000);
    await serverDB.insert(moduleAppPackageUploads).values([
      ...Array.from({ length: 105 }, (_, index) => ({
        declaredSizeBytes: 1,
        expiresAt: expiredAt,
        failureCode: 'test_failure',
        fileName: `expired-${index}.zip`,
        mimeType: 'application/zip',
        scanReport: [],
        scanStatus: 'error' as const,
        status: 'failed' as const,
        storageKey: `module-app-packages/test/expired-${index}.zip`,
      })),
      {
        declaredSizeBytes: 1,
        expiresAt: futureAt,
        failureCode: 'test_failure',
        fileName: 'future.zip',
        mimeType: 'application/zip',
        scanReport: [],
        scanStatus: 'error' as const,
        status: 'failed' as const,
        storageKey: 'module-app-packages/test/future.zip',
      },
    ]);
    const model = new ModuleAppPackageUploadModel(serverDB, { now: () => NOW });

    const claimed = await model.claimExpiredForCleanup(1000);

    expect(claimed).toHaveLength(100);
    expect(claimed.every(({ status }) => status === 'cleaning')).toBe(true);
    expect(claimed.some(({ fileName }) => fileName === 'future.zip')).toBe(false);
  });

  it('does not return the same row to concurrent cleanup claimers', async () => {
    const expiredAt = new Date(NOW.getTime() - 60_000);
    await serverDB.insert(moduleAppPackageUploads).values(
      Array.from({ length: 2 }, (_, index) => ({
        declaredSizeBytes: 1,
        expiresAt: expiredAt,
        failureCode: 'test_failure',
        fileName: `concurrent-${index}.zip`,
        mimeType: 'application/zip',
        scanReport: [],
        scanStatus: 'error' as const,
        status: 'failed' as const,
        storageKey: `module-app-packages/test/concurrent-${index}.zip`,
      })),
    );
    const first = new ModuleAppPackageUploadModel(serverDB, { now: () => NOW });
    const second = new ModuleAppPackageUploadModel(serverDB, { now: () => NOW });

    const claims = await Promise.all([
      first.claimExpiredForCleanup(1),
      second.claimExpiredForCleanup(1),
    ]);
    const ids = claims.flat().map(({ id }) => id);

    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toHaveLength(2);
  });
});
