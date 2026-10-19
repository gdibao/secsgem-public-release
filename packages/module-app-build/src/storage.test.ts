import { createHash } from 'node:crypto';

import {
  type ModuleAppObjectStorage,
  publishVerifiedModuleAppArtifact,
} from '@lobechat/module-app-build';
import { describe, expect, it, vi } from 'vitest';

const BUILD_ID = '00000000-0000-4000-8000-000000000001';
const CLAIM_TOKEN = 'claim-token-1';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const createStorage = (tamperKey?: (key: string) => boolean) => {
  const objects = new Map<string, Uint8Array>();
  const storage: ModuleAppObjectStorage = {
    deleteObject: vi.fn(async ({ key }) => {
      objects.delete(key);
    }),
    getObject: vi.fn(async ({ key }) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`missing object: ${key}`);
      return bytes.slice();
    }),
    headObject: vi.fn(async ({ key }) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`missing object: ${key}`);
      return { contentLength: bytes.byteLength };
    }),
    putObject: vi.fn(async ({ body, key }) => {
      objects.set(key, tamperKey?.(key) ? new TextEncoder().encode('tampered') : body.slice());
    }),
  };

  return { objects, storage };
};

describe('publishVerifiedModuleAppArtifact', () => {
  it('verifies claim-scoped staging and promoted bytes before deleting staging', async () => {
    const artifactBytes = new TextEncoder().encode('verified artifact');
    const artifactSha256 = sha256(artifactBytes);
    const { objects, storage } = createStorage();

    await expect(
      publishVerifiedModuleAppArtifact({
        artifactBytes,
        artifactSha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        storage,
      }),
    ).resolves.toEqual({
      artifactKey: `module-app-builds/${BUILD_ID}/${artifactSha256}.tgz`,
      artifactSha256,
    });

    expect(storage.putObject).toHaveBeenNthCalledWith(1, {
      body: artifactBytes,
      key: `module-app-build-staging/${BUILD_ID}/${CLAIM_TOKEN}.tgz`,
    });
    expect(storage.putObject).toHaveBeenNthCalledWith(2, {
      body: artifactBytes,
      cacheControl: 'private, max-age=31536000, immutable',
      contentType: 'application/gzip',
      key: `module-app-builds/${BUILD_ID}/${artifactSha256}.tgz`,
    });
    expect(storage.getObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledWith({
      key: `module-app-build-staging/${BUILD_ID}/${CLAIM_TOKEN}.tgz`,
    });
    expect(objects.has(`module-app-build-staging/${BUILD_ID}/${CLAIM_TOKEN}.tgz`)).toBe(false);
  });

  it('rejects tampered staging bytes before promotion', async () => {
    const artifactBytes = new TextEncoder().encode('verified artifact');
    const artifactSha256 = sha256(artifactBytes);
    const { storage } = createStorage((key) => key.startsWith('module-app-build-staging/'));

    await expect(
      publishVerifiedModuleAppArtifact({
        artifactBytes,
        artifactSha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        storage,
      }),
    ).rejects.toMatchObject({ code: 'MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH' });

    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('rejects tampered promoted bytes and preserves staging for diagnosis', async () => {
    const artifactBytes = new TextEncoder().encode('verified artifact');
    const artifactSha256 = sha256(artifactBytes);
    const { storage } = createStorage((key) => key.startsWith('module-app-builds/'));

    await expect(
      publishVerifiedModuleAppArtifact({
        artifactBytes,
        artifactSha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        storage,
      }),
    ).rejects.toMatchObject({ code: 'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED' });

    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('normalizes an invalid promoted Content-Length to promotion failure', async () => {
    const artifactBytes = new TextEncoder().encode('verified artifact');
    const artifactSha256 = sha256(artifactBytes);
    const { objects, storage } = createStorage();
    vi.mocked(storage.headObject).mockImplementation(async ({ key }) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`missing object: ${key}`);
      return {
        contentLength: key.startsWith('module-app-builds/') ? 0 : bytes.byteLength,
      };
    });

    await expect(
      publishVerifiedModuleAppArtifact({
        artifactBytes,
        artifactSha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        storage,
      }),
    ).rejects.toMatchObject({ code: 'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED' });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('treats staging cleanup as best-effort after verified promotion', async () => {
    const artifactBytes = new TextEncoder().encode('verified artifact');
    const artifactSha256 = sha256(artifactBytes);
    const { storage } = createStorage();
    vi.mocked(storage.deleteObject).mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(
      publishVerifiedModuleAppArtifact({
        artifactBytes,
        artifactSha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        storage,
      }),
    ).resolves.toMatchObject({ artifactSha256 });
  });

  it.each([
    { buildId: '../other-build', claimToken: CLAIM_TOKEN },
    { buildId: BUILD_ID, claimToken: '../other-claim' },
  ])('rejects unsafe object-key identity segments before writing storage', async (identity) => {
    const artifactBytes = new TextEncoder().encode('verified artifact');
    const artifactSha256 = sha256(artifactBytes);
    const { storage } = createStorage();

    await expect(
      publishVerifiedModuleAppArtifact({
        artifactBytes,
        artifactSha256,
        ...identity,
        storage,
      }),
    ).rejects.toMatchObject({ code: 'MODULE_APP_BUILD_ARTIFACT_KEY_INVALID' });
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
