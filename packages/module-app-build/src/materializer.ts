import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import {
  chmod as fsChmod,
  lstat as fsLstat,
  mkdir as fsMkdir,
  open as fsOpen,
  readdir as fsReaddir,
  readFile as fsReadFile,
  rename as fsRename,
  rm as fsRm,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

import type { ModuleAppPackageManifest } from '@lobechat/types';
import { extract, type Headers } from 'tar-stream';

import { inspectModuleAppArtifact, type ModuleAppArtifactEntry } from './artifact';
import { ModuleAppPackageSafetyError } from './errors';
import { DEFAULT_MODULE_APP_PACKAGE_LIMITS, type ModuleAppPackageArchiveLimits } from './source';

type ManifestV2 = Extract<ModuleAppPackageManifest, { manifestVersion: 2 }>;

type ArtifactMarker = {
  artifactSha256: string;
  buildId: string;
  manifestSha256: string;
  schemaVersion: 1;
};

type ArtifactFileHandle = {
  close: () => Promise<void>;
  sync: () => Promise<void>;
  write: (data: Uint8Array) => Promise<void>;
  writeFile: (data: string) => Promise<void>;
};

type MaterializerFileSystem = {
  chmod: (filePath: string, mode: number) => Promise<void>;
  lstat: (filePath: string) => Promise<Stats>;
  mkdir: (directory: string) => Promise<void>;
  openFileForWrite: (filePath: string) => Promise<ArtifactFileHandle>;
  readDirectory: (directory: string) => Promise<Dirent[]>;
  readTextFile: (filePath: string) => Promise<string>;
  removeDirectory: (directory: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  syncDirectory: (directory: string) => Promise<void>;
};

export type ModuleAppArtifactMaterializerDependencies = {
  fileSystem?: Partial<MaterializerFileSystem>;
  inspectArtifact?: typeof inspectModuleAppArtifact;
  limits?: ModuleAppPackageArchiveLimits;
  platform?: NodeJS.Platform;
};

export type MaterializeModuleAppArtifactInput = {
  artifactBytes: Uint8Array;
  artifactRoot: string;
  artifactSha256: string;
  buildId: string;
  claimToken: string;
  manifest: ManifestV2;
};

export class ModuleAppArtifactMaterializationError extends Error {
  constructor(
    public readonly code: string,
    message = code,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ModuleAppArtifactMaterializationError';
  }
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

const getManifestSha256 = (manifest: ManifestV2) => sha256(JSON.stringify(canonicalize(manifest)));

const isSafePath = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\0')) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
  if (/^[a-z]:[\\/]/i.test(trimmed) || trimmed.includes('\\')) return false;
  return !trimmed
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..');
};

const assertSafeIdentity = (value: string, label: string) => {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new ModuleAppArtifactMaterializationError(
      'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_INVALID',
      `Unsafe ${label}.`,
    );
  }
};

const resolveEntryPath = (root: string, entryPath: string) => {
  if (!isSafePath(entryPath)) {
    throw new ModuleAppPackageSafetyError(
      'module_app_package_unsafe_path',
      `Unsafe package path: ${entryPath}`,
    );
  }
  const resolved = path.resolve(root, ...entryPath.split('/'));
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw new ModuleAppPackageSafetyError(
      'module_app_package_unsafe_path',
      `Unsafe package path: ${entryPath}`,
    );
  }
  return resolved;
};

const defaultSyncDirectory = async (directory: string) => {
  let handle;
  try {
    handle = await fsOpen(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code ?? '')) throw error;
  } finally {
    await handle?.close();
  }
};

const defaultFileSystem: MaterializerFileSystem = {
  chmod: fsChmod,
  lstat: fsLstat,
  mkdir: async (directory) => {
    await fsMkdir(directory, { recursive: true });
  },
  openFileForWrite: async (filePath) => {
    const handle = await fsOpen(filePath, 'wx', 0o600);
    return {
      close: () => handle.close(),
      sync: () => handle.sync(),
      write: async (data) => {
        let offset = 0;
        while (offset < data.byteLength) {
          const { bytesWritten } = await handle.write(data, offset, data.byteLength - offset);
          if (bytesWritten <= 0) throw new Error(`Unable to write artifact file: ${filePath}`);
          offset += bytesWritten;
        }
      },
      writeFile: async (data) => {
        await handle.writeFile(data);
      },
    };
  },
  readDirectory: (directory) => fsReaddir(directory, { withFileTypes: true }),
  readTextFile: (filePath) => fsReadFile(filePath, 'utf8'),
  removeDirectory: async (directory) => {
    await fsRm(directory, { force: true, recursive: true });
  },
  rename: fsRename,
  syncDirectory: defaultSyncDirectory,
};

