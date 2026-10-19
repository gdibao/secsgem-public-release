import { createHash } from 'node:crypto';

import {
  type ModuleAppPackageArchiveLimits,
  unzipModuleAppPackage,
  validateModuleAppBuildSource,
} from '@lobechat/module-app-build';
import { type ModuleAppPackageManifest, moduleAppPackageManifestV2Schema } from '@lobechat/types';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

type ManifestV2 = Extract<ModuleAppPackageManifest, { manifestVersion: 2 }>;

const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const manifest = moduleAppPackageManifestV2Schema.parse({
  app: {
    actions: [],
    appType: 'hybrid_app',
    billing: {},
    category: 'business',
    description: 'A reviewed executable package.',
    displayName: 'Executable Package',
    icon: 'Package',
    pages: [],
    slug: 'executable-package',
    tags: [],
  },
  build: { frontend: { output: 'dist', profile: 'node22-static' } },
  entitlements: [],
  manifestVersion: 2,
  packageVersion: '1.0.0',
  runtime: {
    functions: [
      { entry: 'server/index.ts', key: 'main', runtime: 'node22' },
      { entry: 'python/main.py', key: 'python', runtime: 'python312' },
    ],
    permissions: ['data.read'],
  },
}) as ManifestV2;

const validFiles = (overrides: Record<string, Uint8Array> = {}) => ({
  'dist/index.html': strToU8('<main>Executable Package</main>'),
  'module-app.yaml': strToU8(stringify(manifest)),
  'python/main.py': strToU8('def main():\n    return {"ok": True}\n'),
  'server/index.ts': strToU8('export default async () => ({ ok: true });'),
  ...overrides,
});

const createArchive = (files: Record<string, Uint8Array> = validFiles()) =>
  zipSync(files, { level: 9 });

const validate = (bytes: Uint8Array, reviewedManifest: ManifestV2 = manifest) =>
  validateModuleAppBuildSource({
    bytes,
    expectedSourceSha256: sha256(bytes),
    reviewedManifest,
  });

const findSignatures = (bytes: Uint8Array, signature: number) => {
  const offsets: number[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) offsets.push(offset);
  }

  return offsets;
};

const setCentralAttributes = (archive: Uint8Array, externalAttributes: number) => {
  const bytes = archive.slice();
  const offset = findSignatures(bytes, CENTRAL_SIGNATURE)[0];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(offset + 4, 0x0314, true);
  view.setUint32(offset + 38, externalAttributes, true);
  return bytes;
};

const setEntryCentralAttributes = (
  archive: Uint8Array,
  entryName: string,
  externalAttributes: number,
) => {
  const bytes = archive.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const offset = findSignatures(bytes, CENTRAL_SIGNATURE).find((centralOffset) => {
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const name = decoder.decode(
      bytes.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength),
    );
    return name === entryName;
  });

  if (offset === undefined) throw new Error(`ZIP entry not found: ${entryName}`);

  view.setUint16(offset + 4, 0x0314, true);
  view.setUint32(offset + 38, externalAttributes, true);
  return bytes;
};

const setEncrypted = (archive: Uint8Array) => {
  const bytes = archive.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = findSignatures(bytes, LOCAL_SIGNATURE)[0];
  const centralOffset = findSignatures(bytes, CENTRAL_SIGNATURE)[0];
  view.setUint16(localOffset + 6, view.getUint16(localOffset + 6, true) | 1, true);
  view.setUint16(centralOffset + 8, view.getUint16(centralOffset + 8, true) | 1, true);
  return bytes;
};

