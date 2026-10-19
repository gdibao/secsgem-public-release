// @vitest-environment node
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { getDesktopReleaseDiagnostics } from '@/server/services/desktopRelease';

import { loadAppSettingsSectionSnapshot } from '../../appSettings/loader';
import { adminDesktopRouter } from './desktop';

const mocks = vi.hoisted(() => ({
  assets: {
    completeDesktopBuildAsset: vi.fn(),
    createDesktopBuildAssetUpload: vi.fn(),
    validateDesktopBuildAssetManifest: vi.fn(),
  },
  github: {
    DesktopReleaseDispatchError: class DesktopReleaseDispatchError extends Error {
      constructor(
        public readonly code: string,
        public readonly summary: string,
        public readonly delivery: 'ambiguous' | 'definitive' = 'ambiguous',
      ) {
        super(summary);
      }
    },
    dispatchDesktopReleaseWorkflow: vi.fn(),
    getDesktopReleaseAutomationHealth: vi.fn(),
    reconcileDesktopReleaseWorkflow: vi.fn(),
    retryDesktopReleaseWorkflow: vi.fn(),
  },
  publication: {
    normalizeDesktopReleasePublication: vi.fn(),
    writeDesktopReleasePublicationSettings: vi.fn(),
  },
  ids: {
    randomUUID: vi.fn(),
  },
  audit: {
    records: vi.fn(),
    runRequiredAdminAuditExternalEffect: vi.fn(async (_ctx, options) => {
      await options.audit('started');
      mocks.audit.records('started');
      try {
        const result = await options.effect();
        await options.audit('succeeded', result);
        mocks.audit.records('succeeded');
        return result;
      } catch (error) {
        await options.audit('failed');
        mocks.audit.records('failed');
        throw error;
      }
    }),
    runRequiredAdminAuditMutation: vi.fn(async (_ctx, options) => {
      const result = await options.mutation({});
      await options.audit(result);
      mocks.audit.records('create');
      return result;
    }),
  },
  model: {
    archiveProfile: vi.fn(),
    bindReleaseWorkflowRun: vi.fn(),
    expirePendingReleaseRetry: vi.fn(),
    freezeDraftForRelease: vi.fn(),
    getProfile: vi.fn(),
    getRelease: vi.fn(),
    getRevision: vi.fn(),
    getRevisionsByIds: vi.fn(),
    listProfiles: vi.fn(),
    listReleases: vi.fn(),
    markReleaseDispatched: vi.fn(),
    markReleaseResult: vi.fn(),
    prepareReleaseRetry: vi.fn(),
    saveDraft: vi.fn(),
  },
}));

vi.mock('node:crypto', () => mocks.ids);

vi.mock('@/database/models/desktopBuild', () => ({
  DesktopBuildModel: vi.fn(() => mocks.model),
  isDesktopBuildProfileCursor: (value: string) => value !== 'malformed-cursor',
}));

vi.mock('@/server/services/desktopBuild/assets', () => mocks.assets);

vi.mock('@/server/services/desktopRelease/github', () => mocks.github);

vi.mock('@/server/services/desktopRelease/publication', () => mocks.publication);

vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(() => ({})),
}));

vi.mock('./audit', () => mocks.audit);

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const RELEASE_ID = '44444444-4444-4444-8444-444444444444';
const PROFILE_CURSOR = Buffer.from(
  JSON.stringify({
    createdAt: '2026-07-21T00:00:00.000000Z',
    id: PROFILE_ID,
    v: 2,
  }),
).toString('base64url');
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const payload = {
  applicationId: 'com.qingyou.comhub',
  applicationName: 'ComHub',
  description: 'ComHub desktop',
  executableName: 'ComHub',
  homepage: 'https://comhub.example.com',
  installerArtifactName: '${productName}-${version}-${arch}.${ext}',
  protocolScheme: 'comhub',
  publisher: 'Qingyou',
  shortcutName: 'ComHub',
  uninstallDisplayName: 'ComHub',
};
const trustedAsset = {
  contentType: 'image/png',
  height: 1024,
  key: `desktop-build-assets/${PROFILE_ID}/aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa.png`,
  kind: 'appPreview' as const,
  sha256: 'a'.repeat(64),
  size: 1024,
  width: 1024,
};
const stagingAssetKey = `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.png`;
const manifest = {
  appPreview: trustedAsset,
  nsisHeader: {
    ...trustedAsset,
    contentType: 'image/bmp',
    height: 57,
    key: `desktop-build-assets/${PROFILE_ID}/22222222-2222-4222-8222-222222222223.bmp`,
    kind: 'nsisHeader' as const,
    width: 150,
  },
  nsisSidebar: {
    ...trustedAsset,
    contentType: 'image/bmp',
    height: 314,
    key: `desktop-build-assets/${PROFILE_ID}/22222222-2222-4222-8222-222222222224.bmp`,
    kind: 'nsisSidebar' as const,
    width: 164,
  },
  windowsIcon: {
    ...trustedAsset,
    contentType: 'image/x-icon',
    key: `desktop-build-assets/${PROFILE_ID}/22222222-2222-4222-8222-222222222225.ico`,
    kind: 'windowsIcon' as const,
  },
};
const draftRevision = {
  assetManifest: manifest,
  id: 'draft-revision-1',
  payload,
  profileId: PROFILE_ID,
  revision: 1,
  state: 'draft',
};
const queuedRelease = {
  channel: 'stable' as const,
  id: 'release-1',
  profileId: PROFILE_ID,
  releaseNotes: 'notes',
  status: 'queued' as const,
  version: '2.4.0',
};
const buildingRelease = { ...queuedRelease, status: 'building' as const };

const adminRouterSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/desktopRelease', () => ({
  getDesktopReleaseDiagnostics: vi.fn(),
}));

vi.mock('../../appSettings/loader', () => ({
  loadAppSettingsSectionSnapshot: vi.fn(),
}));

const createDb = (role = 'system_admin') =>
  ({
    query: {
      users: {
        findFirst: vi.fn().mockResolvedValue({ banned: false, role }),
      },
    },
  }) as any;

describe('adminDesktopRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ids.randomUUID
      .mockReturnValueOnce('frozen-revision-0000-4000-8000-000000000001')
      .mockReturnValueOnce('release-00000000-4000-8000-000000000002');
    vi.mocked(getServerDB).mockResolvedValue(createDb());
    vi.mocked(loadAppSettingsSectionSnapshot).mockResolvedValue(
      new Map([
        ['desktop.update.channel', 'stable'],
        ['desktop.update.currentVersion', '2.2.7'],
        ['desktop.update.serverUrl', 'https://releases.example.com'],
        ['desktop.oss.accessKeySecret', 'must-not-leak'],
      ]) as any,
    );
    vi.mocked(getDesktopReleaseDiagnostics).mockResolvedValue({
      baseUrl: 'https://releases.example.com',
      channels: [],
      checkedAt: '2026-07-21T00:00:00.000Z',
      configured: true,
    });
    mocks.model.archiveProfile.mockResolvedValue({ id: PROFILE_ID, status: 'archived' });
    mocks.model.freezeDraftForRelease.mockImplementation(async (input) => ({
      release: { ...queuedRelease, id: input.releaseId },
      revision: { ...draftRevision, id: input.frozenRevisionId, state: 'frozen' },
    }));
    mocks.model.getProfile.mockResolvedValue({
      currentDraftRevisionId: draftRevision.id,
      id: PROFILE_ID,
    });
    mocks.model.getRelease.mockResolvedValue({
      ...buildingRelease,
      dispatchedAt: new Date('2026-07-22T10:00:00Z'),
      id: RELEASE_ID,
      workflowRunAttempt: null,
      workflowRunId: null,
      workflowRunUrl: null,
    });
    mocks.model.getRevision.mockResolvedValue(draftRevision);
    mocks.model.getRevisionsByIds.mockResolvedValue([]);
    mocks.model.listProfiles.mockResolvedValue({ items: [], nextCursor: null });
    mocks.model.listReleases.mockResolvedValue([]);
    mocks.model.markReleaseDispatched.mockImplementation(async (input) => ({
      ...buildingRelease,
      id: input.releaseId,
    }));
    mocks.model.markReleaseResult.mockResolvedValue({ ...queuedRelease, status: 'failed' });
    mocks.model.bindReleaseWorkflowRun.mockResolvedValue({
      ...buildingRelease,
      id: RELEASE_ID,
      workflowRunAttempt: 1,
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });
    mocks.model.expirePendingReleaseRetry.mockResolvedValue(null);
    mocks.model.prepareReleaseRetry.mockResolvedValue({
      ...buildingRelease,
      id: RELEASE_ID,
      workflowRunAttempt: 1,
      workflowRunAttemptPending: true,
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });
    mocks.model.saveDraft.mockResolvedValue({
      profileId: PROFILE_ID,
      revision: 1,
      revisionId: 'revision-1',
    });
    mocks.assets.createDesktopBuildAssetUpload.mockResolvedValue({
      headers: { 'Content-Type': 'image/png' },
      key: trustedAsset.key,
      kind: 'appPreview',
      profileId: PROFILE_ID,
      uploadUrl: 'https://uploads.example.test/opaque-signature',
    });
    mocks.assets.completeDesktopBuildAsset.mockResolvedValue(trustedAsset);
    mocks.assets.validateDesktopBuildAssetManifest.mockResolvedValue(manifest);
    mocks.github.dispatchDesktopReleaseWorkflow.mockResolvedValue(undefined);
    mocks.github.getDesktopReleaseAutomationHealth.mockReturnValue({
      configured: true,
      ref: 'main',
      repository: 'maheshenga/comhub',
      tokenConfigured: true,
      workflowFile: 'comhub-desktop-release.yml',
    });
    mocks.github.retryDesktopReleaseWorkflow.mockResolvedValue(undefined);
    mocks.publication.normalizeDesktopReleasePublication.mockImplementation((input) => input);
    mocks.publication.writeDesktopReleasePublicationSettings.mockResolvedValue(5);
    mocks.github.reconcileDesktopReleaseWorkflow.mockResolvedValue({
      conclusion: null,
      createdAt: '2026-07-22T10:00:02Z',
      state: 'matched',
      status: 'in_progress',
      updatedAt: '2026-07-22T10:01:00Z',
      workflowRunAttempt: 1,
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });
  });

  it('is registered under admin.desktop', () => {
    expect(adminRouterSource).toContain("import { adminDesktopRouter } from './desktop';");
    expect(adminRouterSource).toMatch(/\bdesktop:\s*adminDesktopRouter\b/);
  });

  it('uses the configured update server without exposing OSS credentials', async () => {
    const result = await adminDesktopRouter
      .createCaller({ userId: 'system-admin-user' } as any)
      .getOverview();

    expect(loadAppSettingsSectionSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      'desktop-update',
    );
    expect(getDesktopReleaseDiagnostics).toHaveBeenCalledWith({
      baseUrl: 'https://releases.example.com',
    });
    expect(result).toMatchObject({
      automation: { configured: true, tokenConfigured: true },
      configuredChannel: 'stable',
      configuredVersion: '2.2.7',
      diagnostics: { configured: true },
      runtimePolicy: { autoCheck: true, channel: 'stable', checkInterval: 60 },
    });
    expect(result).not.toHaveProperty('desktopOssConfig');
    expect(result.automation).not.toHaveProperty('token');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('requires the systemRead capability', async () => {
    vi.mocked(getServerDB).mockResolvedValue(createDb('finance_admin'));

    await expect(
      adminDesktopRouter.createCaller({ userId: 'finance-admin-user' } as any).getOverview(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getDesktopReleaseDiagnostics).not.toHaveBeenCalled();
  });

  it('binds the only matched GitHub workflow run without changing release status', async () => {
    const result = await adminDesktopRouter
      .createCaller({ userId: 'system-admin-user' } as any)
      .reconcileDesktopRelease({ releaseId: RELEASE_ID });

    expect(mocks.github.reconcileDesktopReleaseWorkflow).toHaveBeenCalledWith({
      channel: 'stable',
      dispatchedAt: new Date('2026-07-22T10:00:00Z'),
      releaseId: RELEASE_ID,
      version: '2.4.0',
      workflowRunId: null,
    });
    expect(mocks.model.bindReleaseWorkflowRun).toHaveBeenCalledWith({
      releaseId: RELEASE_ID,
      workflowRunAttempt: 1,
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });
    expect(result).toMatchObject({ state: 'matched', status: 'in_progress' });
    expect(mocks.audit.records).toHaveBeenCalledWith('started');
    expect(mocks.audit.records).toHaveBeenCalledWith('succeeded');
  });

  it('reports a conflict when a release becomes terminal before reconciliation can bind it', async () => {
    mocks.model.bindReleaseWorkflowRun.mockRejectedValueOnce(
      new Error('DESKTOP_RELEASE_WORKFLOW_RUN_BIND_NOT_ALLOWED'),
    );

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .reconcileDesktopRelease({ releaseId: RELEASE_ID }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'DESKTOP_RELEASE_RECONCILE_CONFLICT',
    });

    expect(mocks.model.markReleaseResult).not.toHaveBeenCalled();
    expect(mocks.audit.records).toHaveBeenCalledWith('failed');
  });

  it('keeps the release building when GitHub reconciliation has no unique match', async () => {
    mocks.github.reconcileDesktopReleaseWorkflow.mockResolvedValueOnce({
      candidateCount: 0,
      reason: 'not-found',
      state: 'unresolved',
    });

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .reconcileDesktopRelease({ releaseId: RELEASE_ID }),
    ).resolves.toEqual({ candidateCount: 0, reason: 'not-found', state: 'unresolved' });

    expect(mocks.model.bindReleaseWorkflowRun).not.toHaveBeenCalled();
    expect(mocks.model.markReleaseResult).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous rerun pending while GitHub still reports the previous attempt', async () => {
    mocks.model.getRelease.mockResolvedValueOnce({
      ...buildingRelease,
      dispatchedAt: new Date('2026-07-22T10:00:00Z'),
      id: RELEASE_ID,
      workflowRunAttempt: 1,
      workflowRunAttemptPending: true,
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .reconcileDesktopRelease({ releaseId: RELEASE_ID }),
    ).resolves.toEqual({ candidateCount: 1, reason: 'rerun-pending', state: 'unresolved' });

    expect(mocks.model.expirePendingReleaseRetry).toHaveBeenCalledWith({
      releaseId: RELEASE_ID,
      requestedBefore: expect.any(Date),
      workflowRunAttempt: 1,
    });
    expect(mocks.model.bindReleaseWorkflowRun).not.toHaveBeenCalled();
  });

  it('expires an ambiguous rerun when GitHub never advances beyond the previous attempt', async () => {
    mocks.model.getRelease.mockResolvedValueOnce({
      ...buildingRelease,
      dispatchedAt: new Date('2026-07-22T10:00:00Z'),
      id: RELEASE_ID,
      workflowRunAttempt: 1,
      workflowRunAttemptPending: true,
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    });
    mocks.model.expirePendingReleaseRetry.mockResolvedValueOnce({
      ...buildingRelease,
      id: RELEASE_ID,
      status: 'failed',
      workflowRunAttempt: 1,
      workflowRunAttemptPending: false,
    });

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .reconcileDesktopRelease({ releaseId: RELEASE_ID }),
    ).resolves.toEqual({
      candidateCount: 1,
      reason: 'rerun-not-delivered',
      state: 'unresolved',
    });

    expect(mocks.model.bindReleaseWorkflowRun).not.toHaveBeenCalled();
  });

  it('rejects reconciliation for releases that are no longer building', async () => {
    mocks.model.getRelease.mockResolvedValueOnce({ ...buildingRelease, status: 'failed' });

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .reconcileDesktopRelease({ releaseId: RELEASE_ID }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'DESKTOP_RELEASE_RECONCILE_NOT_ALLOWED',
    });

    expect(mocks.github.reconcileDesktopReleaseWorkflow).not.toHaveBeenCalled();
  });

  it('retries a failed release through the required external-effect audit', async () => {
    const result = await adminDesktopRouter
      .createCaller({ userId: 'system-admin-user' } as any)
      .retryDesktopRelease({ releaseId: RELEASE_ID });

    expect(mocks.model.prepareReleaseRetry).toHaveBeenCalledWith({
      actorUserId: 'system-admin-user',
      releaseId: RELEASE_ID,
    });
    expect(mocks.github.retryDesktopReleaseWorkflow).toHaveBeenCalledWith({
      channel: 'stable',
      releaseId: RELEASE_ID,
      releaseNotes: 'notes',
      version: '2.4.0',
      workflowRunId: '1234567890',
    });
    expect(result).toMatchObject({ id: RELEASE_ID, status: 'building' });
    expect(mocks.audit.records).toHaveBeenCalledWith('started');
    expect(mocks.audit.records).toHaveBeenCalledWith('succeeded');
  });

  it('maps a retry request for a non-failed release to a state conflict', async () => {
    mocks.model.prepareReleaseRetry.mockRejectedValueOnce(
      new Error('DESKTOP_RELEASE_RETRY_NOT_ALLOWED'),
    );

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .retryDesktopRelease({ releaseId: RELEASE_ID }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'DESKTOP_RELEASE_RETRY_NOT_ALLOWED',
    });

    expect(mocks.github.retryDesktopReleaseWorkflow).not.toHaveBeenCalled();
    expect(mocks.audit.records).toHaveBeenCalledWith('failed');
  });

  it('returns a retry to failed when GitHub definitively rejects the request', async () => {
    mocks.github.retryDesktopReleaseWorkflow.mockRejectedValueOnce(
      new mocks.github.DesktopReleaseDispatchError(
        'github-dispatch-failed',
        'GitHub rerun failed (409).',
        'definitive',
      ),
    );

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .retryDesktopRelease({ releaseId: RELEASE_ID }),
    ).rejects.toThrow('GitHub rerun failed (409).');

    expect(mocks.model.markReleaseResult).toHaveBeenCalledWith({
      errorSummary: 'GitHub rerun failed (409).',
      releaseId: RELEASE_ID,
      status: 'failed',
    });
    expect(mocks.audit.records).toHaveBeenCalledWith('failed');
  });

  it('keeps a retried release building when GitHub delivery is ambiguous', async () => {
    mocks.github.retryDesktopReleaseWorkflow.mockRejectedValueOnce(
      new mocks.github.DesktopReleaseDispatchError(
        'github-dispatch-timeout',
        'GitHub rerun timed out.',
        'ambiguous',
      ),
    );

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .retryDesktopRelease({ releaseId: RELEASE_ID }),
    ).rejects.toThrow('GitHub rerun timed out.');

    expect(mocks.model.prepareReleaseRetry).toHaveBeenCalledTimes(1);
    expect(mocks.model.markReleaseResult).not.toHaveBeenCalled();
    expect(mocks.audit.records).toHaveBeenCalledWith('failed');
  });

  it('sets an immutable succeeded release as the current public desktop version', async () => {
    const succeededRelease = {
      ...queuedRelease,
      id: RELEASE_ID,
      publishedDownloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.4.0/ComHub.exe',
      publishedServerUrl: 'https://cdn.qingyouai.com/desktop',
      status: 'succeeded' as const,
    };
    mocks.model.getRelease.mockResolvedValueOnce(succeededRelease);

    const result = await adminDesktopRouter
      .createCaller({ userId: 'system-admin-user' } as any)
      .activateDesktopRelease({ releaseId: RELEASE_ID });

    expect(mocks.publication.normalizeDesktopReleasePublication).toHaveBeenCalledWith({
      channel: 'stable',
      downloadUrl: succeededRelease.publishedDownloadUrl,
      releaseNotes: 'notes',
      serverUrl: succeededRelease.publishedServerUrl,
      version: '2.4.0',
    });
    expect(mocks.publication.writeDesktopReleasePublicationSettings).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ version: '2.4.0' }),
    );
    expect(result).toMatchObject({ id: RELEASE_ID, status: 'succeeded' });
    expect(mocks.audit.runRequiredAdminAuditMutation).toHaveBeenCalled();
  });

  it('rejects activation unless the release succeeded with complete publication URLs', async () => {
    const releases = [
      {
        ...queuedRelease,
        id: RELEASE_ID,
        publishedDownloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.4.0/ComHub.exe',
        publishedServerUrl: 'https://cdn.qingyouai.com/desktop',
        status: 'failed' as const,
      },
      {
        ...queuedRelease,
        id: RELEASE_ID,
        publishedDownloadUrl: null,
        publishedServerUrl: 'https://cdn.qingyouai.com/desktop',
        status: 'succeeded' as const,
      },
      {
        ...queuedRelease,
        id: RELEASE_ID,
        publishedDownloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.4.0/ComHub.exe',
        publishedServerUrl: null,
        status: 'succeeded' as const,
      },
    ];

    for (const release of releases) {
      mocks.model.getRelease.mockResolvedValueOnce(release);
      await expect(
        adminDesktopRouter
          .createCaller({ userId: 'system-admin-user' } as any)
          .activateDesktopRelease({ releaseId: RELEASE_ID }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'DESKTOP_RELEASE_ACTIVATION_NOT_ALLOWED',
      });
    }

    expect(mocks.publication.normalizeDesktopReleasePublication).not.toHaveBeenCalled();
    expect(mocks.audit.runRequiredAdminAuditMutation).not.toHaveBeenCalled();
  });

  it('rejects activation when stored publication URLs no longer pass validation', async () => {
    mocks.model.getRelease.mockResolvedValueOnce({
      ...queuedRelease,
      id: RELEASE_ID,
      publishedDownloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.4.0/ComHub.exe',
      publishedServerUrl: 'https://cdn.qingyouai.com/desktop',
      status: 'succeeded' as const,
    });
    mocks.publication.normalizeDesktopReleasePublication.mockImplementationOnce(() => {
      throw new Error('downloadUrl is not allowed: unsafe-url');
    });

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .activateDesktopRelease({ releaseId: RELEASE_ID }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'DESKTOP_RELEASE_PUBLICATION_INVALID',
    });

    expect(mocks.publication.writeDesktopReleasePublicationSettings).not.toHaveBeenCalled();
    expect(mocks.audit.runRequiredAdminAuditMutation).not.toHaveBeenCalled();
  });

  it('rejects activation when normalization removes incomplete publication URLs', async () => {
    mocks.model.getRelease.mockResolvedValueOnce({
      ...queuedRelease,
      id: RELEASE_ID,
      publishedDownloadUrl: '   ',
      publishedServerUrl: '   ',
      status: 'succeeded' as const,
    });
    mocks.publication.normalizeDesktopReleasePublication.mockReturnValueOnce({
      channel: 'stable',
      version: '2.4.0',
    });

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .activateDesktopRelease({ releaseId: RELEASE_ID }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'DESKTOP_RELEASE_PUBLICATION_INVALID',
    });

    expect(mocks.publication.writeDesktopReleasePublicationSettings).not.toHaveBeenCalled();
    expect(mocks.audit.runRequiredAdminAuditMutation).not.toHaveBeenCalled();
  });

  it('requires systemWrite before activating a desktop release', async () => {
    vi.mocked(getServerDB).mockResolvedValue(createDb('finance_admin'));

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'finance-admin-user' } as any)
        .activateDesktopRelease({ releaseId: RELEASE_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mocks.model.getRelease).not.toHaveBeenCalled();
  });

  it('returns draft profile DTOs without storage secrets or signed download URLs', async () => {
    mocks.model.listProfiles.mockResolvedValue({
      items: [
        {
          apiKey: 'must-not-leak',
          currentDraftRevisionId: 'revision-1',
          currentRevision: 1,
          firstStableReleaseAt: new Date('2026-07-21T00:00:00.000Z'),
          id: PROFILE_ID,
          name: 'ComHub',
          status: 'active',
        },
        {
          currentDraftRevisionId: 'revision-2',
          currentRevision: 2,
          firstStableReleaseAt: null,
          id: '33333333-3333-4333-8333-333333333333',
          name: 'ComHub Preview',
          status: 'active',
        },
      ],
      nextCursor: PROFILE_CURSOR,
    });
    mocks.model.getRevisionsByIds.mockResolvedValue([
      {
        assetManifest: manifest,
        id: 'revision-1',
        payload,
        signedGetUrl: 'https://downloads.example.test/private',
        state: 'draft',
      },
      {
        assetManifest: manifest,
        id: 'revision-2',
        payload,
        state: 'draft',
      },
    ]);

    const result = await adminDesktopRouter
      .createCaller({ userId: 'system-admin-user' } as any)
      .listBuildProfiles({ cursor: PROFILE_CURSOR, limit: 2 });

    expect(result).toMatchObject({ nextCursor: PROFILE_CURSOR });
    expect(result.items[0]).toMatchObject({
      currentDraft: { id: 'revision-1', state: 'draft' },
      currentRevision: 1,
      id: PROFILE_ID,
      identityLocked: true,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(JSON.stringify(result)).not.toContain('downloads.example.test');
    expect(mocks.model.listProfiles).toHaveBeenCalledWith({ cursor: PROFILE_CURSOR, limit: 2 });
    expect(mocks.model.getRevisionsByIds).toHaveBeenCalledWith(['revision-1', 'revision-2']);
    expect(mocks.model.getRevision).not.toHaveBeenCalled();
  });

  it('maps malformed opaque profile cursors to a bad request', async () => {
    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .listBuildProfiles({ cursor: 'malformed-cursor', limit: 2 }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mocks.model.listProfiles).not.toHaveBeenCalled();
    expect(mocks.model.getRevisionsByIds).not.toHaveBeenCalled();
  });

  it('requires systemWrite before issuing a private asset upload target', async () => {
    vi.mocked(getServerDB).mockResolvedValue(createDb('finance_admin'));

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'finance-admin-user' } as any)
        .createBuildAssetUpload({ kind: 'appPreview' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.assets.createDesktopBuildAssetUpload).not.toHaveBeenCalled();
  });

  it('completes trusted assets through the required external-effect audit wrapper', async () => {
    const result = await adminDesktopRouter
      .createCaller({ userId: 'system-admin-user' } as any)
      .completeBuildAssetUpload({
        key: stagingAssetKey,
        kind: 'appPreview',
        profileId: PROFILE_ID,
      });

    expect(result).toEqual(trustedAsset);
    expect(mocks.audit.runRequiredAdminAuditExternalEffect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ audit: expect.any(Function), effect: expect.any(Function) }),
    );
    expect(mocks.assets.completeDesktopBuildAsset).toHaveBeenCalledWith(
      expect.objectContaining({ key: stagingAssetKey, kind: 'appPreview', profileId: PROFILE_ID }),
    );
    const auditOptions = mocks.audit.runRequiredAdminAuditExternalEffect.mock.calls[0]?.[1] as {
      audit: (
        status: string,
        asset?: typeof trustedAsset,
      ) => Promise<{
        payload: Record<string, unknown>;
      }>;
    };
    const auditPayloads = await Promise.all([
      auditOptions.audit('started'),
      auditOptions.audit('succeeded', trustedAsset),
    ]);

    expect(auditPayloads.map((entry) => entry.payload)).toEqual([
      { kind: 'appPreview', profileId: PROFILE_ID },
      {
        key: trustedAsset.key,
        kind: 'appPreview',
        profileId: PROFILE_ID,
        sha256: trustedAsset.sha256,
        size: trustedAsset.size,
      },
    ]);
    const serializedAuditPayloads = JSON.stringify(auditPayloads);
    expect(serializedAuditPayloads).not.toContain(stagingAssetKey);
    for (const forbidden of [
      'uploadUrl',
      'headers',
      'accessKey',
      'secret',
      'token',
      'credentials',
    ]) {
      expect(serializedAuditPayloads).not.toContain(forbidden);
    }
    expect(JSON.stringify(result)).not.toContain('uploads.example.test');
  });

  it('saves only a revalidated draft inside the required audit transaction', async () => {
    const result = await adminDesktopRouter
      .createCaller({ userId: 'system-admin-user' } as any)
      .saveBuildProfileDraft({
        assets: manifest,
        createIfMissing: true,
        expectedRevision: 0,
        name: 'ComHub',
        payload,
        profileId: PROFILE_ID,
      });

    expect(result).toEqual({ profileId: PROFILE_ID, revision: 1, revisionId: 'revision-1' });
    expect(mocks.assets.validateDesktopBuildAssetManifest).toHaveBeenCalledWith(
      expect.objectContaining({ manifest, profileId: PROFILE_ID }),
    );
    expect(mocks.model.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ createIfMissing: true, profileId: PROFILE_ID }),
      expect.anything(),
    );
    expect(mocks.audit.runRequiredAdminAuditMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ audit: expect.any(Function), mutation: expect.any(Function) }),
    );
  });

  it('maps stale draft revisions to a conflict without creating an audit record', async () => {
    mocks.model.saveDraft.mockRejectedValueOnce(
      new Error('DESKTOP_BUILD_PROFILE_REVISION_CONFLICT'),
    );

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .saveBuildProfileDraft({
          assets: manifest,
          expectedRevision: 1,
          name: 'ComHub',
          payload,
          profileId: PROFILE_ID,
        }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'DESKTOP_BUILD_PROFILE_REVISION_CONFLICT',
    });

    expect(mocks.audit.records).not.toHaveBeenCalledWith('create');
  });

  it('archives profiles through a required audit transaction without deleting drafts', async () => {
    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'system-admin-user' } as any)
        .archiveBuildProfile({ profileId: PROFILE_ID }),
    ).resolves.toEqual({ id: PROFILE_ID, status: 'archived' });

    expect(mocks.model.archiveProfile).toHaveBeenCalledWith(
      { actorUserId: 'system-admin-user', profileId: PROFILE_ID },
      expect.anything(),
    );
    expect(mocks.audit.runRequiredAdminAuditMutation).toHaveBeenCalled();
  });

  it('dispatches only an explicitly frozen, complete release through the required audit effect', async () => {
    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).resolves.toEqual({
      ...buildingRelease,
      id: 'release-00000000-4000-8000-000000000002',
    });

    expect(mocks.assets.validateDesktopBuildAssetManifest).toHaveBeenCalledWith(
      expect.objectContaining({ manifest, profileId: PROFILE_ID }),
    );
    expect(mocks.model.freezeDraftForRelease).toHaveBeenCalledWith(
      {
        actorUserId: 'system-admin-user',
        channel: 'stable',
        expectedDraftRevisionId: 'draft-revision-1',
        frozenRevisionId: 'frozen-revision-0000-4000-8000-000000000001',
        profileId: PROFILE_ID,
        releaseId: 'release-00000000-4000-8000-000000000002',
        releaseNotes: 'notes',
        version: '2.4.0',
      },
      expect.anything(),
    );
    expect(mocks.github.dispatchDesktopReleaseWorkflow).toHaveBeenCalledWith({
      channel: 'stable',
      releaseId: 'release-00000000-4000-8000-000000000002',
      releaseNotes: 'notes',
      version: '2.4.0',
    });
    expect(mocks.model.markReleaseDispatched).toHaveBeenCalledWith({
      actorUserId: 'system-admin-user',
      releaseId: 'release-00000000-4000-8000-000000000002',
    });
    expect(mocks.audit.runRequiredAdminAuditMutation).toHaveBeenCalledTimes(1);
    expect(mocks.audit.records).toHaveBeenNthCalledWith(1, 'started');
    expect(mocks.model.freezeDraftForRelease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.model.markReleaseDispatched.mock.invocationCallOrder[0]!,
    );
    expect(mocks.model.markReleaseDispatched.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.github.dispatchDesktopReleaseWorkflow.mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.audit.runRequiredAdminAuditExternalEffect.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.audit.runRequiredAdminAuditMutation.mock.invocationCallOrder[0]!);
    expect(mocks.audit.records).toHaveBeenNthCalledWith(2, 'create');
    expect(mocks.audit.records).toHaveBeenNthCalledWith(3, 'succeeded');
    expect(mocks.audit.records.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.model.markReleaseDispatched.mock.invocationCallOrder[0]!,
    );

    const auditOptions = mocks.audit.runRequiredAdminAuditExternalEffect.mock.calls.at(-1)?.[1] as {
      audit: (status: string) => Promise<{ payload: Record<string, unknown> }>;
    };
    const auditPayloads = await Promise.all([
      auditOptions.audit('started'),
      auditOptions.audit('succeeded'),
      auditOptions.audit('failed'),
    ]);
    expect(auditPayloads.map(({ payload }) => payload)).toEqual([
      {
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseId: 'release-00000000-4000-8000-000000000002',
        revisionId: 'frozen-revision-0000-4000-8000-000000000001',
        version: '2.4.0',
      },
      {
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseId: 'release-00000000-4000-8000-000000000002',
        revisionId: 'frozen-revision-0000-4000-8000-000000000001',
        version: '2.4.0',
      },
      {
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseId: 'release-00000000-4000-8000-000000000002',
        revisionId: 'frozen-revision-0000-4000-8000-000000000001',
        version: '2.4.0',
      },
    ]);
    expect(JSON.stringify(auditPayloads)).not.toContain('notes');

    const creationAuditOptions = mocks.audit.runRequiredAdminAuditMutation.mock.calls.at(
      -1,
    )?.[1] as {
      audit: (result: typeof queuedRelease) => Promise<{ payload: Record<string, unknown> }>;
    };
    const creationAudit = creationAuditOptions.audit({
      ...queuedRelease,
      id: 'release-00000000-4000-8000-000000000002',
    });
    expect(creationAudit).toMatchObject({
      payload: {
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseId: 'release-00000000-4000-8000-000000000002',
        revisionId: 'frozen-revision-0000-4000-8000-000000000001',
        version: '2.4.0',
      },
    });
    const serializedAuditPayloads = JSON.stringify({ auditPayloads, creationAudit });
    for (const forbidden of ['notes', 'token', 'url', 'assets', 'https://']) {
      expect(serializedAuditPayloads).not.toContain(forbidden);
    }
  });

  it('does not freeze, queue, or dispatch when the required external audit cannot start', async () => {
    mocks.audit.runRequiredAdminAuditExternalEffect.mockImplementationOnce(async () => {
      throw new Error('ADMIN_AUDIT_START_FAILED');
    });

    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).rejects.toThrow('ADMIN_AUDIT_START_FAILED');

    expect(mocks.model.freezeDraftForRelease).not.toHaveBeenCalled();
    expect(mocks.model.markReleaseDispatched).not.toHaveBeenCalled();
    expect(mocks.github.dispatchDesktopReleaseWorkflow).not.toHaveBeenCalled();
  });

  it('rolls back release creation when its required audit transaction cannot persist', async () => {
    mocks.audit.runRequiredAdminAuditMutation.mockImplementationOnce(async () => {
      throw new Error('ADMIN_AUDIT_CREATE_FAILED');
    });

    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).rejects.toThrow('ADMIN_AUDIT_CREATE_FAILED');

    expect(mocks.model.freezeDraftForRelease).not.toHaveBeenCalled();
    expect(mocks.model.markReleaseDispatched).not.toHaveBeenCalled();
    expect(mocks.github.dispatchDesktopReleaseWorkflow).not.toHaveBeenCalled();
    expect(mocks.audit.records).toHaveBeenNthCalledWith(1, 'started');
    expect(mocks.audit.records).toHaveBeenNthCalledWith(2, 'failed');
  });

  it('rejects invalid release input before freezing or dispatching', async () => {
    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: 'v2.4.0',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mocks.model.freezeDraftForRelease).not.toHaveBeenCalled();
    expect(mocks.github.dispatchDesktopReleaseWorkflow).not.toHaveBeenCalled();
  });

  it('requires systemWrite to create a release', async () => {
    vi.mocked(getServerDB).mockResolvedValue(createDb('finance_admin'));

    await expect(
      adminDesktopRouter
        .createCaller({ userId: 'finance-admin-user' } as any)
        .createDesktopRelease({
          channel: 'stable',
          profileId: PROFILE_ID,
          releaseNotes: 'notes',
          version: '2.4.0',
        }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.model.freezeDraftForRelease).not.toHaveBeenCalled();
  });

  it('does not freeze or dispatch when final asset validation fails', async () => {
    mocks.assets.validateDesktopBuildAssetManifest.mockRejectedValue(new Error('ASSET_INVALID'));

    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).rejects.toThrow('ASSET_INVALID');
    expect(mocks.model.freezeDraftForRelease).not.toHaveBeenCalled();
    expect(mocks.github.dispatchDesktopReleaseWorkflow).not.toHaveBeenCalled();
  });

  it.each(['DESKTOP_BUILD_IDENTITY_LOCKED', 'DESKTOP_RELEASE_VERSION_CONFLICT'])(
    'does not dispatch when transactional freeze rejects %s',
    async (message) => {
      mocks.model.freezeDraftForRelease.mockRejectedValue(new Error(message));

      await expect(
        adminDesktopRouter
          .createCaller({ userId: 'system-admin-user' } as any)
          .createDesktopRelease({
            channel: 'stable',
            profileId: PROFILE_ID,
            releaseNotes: 'notes',
            version: '2.4.0',
          }),
      ).rejects.toThrow(message);
      expect(mocks.github.dispatchDesktopReleaseWorkflow).not.toHaveBeenCalled();
    },
  );

  it('does not dispatch when the transaction-audited freeze rejects a changed draft', async () => {
    mocks.model.freezeDraftForRelease.mockRejectedValue(new Error('DESKTOP_BUILD_DRAFT_CHANGED'));

    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_DRAFT_CHANGED');

    expect(mocks.audit.runRequiredAdminAuditExternalEffect).toHaveBeenCalledTimes(1);
    expect(mocks.audit.records).toHaveBeenNthCalledWith(1, 'started');
    expect(mocks.audit.records).toHaveBeenNthCalledWith(2, 'failed');
    expect(mocks.model.markReleaseDispatched).not.toHaveBeenCalled();
    expect(mocks.github.dispatchDesktopReleaseWorkflow).not.toHaveBeenCalled();
  });

  it('does not dispatch when the durable building transition fails', async () => {
    mocks.model.markReleaseDispatched.mockRejectedValue(
      new Error('DESKTOP_RELEASE_PERSIST_FAILED'),
    );

    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).rejects.toThrow('DESKTOP_RELEASE_PERSIST_FAILED');

    expect(mocks.github.dispatchDesktopReleaseWorkflow).not.toHaveBeenCalled();
    expect(mocks.model.markReleaseResult).not.toHaveBeenCalled();
    expect(mocks.audit.records).toHaveBeenCalledWith('started');
    expect(mocks.audit.records).toHaveBeenCalledWith('failed');
  });

  it('persists a bounded dispatch failure before recording the failed audit outcome', async () => {
    mocks.github.dispatchDesktopReleaseWorkflow.mockRejectedValue(
      new mocks.github.DesktopReleaseDispatchError(
        'github-dispatch-failed',
        'GitHub dispatch failed (422).',
        'definitive',
      ),
    );

    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).rejects.toThrow('GitHub dispatch failed (422).');

    expect(mocks.model.markReleaseResult).toHaveBeenCalledWith({
      errorSummary: 'GitHub dispatch failed (422).',
      releaseId: 'release-00000000-4000-8000-000000000002',
      status: 'failed',
    });
    expect(mocks.model.markReleaseDispatched.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.github.dispatchDesktopReleaseWorkflow.mock.invocationCallOrder[0]!,
    );
    expect(mocks.github.dispatchDesktopReleaseWorkflow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.model.markReleaseResult.mock.invocationCallOrder[0]!,
    );
    expect(mocks.model.markReleaseResult.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.audit.records.mock.invocationCallOrder.find(
        (_call, index) => mocks.audit.records.mock.calls[index]?.[0] === 'failed',
      )!,
    );
    expect(mocks.audit.records).toHaveBeenNthCalledWith(1, 'started');
    expect(mocks.audit.records).toHaveBeenNthCalledWith(3, 'failed');
  });

  it.each([
    ['timeout', 'github-dispatch-timeout', 'GitHub dispatch timed out.'],
    ['transport failure', 'github-dispatch-failed', 'GitHub dispatch delivery is unknown.'],
  ] as const)(
    'keeps the durable building release when %s delivery is ambiguous',
    async (_name, code, summary) => {
      mocks.github.dispatchDesktopReleaseWorkflow.mockRejectedValue(
        new mocks.github.DesktopReleaseDispatchError(code, summary, 'ambiguous'),
      );

      await expect(
        adminDesktopRouter
          .createCaller({ userId: 'system-admin-user' } as any)
          .createDesktopRelease({
            channel: 'stable',
            profileId: PROFILE_ID,
            releaseNotes: 'notes',
            version: '2.4.0',
          }),
      ).rejects.toThrow(summary);

      expect(mocks.model.markReleaseDispatched).toHaveBeenCalledTimes(1);
      expect(mocks.model.markReleaseResult).not.toHaveBeenCalled();
      expect(mocks.audit.records).toHaveBeenNthCalledWith(1, 'started');
      expect(mocks.audit.records).toHaveBeenNthCalledWith(3, 'failed');
    },
  );

  it('persists a missing-token rejection as a definitive failure without auditing secrets', async () => {
    const token = 'super-secret-token';
    const releaseNotes = 'private release notes';
    mocks.github.dispatchDesktopReleaseWorkflow.mockRejectedValue(
      new mocks.github.DesktopReleaseDispatchError(
        'github-token-missing',
        'Desktop release dispatch is unavailable.',
        'definitive',
      ),
    );

    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes,
        version: '2.4.0',
      }),
    ).rejects.toThrow('Desktop release dispatch is unavailable.');

    expect(mocks.model.markReleaseResult).toHaveBeenCalledWith({
      errorSummary: 'Desktop release dispatch is unavailable.',
      releaseId: 'release-00000000-4000-8000-000000000002',
      status: 'failed',
    });
    expect(JSON.stringify(mocks.audit.records.mock.calls)).not.toContain(token);
    expect(JSON.stringify(mocks.audit.records.mock.calls)).not.toContain(releaseNotes);
  });

  it('propagates failure-state persistence errors without dispatching again or rewriting them', async () => {
    mocks.github.dispatchDesktopReleaseWorkflow.mockRejectedValue(
      new mocks.github.DesktopReleaseDispatchError(
        'github-dispatch-failed',
        'GitHub dispatch failed (422).',
        'definitive',
      ),
    );
    const persistenceError = new Error('DESKTOP_RELEASE_FAILURE_PERSIST_FAILED');
    mocks.model.markReleaseResult.mockRejectedValue(persistenceError);

    await expect(
      adminDesktopRouter.createCaller({ userId: 'system-admin-user' } as any).createDesktopRelease({
        channel: 'stable',
        profileId: PROFILE_ID,
        releaseNotes: 'notes',
        version: '2.4.0',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'DESKTOP_RELEASE_FAILURE_PERSIST_FAILED',
    });

    expect(mocks.github.dispatchDesktopReleaseWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.model.markReleaseResult).toHaveBeenCalledTimes(1);
    expect(mocks.audit.records).toHaveBeenCalledWith('failed');
  });
});
