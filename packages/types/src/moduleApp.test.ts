import { describe, expect, it } from 'vitest';

import {
  EMPTY_MODULE_APP_GRANT_SNAPSHOT,
  getModuleAppDeclaredSecretKeys,
  getModuleAppGrantDiff,
  MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE,
  MODULE_APP_PACKAGE_MAX_DAILY_UPLOADS,
  MODULE_APP_PACKAGE_MAX_OPEN_UPLOADS,
  MODULE_APP_PACKAGE_MAX_RETAINED_BYTES,
  MODULE_APP_PACKAGE_MAX_SCAN_ISSUES,
  MODULE_APP_PACKAGE_UPLOAD_TTL_MS,
  moduleAppActionConfigSchema,
  moduleAppAdminUpsertSchema,
  moduleAppBillingConfigSchema,
  moduleAppInputSchema,
  moduleAppInstallationListInputSchema,
  moduleAppInstallationReadinessSchema,
  moduleAppMarketplaceListInputSchema,
  moduleAppPackageArchiveMetadataSchema,
  moduleAppPackageManifestSchema,
  moduleAppPackageManifestV2Schema,
  moduleAppPackageScanStatusSchema,
  moduleAppPackageSubmissionListInputSchema,
  moduleAppPackageSubmitSchema,
  moduleAppPackageUploadedSubmitSchema,
  moduleAppPackageUploadRequestSchema,
  moduleAppPackageUploadStatusSchema,
  moduleAppPageSchema,
  moduleAppRecordInputSchema,
  moduleAppRuntimeTypeSchema,
  moduleAppSecretKeySchema,
  moduleAppSourceSchema,
} from './moduleApp';

