import { mkdir, mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupStaleModuleAppStaging } from './cleanup';

const BUILD_ID = '11111111-1111-4111-8111-111111111111';
const ACTIVE_TOKEN = '22222222-2222-4222-8222-222222222222';
const INACTIVE_TOKEN = '33333333-3333-4333-8333-333333333333';
const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'module-worker-cleanup-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('cleanupStaleModuleAppStaging', () => {
  it('removes only stale inactive UUID-UUID staging directories', async () => {
    const artifactRoot = await createTemporaryDirectory();
    const stagingRoot = path.join(artifactRoot, '.staging');
    const activeName = `${BUILD_ID}-${ACTIVE_TOKEN}`;
    const inactiveName = `${BUILD_ID}-${INACTIVE_TOKEN}`;
    const freshName = `44444444-4444-4444-8444-444444444444-55555555-5555-4555-8555-555555555555`;
    const unknownName = 'not-a-claim';
    const finalHash = 'a'.repeat(64);
    await Promise.all([
      mkdir(path.join(stagingRoot, activeName), { recursive: true }),
      mkdir(path.join(stagingRoot, inactiveName), { recursive: true }),
      mkdir(path.join(stagingRoot, freshName), { recursive: true }),
      mkdir(path.join(stagingRoot, unknownName), { recursive: true }),
      mkdir(path.join(artifactRoot, finalHash), { recursive: true }),
    ]);
    const staleAt = new Date('2026-07-12T22:00:00.000Z');
    await Promise.all([
      utimes(path.join(stagingRoot, activeName), staleAt, staleAt),
      utimes(path.join(stagingRoot, inactiveName), staleAt, staleAt),
      utimes(path.join(stagingRoot, unknownName), staleAt, staleAt),
    ]);
    const isClaimActive = vi.fn(async ({ claimToken }: { claimToken: string }) => claimToken === ACTIVE_TOKEN);

    await expect(
      cleanupStaleModuleAppStaging({
        artifactRoot,
        buildModel: { isClaimActive },
        now: () => new Date('2026-07-13T00:00:00.000Z'),
        staleStagingMs: 3_600_000,
      }),
    ).resolves.toEqual({ failed: 0, removed: 1 });

    expect(isClaimActive).toHaveBeenCalledTimes(2);
    expect(isClaimActive).toHaveBeenCalledWith({ buildId: BUILD_ID, claimToken: ACTIVE_TOKEN });
    expect(isClaimActive).toHaveBeenCalledWith({ buildId: BUILD_ID, claimToken: INACTIVE_TOKEN });
    expect(await readdir(stagingRoot)).toEqual(expect.arrayContaining([activeName, freshName, unknownName]));
    await expect(stat(path.join(stagingRoot, inactiveName))).rejects.toThrow();
    await expect(stat(path.join(artifactRoot, finalHash))).resolves.toBeDefined();
  });

  it('counts a removal failure and continues cleaning later entries', async () => {
    const artifactRoot = await createTemporaryDirectory();
    const stagingRoot = path.join(artifactRoot, '.staging');
    const first = `${BUILD_ID}-${ACTIVE_TOKEN}`;
    const second = `${BUILD_ID}-${INACTIVE_TOKEN}`;
    await Promise.all([
      mkdir(path.join(stagingRoot, first), { recursive: true }),
      mkdir(path.join(stagingRoot, second), { recursive: true }),
    ]);
    const staleAt = new Date('2026-07-12T22:00:00.000Z');
    await Promise.all([
      utimes(path.join(stagingRoot, first), staleAt, staleAt),
      utimes(path.join(stagingRoot, second), staleAt, staleAt),
    ]);
    const remove = vi.fn(async (directory: string) => {
      if (directory.endsWith(first)) throw new Error('disk failure');
      await rm(directory, { force: true, recursive: true });
    });

    await expect(
      cleanupStaleModuleAppStaging({
        artifactRoot,
        buildModel: { isClaimActive: vi.fn(async () => false) },
        now: () => new Date('2026-07-13T00:00:00.000Z'),
        remove,
        staleStagingMs: 3_600_000,
      }),
    ).resolves.toEqual({ failed: 1, removed: 1 });
  });

  it('keeps staging that is exactly one stale interval old', async () => {
    const artifactRoot = await createTemporaryDirectory();
    const stagingRoot = path.join(artifactRoot, '.staging');
    const name = `${BUILD_ID}-${ACTIVE_TOKEN}`;
    const directory = path.join(stagingRoot, name);
    await mkdir(directory, { recursive: true });
    const boundary = new Date('2026-07-12T23:00:00.000Z');
    await utimes(directory, boundary, boundary);
    const isClaimActive = vi.fn(async () => false);

    await expect(
      cleanupStaleModuleAppStaging({
        artifactRoot,
        buildModel: { isClaimActive },
        now: () => new Date('2026-07-13T00:00:00.000Z'),
        staleStagingMs: 3_600_000,
      }),
    ).resolves.toEqual({ failed: 0, removed: 0 });
    expect(isClaimActive).not.toHaveBeenCalled();
    await expect(stat(directory)).resolves.toBeDefined();
  });
});