const closeArtifactFiles = async (handles: ArtifactFileHandle[], ignoreErrors = false) => {
  const results = await Promise.allSettled(handles.map((handle) => handle.close()));
  handles.length = 0;
  if (ignoreErrors) return;
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
};

const extractArtifact = async (input: {
  artifactBytes: Uint8Array;
  fileSystem: MaterializerFileSystem;
  limits: typeof DEFAULT_MODULE_APP_PACKAGE_LIMITS;
  stagingDirectory: string;
}): Promise<ArtifactFileHandle[]> =>
  new Promise((resolve, reject) => {
    const source = Readable.from([Buffer.from(input.artifactBytes)]);
    const gunzip = createGunzip();
    const archive = extract();
    const handles: ArtifactFileHandle[] = [];
    const types = new Map<string, 'directory' | 'file'>();
    let entryCount = 0;
    let settled = false;
    let totalBytes = 0;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      source.destroy();
      gunzip.destroy();
      archive.destroy();
      void closeArtifactFiles(handles, true).then(() => reject(error));
    };

    const invalidArchive = (message: string) =>
      new ModuleAppPackageSafetyError('module_app_package_archive_invalid', message);

    source.once('error', () => fail(invalidArchive('Artifact archive could not be decompressed.')));
    gunzip.once('error', () => fail(invalidArchive('Artifact archive could not be decompressed.')));
    archive.once('error', () =>
      fail(invalidArchive('Artifact archive could not be decompressed.')),
    );
    archive.once('finish', () => {
      if (settled) return;
      for (const [entryPath, type] of types) {
        if (type !== 'file') continue;
        const segments = entryPath.split('/');
        for (let index = 1; index < segments.length; index += 1) {
          const parent = segments.slice(0, index).join('/');
          if (types.get(parent) === 'file') {
            fail(invalidArchive(`Artifact file conflicts with parent directory: ${parent}`));
            return;
          }
        }
      }
      settled = true;
      resolve(handles);
    });

    archive.on('entry', (header: Headers, stream, next) => {
      void (async () => {
        const type = header.type;
        if (type !== 'file' && type !== 'directory') {
          throw invalidArchive(`Artifact contains unsupported entry type: ${type ?? 'unknown'}`);
        }
        const destination = resolveEntryPath(input.stagingDirectory, header.name);
        if (types.has(header.name)) {
          throw new ModuleAppPackageSafetyError(
            'module_app_package_duplicate_path',
            `Duplicate package path: ${header.name}`,
          );
        }
        entryCount += 1;
        if (entryCount > input.limits.maxFileCount) {
          throw new ModuleAppPackageSafetyError(
            'module_app_package_too_many_files',
            `Package contains more than ${input.limits.maxFileCount} entries.`,
          );
        }

        const declaredSize = header.size;
        if (
          typeof declaredSize !== 'number' ||
          !Number.isSafeInteger(declaredSize) ||
          declaredSize < 0
        ) {
          throw invalidArchive(`Invalid artifact size: ${header.name}`);
        }
        if (type === 'directory' && declaredSize !== 0) {
          throw invalidArchive(`Directory contains data: ${header.name}`);
        }
        if (type === 'file' && declaredSize > input.limits.maxFileSizeBytes) {
          throw new ModuleAppPackageSafetyError(
            'module_app_package_file_too_large',
            `Package file exceeds ${input.limits.maxFileSizeBytes} bytes: ${header.name}`,
          );
        }

        if (type === 'directory') {
          await input.fileSystem.mkdir(destination);
          stream.resume();
          await new Promise<void>((entryResolve, entryReject) => {
            stream.once('end', entryResolve);
            stream.once('error', entryReject);
          });
          types.set(header.name, type);
          next();
          return;
        }

        await input.fileSystem.mkdir(path.dirname(destination));
        const handle = await input.fileSystem.openFileForWrite(destination);
        handles.push(handle);
        let actualSize = 0;
        for await (const chunk of stream) {
          const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
          actualSize += bytes.byteLength;
          totalBytes += bytes.byteLength;
          if (actualSize > declaredSize || actualSize > input.limits.maxFileSizeBytes) {
            throw new ModuleAppPackageSafetyError(
              'module_app_package_file_too_large',
              `Package file exceeds ${input.limits.maxFileSizeBytes} bytes: ${header.name}`,
            );
          }
          if (totalBytes > input.limits.maxUncompressedBytes) {
            throw new ModuleAppPackageSafetyError(
              'module_app_package_expanded_too_large',
              `Expanded package exceeds ${input.limits.maxUncompressedBytes} bytes.`,
            );
          }
          await handle.write(bytes);
        }
        if (actualSize !== declaredSize) {
          throw invalidArchive(`Invalid artifact size: ${header.name}`);
        }
        types.set(header.name, type);
        next();
      })().catch(fail);
    });

    source.pipe(gunzip).pipe(archive);
  });

