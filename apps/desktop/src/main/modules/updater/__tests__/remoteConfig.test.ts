import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchRemoteUpdateConfig } from '../remoteConfig';

const { mockGetDesktopEnv, mockNetFetch } = vi.hoisted(() => ({
  mockGetDesktopEnv: vi.fn(() => ({
    OFFICIAL_CLOUD_SERVER: 'https://chat.qingyouai.com/',
  })),
  mockNetFetch: vi.fn(),
}));

vi.mock('electron', () => ({
  net: {
    fetch: mockNetFetch,
  },
}));

vi.mock('@/env', () => ({
  getDesktopEnv: mockGetDesktopEnv,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('fetchRemoteUpdateConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDesktopEnv.mockReturnValue({
      OFFICIAL_CLOUD_SERVER: 'https://chat.qingyouai.com/',
    });
  });

  it('should read desktop update config from the tRPC data.json payload', async () => {
    mockNetFetch.mockResolvedValue({
      json: async () => ({
        result: {
          data: {
            json: {
              autoCheck: false,
              channel: 'canary',
              checkIntervalMinutes: 30,
              serverUrl: 'https://releases.qingyouai.com/releases',
            },
          },
        },
      }),
      ok: true,
    });

    const config = await fetchRemoteUpdateConfig();

    expect(mockNetFetch).toHaveBeenCalledWith(
      'https://chat.qingyouai.com/trpc/lambda/admin.settings.getPublicDesktopUpdate',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(config).toEqual({
      autoCheck: false,
      channel: 'canary',
      checkIntervalMinutes: 30,
      serverUrl: 'https://releases.qingyouai.com/releases',
    });
  });

  it('should return null when no cloud server is configured', async () => {
    mockGetDesktopEnv.mockReturnValue({
      OFFICIAL_CLOUD_SERVER: '',
    });

    await expect(fetchRemoteUpdateConfig()).resolves.toBeNull();
    expect(mockNetFetch).not.toHaveBeenCalled();
  });

  it('should return null when remote config cannot be loaded', async () => {
    mockNetFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchRemoteUpdateConfig()).resolves.toBeNull();
  });

  it('should return null when remote config request fails', async () => {
    mockNetFetch.mockRejectedValue(new Error('network timeout'));

    await expect(fetchRemoteUpdateConfig()).resolves.toBeNull();
  });
});
