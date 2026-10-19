import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModuleAppPackageArchiveError } from './archive';
import { ModuleAppPackageIngestionService } from './ingestion';

const USER_ID = 'user-1';
const UPLOAD_ID = '00000000-0000-4000-8000-000000000010';
const STORAGE_KEY =
  'module-app-packages/c6c289e49e9c05b2145860387b73bcb1/00000000-0000-4000-8000-000000000011.zip';
const EXPIRES_AT = new Date('2026-07-11T02:00:00.000Z');

const parsedSubmission = {
  archive: {
    fileName: 'package.zip',
    mimeType: 'application/zip' as const,
    sha256: 'a'.repeat(64),
    sizeBytes: 64,
    storageKey: STORAGE_KEY,
  },
  fileManifest: [{ path: 'manifest.json', sha256: 'b'.repeat(64), sizeBytes: 32 }],
  manifest: {
    app: {
      actions: [],
      appType: 'standard_app' as const,
      billing: {},
      category: 'business',
      description: 'Package ingestion app.',
      displayName: 'Package Ingestion',
      icon: 'Package',
      pages: [],
      slug: 'package-ingestion',
      source: 'developer' as const,
      status: 'draft' as const,
      tags: [],
    },
    entitlements: [],
    manifestVersion: 1 as const,
    packageVersion: '1.0.0',
    runtime: { kind: 'manifest_only' as const, permissions: [] },
  },
};

const createMocks = () => {
  const model = {
    claimSession: vi.fn().mockResolvedValue({
      declaredSizeBytes: 64,
      fileName: 'package.zip',
      id: UPLOAD_ID,
      storageKey: STORAGE_KEY,
    }),
    completeSubmission: vi
      .fn()
      .mockResolvedValue({ id: 'package-1', reviewStatus: 'pending_review' }),
    createSession: vi.fn().mockResolvedValue({
      expiresAt: EXPIRES_AT,
      id: UPLOAD_ID,
      storageKey: STORAGE_KEY,
    }),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markRejected: vi.fn().mockResolvedValue(undefined),
    markStorageReleased: vi.fn().mockResolvedValue(undefined),
    recordActualSize: vi.fn().mockResolvedValue({ actualSizeBytes: 64 }),
  };
  const storage = {
    createPreSignedUpload: vi.fn().mockResolvedValue({
      headers: { 'x-amz-acl': 'private' },
      url: 'https://uploads.example.com/package.zip',
    }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array(64)),
    getFileMetadata: vi.fn().mockResolvedValue({
      contentLength: 64,
      contentType: 'application/zip',
    }),
  };
  const parseArchive = vi.fn().mockResolvedValue(parsedSubmission);

  return { model, parseArchive, storage };
};

const issueInput = {
  fileName: 'package.zip',
  mimeType: 'application/zip' as const,
  sizeBytes: 64,
};

const submitInput = {
  fileName: 'package.zip',
  storageKey: STORAGE_KEY,
  uploadId: UPLOAD_ID,
};

