// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTING_KEYS, invalidateServerAppSettings } from '@/server/services/appSettings';
import {
  APP_SETTING_SECRET_PREFIX,
  encryptAppSettingSecret,
} from '@/server/services/appSettings/secrets';

import { POST } from '../route';

const { mockGetServerDB, mockReleaseModel } = vi.hoisted(() => ({
  mockGetServerDB: vi.fn(),
  mockReleaseModel: {
    getRelease: vi.fn(),
    markReleaseCallback: vi.fn(),
    markReleaseResult: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({
  getServerDB: mockGetServerDB,
}));
vi.mock('@/database/models/desktopBuild', () => ({
  DesktopBuildModel: vi.fn(() => mockReleaseModel),
}));

vi.mock('@/server/services/appSettings', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...(actual as object),
    invalidateServerAppSettings: vi.fn(),
  };
});

const TEST_KEY_VAULTS_SECRET = Buffer.alloc(32, 17).toString('base64');

const createRequest = (body: unknown, token = 'dedicated-secret') => {
  const requestBody =
    body && typeof body === 'object' && !Array.isArray(body) && 'releaseId' in body
      ? { workflowRunAttempt: 1, ...body }
      : body;

  return new Request('https://chat.qingyouai.com/api/admin/desktop-release', {
    body: JSON.stringify(requestBody),
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  }) as any;
};

const createDb = (legacySecret: unknown = 'legacy-secret') => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));

  const db = {
    insert,
    query: {
      appSettings: {
        findFirst: vi.fn().mockResolvedValue({ value: legacySecret }),
      },
    },
    transaction: vi.fn(async (handler: (tx: unknown) => Promise<unknown>) => handler(db)),
  } as any;

  return { db, insert, values };
};