const renameEntry = (archive: Uint8Array, from: string, to: string) => {
  if (from.length !== to.length) throw new Error('ZIP entry replacements must keep byte length.');

  const bytes = archive.slice();
  const fromBytes = strToU8(from);
  const toBytes = strToU8(to);

  for (let offset = 0; offset <= bytes.byteLength - fromBytes.byteLength; offset += 1) {
    if (fromBytes.every((value, index) => bytes[offset + index] === value)) {
      bytes.set(toBytes, offset);
    }
  }

  return bytes;
};

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe('validateModuleAppBuildSource', () => {
  it('returns normalized files and the reviewed root manifest v2', async () => {
    const bytes = createArchive();

    const validated = await validate(bytes);

    expect(validated.manifest).toEqual(manifest);
    expect(validated.files['dist/index.html']).toBeDefined();
  });

  it('accepts a frontend output declared as an HTML file', async () => {
    const reviewedManifest = moduleAppPackageManifestV2Schema.parse({
      ...manifest,
      build: { frontend: { output: 'public/app.html', profile: 'node22-static' } },
    }) as ManifestV2;
    const bytes = createArchive({
      ...validFiles(),
      'module-app.yaml': strToU8(stringify(reviewedManifest)),
      'public/app.html': strToU8('<main>Direct output</main>'),
    });

    await expect(validate(bytes, reviewedManifest)).resolves.toMatchObject({
      manifest: reviewedManifest,
    });
  });

  it('rejects a source hash mismatch', async () => {
    const bytes = createArchive();

    await expectCode(
      validateModuleAppBuildSource({
        bytes,
        expectedSourceSha256: '0'.repeat(64),
        reviewedManifest: manifest,
      }),
      'MODULE_APP_BUILD_SOURCE_HASH_MISMATCH',
    );
  });

  it('rejects two root manifests and v1-only packages', async () => {
    await expectCode(
      validate(
        createArchive({
          ...validFiles(),
          'manifest.json': strToU8(JSON.stringify({ manifestVersion: 1 })),
        }),
      ),
      'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED',
    );

    await expectCode(
      validate(
        createArchive({
          'dist/index.html': strToU8('<main />'),
          'manifest.json': strToU8(JSON.stringify({ manifestVersion: 1 })),
        }),
      ),
      'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED',
    );
  });

  it('rejects a manifest that differs from the reviewed snapshot', async () => {
    const changedManifest = { ...manifest, packageVersion: '1.0.1' } satisfies ManifestV2;

    await expectCode(
      validate(
        createArchive({
          ...validFiles(),
          'module-app.yaml': strToU8(stringify(changedManifest)),
        }),
      ),
      'MODULE_APP_BUILD_SOURCE_MANIFEST_MISMATCH',
    );
  });

  it.each([
    ['/absolute.txt', 'absolute paths'],
    ['dist\\index.html', 'backslashes'],
    ['dist//index.html', 'empty path segments'],
    ['dist/./index.html', 'dot path segments'],
    ['dist/../secret.txt', 'parent traversal'],
  ])('rejects %s (%s)', async (unsafePath) => {
    await expectCode(
      validate(createArchive({ ...validFiles(), [unsafePath]: strToU8('unsafe') })),
      'MODULE_APP_BUILD_SOURCE_ARCHIVE_REJECTED',
    );
  });

  it('rejects duplicate paths', async () => {
    const archive = createArchive({
      ...validFiles(),
      'same-a.txt': strToU8('a'),
      'same-b.txt': strToU8('b'),
    });

    await expectCode(
      validate(renameEntry(archive, 'same-a.txt', 'same-b.txt')),
      'MODULE_APP_BUILD_SOURCE_ARCHIVE_REJECTED',
    );
  });

  it('rejects symlink and non-regular Unix metadata', async () => {
    const singleFile = createArchive({ 'module-app.yaml': strToU8(stringify(manifest)) });

    await expectCode(
      validate(setCentralAttributes(singleFile, 0xa1ff0000)),
      'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED',
    );
    await expectCode(
      validate(setCentralAttributes(singleFile, 0x11ff0000)),
      'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED',
    );
  });

  it('rejects encrypted entries', async () => {
    const singleFile = createArchive({ 'module-app.yaml': strToU8(stringify(manifest)) });

    await expectCode(validate(setEncrypted(singleFile)), 'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED');
  });

  it.each([
    ['payload.zip', strToU8('PK\u0003\u0004')],
    ['payload.bin', strToU8('PK\u0003\u0004')],
    ['payload.bin', new Uint8Array([0x1f, 0x8b, 0x08])],
    ['payload.bin', strToU8('BZh9')],
    ['payload.bin', new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])],
    ['payload.bin', new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
    ['payload.bin', new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])],
    ['install.ps1', strToU8('Write-Host unsafe')],
    ['binary.bin', new Uint8Array([0x7f, 0x45, 0x4c, 0x46])],
    ['eicar.txt', strToU8('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')],
    ['.env.production', strToU8('API_KEY=do-not-package')],
    ['dist/config.txt', strToU8('-----BEGIN RSA PRIVATE KEY-----\nnot-a-real-key')],
  ])('rejects statically unsafe file %s', async (path, data) => {
    await expectCode(
      validate(createArchive({ ...validFiles(), [path]: data })),
      'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED',
    );
  });

  it('rejects missing frontend output and directories without index.html', async () => {
    const { 'dist/index.html': _frontend, ...withoutFrontend } = validFiles();

    await expectCode(
      validate(createArchive(withoutFrontend)),
      'MODULE_APP_BUILD_SOURCE_FRONTEND_OUTPUT_MISSING',
    );
    await expectCode(
      validate(createArchive({ ...withoutFrontend, 'dist/app.js': strToU8('export {};') })),
      'MODULE_APP_BUILD_SOURCE_FRONTEND_OUTPUT_MISSING',
    );
  });

  it('rejects missing Node and Python function entries', async () => {
    const { 'server/index.ts': _nodeEntry, ...withoutNode } = validFiles();
    await expectCode(
      validate(createArchive(withoutNode)),
      'MODULE_APP_BUILD_SOURCE_FUNCTION_OUTPUT_MISSING',
    );

    const { 'python/main.py': _pythonEntry, ...withoutPython } = validFiles();
    await expectCode(
      validate(createArchive(withoutPython)),
      'MODULE_APP_BUILD_SOURCE_FUNCTION_OUTPUT_MISSING',
    );
  });

  it('requires declared frontend HTML and function entries to be regular files', async () => {
    await expectCode(
      validate(setEntryCentralAttributes(createArchive(), 'dist/index.html', 0x41ff0000)),
      'MODULE_APP_BUILD_SOURCE_FRONTEND_OUTPUT_MISSING',
    );

    await expectCode(
      validate(setEntryCentralAttributes(createArchive(), 'server/index.ts', 0x41ff0000)),
      'MODULE_APP_BUILD_SOURCE_FUNCTION_OUTPUT_MISSING',
    );
  });

  it('enforces the 256 KiB manifest limit at the byte boundary', async () => {
    const maxManifestBytes = 256 * 1024;
    const baseManifest = stringify(manifest);
    const manifestAtLimit = `${baseManifest}\n#${'x'.repeat(maxManifestBytes - strToU8(baseManifest).byteLength - 2)}`;
    const manifestOverLimit = `${manifestAtLimit}x`;
    const files = validFiles();

    await expect(
      validate(zipSync({ ...files, 'module-app.yaml': strToU8(manifestAtLimit) }, { level: 0 })),
    ).resolves.toMatchObject({ manifest });
    await expectCode(
      validate(zipSync({ ...files, 'module-app.yaml': strToU8(manifestOverLimit) }, { level: 0 })),
      'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED',
    );
  });
});

