import type { ModuleAppPackageArchiveMetadata, ModuleAppPackageManifest } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  moduleAppEntitlements,
  moduleAppPackages,
  moduleApps,
  moduleAppVersions,
} from '../schemas';
import { ModuleAppModel } from './moduleApp';

const HASH = 'a'.repeat(64);

const lockedSelect = (rows: unknown[]) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({ for: vi.fn().mockResolvedValue(rows) })),
  })),
});

const manifest: ModuleAppPackageManifest = {
  app: {
    actions: [],
    appType: 'standard_app',
    billing: {
      chargeMode: 'free',
      defaultMultiplier: 1,
      externalApiCostCredits: 0,
      failureFixedFeePolicy: 'do_not_charge',
      fixedServiceFeeCredits: 0,
    },
    category: 'business',
    description: 'A package app.',
    displayName: 'Package App',
    icon: 'Package',
    pages: [],
    slug: 'package-app',
    source: 'developer',
    status: 'draft',
    tags: [],
  },
  entitlements: [
    {
      discountPercent: 0,
      freeQuotaCredits: 100,
      installable: true,
      plan: 'pro',
      runnable: true,
      visible: true,
    },
  ],
  manifestVersion: 1,
  packageVersion: '1.0.0',
  runtime: { kind: 'manifest_only', outboundHosts: ['api.example.com'], permissions: [] },
};

const archive: ModuleAppPackageArchiveMetadata = {
  fileName: 'package-app.zip',
  mimeType: 'application/zip',
  sha256: HASH,
  sizeBytes: 1024,
  storageKey: 'module-app-packages/package-app.zip',
};

