import { describe, expect, it } from 'vitest';

import {
  normalizeModuleAppPackageManifest,
  validateModuleAppPackageFiles,
  validateModuleAppPackageSubmission,
} from './packageManifest';

const validManifest = {
  app: {
    actions: [
      {
        id: 'create_listing',
        inputSchema: { fields: [] },
        name: 'Create listing',
        runtimeType: 'record_create',
      },
    ],
    appType: 'standard_app',
    billing: {
      chargeMode: 'fixed',
      defaultMultiplier: 1.35,
      externalApiCostCredits: 0,
      failureFixedFeePolicy: 'do_not_charge',
      fixedServiceFeeCredits: 20,
    },
    category: 'local-services',
    description: 'A classified information module.',
    displayName: 'Classified Info',
    icon: 'Newspaper',
    pages: [{ key: 'listings', routePath: '/listings', title: 'Listings', type: 'list' }],
    slug: 'classified-info',
    tags: ['classified'],
  },
  entitlements: [
    {
      installable: true,
      plan: 'pro',
      runnable: true,
      visible: true,
    },
  ],
  manifestVersion: 1,
  packageVersion: '1.0.0',
  runtime: {
    entry: 'app/index.html',
    kind: 'frontend_static',
    permissions: ['storage.records', 'billing.charge'],
  },
} as const;

describe('module app package manifest helpers', () => {
  it('accepts a package file manifest with a root manifest.json', () => {
    const result = validateModuleAppPackageFiles([
      { path: 'manifest.json', sizeBytes: 512 },
      { path: 'app/index.html', sizeBytes: 1024 },
    ]);

    expect(result).toEqual({ issues: [], ok: true });
  });

  it('accepts exactly one executable module-app.yaml manifest', () => {
    expect(
      validateModuleAppPackageFiles([
        { path: 'module-app.yaml', sizeBytes: 512 },
        { path: 'src/index.ts', sizeBytes: 1024 },
      ]),
    ).toEqual({ issues: [], ok: true });

    const both = validateModuleAppPackageFiles([
      { path: 'manifest.json', sizeBytes: 512 },
      { path: 'module-app.yaml', sizeBytes: 512 },
    ]);
    expect(both.ok).toBe(false);
    expect(both.issues).toContainEqual(
      expect.objectContaining({ code: 'module_app_package_manifest_conflict' }),
    );
  });

  it('rejects packages missing manifest.json', () => {
    const result = validateModuleAppPackageFiles([{ path: 'app/index.html', sizeBytes: 1024 }]);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'module_app_package_manifest_missing' }),
    );
  });

  it('rejects path traversal and absolute paths in package file lists', () => {
    const result = validateModuleAppPackageFiles([
      { path: 'manifest.json', sizeBytes: 512 },
      { path: '../secret.env', sizeBytes: 10 },
      { path: '/etc/passwd', sizeBytes: 10 },
      { path: 'app\\..\\secret.env', sizeBytes: 10 },
      { path: 'C:\\Windows\\win.ini', sizeBytes: 10 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'module_app_package_unsafe_path', path: '../secret.env' }),
        expect.objectContaining({ code: 'module_app_package_unsafe_path', path: '/etc/passwd' }),
        expect.objectContaining({
          code: 'module_app_package_unsafe_path',
          path: 'app\\..\\secret.env',
        }),
        expect.objectContaining({
          code: 'module_app_package_unsafe_path',
          path: 'C:\\Windows\\win.ini',
        }),
      ]),
    );
  });

  it('rejects submitted archives over the configured package size', () => {
    const result = validateModuleAppPackageSubmission(
      {
        archive: {
          fileName: 'classified-info.zip',
          mimeType: 'application/zip',
          sha256: 'a'.repeat(64),
          sizeBytes: 1024,
          storageKey: 'module-app-packages/user-1/classified-info.zip',
        },
        fileManifest: [{ path: 'manifest.json', sizeBytes: 512 }],
        manifest: validManifest,
      },
      { maxPackageSizeBytes: 512 },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'module_app_package_archive_too_large' }),
    );
  });

  it('normalizes package manifests into existing admin upsert payloads', () => {
    const normalized = normalizeModuleAppPackageManifest(validManifest);

    expect(normalized).toMatchObject({
      app: {
        appType: 'standard_app',
        displayName: 'Classified Info',
        slug: 'classified-info',
        status: 'draft',
      },
      entitlements: [{ plan: 'pro', visible: true }],
      packageVersion: '1.0.0',
      runtime: { kind: 'frontend_static' },
    });
  });
});
