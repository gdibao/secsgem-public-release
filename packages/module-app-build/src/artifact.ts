import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { createGunzip, gzip as gzipCallback } from 'node:zlib';

import { extract, pack, type Headers, type Pack } from 'tar-stream';

import { ModuleAppPackageSafetyError } from './errors';
import { DEFAULT_MODULE_APP_PACKAGE_LIMITS } from './source';

const gzip = promisify(gzipCallback);
const EPOCH = new Date(0);

type ArtifactEntryType = 'directory' | 'file';

type ArtifactEntry = {
  bytes: Uint8Array;
  path: string;
  type: ArtifactEntryType;
};

export type BuildDeterministicModuleAppArtifactInput = {
  files: Record<string, Uint8Array>;
};

export type ModuleAppArtifactEntry = {
  gid: number;
  gname: string;
  mode: number;
  mtime: Date;
  path: string;
  type: ArtifactEntryType;
  uid: number;
  uname: string;
};

const safetyError = (code: string, message: string) =>
  new ModuleAppPackageSafetyError(code, message);

const comparePaths = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const isUnsafePath = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes('\0')) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return true;
  if (/^[a-z]:[\\/]/i.test(trimmed) || trimmed.includes('\\')) return true;

  return trimmed.split('/').some((segment) => segment === '.' || segment === '..' || segment === '');
};

const assertFileLimits = (files: Record<string, Uint8Array>) => {
  const { maxFileCount, maxFileSizeBytes, maxUncompressedBytes } =
    DEFAULT_MODULE_APP_PACKAGE_LIMITS;
  const paths = Object.keys(files);

  if (paths.length > maxFileCount) {
    throw safetyError(
      'module_app_package_too_many_files',
      `Package contains more than ${maxFileCount} files.`,
    );
  }

  let totalBytes = 0;
  for (const path of paths) {
    const data = files[path];
    if (!(data instanceof Uint8Array)) {
      throw safetyError('module_app_package_archive_invalid', `Package file is not binary data: ${path}`);
    }
    if (data.byteLength > maxFileSizeBytes) {
      throw safetyError(
        'module_app_package_file_too_large',
        `Package file exceeds ${maxFileSizeBytes} bytes: ${path}`,
      );
    }

    totalBytes += data.byteLength;
    if (totalBytes > maxUncompressedBytes) {
      throw safetyError(
        'module_app_package_expanded_too_large',
        `Expanded package exceeds ${maxUncompressedBytes} bytes.`,
      );
    }
  }
};

const createArtifactEntries = (files: Record<string, Uint8Array>): ArtifactEntry[] => {
  assertFileLimits(files);

  const entries = new Map<string, ArtifactEntry>();
  for (const [path, bytes] of Object.entries(files)) {
    if (isUnsafePath(path)) {
      throw safetyError('module_app_package_unsafe_path', `Unsafe package path: ${path}`);
    }
    if (entries.has(path)) {
      throw safetyError('module_app_package_duplicate_path', `Duplicate package path: ${path}`);
    }
    entries.set(path, { bytes, path, type: 'file' });
  }

  for (const path of Object.keys(files)) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const directoryPath = segments.slice(0, index).join('/');
      const existing = entries.get(directoryPath);
      if (existing?.type === 'file') {
        throw safetyError(
          'module_app_package_archive_invalid',
          `Package file conflicts with parent directory: ${directoryPath}`,
        );
      }
      if (!existing) {
        entries.set(directoryPath, { bytes: new Uint8Array(), path: directoryPath, type: 'directory' });
      }
    }
  }

  if (entries.size > DEFAULT_MODULE_APP_PACKAGE_LIMITS.maxFileCount) {
    throw safetyError(
      'module_app_package_too_many_files',
      `Package contains more than ${DEFAULT_MODULE_APP_PACKAGE_LIMITS.maxFileCount} entries.`,
    );
  }

  return Array.from(entries.values()).sort((left, right) => comparePaths(left.path, right.path));
};

const headerFor = (entry: ArtifactEntry): Headers => ({
  gid: 0,
  gname: '',
  mode: entry.type === 'directory' ? 0o555 : 0o444,
  mtime: EPOCH,
  name: entry.path,
  type: entry.type,
  uid: 0,
  uname: '',
});

const addEntry = (archive: Pack, entry: ArtifactEntry) =>
  new Promise<void>((resolve, reject) => {
    archive.entry(headerFor(entry), Buffer.from(entry.bytes), (error) => {
      if (error) return reject(error);
      resolve();
    });
  });

const packEntries = (entries: ArtifactEntry[]) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const archive = pack();
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.once('error', reject);
    archive.once('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));

    void (async () => {
      try {
        for (const entry of entries) await addEntry(archive, entry);
        archive.finalize();
      } catch (error) {
        archive.destroy(error instanceof Error ? error : new Error('Failed to create artifact tarball.'));
      }
    })();
  });

const toGzipBytes = async (tarBytes: Uint8Array) => {
  const options = { level: 9, mtime: 0 } as unknown as Parameters<typeof gzipCallback>[1];
  const bytes = new Uint8Array(await gzip(tarBytes, options));
  bytes[9] = 255;
  return bytes;
};

const toArtifactEntry = (header: Headers, type: ArtifactEntryType): ModuleAppArtifactEntry => ({
  gid: header.gid ?? 0,
  gname: header.gname ?? '',
  mode: header.mode ?? 0,
  mtime: header.mtime ? new Date(header.mtime.getTime()) : new Date(0),
  path: header.name,
  type,
  uid: header.uid ?? 0,
  uname: header.uname ?? '',
});