describe('ModuleAppPackageIngestionService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a durable session before signing and returns its identity', async () => {
    const { model, parseArchive, storage } = createMocks();
    const service = new ModuleAppPackageIngestionService({ model: model as any, parseArchive, storage });

    await expect(service.issueUpload({ input: issueInput, userId: USER_ID })).resolves.toEqual({
      expiresAt: EXPIRES_AT,
      headers: { 'x-amz-acl': 'private' },
      storageKey: STORAGE_KEY,
      uploadId: UPLOAD_ID,
      uploadUrl: 'https://uploads.example.com/package.zip',
    });

    expect(model.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ declaredSizeBytes: 64, userId: USER_ID }),
    );
    expect(model.createSession.mock.invocationCallOrder[0]).toBeLessThan(
      storage.createPreSignedUpload.mock.invocationCallOrder[0],
    );
    expect(storage.createPreSignedUpload).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('releases a session without touching storage when signing fails', async () => {
    const { model, parseArchive, storage } = createMocks();
    storage.createPreSignedUpload.mockRejectedValueOnce(new Error('provider details'));
    const service = new ModuleAppPackageIngestionService({ model: model as any, parseArchive, storage });

    await expect(service.issueUpload({ input: issueInput, userId: USER_ID })).rejects.toThrow(
      'module_app_package_upload_signing_failed',
    );

    expect(model.markFailed).toHaveBeenCalledWith({
      failureCode: 'module_app_package_upload_signing_failed',
      uploadId: UPLOAD_ID,
    });
    expect(model.markStorageReleased).toHaveBeenCalledWith({ status: 'failed', uploadId: UPLOAD_ID });
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('verifies metadata, parses bytes, and completes a clean submission', async () => {
    const { model, parseArchive, storage } = createMocks();
    const service = new ModuleAppPackageIngestionService({ model: model as any, parseArchive, storage });

    await expect(service.submitUpload({ input: submitInput, userId: USER_ID })).resolves.toEqual({
      id: 'package-1',
      reviewStatus: 'pending_review',
    });

    expect(model.claimSession).toHaveBeenCalledWith({ ...submitInput, userId: USER_ID });
    expect(model.recordActualSize).toHaveBeenCalledWith({ actualSizeBytes: 64, uploadId: UPLOAD_ID });
    expect(parseArchive).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'package.zip', storageKey: STORAGE_KEY }),
    );
    expect(model.completeSubmission).toHaveBeenCalledWith({
      submission: parsedSubmission,
      uploadId: UPLOAD_ID,
      userId: USER_ID,
      validationReport: [],
    });
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('persists scanner issues, blocks the session, and releases unsafe objects', async () => {
    const { model, parseArchive, storage } = createMocks();
    const issues = [
      {
        code: 'module_app_package_forbidden_extension',
        message: 'Unsafe file.',
        path: 'install.ps1',
        severity: 'error' as const,
      },
    ];
    parseArchive.mockRejectedValueOnce(
      new ModuleAppPackageArchiveError(issues[0].code, issues[0].message, issues),
    );
    const service = new ModuleAppPackageIngestionService({ model: model as any, parseArchive, storage });

    await expect(service.submitUpload({ input: submitInput, userId: USER_ID })).rejects.toMatchObject({
      code: 'module_app_package_forbidden_extension',
    });

    expect(model.markRejected).toHaveBeenCalledWith({
      actualSizeBytes: 64,
      failureCode: 'module_app_package_forbidden_extension',
      scanReport: issues,
      uploadId: UPLOAD_ID,
    });
    expect(storage.deleteFile).toHaveBeenCalledWith(STORAGE_KEY);
    expect(model.markStorageReleased).toHaveBeenCalledWith({
      status: 'rejected',
      uploadId: UPLOAD_ID,
    });
  });

  it('records generic read or persistence failures without exposing provider messages', async () => {
    const { model, parseArchive, storage } = createMocks();
    storage.getFileByteArray.mockRejectedValueOnce(new Error('OSS credential detail'));
    const service = new ModuleAppPackageIngestionService({ model: model as any, parseArchive, storage });

    await expect(service.submitUpload({ input: submitInput, userId: USER_ID })).rejects.toThrow(
      'module_app_package_ingestion_failed',
    );
    expect(model.markFailed).toHaveBeenCalledWith({
      actualSizeBytes: 64,
      failureCode: 'module_app_package_ingestion_failed',
      uploadId: UPLOAD_ID,
    });
    expect(storage.deleteFile).toHaveBeenCalledWith(STORAGE_KEY);

    const next = createMocks();
    next.model.completeSubmission.mockRejectedValueOnce(new Error('database connection details'));
    const persistenceService = new ModuleAppPackageIngestionService({
      model: next.model as any,
      parseArchive: next.parseArchive,
      storage: next.storage,
    });

    await expect(
      persistenceService.submitUpload({ input: submitInput, userId: USER_ID }),
    ).rejects.toThrow('module_app_package_ingestion_failed');
    expect(next.storage.deleteFile).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('keeps failed deletion sessions reserved for maintenance retry', async () => {
    const { model, parseArchive, storage } = createMocks();
    parseArchive.mockRejectedValueOnce(new Error('unexpected parser failure'));
    storage.deleteFile.mockRejectedValueOnce(new Error('temporary delete failure'));
    const service = new ModuleAppPackageIngestionService({ model: model as any, parseArchive, storage });

    await expect(service.submitUpload({ input: submitInput, userId: USER_ID })).rejects.toThrow(
      'module_app_package_ingestion_failed',
    );

    expect(model.markStorageReleased).not.toHaveBeenCalled();
  });
});