describe('POST /api/admin/desktop-release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DESKTOP_RELEASE_TOKEN = 'dedicated-secret';
    process.env.KEY_VAULTS_SECRET = TEST_KEY_VAULTS_SECRET;
    mockReleaseModel.getRelease.mockResolvedValue({
      frozenRevisionId: '22222222-2222-4222-8222-222222222222',
      id: '11111111-1111-4111-8111-111111111111',
      status: 'building',
    });
    mockReleaseModel.markReleaseResult.mockImplementation(async (input: any) => ({
      ...input,
      id: input.releaseId,
    }));
    mockReleaseModel.markReleaseCallback.mockImplementation(async (input: any) => ({
      ...input,
      channel: input.channel ?? 'stable',
      id: input.releaseId,
      releaseNotes: input.releaseNotes ?? 'Stored release notes',
      transitionedToSucceeded: input.status === 'succeeded',
      version: '2.3.0',
    }));
  });

  afterEach(() => {
    delete process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE;
    delete process.env.CRON_SECRET;
    delete process.env.DESKTOP_RELEASE_TOKEN;
    delete process.env.KEY_VAULTS_SECRET;
  });

  it('rejects requests without the release token', async () => {
    const { db, insert } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(createRequest({ version: '2.3.0' }, 'wrong'));

    expect(response.status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it('updates desktop release settings after a successful desktop build', async () => {
    const { db, values } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        channel: 'stable',
        downloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
        releaseNotes: '- desktop fixes',
        serverUrl: 'https://cdn.qingyouai.com/desktop',
        version: '2.3.0',
      }),
    );

    expect(response.status).toBe(200);
    expect(values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.desktopUpdateCurrentVersion,
      value: '2.3.0',
    });
    expect(values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.desktopUpdateServerUrl,
      value: 'https://cdn.qingyouai.com/desktop',
    });
    expect(values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.desktopDownloadUrl,
      value: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
    });
    expect(invalidateServerAppSettings).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['serverUrl', 'http://updates.example.com'],
    ['serverUrl', 'https://release-user:secret@updates.example.com'],
    ['downloadUrl', 'javascript:alert(1)'],
    ['downloadUrl', 'https://127.0.0.1/app.exe'],
  ])('rejects unsafe %s values from release callbacks', async (field, value) => {
    const { db, insert } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(createRequest({ [field]: value, version: '2.3.0' }));

    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not accept cron.secret unless the legacy bridge is explicitly enabled', async () => {
    delete process.env.DESKTOP_RELEASE_TOKEN;
    const { db, insert } = createDb('legacy-secret');
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(createRequest({ version: '2.3.0' }, 'legacy-secret'));

    expect(response.status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it('uses encrypted cron.secret only when dedicated auth is absent and legacy sharing is enabled', async () => {
    delete process.env.DESKTOP_RELEASE_TOKEN;
    process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE = '1';
    const encrypted = await encryptAppSettingSecret(APP_SETTING_KEYS.cronSecret, 'legacy-secret');
    const { db } = createDb(encrypted);
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(createRequest({ version: '2.3.0' }, 'legacy-secret'));

    expect(response.status).toBe(200);
  });

  it('fails closed for invalid encrypted legacy auth without using CRON_SECRET', async () => {
    delete process.env.DESKTOP_RELEASE_TOKEN;
    process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE = '1';
    process.env.CRON_SECRET = 'environment-legacy-secret';
    const { db, insert } = createDb(
      `${APP_SETTING_SECRET_PREFIX}${APP_SETTING_KEYS.cronSecret}:invalid`,
    );
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(createRequest({ version: '2.3.0' }, 'environment-legacy-secret'));

    expect(response.status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it('gives DESKTOP_RELEASE_TOKEN precedence over an enabled legacy bridge', async () => {
    process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE = '1';
    const { db, insert } = createDb('legacy-secret');
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(createRequest({ version: '2.3.0' }, 'legacy-secret'));

    expect(response.status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it('preserves the manual callback path when releaseId is absent', async () => {
    const { db, values } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(createRequest({ version: '2.3.0' }));

    expect(response.status).toBe(200);
    expect(mockReleaseModel.getRelease).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.desktopUpdateCurrentVersion,
      value: '2.3.0',
    });
  });

  it('preserves manual callback compatibility when unknown release fields are present without releaseId', async () => {
    const { db } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        status: 'succeeded',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockReleaseModel.getRelease).not.toHaveBeenCalled();
  });

  it.each([
    ['missing workflow provenance', {}],
    ['missing workflow run attempt', { workflowRunAttempt: undefined }],
    ['only workflow run ID', { workflowRunId: '1234567890' }],
    [
      'only workflow run URL',
      { workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890' },
    ],
  ])('rejects server callbacks with %s', async (_description, workflowMetadata) => {
    const { db } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
        version: '2.3.0',
        ...workflowMetadata,
      }),
    );

    expect(response.status).toBe(400);
    expect(mockReleaseModel.markReleaseResult).not.toHaveBeenCalled();
  });

  it('binds release callbacks to their frozen revision and durable GitHub run metadata', async () => {
    const { db, values } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'building',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockReleaseModel.markReleaseCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'building',
        workflowRunAttempt: 1,
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
      expect.anything(),
    );
    expect(values).not.toHaveBeenCalled();
  });

  it('delegates callback revision authorization to the locked model transition', async () => {
    const { db } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        errorSummary: 'Desktop release profile staging failed.',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockReleaseModel.getRelease).not.toHaveBeenCalled();
    expect(mockReleaseModel.markReleaseCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
      }),
      expect.anything(),
    );
  });

  it('infers the frozen revision for a bounded failed callback when profile staging cannot report one', async () => {
    const { db, values } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        errorSummary: 'Desktop release profile staging failed.',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockReleaseModel.markReleaseCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        errorSummary: 'Desktop release profile staging failed.',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
      }),
      expect.anything(),
    );
    expect(values).not.toHaveBeenCalled();
  });

  it('keeps exact revisionless failed callback retries idempotent without settings writes', async () => {
    const { db, values } = createDb();
    mockGetServerDB.mockResolvedValue(db);
    mockReleaseModel.markReleaseCallback.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });
    mockReleaseModel.markReleaseCallback.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });
    mockReleaseModel.markReleaseCallback.mockRejectedValueOnce(
      new Error('DESKTOP_RELEASE_CALLBACK_REVISION_REQUIRED'),
    );

    const failure = {
      errorSummary: 'Desktop release profile staging failed.',
      releaseId: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
      version: '2.3.0',
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    } as const;
    expect((await POST(createRequest(failure))).status).toBe(200);
    expect((await POST(createRequest(failure))).status).toBe(200);
    expect(
      (
        await POST(
          createRequest({
            ...failure,
            workflowRunId: '1234567891',
            workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567891',
          }),
        )
      ).status,
    ).toBe(400);
    expect(values).not.toHaveBeenCalled();
  });

  it('requires the exact frozen revision after a building callback has persisted workflow binding', async () => {
    const { db } = createDb();
    mockGetServerDB.mockResolvedValue(db);
    mockReleaseModel.getRelease.mockResolvedValue({
      frozenRevisionId: '22222222-2222-4222-8222-222222222222',
      id: '11111111-1111-4111-8111-111111111111',
      status: 'building',
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });
    mockReleaseModel.markReleaseCallback.mockRejectedValueOnce(
      new Error('DESKTOP_RELEASE_CALLBACK_REVISION_REQUIRED'),
    );

    const revisionlessFailure = await POST(
      createRequest({
        errorSummary: 'Desktop release build failed.',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(revisionlessFailure.status).toBe(400);
    expect(mockReleaseModel.markReleaseCallback).toHaveBeenCalledTimes(1);

    const boundFailure = await POST(
      createRequest({
        errorSummary: 'Desktop release build failed.',
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(boundFailure.status).toBe(200);
    expect(mockReleaseModel.markReleaseCallback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
      expect.anything(),
    );
  });

  it('still requires an exact profile revision for non-failed release callbacks', async () => {
    const { db } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'publishing',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(400);
    expect(mockReleaseModel.markReleaseResult).not.toHaveBeenCalled();
  });

  it.each([
    ['both publication URLs', {}],
    ['the download URL', { serverUrl: 'https://cdn.qingyouai.com/desktop' }],
    [
      'the update server URL',
      {
        downloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
      },
    ],
  ])('rejects succeeded release callbacks missing %s', async (_description, publication) => {
    const { db } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'succeeded',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
        ...publication,
      }),
    );

    expect(response.status).toBe(400);
    expect(mockReleaseModel.markReleaseCallback).not.toHaveBeenCalled();
  });

  it.each([
    [
      'download URL',
      {
        downloadUrl: 'javascript:alert(1)',
        serverUrl: 'https://cdn.qingyouai.com/desktop',
      },
    ],
    [
      'update server URL',
      {
        downloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
        serverUrl: 'http://updates.example.com',
      },
    ],
  ])('returns 400 for an invalid succeeded callback %s', async (_description, publication) => {
    const { db } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'succeeded',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
        ...publication,
      }),
    );

    expect(response.status).toBe(400);
    expect(mockReleaseModel.markReleaseCallback).not.toHaveBeenCalled();
  });

  it('maps model publication metadata rejection to a bad request', async () => {
    const { db } = createDb();
    mockGetServerDB.mockResolvedValue(db);
    mockReleaseModel.markReleaseCallback.mockRejectedValueOnce(
      new Error('DESKTOP_RELEASE_PUBLICATION_METADATA_INVALID'),
    );

    const response = await POST(
      createRequest({
        downloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        serverUrl: 'https://cdn.qingyouai.com/desktop',
        status: 'succeeded',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('rejects mismatched profile revisions, invalid GitHub run URLs, and terminal callbacks', async () => {
    const { db, insert } = createDb();
    mockGetServerDB.mockResolvedValue(db);
    mockReleaseModel.markReleaseCallback.mockRejectedValueOnce(
      new Error('DESKTOP_RELEASE_REVISION_MISMATCH'),
    );

    const mismatch = await POST(
      createRequest({
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'publishing',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );
    expect(mismatch.status).toBe(409);

    const invalidUrl = await POST(
      createRequest({
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        status: 'building',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/other/repository/actions/runs/1234567890',
      }),
    );
    expect(invalidUrl.status).toBe(400);

    mockReleaseModel.markReleaseCallback.mockRejectedValueOnce(
      new Error('DESKTOP_RELEASE_TERMINAL'),
    );
    const terminal = await POST(
      createRequest({
        downloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        serverUrl: 'https://cdn.qingyouai.com/desktop',
        status: 'succeeded',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );
    expect(terminal.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
  });

  it('updates public settings only after a succeeded release within the release transaction', async () => {
    const { db, values } = createDb();
    mockGetServerDB.mockResolvedValue(db);

    const response = await POST(
      createRequest({
        downloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        serverUrl: 'https://cdn.qingyouai.com/desktop',
        status: 'succeeded',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(200);
    expect(db.transaction).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.desktopUpdateCurrentVersion,
      value: '2.3.0',
    });
  });

  it('does not overwrite public settings when a succeeded callback is replayed', async () => {
    const { db, values } = createDb();
    mockGetServerDB.mockResolvedValue(db);
    mockReleaseModel.markReleaseCallback.mockResolvedValueOnce({
      channel: 'canary',
      id: '11111111-1111-4111-8111-111111111111',
      releaseNotes: 'Stored newer release',
      status: 'succeeded',
      transitionedToSucceeded: false,
      version: '2.4.0',
    });

    const response = await POST(
      createRequest({
        channel: 'stable',
        downloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        releaseNotes: 'Stale callback notes',
        serverUrl: 'https://cdn.qingyouai.com/desktop',
        status: 'succeeded',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(200);
    expect(values).not.toHaveBeenCalled();
    expect(invalidateServerAppSettings).not.toHaveBeenCalled();
  });

  it('uses locked release values for the first succeeded callback settings update', async () => {
    const { db, values } = createDb();
    mockGetServerDB.mockResolvedValue(db);
    mockReleaseModel.markReleaseCallback.mockResolvedValueOnce({
      channel: 'canary',
      id: '11111111-1111-4111-8111-111111111111',
      releaseNotes: 'Stored release notes',
      status: 'succeeded',
      transitionedToSucceeded: true,
      version: '2.4.0',
    });

    const response = await POST(
      createRequest({
        channel: 'stable',
        downloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
        profileRevisionId: '22222222-2222-4222-8222-222222222222',
        releaseId: '11111111-1111-4111-8111-111111111111',
        releaseNotes: 'Untrusted callback notes',
        serverUrl: 'https://cdn.qingyouai.com/desktop',
        status: 'succeeded',
        version: '2.3.0',
        workflowRunId: '1234567890',
        workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockReleaseModel.markReleaseCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedDownloadUrl:
          'https://cdn.qingyouai.com/desktop/stable/2.3.0/LobeHub-2.3.0-setup.exe',
        publishedServerUrl: 'https://cdn.qingyouai.com/desktop',
      }),
      db,
    );
    expect(values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.desktopUpdateChannel,
      value: 'canary',
    });
    expect(values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.desktopUpdateCurrentVersion,
      value: '2.4.0',
    });
    expect(values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.desktopUpdateReleaseNotes,
      value: 'Stored release notes',
    });
  });
});
