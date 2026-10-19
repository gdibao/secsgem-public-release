import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';
import type { GlobalServerConfig } from '@/types/serverConfig';

import { useMenu } from '../UserPanel/useMenu';

const createWrapper =
  (
    serverConfig: GlobalServerConfig = { aiProvider: {}, telemetry: {} },
  ): React.JSXElementConstructor<{ children: React.ReactNode }> =>
  ({ children }) => {
    const store = initServerConfigStore({ serverConfig });

    return <Provider createStore={() => store}>{children}</Provider>;
  };

const findMenuItem = (items: NonNullable<ReturnType<typeof useMenu>['mainItems']>, key: string) =>
  items.find(
    (item): item is { key: string; label: React.ReactNode } => {
      if (!item || typeof item !== 'object') return false;

      return 'key' in item && (item as { key?: unknown }).key === key && 'label' in item;
    },
  );

// Mock dependencies
vi.mock('next/link', () => ({
  default: vi.fn(({ children }) => <div>{children}</div>),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

vi.mock('@/hooks/useInterceptingRoutes', () => ({
  useOpenSettings: vi.fn(() => vi.fn()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key) => key),
  })),
}));

vi.mock('@/services/config', () => ({
  configService: {
    exportAgents: vi.fn(),
    exportAll: vi.fn(),
    exportSessions: vi.fn(),
    exportSettings: vi.fn(),
  },
}));

vi.mock('./useNewVersion', () => ({
  useNewVersion: vi.fn(() => false),
}));

describe('useMenu', () => {
  it('should provide correct menu items when user is logged in with auth', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), { wrapper: createWrapper() });

    act(() => {
      const { mainItems, logoutItems } = result.current;
      // 'setting' is shown when logged in
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(true);
      expect(mainItems?.some((item) => item?.key === 'upgrade-plan')).toBe(true);
      // 'memory' is gated behind the showMemory nav-layout flag (defaults off)
      expect(mainItems?.some((item) => item?.key === 'memory')).toBe(false);
      // 'logout' is shown when isLoginWithAuth is true
      expect(logoutItems.some((item) => item?.key === 'logout')).toBe(true);
    });
  });

  it('should provide correct menu items when user is not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false });
    });

    const { result } = renderHook(() => useMenu(), { wrapper: createWrapper() });

    act(() => {
      const { mainItems, logoutItems } = result.current;
      // When not logged in, setting and memory should not be shown
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(false);
      expect(mainItems?.some((item) => item?.key === 'memory')).toBe(false);
      expect(logoutItems.some((item) => item?.key === 'logout')).toBe(false);
    });
  });

  it('should not have consecutive dividers in mainItems', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), { wrapper: createWrapper() });

    act(() => {
      const { mainItems } = result.current;
      if (!mainItems) return;

      for (let i = 1; i < mainItems.length; i++) {
        const prev = mainItems[i - 1];
        const curr = mainItems[i];
        const isDivider = (item: any) =>
          item && typeof item === 'object' && item.type === 'divider';
        expect(isDivider(prev) && isDivider(curr)).toBe(false);
      }
    });
  });

  it('does not show admin configured help menu links in the user panel', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), {
      wrapper: createWrapper({
        aiProvider: {},
        customization: {
          helpMenuItems: [{ label: 'Admin Docs', url: 'https://docs.example.com' }],
        },
        telemetry: {},
      }),
    });

    const docsItem = findMenuItem(result.current.mainItems ?? [], 'custom-help-0');

    expect(docsItem).toBeUndefined();
  });
});
