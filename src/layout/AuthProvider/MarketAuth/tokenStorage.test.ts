import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearMarketTokensFromDB } from './tokenStorage';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
}));

vi.mock('@/store/user', () => ({
  useUserStore: { getState: mocks.getState },
}));

describe('MarketAuth token storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists null when clearing stored tokens', async () => {
    const setSettings = vi.fn().mockResolvedValue(undefined);
    mocks.getState.mockReturnValue({
      defaultSettings: {},
      setSettings,
      settings: {
        market: {
          accessToken: 'expired-access-token',
          expiresAt: 1,
          refreshToken: 'invalid-refresh-token',
        },
      },
    });

    await clearMarketTokensFromDB();

    expect(setSettings).toHaveBeenCalledWith({ market: null });
  });
});