const declaredRegularFiles = (manifest: ManifestV2) => {
  const frontendOutput = manifest.build.frontend.output;
  const frontendFile = frontendOutput.toLowerCase().endsWith('.html')
    ? frontendOutput
    : `${frontendOutput}/index.html`;
  return [
    frontendFile,
    ...manifest.runtime.functions.map((runtimeFunction) => runtimeFunction.entry),
  ];
};

const assertDeclaredRegularFiles = async (
  directory: string,
  manifest: ManifestV2,
  fileSystem: MaterializerFileSystem,
) => {
  for (const declaredPath of declaredRegularFiles(manifest)) {
    let metadata;
    try {
      metadata = await fileSystem.lstat(resolveEntryPath(directory, declaredPath));
    } catch (error) {
      throw new ModuleAppArtifactMaterializationError(
        'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_INVALID',
        `Declared artifact file is missing: ${declaredPath}`,
        error,
      );
    }
    if (!metadata.isFile()) {
      throw new ModuleAppArtifactMaterializationError(
        'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_INVALID',
        `Declared artifact path is not a regular file: ${declaredPath}`,
      );
    }
  }
};

const validateExistingDestination = async (
  directory: string,
  marker: ArtifactMarker,
  manifest: ManifestV2,
  fileSystem: MaterializerFileSystem,
  platform: NodeJS.Platform,
) => {
  try {
    const rootMetadata = await fileSystem.lstat(directory);
    if (!rootMetadata.isDirectory()) return false;
    if (
      platform !== 'win32' &&
      !(await validateImmutableTree(directory, fileSystem, rootMetadata))
    ) {
      return false;
    }
    const markerPath = path.join(directory, '.module-app-artifact.json');
    if (!(await fileSystem.lstat(markerPath)).isFile()) return false;
    const existing = JSON.parse(
      await fileSystem.readTextFile(markerPath),
    ) as Partial<ArtifactMarker>;
    if (
      existing.schemaVersion !== 1 ||
      existing.artifactSha256 !== marker.artifactSha256 ||
      existing.buildId !== marker.buildId ||
      existing.manifestSha256 !== marker.manifestSha256
    ) {
      return false;
    }
    await assertDeclaredRegularFiles(directory, manifest, fileSystem);
    return true;
  } catch {
    return false;
  }
};

const validateImmutableTree = async (
  directory: string,
  fileSystem: MaterializerFileSystem,
  metadata?: Stats,
): Promise<boolean> => {
  const directoryMetadata = metadata ?? (await fileSystem.lstat(directory));
  if (!directoryMetadata.isDirectory() || (directoryMetadata.mode & 0o7777) !== 0o555) {
    return false;
  }
  for (const entry of await fileSystem.readDirectory(directory)) {
    if (entry.isSymbolicLink()) return false;
    const entryPath = path.join(directory, entry.name);
    const entryMetadata = await fileSystem.lstat(entryPath);
    if (entryMetadata.isDirectory()) {
      if (!(await validateImmutableTree(entryPath, fileSystem, entryMetadata))) return false;
      continue;
    }
    if (!entryMetadata.isFile() || (entryMetadata.mode & 0o7777) !== 0o444) return false;
  }
  return true;
};

