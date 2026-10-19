import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminCommercialService } from '@/services/adminCommercial';

import { moduleAppCacheKeys } from './cacheKeys';
import { useModuleAppDetail } from './useModuleAppDetail';

const swrState = vi.hoisted(() => ({
  data: undefined as unknown,
  error: undefined as unknown,
  isLoading: false,
  mutate: vi.fn(),
}));

const useClientDataSWR = vi.hoisted(() =>
  vi.fn((_key?: unknown, _fetcher?: () => Promise<unknown>) => swrState),
);

vi.mock('@/libs/swr', () => ({ useClientDataSWR }));
vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: { moduleApps: { get: vi.fn() } },
}));

describe('useModuleAppDetail', () => {
  beforeEach(() => {
    swrState.data = undefined;
    swrState.error = undefined;
    swrState.isLoading = false;
    swrState.mutate.mockReset();
    useClientDataSWR.mockClear();
  });

  it('uses the stable detail key and exposes the SWR refresh function', async () => {
    const app = { displayName: 'Calendar', id: 'app-1' };
    swrState.data = app;

    const { result } = renderHook(() => useModuleAppDetail('app-1'));
    const [key, fetcher] = useClientDataSWR.mock.calls[0];

    expect(key).toEqual(moduleAppCacheKeys.detail('app-1'));
    expect(result.current).toEqual({
      app,
      error: undefined,
      isLoading: false,
      refresh: swrState.mutate,
    });

    await fetcher!();
    expect(adminCommercialService.moduleApps.get).toHaveBeenCalledWith({ appId: 'app-1' });
  });

  it('does not fetch without an app id', () => {
    renderHook(() => useModuleAppDetail(undefined));

    expect(useClientDataSWR.mock.calls[0][0]).toBeNull();
  });
});