const inspectTarEntries = (bytes: Uint8Array): Promise<ModuleAppArtifactEntry[]> =>
  new Promise((resolve, reject) => {
    const input = Readable.from([Buffer.from(bytes)]);
    const gunzip = createGunzip();
    const archive = extract();
    const entries: ModuleAppArtifactEntry[] = [];
    const types = new Map<string, ArtifactEntryType>();
    const { maxFileCount, maxFileSizeBytes, maxUncompressedBytes } =
      DEFAULT_MODULE_APP_PACKAGE_LIMITS;
    let entryCount = 0;
    let totalBytes = 0;
    let settled = false;

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof ModuleAppPackageSafetyError
          ? error
          : safetyError('module_app_package_archive_invalid', 'Artifact archive could not be decompressed.'),
      );
    };

    const abort = (error: ModuleAppPackageSafetyError) => {
      rejectOnce(error);
      input.destroy();
      gunzip.destroy();
      archive.destroy();
    };

    const abortMalformedArchive = () =>
      abort(safetyError('module_app_package_archive_invalid', 'Artifact archive could not be decompressed.'));

    input.once('error', abortMalformedArchive);
    gunzip.once('error', abortMalformedArchive);
    archive.once('error', abortMalformedArchive);
    archive.once('finish', () => {
      if (settled) return;
      for (const [path, type] of types) {
        if (type !== 'file') continue;
        const segments = path.split('/');
        for (let index = 1; index < segments.length; index += 1) {
          const parent = segments.slice(0, index).join('/');
          if (types.get(parent) === 'file') {
            return rejectOnce(
              safetyError(
                'module_app_package_archive_invalid',
                `Artifact file conflicts with parent directory: ${parent}`,
              ),
            );
          }
        }
      }
      settled = true;
      resolve(entries.sort((left, right) => comparePaths(left.path, right.path)));
    });

    archive.on('entry', (header: Headers, stream, next) => {
      const fail = (error: ModuleAppPackageSafetyError) => {
        stream.destroy();
        abort(error);
      };

      const type = header.type;
      if (type !== 'file' && type !== 'directory') {
        return fail(
          safetyError(
            'module_app_package_archive_invalid',
            `Artifact contains unsupported entry type: ${header.type ?? 'unknown'}`,
          ),
        );
      }
      if (isUnsafePath(header.name)) {
        return fail(safetyError('module_app_package_unsafe_path', `Unsafe package path: ${header.name}`));
      }
      if (types.has(header.name)) {
        return fail(safetyError('module_app_package_duplicate_path', `Duplicate package path: ${header.name}`));
      }
      entryCount += 1;
      if (entryCount > maxFileCount) {
        return fail(
          safetyError(
            'module_app_package_too_many_files',
            `Package contains more than ${maxFileCount} entries.`,
          ),
        );
      }
      const entrySize = header.size;
      if (typeof entrySize !== 'number' || !Number.isSafeInteger(entrySize) || entrySize < 0) {
        return fail(safetyError('module_app_package_archive_invalid', `Invalid artifact size: ${header.name}`));
      }
      const declaredSize = entrySize;
      if (type === 'directory' && declaredSize !== 0) {
        return fail(
          safetyError('module_app_package_archive_invalid', `Directory contains data: ${header.name}`),
        );
      }
      if (type === 'file') {
        if (declaredSize > maxFileSizeBytes) {
          return fail(
            safetyError(
              'module_app_package_file_too_large',
              `Package file exceeds ${maxFileSizeBytes} bytes: ${header.name}`,
            ),
          );
        }
      }

      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.byteLength;
        if (size > declaredSize || (type === 'file' && size > maxFileSizeBytes)) {
          return fail(safetyError('module_app_package_file_too_large', `Package file exceeds ${maxFileSizeBytes} bytes: ${header.name}`));
        }
        if (type === 'file') {
          totalBytes += chunk.byteLength;
          if (totalBytes > maxUncompressedBytes) {
            return fail(
              safetyError(
                'module_app_package_expanded_too_large',
                `Expanded package exceeds ${maxUncompressedBytes} bytes.`,
              ),
            );
          }
        }
      });
      stream.once('error', abortMalformedArchive);
      stream.once('end', () => {
        if (settled) return;
        if (size !== declaredSize) {
          return fail(safetyError('module_app_package_archive_invalid', `Invalid artifact size: ${header.name}`));
        }
        types.set(header.name, type);
        entries.push(toArtifactEntry(header, type));
        next();
      });
      stream.resume();
    });

    input.pipe(gunzip).pipe(archive);
  });

export const buildDeterministicModuleAppArtifact = async (
  input: BuildDeterministicModuleAppArtifactInput,
): Promise<{ bytes: Uint8Array; sha256: string }> => {
  const bytes = await toGzipBytes(await packEntries(createArtifactEntries(input.files)));

  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

export const inspectModuleAppArtifact = async (bytes: Uint8Array): Promise<ModuleAppArtifactEntry[]> => {
  try {
    return await inspectTarEntries(bytes);
  } catch (error) {
    if (error instanceof ModuleAppPackageSafetyError) throw error;
    throw safetyError('module_app_package_archive_invalid', 'Artifact archive could not be decompressed.');
  }
};
