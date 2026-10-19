import {
  ModuleAppArtifactStorageError,
  type ModuleAppObjectStorage,
  publishVerifiedModuleAppArtifact,
} from '@lobechat/module-app-build';
import type { ModuleAppBuildProfile } from '@lobechat/types';

import { FileS3 } from '@/server/modules/S3';

import type { ModuleAppBuildWorkerRequest } from './contracts';

const MODULE_APP_BUILD_URL_EXPIRES_IN_SECONDS = 15 * 60;
const MODULE_APP_BUILD_MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;

export type ModuleAppBuildStorage = Pick<
  FileS3,
  | 'createPreSignedUpload'
  | 'createPreSignedUrlForPreview'
  | 'deleteFile'
  | 'getFileByteArray'
  | 'getFileMetadata'
  | 'uploadBuffer'
>;

export type ClaimedModuleAppBuild = {
  buildProfile: ModuleAppBuildProfile;
  claimToken: string;
  id: string;
  sourceSha256: string;
  sourceStorageKey: string;
};

type StoredModuleAppBuild = Omit<ClaimedModuleAppBuild, 'sourceStorageKey'>;

export class ModuleAppBuildStorageError extends Error {
  constructor(
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(code);
    this.name = 'ModuleAppBuildStorageError';
  }
}

export const getModuleAppBuildStagingKey = (buildId: string, claimToken: string) =>
  `module-app-build-staging/${buildId}/${claimToken}.tgz`;

export const getModuleAppBuildArtifactKey = (buildId: string, artifactSha256: string) =>
  `module-app-builds/${buildId}/${artifactSha256}.tgz`;

export class ModuleAppBuildStorageService {
  private readonly storage: ModuleAppBuildStorage;

  constructor(options: { storage?: ModuleAppBuildStorage } = {}) {
    this.storage = options.storage ?? new FileS3();
  }

  prepareWorkerRequest = async (
    build: ClaimedModuleAppBuild,
  ): Promise<ModuleAppBuildWorkerRequest> => {
    const artifactKey = getModuleAppBuildStagingKey(build.id, build.claimToken);
    const [sourceDownloadUrl, upload] = await Promise.all([
      this.storage.createPreSignedUrlForPreview(
        build.sourceStorageKey,
        MODULE_APP_BUILD_URL_EXPIRES_IN_SECONDS,
      ),
      this.storage.createPreSignedUpload(artifactKey),
    ]);

    return {
      artifactKey,
      buildId: build.id,
      buildProfile: build.buildProfile,
      claimToken: build.claimToken,
      sourceDownloadUrl,
      sourceSha256: build.sourceSha256,
      uploadHeaders: upload.headers ?? {},
      uploadUrl: upload.url,
    };
  };

  promoteVerifiedArtifact = async (input: {
    artifactKey: string;
    artifactSha256: string;
    build: StoredModuleAppBuild;
  }) => {
    const stagingKey = getModuleAppBuildStagingKey(input.build.id, input.build.claimToken);
    if (input.artifactKey !== stagingKey) {
      throw new ModuleAppBuildStorageError('MODULE_APP_BUILD_ARTIFACT_KEY_MISMATCH');
    }
    if (!/^[a-f0-9]{64}$/.test(input.artifactSha256)) {
      throw new ModuleAppBuildStorageError('MODULE_APP_BUILD_ARTIFACT_HASH_INVALID');
    }

    const metadata = await this.storage.getFileMetadata(stagingKey).catch((error) => {
      throw new ModuleAppBuildStorageError('MODULE_APP_BUILD_ARTIFACT_NOT_FOUND', error);
    });
    if (
      metadata.contentLength <= 0 ||
      metadata.contentLength > MODULE_APP_BUILD_MAX_ARTIFACT_BYTES
    ) {
      throw new ModuleAppBuildStorageError('MODULE_APP_BUILD_ARTIFACT_SIZE_INVALID');
    }

    const bytes = await this.storage.getFileByteArray(stagingKey).catch((error) => {
      throw new ModuleAppBuildStorageError('MODULE_APP_BUILD_ARTIFACT_READ_FAILED', error);
    });
    if (bytes.byteLength !== metadata.contentLength) {
      throw new ModuleAppBuildStorageError('MODULE_APP_BUILD_ARTIFACT_SIZE_MISMATCH');
    }

    const storage: ModuleAppObjectStorage = {
      deleteObject: async ({ key }) => {
        await this.storage.deleteFile(key);
      },
      getObject: ({ key }) => this.storage.getFileByteArray(key),
      headObject: ({ key }) => this.storage.getFileMetadata(key),
      putObject: async ({ body, cacheControl, contentType, key }) => {
        if (key === stagingKey) return;
        await this.storage.uploadBuffer(key, Buffer.from(body), contentType, cacheControl);
      },
    };

    try {
      return await publishVerifiedModuleAppArtifact({
        artifactBytes: bytes,
        artifactSha256: input.artifactSha256,
        buildId: input.build.id,
        claimToken: input.build.claimToken,
        storage,
      });
    } catch (error) {
      if (error instanceof ModuleAppArtifactStorageError) {
        throw new ModuleAppBuildStorageError(error.code, error);
      }
      throw error;
    }
  };
}