describe('unzipModuleAppPackage limits', () => {
  const expectArchiveRejection = async (
    files: Record<string, Uint8Array>,
    limits: ModuleAppPackageArchiveLimits,
    code: string,
  ) => {
    const bytes = createArchive(files);
    await expect(unzipModuleAppPackage(bytes, limits)).rejects.toMatchObject({
      code,
    });
  };

  it('rejects excessive compression ratio', async () => {
    await expectArchiveRejection(
      { 'large.txt': strToU8('x'.repeat(4096)) },
      {
        maxCompressionRatio: 2,
      },
      'module_app_package_compression_ratio_exceeded',
    );
  });

  it('rejects excessive file count', async () => {
    await expectArchiveRejection(
      { 'a.txt': strToU8('a'), 'b.txt': strToU8('b') },
      { maxFileCount: 1 },
      'module_app_package_too_many_files',
    );
  });

  it('rejects excessive expanded size', async () => {
    await expectArchiveRejection(
      { 'large.txt': strToU8('x'.repeat(2048)) },
      {
        maxUncompressedBytes: 1024,
      },
      'module_app_package_expanded_too_large',
    );
  });

  it('enforces the 25 MiB per-file limit at the byte boundary', async () => {
    const maxFileSizeBytes = 25 * 1024 * 1024;

    await expect(
      unzipModuleAppPackage(
        zipSync({ 'at-limit.bin': new Uint8Array(maxFileSizeBytes) }, { level: 0 }),
      ),
    ).resolves.toMatchObject({ 'at-limit.bin': expect.any(Uint8Array) });
    await expect(
      unzipModuleAppPackage(
        zipSync({ 'over-limit.bin': new Uint8Array(maxFileSizeBytes + 1) }, { level: 0 }),
      ),
    ).rejects.toMatchObject({ code: 'module_app_package_file_too_large' });
  });
});