const collectDirectories = (entries: ModuleAppArtifactEntry[], stagingDirectory: string) => {
  const directories = new Set([stagingDirectory]);
  for (const entry of entries) {
    const destination = resolveEntryPath(stagingDirectory, entry.path);
    if (entry.type === 'directory') directories.add(destination);
    let current = path.dirname(destination);
    while (current.startsWith(`${stagingDirectory}${path.sep}`)) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  return Array.from(directories).sort((left, right) => right.length - left.length);
};

const applyImmutableModes = async (input: {
  entries: ModuleAppArtifactEntry[];
  fileSystem: MaterializerFileSystem;
  markerPath: string;
  stagingDirectory: string;
}) => {
  for (const entry of input.entries) {
    if (entry.type === 'file') {
      await input.fileSystem.chmod(resolveEntryPath(input.stagingDirectory, entry.path), 0o444);
    }
  }
  for (const directory of collectDirectories(input.entries, input.stagingDirectory)) {
    if (directory === input.stagingDirectory) continue;
    await input.fileSystem.chmod(directory, 0o555);
  }
  await input.fileSystem.chmod(input.markerPath, 0o444);
};

const syncMaterializedTree = async (input: {
  entries: ModuleAppArtifactEntry[];
  fileHandles: ArtifactFileHandle[];
  fileSystem: MaterializerFileSystem;
  stagingDirectory: string;
}) => {
  for (const handle of input.fileHandles) await handle.sync();
  for (const directory of collectDirectories(input.entries, input.stagingDirectory)) {
    await input.fileSystem.syncDirectory(directory);
  }
};

const makeDirectoriesWritable = async (
  directory: string,
  fileSystem: MaterializerFileSystem,
): Promise<void> => {
  const metadata = await fileSystem.lstat(directory).catch(() => undefined);
  if (!metadata?.isDirectory()) return;
  await fileSystem.chmod(directory, 0o755).catch(() => undefined);
  const children = await fileSystem.readDirectory(directory).catch(() => []);
  await Promise.all(
    children
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => makeDirectoriesWritable(path.join(directory, entry.name), fileSystem)),
  );
};

const removeOwnedDirectory = async (directory: string, fileSystem: MaterializerFileSystem) => {
  try {
    await fileSystem.removeDirectory(directory);
  } catch {
    await makeDirectoriesWritable(directory, fileSystem);
    await fileSystem.removeDirectory(directory);
  }
};

const attachRollbackErrors = (primary: unknown, rollbackErrors: unknown[]) => {
  if (rollbackErrors.length === 0 || !(primary instanceof Error)) return;
  const existing = (primary as Error & { rollbackErrors?: unknown[] }).rollbackErrors ?? [];
  Object.defineProperty(primary, 'rollbackErrors', {
    configurable: true,
    value: [...existing, ...rollbackErrors],
  });
};

const runCleanupWithoutHidingPrimary = async (
  primary: unknown,
  actions: Array<() => Promise<void>>,
) => {
  const rollbackErrors: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  attachRollbackErrors(primary, rollbackErrors);
};

const rollbackPromotedDirectory = async (input: {
  artifactRoot: string;
  directory: string;
  fileSystem: MaterializerFileSystem;
  primary: unknown;
  stagingParent: string;
}) =>
  runCleanupWithoutHidingPrimary(input.primary, [
    () => removeOwnedDirectory(input.directory, input.fileSystem),
    () => input.fileSystem.syncDirectory(input.artifactRoot),
    () => input.fileSystem.syncDirectory(input.stagingParent),
  ]);

