// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

const { mockGetServerDB, mockModel, mockS3 } = vi.hoisted(() => ({
  mockGetServerDB: vi.fn(),
  mockModel: {
    getRelease: vi.fn(),
    getRevision: vi.fn(),
  },
  mockS3: {
    createPreSignedUrlForPreview: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({ getServerDB: mockGetServerDB }));
vi.mock('@/database/models/desktopBuild', () => ({
  DesktopBuildModel: vi.fn(() => mockModel),
}));
vi.mock('@/server/modules/S3', () => ({ FileS3: vi.fn(() => mockS3) }));

const request = (releaseId: string, token = 'dedicated-secret') =>
  new Request(`https://chat.qingyouai.com/api/admin/desktop-release/${releaseId}/profile`, {
    headers: { authorization: `Bearer ${token}` },
  }) as any;
const context = (releaseId: string) => ({ params: Promise.resolve({ releaseId }) });

const asset = (kind: string, contentType: string, sha256: string) => ({
  contentType,
  key: `desktop-build-assets/profile/${kind}`,
  kind,
  sha256,
  size: 1024,
});

describe('GET /api/admin/desktop-release/:releaseId/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DESKTOP_RELEASE_TOKEN = 'dedicated-secret';
    mockGetServerDB.mockResolvedValue({ query: { appSettings: { findFirst: vi.fn() } } });
    mockModel.getRelease.mockResolvedValue({
      frozenRevisionId: '22222222-2222-4222-8222-222222222222',
      id: '11111111-1111-4111-8111-111111111111',
      profileId: '33333333-3333-4333-8333-333333333333',
      status: 'building',
    });
    mockModel.getRevision.mockResolvedValue({
      assetManifest: {
        appPreview: asset('appPreview', 'image/png', 'a'.repeat(64)),
        nsisHeader: asset('nsisHeader', 'image/bmp', 'b'.repeat(64)),
        nsisSidebar: asset('nsisSidebar', 'image/bmp', 'c'.repeat(64)),
        windowsIcon: asset('windowsIcon', 'image/x-icon', 'd'.repeat(64)),
      },
      id: '22222222-2222-4222-8222-222222222222',
      payload: { applicationId: 'com.qingyou.comhub', applicationName: 'ComHub' },
      profileId: '33333333-3333-4333-8333-333333333333',
      revision: 2,
      state: 'frozen',
    });
    mockS3.createPreSignedUrlForPreview.mockImplementation(
      async (key: string) => `https://signed.example.test/${key}`,
    );
  });

  it('returns exactly one frozen revision with complete short-lived asset URLs and no secrets', async () => {
    const response = await GET(
      request('11111111-1111-4111-8111-111111111111'),
      context('11111111-1111-4111-8111-111111111111'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      profileRevision: {
        id: '22222222-2222-4222-8222-222222222222',
        state: 'frozen',
      },
      releaseId: '11111111-1111-4111-8111-111111111111',
    });
    expect(Object.keys(body.assets).sort()).toEqual([
      'appPreview',
      'nsisHeader',
      'nsisSidebar',
      'windowsIcon',
    ]);
    expect(body.assets.appPreview).toMatchObject({
      contentType: 'image/png',
      sha256: 'a'.repeat(64),
      size: 1024,
      url: expect.stringContaining('https://signed.example.test/'),
    });
    expect(mockS3.createPreSignedUrlForPreview).toHaveBeenCalledTimes(4);
    expect(mockS3.createPreSignedUrlForPreview).toHaveBeenCalledWith(expect.any(String), 300);
    expect(JSON.stringify(body)).not.toMatch(/accessKey|secretAccessKey|bucket|token|upload/i);
  });

  it.each(['succeeded', 'failed', 'publishing'])('rejects a %s release', async (status) => {
    mockModel.getRelease.mockResolvedValueOnce({
      frozenRevisionId: '22222222-2222-4222-8222-222222222222',
      id: '11111111-1111-4111-8111-111111111111',
      profileId: '33333333-3333-4333-8333-333333333333',
      status,
    });

    const response = await GET(
      request('11111111-1111-4111-8111-111111111111'),
      context('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(409);
  });

  it('rejects unauthenticated requests and mismatched frozen revisions', async () => {
    const unauthorized = await GET(
      request('11111111-1111-4111-8111-111111111111', 'wrong'),
      context('11111111-1111-4111-8111-111111111111'),
    );
    expect(unauthorized.status).toBe(401);

    mockModel.getRevision.mockResolvedValueOnce({
      id: 'different-revision',
      state: 'frozen',
    });
    const mismatch = await GET(
      request('11111111-1111-4111-8111-111111111111'),
      context('11111111-1111-4111-8111-111111111111'),
    );
    expect(mismatch.status).toBe(409);
  });

  it('rejects a frozen revision owned by another profile', async () => {
    mockModel.getRevision.mockResolvedValueOnce({
      assetManifest: {
        appPreview: asset('appPreview', 'image/png', 'a'.repeat(64)),
        nsisHeader: asset('nsisHeader', 'image/bmp', 'b'.repeat(64)),
        nsisSidebar: asset('nsisSidebar', 'image/bmp', 'c'.repeat(64)),
        windowsIcon: asset('windowsIcon', 'image/x-icon', 'd'.repeat(64)),
      },
      id: '22222222-2222-4222-8222-222222222222',
      payload: { applicationId: 'com.qingyou.comhub', applicationName: 'ComHub' },
      profileId: '44444444-4444-4444-8444-444444444444',
      revision: 2,
      state: 'frozen',
    });

    const response = await GET(
      request('11111111-1111-4111-8111-111111111111'),
      context('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(409);
    expect(mockS3.createPreSignedUrlForPreview).not.toHaveBeenCalled();
  });
});