describe('ModuleAppModel package review lifecycle', () => {
  it('returns bounded admin scan state without storage keys or hashes', async () => {
    const offset = vi.fn().mockResolvedValue([
      {
        packageRow: {
          archive,
          fileManifest: [{ path: 'manifest.json', sha256: HASH, sizeBytes: 512 }],
          id: 'package-1',
          manifestSnapshot: manifest,
          reviewStatus: 'pending_review',
          validationReport: Array.from({ length: 120 }, (_, index) => ({
            code: `issue-${index}`,
            message: 'Issue',
            severity: 'warning' as const,
          })),
        },
        buildFailureCode: null,
        buildStatus: 'queued',
        scanStatus: null,
      },
    ]);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const secondLeftJoin = vi.fn(() => ({ where }));
    const leftJoin = vi.fn(() => ({ leftJoin: secondLeftJoin }));
    const from = vi.fn(() => ({ leftJoin }));
    const db = { select: vi.fn(() => ({ from })) } as any;

    const result = await new ModuleAppModel(db).listAdminPackageSubmissions({ limit: 50 });

    expect(result.items[0]).toMatchObject({
      archive: {
        fileName: 'package-app.zip',
        mimeType: 'application/zip',
        sizeBytes: 1024,
      },
      id: 'package-1',
      buildFailureCode: null,
      buildStatus: 'queued',
      scanStatus: 'pending',
    });
    expect(result.items[0].validationReport).toHaveLength(100);
    expect(JSON.stringify(result.items[0])).not.toContain('module-app-packages/package-app.zip');
    expect(JSON.stringify(result.items[0])).not.toContain(HASH);
  });

  it('creates a pending package submission', async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([{ id: 'package-1', reviewStatus: 'pending_review' }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as any;

    const result = await new ModuleAppModel(db).createPackageSubmission({
      archive,
      fileManifest: [{ path: 'manifest.json', sha256: HASH, sizeBytes: 512 }],
      manifest: { ...manifest, app: { ...manifest.app, source: 'system' } },
      submittedByUserId: 'user-1',
      validationReport: [],
    });

    expect(result).toEqual({ id: 'package-1', reviewStatus: 'pending_review' });
    expect(insert).toHaveBeenCalledWith(moduleAppPackages);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        archive,
        manifestSnapshot: expect.objectContaining({
          app: expect.objectContaining({
            displayName: 'Package App',
            source: 'developer',
          }),
        }),
        reviewStatus: 'pending_review',
        submittedByUserId: 'user-1',
      }),
    );
  });

  it('approves a pending package by upserting the app and linking package metadata', async () => {
    const app = { id: 'app-1', slug: 'package-app' };
    const version = { id: 'version-1', publishedAt: null, version: '1.0.0' };
    const approvedPackage = {
      appId: app.id,
      id: 'package-1',
      reviewStatus: 'approved',
      versionId: version.id,
    };
    const submission = {
      id: 'package-1',
      manifestSnapshot: manifest,
      reviewStatus: 'pending_review',
      submittedByUserId: 'developer-1',
    };

    const insertValuesByTable = new Map<unknown, unknown>();
    const updateValuesByTable = new Map<unknown, unknown>();

    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        insertValuesByTable.set(table, value);

        return {
          returning: vi.fn(async () => {
            if (table === moduleApps) return [app];
            if (table === moduleAppVersions) return [version];
            return [];
          }),
        };
      }),
    }));
    const update = vi.fn((table: unknown) => ({
      set: vi.fn((value: unknown) => {
        updateValuesByTable.set(table, value);

        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [approvedPackage]),
          })),
        };
      }),
    }));
    const tx = {
      delete: vi.fn(() => ({ where: vi.fn() })),
      insert,
      query: {
        moduleAppPackageUploads: {
          findFirst: vi.fn().mockResolvedValue({
            packageId: 'package-1',
            scanStatus: 'clean',
            status: 'submitted',
          }),
        },
        moduleAppVersions: {
          findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(version),
        },
        moduleApps: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      select: vi
        .fn()
        .mockReturnValueOnce(lockedSelect([submission]))
        .mockReturnValueOnce(lockedSelect([{ id: 'publisher-1' }])),
      update,
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) } as any;

    await expect(
      new ModuleAppModel(db).approvePackageSubmissionForAdmin({
        outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
        packageId: 'package-1',
        reviewedByUserId: 'admin-1',
      }),
    ).resolves.toMatchObject({
      appId: app.id,
      package: approvedPackage,
      slug: app.slug,
      versionId: version.id,
    });

    expect(insertValuesByTable.get(moduleApps)).toEqual(
      expect.objectContaining({
        displayName: 'Package App',
        slug: 'package-app',
        source: 'developer',
      }),
    );
    expect(insertValuesByTable.get(moduleAppEntitlements)).toEqual([
      expect.objectContaining({ appId: app.id, plan: 'pro', runnable: true }),
    ]);
    expect(updateValuesByTable.get(moduleAppVersions)).toEqual(
      expect.objectContaining({
        runtimeManifest: expect.objectContaining({
          outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
        }),
      }),
    );
    expect(updateValuesByTable.get(moduleAppPackages)).toEqual(
      expect.objectContaining({
        appId: app.id,
        reviewStatus: 'approved',
        reviewedByUserId: 'admin-1',
        versionId: version.id,
      }),
    );
  });

  it('blocks approval before app mutation when the linked upload is not clean', async () => {
    const submission = {
      id: 'package-1',
      manifestSnapshot: manifest,
      reviewStatus: 'pending_review',
      submittedByUserId: 'developer-1',
    };
    const tx = {
      query: {
        moduleAppPackageUploads: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      select: vi.fn().mockReturnValueOnce(lockedSelect([submission])),
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) } as any;

    await expect(
      new ModuleAppModel(db).approvePackageSubmissionForAdmin({
        outboundHostPolicies: [{ host: 'api.example.com', purpose: 'general' }],
        packageId: 'package-1',
        reviewedByUserId: 'admin-1',
      }),
    ).rejects.toThrow('MODULE_APP_PACKAGE_SCAN_NOT_CLEAN');
  });

  it('rejects a pending package with a reviewer and reason', async () => {
    const rejectedPackage = {
      id: 'package-1',
      rejectionReason: 'Unsafe manifest',
      reviewStatus: 'rejected',
    };
    const set = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => [rejectedPackage]),
      })),
    }));
    const tx = {
      query: {
        moduleAppPackages: {
          findFirst: vi.fn().mockResolvedValue({ id: 'package-1', reviewStatus: 'pending_review' }),
        },
      },
      update: vi.fn(() => ({ set })),
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) } as any;

    await expect(
      new ModuleAppModel(db).rejectPackageSubmissionForAdmin({
        packageId: 'package-1',
        reason: 'Unsafe manifest',
        reviewedByUserId: 'admin-1',
      }),
    ).resolves.toEqual(rejectedPackage);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectionReason: 'Unsafe manifest',
        reviewStatus: 'rejected',
        reviewedByUserId: 'admin-1',
      }),
    );
  });
});
