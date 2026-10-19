import { recordModuleAppArtifactCleanup } from '@lobechat/observability-otel/modules/module-app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModuleAppArtifactCleanupService } from './index';

vi.mock('@lobechat/observability-otel/modules/module-app', () => ({
  recordModuleAppArtifactCleanup: vi.fn(),
}));

const artifactKey = (name: string) =>
  `module-apps/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/${name}`;

const createJob = (id: string, storageKey: string, attemptCount = 1) =>
  ({ attemptCount, id, storageKey }) as any;

describe('ModuleAppArtifactCleanupService', () => {
  const model = {
    claimPending: vi.fn(),
    markFailure: vi.fn().mockResolvedValue(true),
    markReleased: vi.fn().mockResolvedValue(true),
  };
  const storage = { deleteFile: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    model.markFailure.mockResolvedValue(true);
    model.markReleased.mockResolvedValue(true);
  });

  it('releases deleted and already-missing objects and retries transient failures', async () => {
    model.claimPending.mockResolvedValue([
      createJob('released', artifactKey('released.txt')),
      createJob('missing', artifactKey('missing.txt')),
      createJob('retry', artifactKey('retry.txt')),
    ]);
    storage.deleteFile.mockImplementation(async (key: string) => {
      if (key.endsWith('missing.txt')) throw { name: 'NoSuchKey' };
      if (key.endsWith('retry.txt')) throw { code: 'ServiceUnavailable' };
    });

    const result = await new ModuleAppArtifactCleanupService({ model, storage }).cleanupPending(20);

    expect(result).toEqual({ claimed: 3, failed: 0, released: 2, retrying: 1 });
    expect(model.markReleased).toHaveBeenCalledTimes(2);
    expect(model.markFailure).toHaveBeenCalledWith({
      error: 'MODULE_APP_ARTIFACT_DELETE_ServiceUnavailable',
      id: 'retry',
      retryable: true,
    });
    expect(recordModuleAppArtifactCleanup).toHaveBeenCalledWith({
      failed: 0,
      released: 2,
      retrying: 1,
    });
  });

  it('permanently rejects keys outside the generated module artifact namespace', async () => {
    model.claimPending.mockResolvedValue([
      createJob('unsafe', 'module-app-packages/private/archive.zip'),
    ]);

    await expect(
      new ModuleAppArtifactCleanupService({ model, storage }).cleanupPending(),
    ).resolves.toEqual({ claimed: 1, failed: 1, released: 0, retrying: 0 });
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(model.markFailure).toHaveBeenCalledWith({
      error: 'MODULE_APP_ARTIFACT_STORAGE_KEY_INVALID',
      id: 'unsafe',
      retryable: false,
    });
  });
});
