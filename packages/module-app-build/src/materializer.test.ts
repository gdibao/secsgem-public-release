import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  buildDeterministicModuleAppArtifact,
  materializeModuleAppArtifact,
} from '@lobechat/module-app-build';
import { type ModuleAppPackageManifest, moduleAppPackageManifestV2Schema } from '@lobechat/types';
import { type Headers, type Pack, pack } from 'tar-stream';
import { afterEach, describe, expect, it } from 'vitest';

import {
  materializeModuleAppArtifactWithDependencies,
  type ModuleAppArtifactMaterializerDependencies,
} from './materializer';

type ManifestV2 = Extract<ModuleAppPackageManifest, { manifestVersion: 2 }>;

const BUILD_ID = '00000000-0000-4000-8000-000000000001';
const CLAIM_TOKEN = 'claim-token-1';
const roots: string[] = [];
const encoder = new TextEncoder();

const manifest = moduleAppPackageManifestV2Schema.parse({
  app: {
    actions: [],
    appType: 'hybrid_app',
    billing: {},
    category: 'business',
    description: 'A materialized executable package.',
    displayName: 'Materialized Package',
    icon: 'Package',
    pages: [],
    slug: 'materialized-package',
    tags: [],
  },
  build: { frontend: { output: 'dist', profile: 'node22-static' } },
  entitlements: [],
  manifestVersion: 2,
  packageVersion: '1.0.0',
  runtime: {
    functions: [{ entry: 'server/index.js', key: 'main', runtime: 'node22' }],
    permissions: [],
  },
}) as ManifestV2;

