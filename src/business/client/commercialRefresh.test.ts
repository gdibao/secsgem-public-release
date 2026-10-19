import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMERCIAL_ENTITLEMENT_SWR_KEYS,
  refreshCommercialEntitlementState,
} from './commercialRefresh';

const { mutateMock, refreshAiProviderRuntimeStateMock, refreshUserStateMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  refreshAiProviderRuntimeStateMock: vi.fn(),
  refreshUserStateMock: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  mutate: mutateMock,
}));

vi.mock('@/store/aiInfra/store', () => ({
  getAiInfraStoreState: () => ({
    refreshAiProviderRuntimeState: refreshAiProviderRuntimeStateMock,
  }),
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({
    refreshUserState: refreshUserStateMock,
  }),
}));

describe('refreshCommercialEntitlementState', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    refreshAiProviderRuntimeStateMock.mockReset();
    refreshUserStateMock.mockReset();
  });

  it('refreshes commercial caches, user state, and AI provider runtime state', async () => {
    mutateMock.mockResolvedValue(undefined);
    refreshUserStateMock.mockResolvedValue(undefined);
    refreshAiProviderRuntimeStateMock.mockResolvedValue(undefined);

    await refreshCommercialEntitlementState([['business-referral-overview']]);

    for (const key of COMMERCIAL_ENTITLEMENT_SWR_KEYS) {
      expect(mutateMock).toHaveBeenCalledWith(key);
    }

    expect(COMMERCIAL_ENTITLEMENT_SWR_KEYS).toEqual(
      expect.arrayContaining([['commercial.listBillingOrders'], ['commercial.listCreditPackages']]),
    );

    expect(mutateMock).toHaveBeenCalledWith(['business-referral-overview']);
    expect(refreshUserStateMock).toHaveBeenCalledTimes(1);
    expect(refreshAiProviderRuntimeStateMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when one refresh target fails after the entitlement change already succeeded', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mutateMock.mockRejectedValueOnce(new Error('network'));
    mutateMock.mockResolvedValue(undefined);
    refreshUserStateMock.mockResolvedValue(undefined);
    refreshAiProviderRuntimeStateMock.mockResolvedValue(undefined);

    await expect(refreshCommercialEntitlementState()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to refresh commercial entitlement state:',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