export const materializeModuleAppArtifactWithDependencies = async (
  input: MaterializeModuleAppArtifactInput,
  dependencies: ModuleAppArtifactMaterializerDependencies = {},
): Promise<{ directory: string; reused: boolean }> => {
  const artifactBytes = Uint8Array.from(input.artifactBytes);
  const artifactSha256 = input.artifactSha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(artifactSha256) || sha256(artifactBytes) !== artifactSha256) {
    throw new ModuleAppArtifactMaterializationError('MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH');
  }
  assertSafeIdentity(input.buildId, 'build ID');
  assertSafeIdentity(input.claimToken, 'claim token');

  const fileSystem = { ...defaultFileSystem, ...dependencies.fileSystem };
  const inspectArtifact = dependencies.inspectArtifact ?? inspectModuleAppArtifact;
  const limits = { ...DEFAULT_MODULE_APP_PACKAGE_LIMITS, ...dependencies.limits };
  const platform = dependencies.platform ?? process.platform;
  const artifactRoot = path.resolve(input.artifactRoot);
  const stagingDirectory = path.join(
    artifactRoot,
    '.staging',
    `${input.buildId}-${input.claimToken}`,
  );
  const directory = path.join(artifactRoot, artifactSha256);
  const marker: ArtifactMarker = {
    artifactSha256,
    buildId: input.buildId,
    manifestSha256: getManifestSha256(input.manifest),
    schemaVersion: 1,
  };

  if (
    await fileSystem
      .lstat(directory)
      .then(() => true)
      .catch(() => false)
  ) {
    if (
      await validateExistingDestination(directory, marker, input.manifest, fileSystem, platform)
    ) {
      return { directory, reused: true };
    }
    throw new ModuleAppArtifactMaterializationError(
      'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_MISMATCH',
    );
  }

  await fileSystem.mkdir(path.dirname(stagingDirectory));
  await removeOwnedDirectory(stagingDirectory, fileSystem);
  const fileHandles: ArtifactFileHandle[] = [];

  try {
    const entries = await inspectArtifact(artifactBytes);
    await fileSystem.mkdir(stagingDirectory);
    fileHandles.push(
      ...(await extractArtifact({ artifactBytes, fileSystem, limits, stagingDirectory })),
    );

    for (const entry of entries) {
      const metadata = await fileSystem.lstat(resolveEntryPath(stagingDirectory, entry.path));
      if (
        (entry.type === 'file' && !metadata.isFile()) ||
        (entry.type === 'directory' && !metadata.isDirectory())
      ) {
        throw new ModuleAppArtifactMaterializationError(
          'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_INVALID',
          `Artifact entry type changed during extraction: ${entry.path}`,
        );
      }
    }
    await assertDeclaredRegularFiles(stagingDirectory, input.manifest, fileSystem);

    const markerPath = path.join(stagingDirectory, '.module-app-artifact.json');
    const markerHandle = await fileSystem.openFileForWrite(markerPath);
    fileHandles.push(markerHandle);
    await markerHandle.writeFile(`${JSON.stringify(marker)}\n`);
    await applyImmutableModes({ entries, fileSystem, markerPath, stagingDirectory });
    await syncMaterializedTree({ entries, fileHandles, fileSystem, stagingDirectory });
    await closeArtifactFiles(fileHandles);

    try {
      await fileSystem.rename(stagingDirectory, directory);
    } catch (error) {
      const destinationExists = await fileSystem
        .lstat(directory)
        .then(() => true)
        .catch(() => false);
      if (destinationExists) {
        if (
          await validateExistingDestination(directory, marker, input.manifest, fileSystem, platform)
        ) {
          await removeOwnedDirectory(stagingDirectory, fileSystem);
          return { directory, reused: true };
        }
        throw new ModuleAppArtifactMaterializationError(
          'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_MISMATCH',
          'Existing materialized artifact does not match the requested identity.',
          error,
        );
      }
      throw error;
    }
    const stagingParent = path.dirname(stagingDirectory);
    try {
      await fileSystem.chmod(directory, 0o555);
      await fileSystem.syncDirectory(directory);
      await fileSystem.syncDirectory(artifactRoot);
      await fileSystem.syncDirectory(stagingParent);
    } catch (error) {
      await rollbackPromotedDirectory({
        artifactRoot,
        directory,
        fileSystem,
        primary: error,
        stagingParent,
      });
      throw error;
    }
    return { directory, reused: false };
  } catch (error) {
    await runCleanupWithoutHidingPrimary(error, [
      () => closeArtifactFiles(fileHandles),
      () => removeOwnedDirectory(stagingDirectory, fileSystem),
    ]);
    throw error;
  }
};

export const materializeModuleAppArtifact = (input: MaterializeModuleAppArtifactInput) =>
  materializeModuleAppArtifactWithDependencies(input);