const files = {
  'dist/index.html': encoder.encode('<main>Materialized</main>'),
  'server/index.js': encoder.encode('export default () => ({ ok: true });'),
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const createRoot = async () => {
  const root = path.join(os.tmpdir(), `module-app-materializer-${crypto.randomUUID()}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
};

const addTarEntry = (archive: Pack, header: Headers, bytes?: Uint8Array) =>
  new Promise<void>((resolve, reject) => {
    archive.entry(header, Buffer.from(bytes ?? new Uint8Array()), (error) => {
      if (error) return reject(error);
      resolve();
    });
  });

const createTgz = async (entries: Array<Headers & { bytes?: Uint8Array }>) => {
  const archive = pack();
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const tarBytes = await new Promise<Buffer>((resolve, reject) => {
    archive.once('error', reject);
    archive.once('end', () => resolve(Buffer.concat(chunks)));
    void (async () => {
      try {
        for (const { bytes, ...header } of entries) {
          await addTarEntry(
            archive,
            header.type === ('socket' as Headers['type']) ? { ...header, type: 'file' } : header,
            bytes,
          );
        }
        archive.finalize();
      } catch (error) {
        archive.destroy(error instanceof Error ? error : new Error('fixture failed'));
      }
    })();
  });
  if (entries.some((entry) => entry.type === ('socket' as Headers['type']))) {
    tarBytes.fill(0x20, 148, 156);
    tarBytes[156] = '8'.charCodeAt(0);
    const checksum = tarBytes.subarray(0, 512).reduce((sum, value) => sum + value, 0);
    Buffer.from(checksum.toString(8).padStart(6, '0')).copy(tarBytes, 148);
    tarBytes[154] = 0;
    tarBytes[155] = 0x20;
  }
  return new Uint8Array(gzipSync(tarBytes));
};

const materialize = async (
  artifactRoot: string,
  artifactBytes: Uint8Array,
  inputManifest = manifest,
) =>
  materializeModuleAppArtifact({
    artifactBytes,
    artifactRoot,
    artifactSha256: sha256(artifactBytes),
    buildId: BUILD_ID,
    claimToken: CLAIM_TOKEN,
    manifest: inputManifest,
  });

const materializeWithDependencies = (
  input: Parameters<typeof materializeModuleAppArtifact>[0],
  dependencies: ModuleAppArtifactMaterializerDependencies,
) => materializeModuleAppArtifactWithDependencies(input, dependencies);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('materializeModuleAppArtifact', () => {
  it('snapshots caller-owned artifact bytes before the first asynchronous boundary', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });
    const callerBytes = artifact.bytes.slice();

    const result = materialize(artifactRoot, callerBytes);
    callerBytes.fill(0);

    await expect(result).resolves.toEqual({
      directory: path.join(artifactRoot, artifact.sha256),
      reused: false,
    });
    expect(
      await readFile(path.join(artifactRoot, artifact.sha256, 'dist/index.html'), 'utf8'),
    ).toContain('Materialized');
  });

  it.each([
    {
      code: 'module_app_package_too_many_files',
      entries: [
        { name: 'one', type: 'directory' as const },
        { name: 'two', type: 'directory' as const },
      ],
      limits: { maxFileCount: 1 },
      name: 'entry count',
    },
    {
      code: 'module_app_package_file_too_large',
      entries: [{ bytes: encoder.encode('1234'), name: 'file.bin', type: 'file' as const }],
      limits: { maxFileSizeBytes: 3 },
      name: 'per-file bytes',
    },
    {
      code: 'module_app_package_expanded_too_large',
      entries: [
        { bytes: encoder.encode('12'), name: 'one.bin', type: 'file' as const },
        { bytes: encoder.encode('34'), name: 'two.bin', type: 'file' as const },
      ],
      limits: { maxFileSizeBytes: 10, maxUncompressedBytes: 3 },
      name: 'total expanded bytes',
    },
  ])(
    'enforces $name during extraction even when pre-inspection is bypassed',
    async ({ code, entries, limits }) => {
      const artifactRoot = await createRoot();
      const artifactBytes = await createTgz(entries);

      await expect(
        materializeWithDependencies(
          {
            artifactBytes,
            artifactRoot,
            artifactSha256: sha256(artifactBytes),
            buildId: BUILD_ID,
            claimToken: CLAIM_TOKEN,
            manifest,
          },
          { inspectArtifact: async () => [], limits },
        ),
      ).rejects.toMatchObject({ code });
    },
  );

  it.each([
    {
      code: 'module_app_package_unsafe_path',
      entry: { bytes: encoder.encode('unsafe'), name: '../escape.txt', type: 'file' as const },
      name: 'unsafe paths',
    },
    {
      code: 'module_app_package_archive_invalid',
      entry: { linkname: 'target', name: 'link', type: 'symlink' as const },
      name: 'unsupported types',
    },
  ])(
    'enforces $name during extraction even when pre-inspection is bypassed',
    async ({ code, entry }) => {
      const artifactRoot = await createRoot();
      const artifactBytes = await createTgz([entry]);

      await expect(
        materializeWithDependencies(
          {
            artifactBytes,
            artifactRoot,
            artifactSha256: sha256(artifactBytes),
            buildId: BUILD_ID,
            claimToken: CLAIM_TOKEN,
            manifest,
          },
          { inspectArtifact: async () => [] },
        ),
      ).rejects.toMatchObject({ code });
    },
  );

  it('orders marker write, chmod, fsync, and rename durability operations', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });
    const events: string[] = [];

    await materializeWithDependencies(
      {
        artifactBytes: artifact.bytes,
        artifactRoot,
        artifactSha256: artifact.sha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        manifest,
      },
      {
        fileSystem: {
          chmod: async (filePath: string, mode: number) => {
            events.push(`chmod:${path.basename(filePath)}:${mode.toString(8)}`);
            await chmod(filePath, mode);
          },
          openFileForWrite: async (filePath: string) => {
            const handle = await open(filePath, 'wx', 0o600);
            return {
              close: () => handle.close(),
              sync: async () => {
                events.push(`fsync-file:${path.basename(filePath)}`);
                await handle.sync();
              },
              write: async (data: Uint8Array) => {
                await handle.write(data);
              },
              writeFile: async (data: string) => {
                events.push(`write:${path.basename(filePath)}`);
                await handle.writeFile(data);
              },
            };
          },
          rename: async (from: string, to: string) => {
            events.push('rename');
            await rename(from, to);
          },
          syncDirectory: async (directory: string) => {
            events.push(`fsync-directory:${directory}`);
          },
        },
      },
    );

    const markerWrite = events.indexOf('write:.module-app-artifact.json');
    const renameIndex = events.indexOf('rename');
    const chmodIndexes = events.flatMap((event, index) =>
      event.startsWith('chmod:') && index < renameIndex ? [index] : [],
    );
    const fileSyncIndexes = events.flatMap((event, index) =>
      event.startsWith('fsync-file:') ? [index] : [],
    );
    const artifactRootSync = events.indexOf(`fsync-directory:${artifactRoot}`);
    const stagingParentSync = events.indexOf(
      `fsync-directory:${path.join(artifactRoot, '.staging')}`,
    );
    const preRenameDirectorySyncIndexes = events.flatMap((event, index) =>
      event.startsWith('fsync-directory:') &&
      index < renameIndex &&
      index !== artifactRootSync &&
      index !== stagingParentSync
        ? [index]
        : [],
    );
    const finalRootChmod = events.indexOf(`chmod:${artifact.sha256}:555`);

    expect(markerWrite).toBeGreaterThanOrEqual(0);
    expect(events).toContain('chmod:.module-app-artifact.json:444');
    expect(events).toContain('fsync-file:.module-app-artifact.json');
    expect(events.indexOf('chmod:.module-app-artifact.json:444')).toBe(Math.max(...chmodIndexes));
    expect(Math.min(...chmodIndexes)).toBeGreaterThan(markerWrite);
    expect(Math.min(...fileSyncIndexes)).toBeGreaterThan(Math.max(...chmodIndexes));
    expect(Math.min(...preRenameDirectorySyncIndexes)).toBeGreaterThan(
      Math.max(...fileSyncIndexes),
    );
    expect(renameIndex).toBeGreaterThan(Math.max(...preRenameDirectorySyncIndexes));
    expect(finalRootChmod).toBeGreaterThan(renameIndex);
    expect(artifactRootSync).toBeGreaterThan(finalRootChmod);
    expect(stagingParentSync).toBeGreaterThan(finalRootChmod);
  });

  it('rolls back a newly renamed final directory when parent fsync fails', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });
    const directory = path.join(artifactRoot, artifact.sha256);

    await expect(
      materializeWithDependencies(
        {
          artifactBytes: artifact.bytes,
          artifactRoot,
          artifactSha256: artifact.sha256,
          buildId: BUILD_ID,
          claimToken: CLAIM_TOKEN,
          manifest,
        },
        {
          fileSystem: {
            syncDirectory: async (syncPath: string) => {
              if (syncPath === artifactRoot) {
                throw Object.assign(new Error('parent fsync failed'), { code: 'EIO' });
              }
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'EIO' });
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { failurePoint: 'chmod' as const, name: 'final root chmod' },
    { failurePoint: 'fsync' as const, name: 'final root fsync' },
  ])('durably rolls back a promoted destination when $name fails', async ({ failurePoint }) => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });
    const directory = path.join(artifactRoot, artifact.sha256);
    const stagingParent = path.join(artifactRoot, '.staging');
    const primary = Object.assign(new Error(`${failurePoint} failed`), { code: 'EIO' });
    const events: string[] = [];
    let rollbackStarted = false;

    const result = materializeWithDependencies(
      {
        artifactBytes: artifact.bytes,
        artifactRoot,
        artifactSha256: artifact.sha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        manifest,
      },
      {
        fileSystem: {
          chmod: async (filePath: string, mode: number) => {
            if (filePath === directory && failurePoint === 'chmod') {
              rollbackStarted = true;
              throw primary;
            }
            await chmod(filePath, mode);
          },
          removeDirectory: async (removePath: string) => {
            if (rollbackStarted && removePath === directory) events.push('remove-destination');
            await rm(removePath, { force: true, recursive: true });
          },
          syncDirectory: async (syncPath: string) => {
            if (syncPath === directory && failurePoint === 'fsync') {
              rollbackStarted = true;
              throw primary;
            }
            if (rollbackStarted && syncPath === artifactRoot) events.push('sync-artifact-root');
            if (rollbackStarted && syncPath === stagingParent) events.push('sync-staging-parent');
          },
        },
      },
    );

    await expect(result).rejects.toBe(primary);
    expect(events).toEqual(['remove-destination', 'sync-artifact-root', 'sync-staging-parent']);
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('syncs both rename parents after removing a promotion rejected by parent fsync', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });
    const directory = path.join(artifactRoot, artifact.sha256);
    const stagingParent = path.join(artifactRoot, '.staging');
    const primary = Object.assign(new Error('parent fsync failed'), { code: 'EIO' });
    const events: string[] = [];
    let artifactRootSyncs = 0;
    let rollbackStarted = false;

    const result = materializeWithDependencies(
      {
        artifactBytes: artifact.bytes,
        artifactRoot,
        artifactSha256: artifact.sha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        manifest,
      },
      {
        fileSystem: {
          removeDirectory: async (removePath: string) => {
            if (rollbackStarted && removePath === directory) events.push('remove-destination');
            await rm(removePath, { force: true, recursive: true });
          },
          syncDirectory: async (syncPath: string) => {
            if (syncPath === artifactRoot) {
              artifactRootSyncs += 1;
              if (artifactRootSyncs === 1) {
                rollbackStarted = true;
                throw primary;
              }
              if (rollbackStarted) {
                events.push('sync-artifact-root-start');
                await new Promise((resolve) => setTimeout(resolve, 10));
                events.push('sync-artifact-root-end');
              }
            }
            if (rollbackStarted && syncPath === stagingParent) events.push('sync-staging-parent');
          },
        },
      },
    );

    await expect(result).rejects.toBe(primary);
    expect(events).toEqual([
      'remove-destination',
      'sync-artifact-root-start',
      'sync-artifact-root-end',
      'sync-staging-parent',
    ]);
  });

  it.each([
    { failurePoint: 'cleanup' as const, name: 'destination cleanup' },
    { failurePoint: 'sync' as const, name: 'rollback parent sync' },
  ])('preserves the promotion failure when $name also fails', async ({ failurePoint }) => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });
    const directory = path.join(artifactRoot, artifact.sha256);
    const stagingParent = path.join(artifactRoot, '.staging');
    const primary = Object.assign(new Error('promotion chmod failed'), { code: 'EIO' });
    const secondary = Object.assign(new Error(`${failurePoint} failed`), { code: 'EACCES' });
    const events: string[] = [];
    let rollbackStarted = false;

    const result = materializeWithDependencies(
      {
        artifactBytes: artifact.bytes,
        artifactRoot,
        artifactSha256: artifact.sha256,
        buildId: BUILD_ID,
        claimToken: CLAIM_TOKEN,
        manifest,
      },
      {
        fileSystem: {
          chmod: async (filePath: string, mode: number) => {
            if (filePath === directory) {
              rollbackStarted = true;
              throw primary;
            }
            await chmod(filePath, mode);
          },
          removeDirectory: async (removePath: string) => {
            if (rollbackStarted && removePath === directory) {
              events.push('remove-destination');
              if (failurePoint === 'cleanup') throw secondary;
            }
            await rm(removePath, { force: true, recursive: true });
          },
          syncDirectory: async (syncPath: string) => {
            if (rollbackStarted && syncPath === artifactRoot) {
              events.push('sync-artifact-root');
              if (failurePoint === 'sync') throw secondary;
            }
            if (rollbackStarted && syncPath === stagingParent) events.push('sync-staging-parent');
          },
        },
      },
    );

    await expect(result).rejects.toBe(primary);
    expect(events).toContain('remove-destination');
    expect(events).toContain('sync-artifact-root');
    expect(events).toContain('sync-staging-parent');
    expect((primary as Error & { rollbackErrors?: unknown[] }).rollbackErrors).toContain(secondary);
  });

  it('validates and reuses a destination that appears during an EPERM rename collision', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });

    await expect(
      materializeWithDependencies(
        {
          artifactBytes: artifact.bytes,
          artifactRoot,
          artifactSha256: artifact.sha256,
          buildId: BUILD_ID,
          claimToken: CLAIM_TOKEN,
          manifest,
        },
        {
          fileSystem: {
            rename: async (from: string, to: string) => {
              await cp(from, to, { recursive: true });
              throw Object.assign(new Error('destination collision'), { code: 'EPERM' });
            },
          },
        },
      ),
    ).resolves.toEqual({
      directory: path.join(artifactRoot, artifact.sha256),
      reused: true,
    });
  });

  it('extracts through claim staging, writes identity marker, and applies read-only modes', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });

    await expect(materialize(artifactRoot, artifact.bytes)).resolves.toEqual({
      directory: path.join(artifactRoot, artifact.sha256),
      reused: false,
    });

    const directory = path.join(artifactRoot, artifact.sha256);
    expect(await readFile(path.join(directory, 'dist/index.html'), 'utf8')).toContain(
      'Materialized',
    );
    expect(
      JSON.parse(await readFile(path.join(directory, '.module-app-artifact.json'), 'utf8')),
    ).toEqual(
      expect.objectContaining({
        artifactSha256: artifact.sha256,
        buildId: BUILD_ID,
        manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        schemaVersion: 1,
      }),
    );
    expect((await stat(directory)).mode & 0o777).toBe(process.platform === 'win32' ? 0o444 : 0o555);
    expect((await stat(path.join(directory, 'dist/index.html'))).mode & 0o777).toBe(0o444);
    await expect(
      lstat(path.join(artifactRoot, '.staging', `${BUILD_ID}-${CLAIM_TOKEN}`)),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('removes interrupted claim staging before a fresh atomic materialization', async () => {
    const artifactRoot = await createRoot();
    const staging = path.join(artifactRoot, '.staging', `${BUILD_ID}-${CLAIM_TOKEN}`);
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, 'partial.txt'), 'partial');
    const artifact = await buildDeterministicModuleAppArtifact({ files });

    await expect(materialize(artifactRoot, artifact.bytes)).resolves.toMatchObject({
      reused: false,
    });
    await expect(lstat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reuses only an existing destination with matching marker and declared regular files', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });

    await materialize(artifactRoot, artifact.bytes);
    await expect(materialize(artifactRoot, artifact.bytes)).resolves.toEqual({
      directory: path.join(artifactRoot, artifact.sha256),
      reused: true,
    });

    await chmod(path.join(artifactRoot, artifact.sha256), 0o755);
    await rm(path.join(artifactRoot, artifact.sha256, 'server/index.js'));
    await mkdir(path.join(artifactRoot, artifact.sha256, 'server/index.js'));
    await expect(materialize(artifactRoot, artifact.bytes)).rejects.toMatchObject({
      code: 'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_MISMATCH',
    });
    expect(
      (await lstat(path.join(artifactRoot, artifact.sha256, 'server/index.js'))).isDirectory(),
    ).toBe(true);
  });

  it.each([
    { mode: 0o755, name: 'root', relativePath: '' },
    { mode: 0o755, name: 'nested directory', relativePath: 'dist' },
    { mode: 0o644, name: 'artifact file', relativePath: 'dist/index.html' },
    { mode: 0o644, name: 'identity marker', relativePath: '.module-app-artifact.json' },
  ])('rejects reuse when the existing POSIX $name is writable', async ({ mode, relativePath }) => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });
    const directory = path.join(artifactRoot, artifact.sha256);
    const writablePath = path.join(directory, relativePath);

    await materialize(artifactRoot, artifact.bytes);

    await expect(
      materializeWithDependencies(
        {
          artifactBytes: artifact.bytes,
          artifactRoot,
          artifactSha256: artifact.sha256,
          buildId: BUILD_ID,
          claimToken: CLAIM_TOKEN,
          manifest,
        },
        {
          fileSystem: {
            lstat: async (filePath: string) => {
              const metadata = await lstat(filePath);
              const expectedMode = metadata.isDirectory() ? 0o555 : 0o444;
              Object.defineProperty(metadata, 'mode', {
                configurable: true,
                value:
                  (metadata.mode & ~0o777) |
                  (path.resolve(filePath) === writablePath ? mode : expectedMode),
              });
              return metadata;
            },
          },
          platform: 'linux',
        },
      ),
    ).rejects.toMatchObject({
      code: 'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_MISMATCH',
    });
  });

  it('fails closed on an existing marker mismatch without deleting the destination', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({ files });
    const destination = path.join(artifactRoot, artifact.sha256);
    await mkdir(destination, { recursive: true });
    await writeFile(
      path.join(destination, '.module-app-artifact.json'),
      JSON.stringify({
        artifactSha256: '0'.repeat(64),
        buildId: BUILD_ID,
        manifestSha256: '0'.repeat(64),
        schemaVersion: 1,
      }),
    );

    await expect(materialize(artifactRoot, artifact.bytes)).rejects.toMatchObject({
      code: 'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_MISMATCH',
    });
    expect(await lstat(destination)).toBeDefined();
  });

  it.each(['../escape.txt', '/absolute.txt', 'C:\\absolute.txt', 'dist\\index.html'])(
    'rejects unsafe archive path %s without creating a final directory',
    async (entryPath) => {
      const artifactRoot = await createRoot();
      const bytes = await createTgz([
        { bytes: encoder.encode('unsafe'), name: entryPath, type: 'file' },
      ]);

      await expect(materialize(artifactRoot, bytes)).rejects.toMatchObject({
        code: 'module_app_package_unsafe_path',
      });
      await expect(lstat(path.join(artifactRoot, sha256(bytes)))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it.each(['symlink', 'link', 'character-device', 'block-device', 'fifo', 'socket'])(
    'rejects unsupported %s entries without creating a final directory',
    async (type) => {
      const artifactRoot = await createRoot();
      const bytes = await createTgz([
        { linkname: 'target', name: 'unsafe-entry', type: type as Headers['type'] },
      ]);

      await expect(materialize(artifactRoot, bytes)).rejects.toMatchObject({
        code: 'module_app_package_archive_invalid',
      });
      await expect(lstat(path.join(artifactRoot, sha256(bytes)))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('removes staging and leaves no final directory when declared outputs are missing', async () => {
    const artifactRoot = await createRoot();
    const artifact = await buildDeterministicModuleAppArtifact({
      files: { 'dist/index.html': files['dist/index.html'] },
    });

    await expect(materialize(artifactRoot, artifact.bytes)).rejects.toMatchObject({
      code: 'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_INVALID',
    });
    await expect(lstat(path.join(artifactRoot, artifact.sha256))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      lstat(path.join(artifactRoot, '.staging', `${BUILD_ID}-${CLAIM_TOKEN}`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
