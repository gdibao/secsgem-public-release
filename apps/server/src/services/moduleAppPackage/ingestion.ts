import { createHash, randomUUID } from 'node:crypto';

import type {
  ModuleAppPackageSubmitInput,
  ModuleAppPackageUploadedSubmitInput,
  ModuleAppPackageUploadRequest,
  ModuleAppPackageUploadTarget,
} from '@lobechat/types';

import { ModuleAppPackageUploadModel } from '@/database/models/moduleAppPackageUpload';
import type { LobeChatDatabase } from '@/database/type';
import { FileS3 } from '@/server/modules/S3';

import {
  ModuleAppPackageArchiveError,
  parseModuleAppPackageArchive,
} from './archive';

export type ModuleAppPackageStorage = Pick<
  FileS3,
  'createPreSignedUpload' | 'deleteFile' | 'getFileByteArray' | 'getFileMetadata'
>;

type PackageUploadModel = Pick<
  ModuleAppPackageUploadModel,
  | 'claimSession'
  | 'completeSubmission'
  | 'createSession'
  | 'markFailed'
  | 'markRejected'
  | 'markStorageReleased'
  | 'recordActualSize'
>;

type ParseArchive = typeof parseModuleAppPackageArchive;

type IngestionOptions = {
  db?: LobeChatDatabase;
  model?: PackageUploadModel;
  parseArchive?: ParseArchive;
  randomId?: () => string;
  storage?: ModuleAppPackageStorage;
};

export class ModuleAppPackageIngestionError extends Error {
  constructor(
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(code);
    this.name = 'ModuleAppPackageIngestionError';
  }
}

export const getModuleAppPackageStoragePrefix = (userId: string) => {
  const userScope = createHash('sha256').update(userId).digest('hex').slice(0, 32);
  return `module-app-packages/${userScope}/`;
};

export const isValidModuleAppPackageStorageKey = (storageKey: string, userId: string) => {
  const prefix = getModuleAppPackageStoragePrefix(userId);
  if (!storageKey.startsWith(prefix)) return false;

  const objectName = storageKey.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.zip$/i.test(
    objectName,
  );
};

const resolvePackageMimeType = (contentType?: string) => {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase();
  if (
    normalized === 'application/zip' ||
    normalized === 'application/x-zip-compressed' ||
    normalized === 'application/octet-stream'
  ) {
    return normalized;
  }

  return 'application/zip' as const;
};

export class ModuleAppPackageIngestionService {
  private readonly model: PackageUploadModel;
  private readonly parseArchive: ParseArchive;
  private readonly randomId: () => string;
  private readonly storage: ModuleAppPackageStorage;

  constructor(options: IngestionOptions) {
    if (!options.model && !options.db) {
      throw new Error('ModuleAppPackageIngestionService requires a database or model.');
    }

    this.model = options.model ?? new ModuleAppPackageUploadModel(options.db!);
    this.parseArchive = options.parseArchive ?? parseModuleAppPackageArchive;
    this.randomId = options.randomId ?? randomUUID;
    this.storage = options.storage ?? new FileS3();
  }

  issueUpload = async (params: {
    input: ModuleAppPackageUploadRequest;
    userId: string;
  }): Promise<ModuleAppPackageUploadTarget> => {
    const session = await this.model.createSession({
      declaredSizeBytes: params.input.sizeBytes,
      fileName: params.input.fileName,
      mimeType: params.input.mimeType,
      storageKey: `${getModuleAppPackageStoragePrefix(params.userId)}${this.randomId()}.zip`,
      userId: params.userId,
    });

    try {
      const upload = await this.storage.createPreSignedUpload(session.storageKey);

      return {
        expiresAt: session.expiresAt,
        headers: upload.headers ?? {},
        storageKey: session.storageKey,
        uploadId: session.id,
        uploadUrl: upload.url,
      };
    } catch (error) {
      const failureCode = 'module_app_package_upload_signing_failed';
      await this.model.markFailed({ failureCode, uploadId: session.id }).catch(() => undefined);
      await this.model
        .markStorageReleased({ status: 'failed', uploadId: session.id })
        .catch(() => undefined);
      throw new ModuleAppPackageIngestionError(failureCode, error);
    }
  };

  private releaseObject = async (
    uploadId: string,
    storageKey: string,
    status: 'failed' | 'rejected',
  ) => {
    try {
      await this.storage.deleteFile(storageKey);
      await this.model.markStorageReleased({ status, uploadId });
      return true;
    } catch {
      return false;
    }
  };

  submitUpload = async (params: {
    input: ModuleAppPackageUploadedSubmitInput;
    userId: string;
  }) => {
    if (!isValidModuleAppPackageStorageKey(params.input.storageKey, params.userId)) {
      throw new ModuleAppPackageIngestionError('module_app_package_storage_key_forbidden');
    }

    await this.model.claimSession({ ...params.input, userId: params.userId });

    let actualSizeBytes: number | undefined;
    try {
      const metadata = await this.storage.getFileMetadata(params.input.storageKey);
      actualSizeBytes = metadata.contentLength;
      await this.model.recordActualSize({ actualSizeBytes, uploadId: params.input.uploadId });

      const bytes = await this.storage.getFileByteArray(params.input.storageKey);
      const submission: ModuleAppPackageSubmitInput = await this.parseArchive({
        bytes,
        fileName: params.input.fileName,
        mimeType: resolvePackageMimeType(metadata.contentType),
        storageKey: params.input.storageKey,
      });

      return await this.model.completeSubmission({
        submission,
        uploadId: params.input.uploadId,
        userId: params.userId,
        validationReport: [],
      });
    } catch (error) {
      if (error instanceof ModuleAppPackageArchiveError) {
        await this.model
          .markRejected({
            actualSizeBytes,
            failureCode: error.code,
            scanReport: error.issues,
            uploadId: params.input.uploadId,
          })
          .catch(() => undefined);
        await this.releaseObject(params.input.uploadId, params.input.storageKey, 'rejected');
        throw error;
      }

      if (error instanceof Error && error.message === 'MODULE_APP_PACKAGE_ACTUAL_SIZE_EXCEEDED') {
        const code = 'module_app_package_actual_size_exceeded';
        await this.model
          .markRejected({ actualSizeBytes, failureCode: code, uploadId: params.input.uploadId })
          .catch(() => undefined);
        await this.releaseObject(params.input.uploadId, params.input.storageKey, 'rejected');
        throw new ModuleAppPackageIngestionError(code);
      }

      const failureCode = 'module_app_package_ingestion_failed';
      await this.model
        .markFailed({ actualSizeBytes, failureCode, uploadId: params.input.uploadId })
        .catch(() => undefined);
      await this.releaseObject(params.input.uploadId, params.input.storageKey, 'failed');
      throw new ModuleAppPackageIngestionError(failureCode, error);
    }
  };
}
