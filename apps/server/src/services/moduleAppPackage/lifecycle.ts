import {
  MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE,
  MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES,
  MODULE_APP_PACKAGE_MAX_SCAN_ISSUES,
  type ModuleAppPackageScanStatus,
  type ModuleAppPackageValidationIssue,
} from '@lobechat/types';

import { ModuleAppModel } from '@/database/models/moduleApp';
import { ModuleAppPackageUploadModel } from '@/database/models/moduleAppPackageUpload';
import type { LobeChatDatabase } from '@/database/type';
import { FileS3 } from '@/server/modules/S3';

import { ModuleAppPackageArchiveError, parseModuleAppPackageArchive } from './archive';
import { isValidModuleAppPackageStorageKey } from './ingestion';

type PackageModel = Pick<
  ModuleAppModel,
  'getPackageSubmissionForLifecycle' | 'rejectPackageSubmissionForAdmin'
>;

type UploadModel = Pick<
  ModuleAppPackageUploadModel,
  | 'claimExpiredForCleanup'
  | 'createLegacySession'
  | 'getByPackageId'
  | 'markStorageReleased'
  | 'prepareRejectedForCleanup'
>;

type LifecycleStorage = Pick<FileS3, 'deleteFile' | 'getFileByteArray' | 'getFileMetadata'>;
type ParseArchive = typeof parseModuleAppPackageArchive;

type LifecycleOptions = {
  db?: LobeChatDatabase;
  packageModel?: PackageModel;
  parseArchive?: ParseArchive;
  storage?: LifecycleStorage;
  uploadModel?: UploadModel;
};

type ScanSummary = {
  cleanupQueued: boolean;
  issueCodes: string[];
  packageId: string;
  scanStatus: ModuleAppPackageScanStatus;
};

const STRUCTURAL_STORAGE_KEY_PATTERN =
  /^module-app-packages\/[0-9a-f]{32}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.zip$/i;

const isMissingObjectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  const values = ['code', 'name', 'statusCode']
    .map((key) => (key in error ? String((error as Record<string, unknown>)[key]) : ''))
    .filter(Boolean);
  return values.some((value) =>
    ['404', 'NotFound', 'NoSuchKey', 'ObjectNotFound'].includes(value),
  );
};

const boundedIssues = (issues: ModuleAppPackageValidationIssue[]) =>
  issues.slice(0, MODULE_APP_PACKAGE_MAX_SCAN_ISSUES);

const issuesFromArchiveError = (
  error: ModuleAppPackageArchiveError,
): ModuleAppPackageValidationIssue[] =>
  boundedIssues(
    error.issues.length > 0
      ? error.issues
      : [{ code: error.code, message: error.message, severity: 'error' }],
  );

const toSummary = (upload: {
  packageId: null | string;
  scanReport: ModuleAppPackageValidationIssue[];
  scanStatus: ModuleAppPackageScanStatus;
  status: string;
  storageReleasedAt: Date | null;
}): ScanSummary => ({
  cleanupQueued:
    upload.storageReleasedAt === null &&
    (upload.status === 'failed' || upload.status === 'rejected' || upload.status === 'cleaning'),
  issueCodes: [...new Set(upload.scanReport.map(({ code }) => code))].slice(
    0,
    MODULE_APP_PACKAGE_MAX_SCAN_ISSUES,
  ),
  packageId: upload.packageId!,
  scanStatus: upload.scanStatus,
});

export class ModuleAppPackageLifecycleError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ModuleAppPackageLifecycleError';
  }
}

export class ModuleAppPackageLifecycleService {
  private readonly packageModel: PackageModel;
  private readonly parseArchive: ParseArchive;
  private readonly storage: LifecycleStorage;
  private readonly uploadModel: UploadModel;

  constructor(options: LifecycleOptions) {
    if ((!options.packageModel || !options.uploadModel) && !options.db) {
      throw new Error('ModuleAppPackageLifecycleService requires a database or models.');
    }

    this.packageModel = options.packageModel ?? new ModuleAppModel(options.db!);
    this.parseArchive = options.parseArchive ?? parseModuleAppPackageArchive;
    this.storage = options.storage ?? new FileS3();
    this.uploadModel = options.uploadModel ?? new ModuleAppPackageUploadModel(options.db!);
  }

  private releaseObject = async (uploadId: string, storageKey: string) => {
    try {
      await this.storage.deleteFile(storageKey);
      await this.uploadModel.markStorageReleased({ status: 'rejected', uploadId });
      return true;
    } catch {
      return false;
    }
  };

  cleanupExpiredUploads = async (params: { limit?: number } = {}) => {
    const limit = Math.max(
      1,
      Math.min(
        params.limit ?? MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE,
        MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE,
      ),
    );
    const uploads = await this.uploadModel.claimExpiredForCleanup(limit);
    let expired = 0;
    let failed = 0;

    for (const upload of uploads) {
      const storageKeyIsValid = upload.userId
        ? isValidModuleAppPackageStorageKey(upload.storageKey, upload.userId)
        : STRUCTURAL_STORAGE_KEY_PATTERN.test(upload.storageKey);
      if (!storageKeyIsValid) {
        failed += 1;
        continue;
      }

      try {
        await this.storage.deleteFile(upload.storageKey);
      } catch (error) {
        if (!isMissingObjectError(error)) {
          failed += 1;
          continue;
        }
      }

      try {
        const released = await this.uploadModel.markStorageReleased({
          status: 'expired',
          uploadId: upload.id,
        });
        if (!released) {
          failed += 1;
          continue;
        }
        expired += 1;
      } catch {
        failed += 1;
      }
    }

    return { expired, failed };
  };

