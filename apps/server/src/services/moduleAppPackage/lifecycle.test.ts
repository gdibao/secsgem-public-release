import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModuleAppPackageArchiveError } from './archive';
import { ModuleAppPackageLifecycleService } from './lifecycle';

const PACKAGE_ID = '00000000-0000-4000-8000-000000000021';
const UPLOAD_ID = '00000000-0000-4000-8000-000000000022';
const USER_ID = 'user-1';
const STORAGE_KEY =
  'module-app-packages/c6c289e49e9c05b2145860387b73bcb1/00000000-0000-4000-8000-000000000023.zip';

const packageSubmission = {
  archive: {
    fileName: 'legacy-package.zip',
    mimeType: 'application/zip' as const,
    sha256: 'a'.repeat(64),
    sizeBytes: 64,
    storageKey: STORAGE_KEY,
  },
  fileManifest: [{ path: 'manifest.json', sha256: 'b'.repeat(64), sizeBytes: 32 }],
  manifest: {
    app: {
      actions: [],
      appType: 'standard_app' as const,
      billing: {},
      category: 'business',
      description: 'Legacy package.',
      displayName: 'Legacy Package',
      icon: 'Package',
      pages: [],
      slug: 'legacy-package',
      source: 'developer' as const,
      status: 'draft' as const,
      tags: [],
    },
    entitlements: [],
    manifestVersion: 1 as const,
    packageVersion: '1.0.0',
    runtime: { kind: 'manifest_only' as const, permissions: [] },
  },
};

const packageRow = {
  archive: packageSubmission.archive,
  id: PACKAGE_ID,
  reviewStatus: 'pending_review',
  submittedByUserId: USER_ID,
};

const createMocks = () => {
  const packageModel = {
    getPackageSubmissionForLifecycle: vi.fn().mockResolvedValue(packageRow),
    rejectPackageSubmissionForAdmin: vi.fn().mockResolvedValue({
      id: PACKAGE_ID,
      reviewStatus: 'rejected',
    }),
  };
  const uploadModel = {
    claimExpiredForCleanup: vi.fn().mockResolvedValue([]),
    createLegacySession: vi.fn().mockImplementation(async (input) => ({
      ...input,
      id: UPLOAD_ID,
      storageReleasedAt: null,
    })),
    getByPackageId: vi.fn().mockResolvedValue(null),
    markStorageReleased: vi.fn().mockResolvedValue({ id: UPLOAD_ID }),
    prepareRejectedForCleanup: vi.fn().mockImplementation(async (input) => ({
      ...input,
      id: UPLOAD_ID,
      scanReport: [],
      scanStatus: 'clean',
      storageKey: STORAGE_KEY,
      storageReleasedAt: null,
    })),
  };
  const storage = {
    deleteFile: vi.fn().mockResolvedValue(undefined),
    getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array(64)),
    getFileMetadata: vi.fn().mockResolvedValue({
      contentLength: 64,
      contentType: 'application/zip',
    }),
  };
  const parseArchive = vi.fn().mockResolvedValue(packageSubmission);

  return { packageModel, parseArchive, storage, uploadModel };
};

const createService = (mocks: ReturnType<typeof createMocks>) =>
  new ModuleAppPackageLifecycleService({
    packageModel: mocks.packageModel as any,
    parseArchive: mocks.parseArchive,
    storage: mocks.storage,
    uploadModel: mocks.uploadModel as any,
  });

