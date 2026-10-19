import { describe, expect, it, vi } from 'vitest';

import { ModuleAppBuildService } from './service';
import { ModuleAppBuildStorageError } from './storage';

describe('ModuleAppBuildService', () => {
  const createMocks = () => {
    const approval = {
      appId: 'app-1',
      build: { id: 'build-1', status: 'queued' },
      package: { id: 'package-1', reviewStatus: 'approved' },
      slug: 'example',
      versionId: 'version-1',
    };
    const appModel = { approvePackageSubmissionForAdmin: vi.fn().mockResolvedValue(approval) };
    const buildModel = {
      claimNext: vi.fn().mockResolvedValue({
        buildProfile: 'node22-static',
        claimExpiresAt: new Date('2026-07-11T01:01:00.000Z'),
        claimToken: 'claim-token-1',
        id: 'build-1',
        sourceSha256: 'a'.repeat(64),
        sourceStorageKey: 'module-app-packages/source.zip',
        status: 'building',
      }),
      complete: vi.fn().mockResolvedValue({ id: 'build-1', status: 'ready' }),
      fail: vi.fn().mockResolvedValue({ id: 'build-1', status: 'failed' }),
      getById: vi.fn().mockResolvedValue({
        buildProfile: 'node22-static',
        claimToken: 'claim-token-1',
        id: 'build-1',
        sourceSha256: 'a'.repeat(64),
        status: 'building',
      }),
    };
    const storage = {
      prepareWorkerRequest: vi.fn().mockResolvedValue({
        artifactKey: 'module-app-build-staging/build-1/claim-token-1.tgz',
        buildId: 'build-1',
        buildProfile: 'node22-static',
        claimToken: 'claim-token-1',
        sourceDownloadUrl: 'https://storage.example.com/source',
        sourceSha256: 'a'.repeat(64),
        uploadHeaders: {},
        uploadUrl: 'https://storage.example.com/upload',
      }),
      promoteVerifiedArtifact: vi.fn().mockResolvedValue({
        artifactKey: `module-app-builds/build-1/${'b'.repeat(64)}.tgz`,
        artifactSha256: 'b'.repeat(64),
      }),
    };

    const service = new ModuleAppBuildService({
      appModel: appModel as never,
      buildModel: buildModel as never,
      storage: storage as never,
    });

    return { appModel, approval, buildModel, service, storage };
  };

  it('delegates executable approval and prepares a worker request', async () => {
    const { appModel, approval, buildModel, service, storage } = createMocks();

    await expect(
      service.approvePackage({
        outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
        packageId: 'package-1',
        reviewedByUserId: 'admin-1',
      }),
    ).resolves.toEqual(approval);
    expect(appModel.approvePackageSubmissionForAdmin).toHaveBeenCalledWith({
      outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
      packageId: 'package-1',
      reviewedByUserId: 'admin-1',
    });
    await expect(
      service.claimBuild({ leaseDurationMs: 60_000, workerId: 'worker-1' }),
    ).resolves.toMatchObject({
      artifactKey: 'module-app-build-staging/build-1/claim-token-1.tgz',
      buildId: 'build-1',
      claimToken: 'claim-token-1',
      sourceDownloadUrl: 'https://storage.example.com/source',
    });
    expect(buildModel.claimNext).toHaveBeenCalledWith({
      leaseDurationMs: 60_000,
      workerId: 'worker-1',
    });
    expect(storage.prepareWorkerRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'build-1',
        sourceStorageKey: 'module-app-packages/source.zip',
      }),
    );
    expect(buildModel.fail).not.toHaveBeenCalled();
  });

  it('verifies and promotes a ready artifact before completing the build', async () => {
    const { buildModel, service, storage } = createMocks();

    await expect(
      service.recordBuildResult({
        artifactKey: 'module-app-build-staging/build-1/claim-token-1.tgz',
        artifactSha256: 'b'.repeat(64),
        buildId: 'build-1',
        claimToken: 'claim-token-1',
        status: 'ready',
      }),
    ).resolves.toMatchObject({ status: 'ready' });

    expect(storage.promoteVerifiedArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ build: expect.objectContaining({ id: 'build-1' }) }),
    );
    expect(buildModel.complete).toHaveBeenCalledWith({
      artifactKey: `module-app-builds/build-1/${'b'.repeat(64)}.tgz`,
      artifactSha256: 'b'.repeat(64),
      buildId: 'build-1',
      claimToken: 'claim-token-1',
    });
  });

  it('rejects a stale result before reading or deleting the active claim staging object', async () => {
    const { buildModel, service, storage } = createMocks();
    buildModel.getById.mockResolvedValueOnce({
      buildProfile: 'node22-static',
      claimToken: 'claim-token-2',
      id: 'build-1',
      sourceSha256: 'a'.repeat(64),
      status: 'building',
    });

    await expect(
      service.recordBuildResult({
        artifactKey: 'module-app-build-staging/build-1/claim-token-1.tgz',
        artifactSha256: 'b'.repeat(64),
        buildId: 'build-1',
        claimToken: 'claim-token-1',
        status: 'ready',
      }),
    ).rejects.toThrow('MODULE_APP_BUILD_LEASE_LOST');

    expect(storage.promoteVerifiedArtifact).not.toHaveBeenCalled();
    expect(buildModel.complete).not.toHaveBeenCalled();
    expect(buildModel.fail).not.toHaveBeenCalled();
  });

  it('fails a claimed build when storage signing cannot prepare the worker request', async () => {
    const { buildModel, service, storage } = createMocks();
    storage.prepareWorkerRequest.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      service.claimBuild({ leaseDurationMs: 60_000, workerId: 'worker-1' }),
    ).rejects.toThrow('MODULE_APP_BUILD_STORAGE_SIGNING_FAILED');
    expect(buildModel.fail).toHaveBeenCalledWith({
      buildId: 'build-1',
      claimToken: 'claim-token-1',
      failureCode: 'MODULE_APP_BUILD_STORAGE_SIGNING_FAILED',
    });
  });

  it('persists a stable failure code when artifact verification fails', async () => {
    const { buildModel, service, storage } = createMocks();
    storage.promoteVerifiedArtifact.mockRejectedValueOnce(
      new ModuleAppBuildStorageError('MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH'),
    );

    await expect(
      service.recordBuildResult({
        artifactKey: 'module-app-build-staging/build-1/claim-token-1.tgz',
        artifactSha256: 'b'.repeat(64),
        buildId: 'build-1',
        claimToken: 'claim-token-1',
        status: 'ready',
      }),
    ).rejects.toThrow('MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH');
    expect(buildModel.fail).toHaveBeenCalledWith({
      buildId: 'build-1',
      claimToken: 'claim-token-1',
      failureCode: 'MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH',
    });
    expect(buildModel.complete).not.toHaveBeenCalled();
  });

  it('passes the active token when a worker explicitly reports failure', async () => {
    const { buildModel, service } = createMocks();

    await expect(
      service.recordBuildResult({
        buildId: 'build-1',
        claimToken: 'claim-token-1',
        failureCode: 'MODULE_APP_BUILD_WORKER_FAILED',
        status: 'failed',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(buildModel.fail).toHaveBeenCalledWith({
      buildId: 'build-1',
      claimToken: 'claim-token-1',
      failureCode: 'MODULE_APP_BUILD_WORKER_FAILED',
    });
  });
});