  rescanLegacyPackage = async (params: {
    packageId: string;
    reviewedByUserId: string;
  }): Promise<ScanSummary> => {
    const linked = await this.uploadModel.getByPackageId(params.packageId);
    if (linked) return toSummary(linked);

    const packageRow = await this.packageModel.getPackageSubmissionForLifecycle({
      packageId: params.packageId,
    });
    if (!packageRow) throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_NOT_FOUND');
    if (packageRow.reviewStatus !== 'pending_review') {
      throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_NOT_PENDING_REVIEW');
    }
    if (!packageRow.submittedByUserId) {
      throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_RESCAN_SUBMITTER_MISSING');
    }
    if (
      !isValidModuleAppPackageStorageKey(
        packageRow.archive.storageKey,
        packageRow.submittedByUserId,
      )
    ) {
      throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_RESCAN_OWNERSHIP_INVALID');
    }

    let metadata: Awaited<ReturnType<LifecycleStorage['getFileMetadata']>>;
    try {
      metadata = await this.storage.getFileMetadata(packageRow.archive.storageKey);
    } catch {
      throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_RESCAN_OBJECT_MISSING');
    }

    if (
      metadata.contentLength < 1 ||
      metadata.contentLength > MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES
    ) {
      throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_RESCAN_SIZE_INVALID');
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.storage.getFileByteArray(packageRow.archive.storageKey);
    } catch {
      throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_RESCAN_READ_FAILED');
    }

    try {
      const submission = await this.parseArchive({
        bytes,
        fileName: packageRow.archive.fileName,
        mimeType: packageRow.archive.mimeType,
        storageKey: packageRow.archive.storageKey,
      });

      if (
        submission.archive.sha256 !== packageRow.archive.sha256 ||
        submission.archive.sizeBytes !== packageRow.archive.sizeBytes ||
        submission.archive.sizeBytes !== metadata.contentLength
      ) {
        throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_RESCAN_ARCHIVE_MISMATCH');
      }

      const upload = await this.uploadModel.createLegacySession({
        actualSizeBytes: submission.archive.sizeBytes,
        fileName: submission.archive.fileName,
        mimeType: submission.archive.mimeType,
        packageId: params.packageId,
        scanReport: [],
        scanStatus: 'clean',
        sha256: submission.archive.sha256,
        status: 'submitted',
        storageKey: submission.archive.storageKey,
        userId: packageRow.submittedByUserId,
      });

      return toSummary(upload);
    } catch (error) {
      if (!(error instanceof ModuleAppPackageArchiveError)) throw error;

      const issues = issuesFromArchiveError(error);
      const upload = await this.uploadModel.createLegacySession({
        actualSizeBytes: metadata.contentLength,
        failureCode: error.code,
        fileName: packageRow.archive.fileName,
        mimeType: packageRow.archive.mimeType,
        packageId: params.packageId,
        scanReport: issues,
        scanStatus: 'blocked',
        sha256: packageRow.archive.sha256,
        status: 'rejected',
        storageKey: packageRow.archive.storageKey,
        userId: packageRow.submittedByUserId,
      });

      await this.packageModel.rejectPackageSubmissionForAdmin({
        packageId: params.packageId,
        reason: `Package security scan failed: ${error.code}`,
        reviewedByUserId: params.reviewedByUserId,
      });
      const released = await this.releaseObject(upload.id, upload.storageKey);

      return {
        ...toSummary(upload),
        cleanupQueued: !released,
      };
    }
  };

  releaseRejectedPackage = async (params: {
    packageId: string;
    reason?: string;
    reviewedByUserId: string;
  }) => {
    const packageRow = await this.packageModel.getPackageSubmissionForLifecycle({
      packageId: params.packageId,
    });
    if (!packageRow) throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_NOT_FOUND');
    if (packageRow.reviewStatus !== 'pending_review') {
      throw new ModuleAppPackageLifecycleError('MODULE_APP_PACKAGE_NOT_PENDING_REVIEW');
    }
    const storageKeyIsValid = packageRow.submittedByUserId
      ? isValidModuleAppPackageStorageKey(
          packageRow.archive.storageKey,
          packageRow.submittedByUserId,
        )
      : STRUCTURAL_STORAGE_KEY_PATTERN.test(packageRow.archive.storageKey);
    if (!storageKeyIsValid) {
      const rejectedPackage = await this.packageModel.rejectPackageSubmissionForAdmin(params);
      return { cleanupQueued: false, cleanupSkipped: true, package: rejectedPackage };
    }

    const linked = await this.uploadModel.getByPackageId(params.packageId);
    const upload = linked
      ? await this.uploadModel.prepareRejectedForCleanup({
          failureCode: 'module_app_package_admin_rejected',
          uploadId: linked.id,
        })
      : await this.uploadModel.createLegacySession({
          actualSizeBytes: packageRow.archive.sizeBytes,
          failureCode: 'module_app_package_admin_rejected',
          fileName: packageRow.archive.fileName,
          mimeType: packageRow.archive.mimeType,
          packageId: params.packageId,
          scanReport: [],
          scanStatus: 'pending',
          sha256: packageRow.archive.sha256,
          status: 'rejected',
          storageKey: packageRow.archive.storageKey,
          userId: packageRow.submittedByUserId,
        });

    const prepared = linked
      ? upload
      : await this.uploadModel.prepareRejectedForCleanup({
          failureCode: 'module_app_package_admin_rejected',
          uploadId: upload.id,
        });
    const rejectedPackage = await this.packageModel.rejectPackageSubmissionForAdmin(params);

    if (prepared.storageReleasedAt) {
      return { cleanupQueued: false, package: rejectedPackage };
    }

    const released = await this.releaseObject(prepared.id, prepared.storageKey);
    return { cleanupQueued: !released, package: rejectedPackage };
  };
}