describe('ModuleAppPackageLifecycleService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rescans a legacy package and links a clean terminal upload session', async () => {
    const mocks = createMocks();

    await expect(
      createService(mocks).rescanLegacyPackage({
        packageId: PACKAGE_ID,
        reviewedByUserId: 'admin-1',
      }),
    ).resolves.toEqual({
      cleanupQueued: false,
      issueCodes: [],
      packageId: PACKAGE_ID,
      scanStatus: 'clean',
    });

    expect(mocks.storage.getFileMetadata).toHaveBeenCalledWith(STORAGE_KEY);
    expect(mocks.storage.getFileByteArray).toHaveBeenCalledWith(STORAGE_KEY);
    expect(mocks.uploadModel.createLegacySession).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: PACKAGE_ID,
        scanStatus: 'clean',
        status: 'submitted',
        userId: USER_ID,
      }),
    );
    expect(mocks.packageModel.rejectPackageSubmissionForAdmin).not.toHaveBeenCalled();
  });

  it('rejects blocked legacy content before releasing its object', async () => {
    const mocks = createMocks();
    const issues = [
      {
        code: 'module_app_package_forbidden_extension',
        message: 'Executable payload.',
        path: 'install.ps1',
        severity: 'error' as const,
      },
    ];
    mocks.parseArchive.mockRejectedValueOnce(
      new ModuleAppPackageArchiveError(issues[0].code, issues[0].message, issues),
    );

    await expect(
      createService(mocks).rescanLegacyPackage({
        packageId: PACKAGE_ID,
        reviewedByUserId: 'admin-1',
      }),
    ).resolves.toEqual({
      cleanupQueued: false,
      issueCodes: ['module_app_package_forbidden_extension'],
      packageId: PACKAGE_ID,
      scanStatus: 'blocked',
    });

    expect(mocks.uploadModel.createLegacySession).toHaveBeenCalledWith(
      expect.objectContaining({ scanReport: issues, scanStatus: 'blocked', status: 'rejected' }),
    );
    expect(mocks.packageModel.rejectPackageSubmissionForAdmin).toHaveBeenCalledWith({
      packageId: PACKAGE_ID,
      reason: 'Package security scan failed: module_app_package_forbidden_extension',
      reviewedByUserId: 'admin-1',
    });
    expect(
      mocks.packageModel.rejectPackageSubmissionForAdmin.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.storage.deleteFile.mock.invocationCallOrder[0]);
    expect(mocks.uploadModel.markStorageReleased).toHaveBeenCalledWith({
      status: 'rejected',
      uploadId: UPLOAD_ID,
    });
  });

  it('returns stable remediation errors for a missing submitter or object', async () => {
    const missingSubmitter = createMocks();
    missingSubmitter.packageModel.getPackageSubmissionForLifecycle.mockResolvedValueOnce({
      ...packageRow,
      submittedByUserId: null,
    });

    await expect(
      createService(missingSubmitter).rescanLegacyPackage({
        packageId: PACKAGE_ID,
        reviewedByUserId: 'admin-1',
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_RESCAN_SUBMITTER_MISSING');
    expect(missingSubmitter.storage.getFileMetadata).not.toHaveBeenCalled();

    const missingObject = createMocks();
    missingObject.storage.getFileMetadata.mockRejectedValueOnce(new Error('NoSuchKey provider detail'));

    await expect(
      createService(missingObject).rescanLegacyPackage({
        packageId: PACKAGE_ID,
        reviewedByUserId: 'admin-1',
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_RESCAN_OBJECT_MISSING');
  });

  it('returns an existing linked scan idempotently without reading storage', async () => {
    const mocks = createMocks();
    mocks.uploadModel.getByPackageId.mockResolvedValueOnce({
      id: UPLOAD_ID,
      packageId: PACKAGE_ID,
      scanReport: [{ code: 'warning_code', message: 'Warning', severity: 'warning' }],
      scanStatus: 'clean',
      status: 'submitted',
      storageKey: STORAGE_KEY,
      storageReleasedAt: null,
    });

    const result = await createService(mocks).rescanLegacyPackage({
      packageId: PACKAGE_ID,
      reviewedByUserId: 'admin-1',
    });

    expect(result).toEqual({
      cleanupQueued: false,
      issueCodes: ['warning_code'],
      packageId: PACKAGE_ID,
      scanStatus: 'clean',
    });
    expect(JSON.stringify(result)).not.toContain(STORAGE_KEY);
    expect(JSON.stringify(result)).not.toContain('sha256');
    expect(mocks.storage.getFileMetadata).not.toHaveBeenCalled();
    expect(mocks.uploadModel.createLegacySession).not.toHaveBeenCalled();
  });

  it('refuses to link a clean object that no longer matches the stored archive hash', async () => {
    const mocks = createMocks();
    mocks.parseArchive.mockResolvedValueOnce({
      ...packageSubmission,
      archive: { ...packageSubmission.archive, sha256: 'c'.repeat(64) },
    });

    await expect(
      createService(mocks).rescanLegacyPackage({
        packageId: PACKAGE_ID,
        reviewedByUserId: 'admin-1',
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_RESCAN_ARCHIVE_MISMATCH');

    expect(mocks.uploadModel.createLegacySession).not.toHaveBeenCalled();
    expect(mocks.packageModel.rejectPackageSubmissionForAdmin).not.toHaveBeenCalled();
    expect(mocks.storage.deleteFile).not.toHaveBeenCalled();
  });

  it('rejects first and then releases the linked package object', async () => {
    const mocks = createMocks();
    mocks.uploadModel.getByPackageId.mockResolvedValueOnce({
      id: UPLOAD_ID,
      packageId: PACKAGE_ID,
      scanReport: [],
      scanStatus: 'clean',
      status: 'submitted',
      storageKey: STORAGE_KEY,
      storageReleasedAt: null,
    });

    await expect(
      createService(mocks).releaseRejectedPackage({
        packageId: PACKAGE_ID,
        reason: 'Rejected by reviewer',
        reviewedByUserId: 'admin-1',
      }),
    ).resolves.toEqual({
      cleanupQueued: false,
      package: { id: PACKAGE_ID, reviewStatus: 'rejected' },
    });

    expect(mocks.uploadModel.prepareRejectedForCleanup).toHaveBeenCalledWith({
      failureCode: 'module_app_package_admin_rejected',
      uploadId: UPLOAD_ID,
    });
    expect(
      mocks.packageModel.rejectPackageSubmissionForAdmin.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.storage.deleteFile.mock.invocationCallOrder[0]);
    expect(mocks.uploadModel.markStorageReleased).toHaveBeenCalledWith({
      status: 'rejected',
      uploadId: UPLOAD_ID,
    });
  });

  it('does not mutate upload state when the package is no longer pending review', async () => {
    const mocks = createMocks();
    mocks.packageModel.getPackageSubmissionForLifecycle.mockResolvedValueOnce({
      ...packageRow,
      reviewStatus: 'approved',
    });

    await expect(
      createService(mocks).releaseRejectedPackage({
        packageId: PACKAGE_ID,
        reviewedByUserId: 'admin-1',
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_NOT_PENDING_REVIEW');

    expect(mocks.uploadModel.prepareRejectedForCleanup).not.toHaveBeenCalled();
    expect(mocks.uploadModel.createLegacySession).not.toHaveBeenCalled();
    expect(mocks.storage.deleteFile).not.toHaveBeenCalled();
  });

  it('rejects an unsafe legacy storage key without attempting object deletion', async () => {
    const mocks = createMocks();
    mocks.packageModel.getPackageSubmissionForLifecycle.mockResolvedValueOnce({
      ...packageRow,
      archive: {
        ...packageRow.archive,
        storageKey: 'legacy-client-supplied-key.zip',
      },
    });

    await expect(
      createService(mocks).releaseRejectedPackage({
        packageId: PACKAGE_ID,
        reason: 'Legacy package cannot be safely cleaned',
        reviewedByUserId: 'admin-1',
      }),
    ).resolves.toEqual({
      cleanupQueued: false,
      cleanupSkipped: true,
      package: { id: PACKAGE_ID, reviewStatus: 'rejected' },
    });

    expect(mocks.packageModel.rejectPackageSubmissionForAdmin).toHaveBeenCalled();
    expect(mocks.uploadModel.createLegacySession).not.toHaveBeenCalled();
    expect(mocks.storage.deleteFile).not.toHaveBeenCalled();
  });

  it('keeps a rejected package reserved when object deletion fails', async () => {
    const mocks = createMocks();
    mocks.uploadModel.getByPackageId.mockResolvedValueOnce({
      id: UPLOAD_ID,
      packageId: PACKAGE_ID,
      scanReport: [],
      scanStatus: 'clean',
      status: 'submitted',
      storageKey: STORAGE_KEY,
      storageReleasedAt: null,
    });
    mocks.storage.deleteFile.mockRejectedValueOnce(new Error('temporary OSS failure'));

    await expect(
      createService(mocks).releaseRejectedPackage({
        packageId: PACKAGE_ID,
        reviewedByUserId: 'admin-1',
      }),
    ).resolves.toEqual({
      cleanupQueued: true,
      package: { id: PACKAGE_ID, reviewStatus: 'rejected' },
    });

    expect(mocks.uploadModel.markStorageReleased).not.toHaveBeenCalled();
  });

  it('cleans a bounded claimed batch and retries transient deletion failures', async () => {
    const mocks = createMocks();
    const keys = [23, 24, 25].map(
      (suffix) =>
        `module-app-packages/c6c289e49e9c05b2145860387b73bcb1/00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}.zip`,
    );
    mocks.uploadModel.claimExpiredForCleanup.mockResolvedValueOnce(
      keys.map((storageKey, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 30).padStart(12, '0')}`,
        storageKey,
        userId: USER_ID,
      })),
    );
    mocks.storage.deleteFile.mockImplementation(async (storageKey) => {
      if (storageKey === keys[1]) {
        throw Object.assign(new Error('Object is already gone'), { code: 'NoSuchKey' });
      }
      if (storageKey === keys[2]) throw new Error('temporary storage failure');
    });

    await expect(createService(mocks).cleanupExpiredUploads({ limit: 1000 })).resolves.toEqual({
      expired: 2,
      failed: 1,
    });

    expect(mocks.uploadModel.claimExpiredForCleanup).toHaveBeenCalledWith(100);
    expect(mocks.uploadModel.markStorageReleased).toHaveBeenCalledTimes(2);
    expect(mocks.uploadModel.markStorageReleased).toHaveBeenNthCalledWith(1, {
      status: 'expired',
      uploadId: '00000000-0000-4000-8000-000000000030',
    });
    expect(mocks.uploadModel.markStorageReleased).toHaveBeenNthCalledWith(2, {
      status: 'expired',
      uploadId: '00000000-0000-4000-8000-000000000031',
    });
  });
});
