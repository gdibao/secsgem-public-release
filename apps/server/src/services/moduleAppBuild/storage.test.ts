import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ModuleAppBuildStorageError } from './storage';
import {
  getModuleAppBuildArtifactKey,
  getModuleAppBuildStagingKey,
  ModuleAppBuildStorageService,
} from './storage';

const BUILD_ID = '00000000-0000-4000-8000-000000000001';
const CLAIM_TOKEN = 'claim-token-1';
const SOURCE_SHA256 = 'a'.repeat(64);
const build = {
  buildProfile: 'node22-static' as const,
  claimToken: CLAIM_TOKEN,
  id: BUILD_ID,
  sourceSha256: SOURCE_SHA256,
  sourceStorageKey: 'module-app-packages/source.zip',
};

const createStorage = () => ({
  createPreSignedUpload: vi.fn().mockResolvedValue({
    headers: { 'x-amz-acl': 'private' },
    url: 'https://storage.example.com/upload',
  }),
  createPreSignedUrlForPreview: vi.fn().mockResolvedValue('https://storage.example.com/source'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getFileByteArray: vi.fn(),
  getFileMetadata: vi.fn(),
  uploadBuffer: vi.fn().mockResolvedValue(undefined),
});

describe('ModuleAppBuildStorageService', () => {
  it('signs only the reviewed source and the claim-scoped staging key', async () => {
    const storage = createStorage();
    const service = new ModuleAppBuildStorageService({ storage: storage as never });

    await expect(service.prepareWorkerRequest(build)).resolves.toEqual({
      artifactKey: getModuleAppBuildStagingKey(BUILD_ID, CLAIM_TOKEN),
      buildId: BUILD_ID,
      buildProfile: 'node22-static',
      claimToken: CLAIM_TOKEN,
      sourceDownloadUrl: 'https://storage.example.com/source',
      sourceSha256: SOURCE_SHA256,
      uploadHeaders: { 'x-amz-acl': 'private' },
      uploadUrl: 'https://storage.example.com/upload',
    });
    expect(storage.createPreSignedUrlForPreview).toHaveBeenCalledWith(
      'module-app-packages/source.zip',
      900,
    );
    expect(storage.createPreSignedUpload).toHaveBeenCalledWith(
      getModuleAppBuildStagingKey(BUILD_ID, CLAIM_TOKEN),
    );
  });

  it('verifies bytes and promotes a staging artifact to a content-addressed key', async () => {
    const storage = createStorage();
    const bytes = new TextEncoder().encode('verified artifact');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    storage.getFileMetadata.mockResolvedValue({ contentLength: bytes.byteLength });
    storage.getFileByteArray.mockResolvedValue(bytes);
    const service = new ModuleAppBuildStorageService({ storage: storage as never });

    await expect(
      service.promoteVerifiedArtifact({
        artifactKey: getModuleAppBuildStagingKey(BUILD_ID, CLAIM_TOKEN),
        artifactSha256: sha256,
        build,
      }),
    ).resolves.toEqual({
      artifactKey: getModuleAppBuildArtifactKey(BUILD_ID, sha256),
      artifactSha256: sha256,
    });
    expect(storage.uploadBuffer).toHaveBeenCalledWith(
      getModuleAppBuildArtifactKey(BUILD_ID, sha256),
      expect.any(Buffer),
      'application/gzip',
      'private, max-age=31536000, immutable',
    );
    expect(storage.uploadBuffer).toHaveBeenCalledTimes(1);
    expect(storage.deleteFile).toHaveBeenCalledWith(
      getModuleAppBuildStagingKey(BUILD_ID, CLAIM_TOKEN),
    );
    expect(storage.getFileByteArray).toHaveBeenCalledWith(
      getModuleAppBuildArtifactKey(BUILD_ID, sha256),
    );
  });

  it('rejects promoted bytes that do not survive the destination re-read', async () => {
    const storage = createStorage();
    const bytes = new TextEncoder().encode('verified artifact');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    storage.getFileMetadata.mockResolvedValue({ contentLength: bytes.byteLength });
    storage.getFileByteArray
      .mockResolvedValueOnce(bytes)
      .mockResolvedValueOnce(bytes)
      .mockResolvedValueOnce(new TextEncoder().encode('tampered'));
    const service = new ModuleAppBuildStorageService({ storage: storage as never });

    await expect(
      service.promoteVerifiedArtifact({
        artifactKey: getModuleAppBuildStagingKey(BUILD_ID, CLAIM_TOKEN),
        artifactSha256: sha256,
        build,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ModuleAppBuildStorageError>>({
        code: 'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED',
      }),
    );
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('rejects a stale claim staging key before reading or deleting the active claim object', async () => {
    const storage = createStorage();
    const service = new ModuleAppBuildStorageService({ storage: storage as never });

    await expect(
      service.promoteVerifiedArtifact({
        artifactKey: getModuleAppBuildStagingKey(BUILD_ID, 'stale-claim-token'),
        artifactSha256: 'b'.repeat(64),
        build,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ModuleAppBuildStorageError>>({
        code: 'MODULE_APP_BUILD_ARTIFACT_KEY_MISMATCH',
      }),
    );
    expect(storage.getFileMetadata).not.toHaveBeenCalled();
    expect(storage.getFileByteArray).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('rejects an artifact outside the build staging key before reading storage', async () => {
    const storage = createStorage();
    const service = new ModuleAppBuildStorageService({ storage: storage as never });

    await expect(
      service.promoteVerifiedArtifact({
        artifactKey: 'module-app-builds/other.tgz',
        artifactSha256: 'b'.repeat(64),
        build,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ModuleAppBuildStorageError>>({
        code: 'MODULE_APP_BUILD_ARTIFACT_KEY_MISMATCH',
      }),
    );
    expect(storage.getFileMetadata).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('rejects a worker hash that does not match the uploaded artifact bytes', async () => {
    const storage = createStorage();
    const bytes = new TextEncoder().encode('tampered artifact');
    storage.getFileMetadata.mockResolvedValue({ contentLength: bytes.byteLength });
    storage.getFileByteArray.mockResolvedValue(bytes);
    const service = new ModuleAppBuildStorageService({ storage: storage as never });

    await expect(
      service.promoteVerifiedArtifact({
        artifactKey: getModuleAppBuildStagingKey(BUILD_ID, CLAIM_TOKEN),
        artifactSha256: 'b'.repeat(64),
        build,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ModuleAppBuildStorageError>>({
        code: 'MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH',
      }),
    );
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });
});
