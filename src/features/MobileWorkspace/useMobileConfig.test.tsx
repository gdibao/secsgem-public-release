import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MOBILE_CONFIG } from '@/const/mobileConfig';
import { lambdaClient } from '@/libs/trpc/client';

import { useMobileConfig } from './useMobileConfig';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    admin: {
      settings: {
        getPublicMobileConfigSnapshot: { query: vi.fn() },
      },
    },
  },
}));

const wrapper = ({ children }: PropsWithChildren) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

describe('useMobileConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('uses a stable default immediately and normalizes the public response', async () => {
    vi.mocked(lambdaClient.admin.settings.getPublicMobileConfigSnapshot.query).mockResolvedValue({
      config: {
        ...DEFAULT_MOBILE_CONFIG,
        brand: { displayName: 'Mobile Brand', logoUrl: null },
        discover: { ...DEFAULT_MOBILE_CONFIG.discover, featuredAssistants: [] },
      },
      revision: 7,
      updatedAt: '2026-07-20T07:00:00.000Z',
    });

    const { result } = renderHook(() => useMobileConfig(), { wrapper });

    expect(result.current.config).toEqual(DEFAULT_MOBILE_CONFIG);
    await waitFor(() => expect(result.current.config.brand.displayName).toBe('Mobile Brand'));
    expect(result.current.revision).toBe(7);
    expect(result.current.updatedAt).toBe('2026-07-20T07:00:00.000Z');
    expect(result.current.error).toBeUndefined();
    expect(result.current.mutate).toEqual(expect.any(Function));
  });

  it('keeps the safe default and exposes an error when the public request fails', async () => {
    vi.mocked(lambdaClient.admin.settings.getPublicMobileConfigSnapshot.query).mockRejectedValue(
      new Error('offline'),
    );

    const { result } = renderHook(() => useMobileConfig(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.config).toEqual(DEFAULT_MOBILE_CONFIG);
    expect(result.current.isUsingCachedConfig).toBe(false);
  });

  it('keeps the last known good brand and navigation while offline', async () => {
    window.localStorage.setItem(
      'comhub.mobile-config.last-known-good',
      JSON.stringify({
        config: {
          ...DEFAULT_MOBILE_CONFIG,
          brand: { displayName: 'Cached Brand', logoUrl: null },
        },
        revision: 6,
        updatedAt: '2026-07-20T06:00:00.000Z',
      }),
    );
    vi.mocked(lambdaClient.admin.settings.getPublicMobileConfigSnapshot.query).mockRejectedValue(
      new Error('offline'),
    );

    const { result } = renderHook(() => useMobileConfig(), { wrapper });

    expect(result.current.config.brand.displayName).toBe('Cached Brand');
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.revision).toBe(6);
    expect(result.current.isUsingCachedConfig).toBe(true);
  });
});
