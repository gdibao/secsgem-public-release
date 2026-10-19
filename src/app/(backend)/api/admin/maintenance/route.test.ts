// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncExpiredSubscriptionsToFree } from '@/business/server/subscriptionMaintenance';
import { getServerDB } from '@/database/server';
import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import {
  APP_SETTING_SECRET_PREFIX,
  encryptAppSettingSecret,
} from '@/server/services/appSettings/secrets';

import { POST } from './route';

const cleanupMocks = vi.hoisted(() => ({
  cleanupPending: vi.fn(),
  cleanupExpiredUploads: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/business/server/subscriptionMaintenance', () => ({
  syncExpiredSubscriptionsToFree: vi.fn(),
}));

vi.mock('@/server/services/moduleAppPackage/lifecycle', () => ({
  ModuleAppPackageLifecycleService: vi.fn(() => cleanupMocks),
}));

vi.mock('@/server/services/moduleAppArtifactCleanup', () => ({
  ModuleAppArtifactCleanupService: vi.fn(() => cleanupMocks),
}));

const TEST_KEY_VAULTS_SECRET = Buffer.alloc(32, 15).toString('base64');

const createDb = (secret: unknown = 'maintenance-secret') =>
  ({
    query: {
      appSettings: {
        findFirst: vi.fn().mockResolvedValue({ value: secret }),
      },
    },
  }) as any;

const createRequest = (token?: string, body?: Record<string, unknown>) =>
  new Request('https://example.com/api/admin/maintenance', {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    method: 'POST',
  }) as any;

describe('admin maintenance route module app cleanup', () => {
  beforeEach(() => {
    process.env.KEY_VAULTS_SECRET = TEST_KEY_VAULTS_SECRET;
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue(createDb());
    vi.mocked(syncExpiredSubscriptionsToFree).mockResolvedValue({
      expiredSnapshots: 2,
      freeSnapshotsCreated: 1,
    });
    cleanupMocks.cleanupExpiredUploads.mockResolvedValue({ expired: 4, failed: 1 });
    cleanupMocks.cleanupPending.mockResolvedValue({
      claimed: 5,
      failed: 1,
      released: 3,
      retrying: 1,
    });
  });

  afterEach(() => {
    delete process.env.KEY_VAULTS_SECRET;
    delete process.env.CRON_SECRET;
  });

  it('keeps missing and incorrect bearer tokens unauthorized', async () => {
    await expect(POST(createRequest())).resolves.toMatchObject({ status: 401 });
    await expect(POST(createRequest('wrong-secret'))).resolves.toMatchObject({ status: 401 });
    expect(cleanupMocks.cleanupExpiredUploads).not.toHaveBeenCalled();
  });

  it('runs bounded module app cleanup for an authenticated request', async () => {
    const response = await POST(
      createRequest('maintenance-secret', { skipAudit: true, skipOrders: true }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      moduleAppUploadCleanupFailed: 1,
      moduleAppUploadsExpired: 4,
      moduleAppArtifactCleanupClaimed: 5,
      moduleAppArtifactCleanupFailed: 1,
      moduleAppArtifactCleanupRetrying: 1,
      moduleAppArtifactsReleased: 3,
      subscriptionSnapshotsExpired: 2,
    });
    expect(cleanupMocks.cleanupExpiredUploads).toHaveBeenCalledWith({ limit: 100 });
    expect(cleanupMocks.cleanupPending).toHaveBeenCalledWith(100);
  });

  it('decrypts cron.secret and keeps legacy non-string environment fallback', async () => {
    const encrypted = await encryptAppSettingSecret(
      APP_SETTING_KEYS.cronSecret,
      'encrypted-maintenance-secret',
    );
    vi.mocked(getServerDB).mockResolvedValue(createDb(encrypted));
    await expect(
      POST(createRequest('encrypted-maintenance-secret', { skipAudit: true, skipOrders: true })),
    ).resolves.toMatchObject({ status: 200 });

    process.env.CRON_SECRET = 'environment-maintenance-secret';
    vi.mocked(getServerDB).mockResolvedValue(createDb({ legacy: true }));
    await expect(
      POST(createRequest('environment-maintenance-secret', { skipAudit: true, skipOrders: true })),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('fails closed instead of using CRON_SECRET for invalid ciphertext', async () => {
    process.env.CRON_SECRET = 'environment-maintenance-secret';
    vi.mocked(getServerDB).mockResolvedValue(
      createDb(`${APP_SETTING_SECRET_PREFIX}${APP_SETTING_KEYS.cronSecret}:invalid`),
    );

    await expect(POST(createRequest('environment-maintenance-secret'))).resolves.toMatchObject({
      status: 401,
    });
    expect(cleanupMocks.cleanupExpiredUploads).not.toHaveBeenCalled();
  });

  it('skips module app cleanup only when explicitly requested', async () => {
    const response = await POST(
      createRequest('maintenance-secret', {
        skipAudit: true,
        skipModuleAppArtifacts: true,
        skipModuleAppUploads: true,
        skipOrders: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(cleanupMocks.cleanupExpiredUploads).not.toHaveBeenCalled();
    expect(cleanupMocks.cleanupPending).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty('moduleAppUploadsExpired');
  });
});
