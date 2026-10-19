import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { parseModuleAppPackageArchive } from './archive';

const validManifest = {
  app: {
    actions: [],
    appType: 'standard_app',
    billing: {},
    category: 'business',
    description: 'A package app.',
    displayName: 'Package App',
    icon: 'Package',
    pages: [],
    slug: 'package-app',
    tags: [],
  },
  entitlements: [],
  manifestVersion: 1,
  packageVersion: '1.0.0',
  runtime: { kind: 'manifest_only', permissions: [] },
} as const;

const createArchive = (files: Record<string, Uint8Array>) => zipSync(files);

const validManifestV2 = {
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
    functions: [{ entry: 'server/index.ts', key: 'main', runtime: 'node22' }],
    permissions: ['data.read'],
  },
} as const;

describe('parseModuleAppPackageArchive', () => {
  it('derives manifest, file inventory, size, and hashes from uploaded ZIP bytes', async () => {
    const bytes = createArchive({
      'app/index.html': strToU8('<main>Package App</main>'),
      'manifest.json': strToU8(JSON.stringify(validManifest)),
    });

    const result = await parseModuleAppPackageArchive({
      bytes,
      fileName: 'package-app.zip',
      mimeType: 'application/zip',
      storageKey: 'module-app-packages/user-scope/package.zip',
    });

    expect(result.archive).toMatchObject({
      fileName: 'package-app.zip',
      sizeBytes: bytes.byteLength,
      storageKey: 'module-app-packages/user-scope/package.zip',
    });
    expect(result.archive.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fileManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'manifest.json', sha256: expect.any(String) }),
        expect.objectContaining({ path: 'app/index.html', sha256: expect.any(String) }),
      ]),
    );
    expect(result.manifest.app.slug).toBe('package-app');
  });

  it('rejects unsafe paths before accepting package contents', async () => {
    const bytes = createArchive({
      '../secret.txt': strToU8('secret'),
      'manifest.json': strToU8(JSON.stringify(validManifest)),
    });

    await expect(
      parseModuleAppPackageArchive({
        bytes,
        fileName: 'unsafe.zip',
        mimeType: 'application/zip',
        storageKey: 'module-app-packages/user-scope/unsafe.zip',
      }),
    ).rejects.toMatchObject({
      code: 'module_app_package_unsafe_path',
    });
  });

  it('rejects archives whose expanded contents exceed the configured limit', async () => {
    const bytes = createArchive({
      'app/data.txt': strToU8('x'.repeat(2048)),
      'manifest.json': strToU8(JSON.stringify(validManifest)),
    });

    await expect(
      parseModuleAppPackageArchive(
        {
          bytes,
          fileName: 'large.zip',
          mimeType: 'application/zip',
          storageKey: 'module-app-packages/user-scope/large.zip',
        },
        { maxUncompressedBytes: 1024 },
      ),
    ).rejects.toMatchObject({
      code: 'module_app_package_expanded_too_large',
    });
  });

  it('rejects archives without a root manifest.json', async () => {
    const bytes = createArchive({ 'app/index.html': strToU8('<main />') });

    await expect(
      parseModuleAppPackageArchive({
        bytes,
        fileName: 'missing-manifest.zip',
        mimeType: 'application/zip',
        storageKey: 'module-app-packages/user-scope/missing-manifest.zip',
      }),
    ).rejects.toMatchObject({
      code: 'module_app_package_manifest_missing',
    });
  });

  it('rejects statically unsafe package contents with a bounded scan report', async () => {
    const bytes = createArchive({
      'install.ps1': strToU8('Write-Host unsafe'),
      'manifest.json': strToU8(JSON.stringify(validManifest)),
    });

    await expect(
      parseModuleAppPackageArchive({
        bytes,
        fileName: 'unsafe-script.zip',
        mimeType: 'application/zip',
        storageKey: 'module-app-packages/user-scope/unsafe-script.zip',
      }),
    ).rejects.toMatchObject({
      code: 'module_app_package_forbidden_extension',
      issues: [
        expect.objectContaining({
          code: 'module_app_package_forbidden_extension',
          path: 'install.ps1',
        }),
      ],
    });
  });

  it('parses a root module-app.yaml executable manifest', async () => {
    const bytes = createArchive({
      'module-app.yaml': strToU8(stringify(validManifestV2)),
      'server/index.ts': strToU8('export default async () => ({ ok: true });'),
    });

    const result = await parseModuleAppPackageArchive({
      bytes,
      fileName: 'executable-package.zip',
      mimeType: 'application/zip',
      storageKey: 'module-app-packages/user-scope/executable-package.zip',
    });

    expect(result.manifest).toMatchObject({
      manifestVersion: 2,
      packageVersion: '1.0.0',
    });
    expect(result.fileManifest).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'module-app.yaml' })]),
    );
  });

  it('keeps server ingestion independent from worker-only declared output checks', async () => {
    const bytes = createArchive({
      'module-app.yaml': strToU8(stringify(validManifestV2)),
    });

    const result = await parseModuleAppPackageArchive({
      bytes,
      fileName: 'review-package.zip',
      mimeType: 'application/zip',
      storageKey: 'module-app-packages/user-scope/review-package.zip',
    });

    expect(result.manifest).toMatchObject({ manifestVersion: 2 });
    expect(result.fileManifest).toEqual([expect.objectContaining({ path: 'module-app.yaml' })]);
  });

  it('rejects packages that contain both manifest formats', async () => {
    const bytes = createArchive({
      'manifest.json': strToU8(JSON.stringify(validManifest)),
      'module-app.yaml': strToU8(stringify(validManifestV2)),
    });

    await expect(
      parseModuleAppPackageArchive({
        bytes,
        fileName: 'conflicting-package.zip',
        mimeType: 'application/zip',
        storageKey: 'module-app-packages/user-scope/conflicting-package.zip',
      }),
    ).rejects.toMatchObject({ code: 'module_app_package_manifest_conflict' });
  });
});