describe('module app type contracts', () => {
  it('rejects unsafe or over-precise module multipliers', () => {
    expect(() => moduleAppBillingConfigSchema.parse({ defaultMultiplier: 101 })).toThrow();
    expect(() => moduleAppBillingConfigSchema.parse({ defaultMultiplier: 1.00001 })).toThrow();
    expect(() =>
      moduleAppActionConfigSchema.parse({
        id: 'generate',
        moduleMultiplier: 101,
        name: 'Generate',
        runtimeType: 'content_generation',
      }),
    ).toThrow();
  });

  it('accepts standard app pages and record actions', () => {
    expect(
      moduleAppPageSchema.parse({
        key: 'records',
        routePath: '/records',
        title: 'Records',
        type: 'list',
      }),
    ).toMatchObject({ key: 'records', type: 'list' });

    expect(
      moduleAppActionConfigSchema.parse({
        id: 'create_record',
        inputSchema: { fields: [{ key: 'title', label: 'Title', required: true, type: 'text' }] },
        name: 'Create record',
        runtimeType: 'record_create',
      }),
    ).toMatchObject({ id: 'create_record', runtimeType: 'record_create' });
  });

  it('accepts explicit bounded options for schema-driven select fields', () => {
    expect(
      moduleAppInputSchema.parse({
        fields: [
          {
            key: 'priority',
            label: 'Priority',
            options: [
              { label: 'High', value: 'high' },
              { label: 'Low', value: 'low' },
            ],
            type: 'select',
          },
        ],
      }),
    ).toMatchObject({
      fields: [
        {
          options: [
            { label: 'High', value: 'high' },
            { label: 'Low', value: 'low' },
          ],
        },
      ],
    });
  });

  it('keeps unsafe P1 runtimes out of the runtime enum', () => {
    expect(() => moduleAppRuntimeTypeSchema.parse('external_js')).toThrow();
    expect(() => moduleAppRuntimeTypeSchema.parse('iframe')).toThrow();
    expect(() => moduleAppRuntimeTypeSchema.parse('mcp')).toThrow();
    expect(() => moduleAppRuntimeTypeSchema.parse('skill')).toThrow();
  });

  it('accepts executable actions only with a reviewed function key', () => {
    expect(
      moduleAppActionConfigSchema.parse({
        id: 'search',
        name: 'Search',
        runtimeConfig: { functionKey: 'search_jobs' },
        runtimeType: 'executable_action',
      }),
    ).toMatchObject({ runtimeType: 'executable_action' });
    expect(() =>
      moduleAppActionConfigSchema.parse({
        id: 'search',
        name: 'Search',
        runtimeType: 'executable_action',
      }),
    ).toThrow();
  });

  it('normalizes bounded installation secret declarations', () => {
    expect(
      getModuleAppDeclaredSecretKeys([
        { runtimeConfig: { secretKeys: ['CRM_TOKEN', 'API_KEY', 'CRM_TOKEN'] } },
        { runtimeConfig: { secretKeys: ['API_KEY', 'SEARCH_TOKEN'] } },
      ]),
    ).toEqual(['API_KEY', 'CRM_TOKEN', 'SEARCH_TOKEN']);
    expect(moduleAppSecretKeySchema.safeParse('crm_token').success).toBe(false);
    expect(
      moduleAppActionConfigSchema.safeParse({
        id: 'sync_crm',
        name: 'Sync CRM',
        runtimeConfig: { secretKeys: ['invalid-key'] },
        runtimeType: 'api_action',
      }).success,
    ).toBe(false);
    expect(() =>
      getModuleAppDeclaredSecretKeys([{ runtimeConfig: { secretKeys: ['invalid-key'] } }]),
    ).toThrow('MODULE_APP_SECRET_KEYS_INVALID');
    expect(() =>
      getModuleAppDeclaredSecretKeys(
        Array.from({ length: 5 }, (_, actionIndex) => ({
          runtimeConfig: {
            secretKeys: Array.from(
              { length: 20 },
              (_, keyIndex) => `SECRET_${actionIndex}_${keyIndex}`,
            ),
          },
        })),
      ),
    ).toThrow('MODULE_APP_SECRET_KEYS_INVALID');
  });

  it('defaults billing to free CRUD semantics', () => {
    expect(moduleAppBillingConfigSchema.parse({})).toEqual({
      chargeMode: 'free',
      defaultMultiplier: 1,
      externalApiCostCredits: 0,
      failureFixedFeePolicy: 'do_not_charge',
      fixedServiceFeeCredits: 0,
    });
  });

  it('parses admin app definitions with multiple pages and actions', () => {
    const input = moduleAppAdminUpsertSchema.parse({
      appType: 'standard_app',
      billing: {},
      category: 'Productivity',
      description: 'Simple saved records app',
      displayName: 'Record Desk',
      icon: 'Notebook',
      pages: [
        { key: 'overview', routePath: '/', title: 'Overview', type: 'overview' },
        { key: 'records', routePath: '/records', title: 'Records', type: 'list' },
      ],
      actions: [
        {
          id: 'create_record',
          inputSchema: { fields: [] },
          name: 'Create',
          runtimeType: 'record_create',
        },
      ],
      slug: 'record-desk',
      status: 'draft',
      tags: ['records'],
    });

    expect(input.pages).toHaveLength(2);
    expect(input.actions).toHaveLength(1);
  });

  it('defaults admin-created apps to admin source and accepts reviewed sources', () => {
    expect(moduleAppSourceSchema.options).toEqual(['system', 'admin', 'user', 'developer']);

    expect(
      moduleAppAdminUpsertSchema.parse({
        actions: [],
        appType: 'standard_app',
        billing: {},
        category: 'office',
        description: 'Admin-created module.',
        displayName: 'Admin Module',
        icon: 'Blocks',
        pages: [],
        slug: 'admin-module',
        status: 'draft',
        tags: [],
      }).source,
    ).toBe('admin');

    expect(
      moduleAppAdminUpsertSchema.parse({
        actions: [],
        appType: 'standard_app',
        billing: {},
        category: 'developer',
        description: 'Developer submitted module.',
        displayName: 'Developer Module',
        icon: 'Package',
        pages: [],
        slug: 'developer-module',
        source: 'developer',
        status: 'draft',
        tags: [],
      }).source,
    ).toBe('developer');

    expect(() =>
      moduleAppAdminUpsertSchema.parse({
        actions: [],
        appType: 'standard_app',
        billing: {},
        category: 'bad',
        description: 'Invalid source.',
        displayName: 'Invalid Source',
        icon: 'Package',
        pages: [],
        slug: 'invalid-source',
        source: 'plugin',
        status: 'draft',
        tags: [],
      }),
    ).toThrow();
  });

  it('normalizes optional list and record inputs', () => {
    expect(moduleAppMarketplaceListInputSchema.parse({ query: '  desk  ' })).toEqual({
      query: 'desk',
    });

    expect(
      moduleAppRecordInputSchema.parse({
        appId: '00000000-0000-4000-8000-000000000001',
        collectionKey: 'records',
        data: { title: 'A' },
        scopeType: 'personal',
      }),
    ).toMatchObject({ collectionKey: 'records', scopeType: 'personal' });
  });

  it('bounds and normalizes installed app list pagination', () => {
    expect(moduleAppInstallationListInputSchema.parse({ query: '  record desk  ' })).toEqual({
      cursor: 0,
      limit: 20,
      query: 'record desk',
    });
    expect(moduleAppInstallationListInputSchema.parse({ cursor: 20, limit: 10 })).toEqual({
      cursor: 20,
      limit: 10,
    });
    expect(() => moduleAppInstallationListInputSchema.parse({ cursor: -1 })).toThrow();
    expect(() => moduleAppInstallationListInputSchema.parse({ limit: 51 })).toThrow();
    expect(() => moduleAppInstallationListInputSchema.parse({ query: 'x'.repeat(81) })).toThrow();
  });

  it('validates installation configuration and runtime readiness states', () => {
    expect(
      moduleAppInstallationReadinessSchema.parse({
        configuration: 'required',
        missingSecretCount: 2,
        runtime: 'ready',
      }),
    ).toEqual({ configuration: 'required', missingSecretCount: 2, runtime: 'ready' });
    expect(() =>
      moduleAppInstallationReadinessSchema.parse({
        configuration: 'ready',
        missingSecretCount: -1,
        runtime: 'unavailable',
      }),
    ).toThrow();
  });

  it('parses package manifests with app metadata, billing, pages, actions, and entitlements', () => {
    const manifest = moduleAppPackageManifestSchema.parse({
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
        description: 'A classified information module package.',
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
    });

    expect(manifest.app.displayName).toBe('Classified Info');
    expect(manifest.entitlements[0]).toMatchObject({
      installable: true,
      plan: 'pro',
      runnable: true,
      visible: true,
    });
    expect(manifest.runtime.kind).toBe('frontend_static');
  });

  it('rejects server container runtime declarations in package manifests for P1', () => {
    expect(() =>
      moduleAppPackageManifestSchema.parse({
        app: {
          actions: [],
          appType: 'hybrid_app',
          billing: {},
          category: 'enterprise',
          description: 'Server container module.',
          displayName: 'Server Module',
          icon: 'Server',
          pages: [],
          slug: 'server-module',
          tags: [],
        },
        manifestVersion: 1,
        packageVersion: '1.0.0',
        runtime: {
          entry: 'server/index.js',
          kind: 'server_container',
          permissions: ['network.external'],
        },
      }),
    ).toThrow();
  });

  it('parses executable manifest v2 with fixed platform build profiles', () => {
    const manifest = moduleAppPackageManifestV2Schema.parse({
      app: {
        actions: [],
        appType: 'hybrid_app',
        billing: {},
        category: 'business',
        description: 'A reviewed executable module.',
        displayName: 'Executable Module',
        icon: 'Package',
        pages: [],
        slug: 'executable-module',
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
    });

    expect(manifest.build.frontend).toEqual({ output: 'dist', profile: 'node22-static' });
    expect(moduleAppPackageManifestSchema.parse(manifest).manifestVersion).toBe(2);
    expect(() =>
      moduleAppPackageManifestV2Schema.parse({
        ...manifest,
        build: { image: 'developer/custom:latest' },
      }),
    ).toThrow();
  });

  it('parses submitted package archive metadata', () => {
    const input = moduleAppPackageSubmitSchema.parse({
      archive: {
        fileName: 'classified-info.zip',
        mimeType: 'application/zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
        storageKey: 'module-app-packages/user-1/classified-info.zip',
      },
      fileManifest: [{ path: 'manifest.json', sizeBytes: 512 }],
      manifest: {
        app: {
          actions: [],
          appType: 'standard_app',
          billing: {},
          category: 'local-services',
          description: 'A classified information module package.',
          displayName: 'Classified Info',
          icon: 'Newspaper',
          pages: [],
          slug: 'classified-info',
          tags: [],
        },
        manifestVersion: 1,
        packageVersion: '1.0.0',
        runtime: { kind: 'manifest_only', permissions: [] },
      },
    });

    expect(moduleAppPackageArchiveMetadataSchema.parse(input.archive)).toMatchObject({
      fileName: 'classified-info.zip',
      sizeBytes: 1024,
    });
    expect(input.fileManifest).toEqual([{ path: 'manifest.json', sizeBytes: 512 }]);
  });

  it('accepts a bounded ZIP upload request and uploaded package reference', () => {
    expect(
      moduleAppPackageUploadRequestSchema.parse({
        fileName: 'classified-info.zip',
        mimeType: 'application/zip',
        sizeBytes: 1024,
      }),
    ).toEqual({
      fileName: 'classified-info.zip',
      mimeType: 'application/zip',
      sizeBytes: 1024,
    });

    expect(
      moduleAppPackageUploadedSubmitSchema.parse({
        fileName: 'classified-info.zip',
        storageKey: 'module-app-packages/user-scope/package.zip',
        uploadId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      fileName: 'classified-info.zip',
      storageKey: 'module-app-packages/user-scope/package.zip',
      uploadId: '00000000-0000-4000-8000-000000000001',
    });

    expect(
      moduleAppPackageUploadedSubmitSchema.safeParse({
        fileName: 'classified-info.zip',
        storageKey: 'module-app-packages/user-scope/package.zip',
      }).success,
    ).toBe(false);

    expect(() =>
      moduleAppPackageUploadRequestSchema.parse({
        fileName: 'classified-info.tar.gz',
        mimeType: 'application/gzip',
        sizeBytes: 1024,
      }),
    ).toThrow();
  });

  it('defines bounded upload lifecycle and scan contracts', () => {
    expect(moduleAppPackageUploadStatusSchema.options).toEqual([
      'issued',
      'processing',
      'submitted',
      'rejected',
      'failed',
      'cleaning',
      'expired',
    ]);
    expect(moduleAppPackageScanStatusSchema.options).toEqual([
      'pending',
      'clean',
      'blocked',
      'error',
    ]);
    expect(MODULE_APP_PACKAGE_MAX_OPEN_UPLOADS).toBe(3);
    expect(MODULE_APP_PACKAGE_MAX_DAILY_UPLOADS).toBe(20);
    expect(MODULE_APP_PACKAGE_MAX_RETAINED_BYTES).toBe(500 * 1024 * 1024);
    expect(MODULE_APP_PACKAGE_UPLOAD_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE).toBe(100);
    expect(MODULE_APP_PACKAGE_MAX_SCAN_ISSUES).toBe(100);
  });

  it('bounds user package submission list pagination and status filters', () => {
    expect(moduleAppPackageSubmissionListInputSchema.parse({})).toEqual({
      cursor: 0,
      limit: 20,
    });

    expect(
      moduleAppPackageSubmissionListInputSchema.parse({
        cursor: 20,
        limit: 10,
        reviewStatus: 'rejected',
      }),
    ).toEqual({ cursor: 20, limit: 10, reviewStatus: 'rejected' });

    expect(() =>
      moduleAppPackageSubmissionListInputSchema.parse({ cursor: -1, limit: 51 }),
    ).toThrow();
  });

  it('reports only newly requested installation grants', () => {
    const diff = getModuleAppGrantDiff(
      { ...EMPTY_MODULE_APP_GRANT_SNAPSHOT, permissions: ['records.read'] },
      {
        ...EMPTY_MODULE_APP_GRANT_SNAPSHOT,
        outboundHosts: ['api.example.com'],
        permissions: ['records.read', 'records.write'],
        secretKeys: ['API_KEY'],
      },
    );

    expect(diff).toEqual({
      added: {
        ...EMPTY_MODULE_APP_GRANT_SNAPSHOT,
        outboundHosts: ['api.example.com'],
        permissions: ['records.write'],
        secretKeys: ['API_KEY'],
      },
      hasExpansion: true,
    });
  });
});
