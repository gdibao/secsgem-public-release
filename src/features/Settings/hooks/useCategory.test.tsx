import { act, renderHook } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';
import { useUserStore } from '@/store/user';

import { SettingsGroupKey, useCategory } from './useCategory';

const userStoreMock = vi.hoisted(() => {
  const initialState = {
    enableExecutionDeviceSwitcher: false,
    isSignedIn: false,
    preference: {
      lab: {
        enableOAuthApps: false,
      },
    },
    settings: {
      general: {
        isDevMode: false,
      },
    },
    user: undefined as any,
  };
  let state: typeof initialState = { ...initialState };
  const useStore = ((selector: (state: typeof initialState) => unknown) => selector(state)) as any;

  useStore.getState = () => state;
  useStore.setState = (patch: Partial<typeof state>, replace?: boolean) => {
    state = replace ? ({ ...patch } as typeof state) : { ...state, ...patch };
  };

  return { initialState, useStore };
});

const serverConfigMock = vi.hoisted(() => {
  const initialState = {
    enableBusinessFeatures: true,
    featureFlags: {
      hideDocs: false,
      showApiKeyManage: false,
      showProvider: true,
    },
    isMobile: false,
  };
  let state: typeof initialState = {
    ...initialState,
    featureFlags: { ...initialState.featureFlags },
  };
  const useStore = ((selector: (state: typeof initialState) => unknown) => selector(state)) as any;

  return {
    reset: () => {
      state = { ...initialState, featureFlags: { ...initialState.featureFlags } };
    },
    setShowProvider: (showProvider: boolean) => {
      state = { ...state, featureFlags: { ...state.featureFlags, showProvider } };
    },
    useStore,
  };
});

const localStorageMock = vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage = {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  } satisfies Storage;

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
  }

  return storage;
});

vi.mock('@/store/user', () => ({
  useUserStore: userStoreMock.useStore,
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableExecutionDeviceSwitcher: (s: typeof userStoreMock.initialState) =>
      Boolean(s.enableExecutionDeviceSwitcher),
    enableOAuthApps: (s: typeof userStoreMock.initialState) =>
      Boolean(s.preference?.lab?.enableOAuthApps),
  },
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  userProfileSelectors: {
    nickName: (s: typeof userStoreMock.initialState) => s.user?.username,
    userAvatar: (s: typeof userStoreMock.initialState) => s.user?.avatar,
    userProfile: (s: typeof userStoreMock.initialState) => s.user,
  },
}));

vi.mock('@/store/user/slices/settings/selectors', () => ({
  userGeneralSettingsSelectors: {
    config: (s: typeof userStoreMock.initialState) => s.settings.general,
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: { remoteServerUrl?: string }) => unknown) =>
    selector({ remoteServerUrl: undefined }),
}));

vi.mock('@/store/electron/selectors', () => ({
  electronSyncSelectors: {
    remoteServerUrl: (s: { remoteServerUrl?: string }) => s.remoteServerUrl,
  },
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (s: {
    featureFlags: {
      hideDocs: boolean;
      showApiKeyManage: boolean;
      showProvider: boolean;
    };
  }) => s.featureFlags,
  serverConfigSelectors: {
    enableBusinessFeatures: (s: { enableBusinessFeatures: boolean }) => s.enableBusinessFeatures,
  },
  useServerConfigStore: serverConfigMock.useStore,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

const hasAdminItem = (groups: ReturnType<typeof useCategory>) =>
  groups.some((group) => group.items.some((item) => item.key === SettingsTabs.Admin));

const getItemKeys = (showProvider = true) => {
  serverConfigMock.setShowProvider(showProvider);
  const { result } = renderHook(() => useCategory());

  return result.current.flatMap((group) => group.items.map((item) => item.key));
};

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  cleanup();
  localStorageMock.clear();
  serverConfigMock.reset();
  act(() => {
    useUserStore.setState(initialUserStoreState, true);
  });
});

describe('settings useCategory', () => {
  // Account-level settings (profile / appearance / hotkeys) form their own
  // group so the workspace sidebar can mirror exactly this set; the General
  // group keeps the personal-scoped data pages.
  it('splits account-level tabs into a leading Account group', () => {
    const { result } = renderHook(() => useCategory());
    const accountGroup = result.current.find((group) => group.key === SettingsGroupKey.Account);
    const generalGroup = result.current.find((group) => group.key === SettingsGroupKey.General);

    expect(result.current[0]?.key).toBe(SettingsGroupKey.Account);
    expect(accountGroup?.items.map((item) => item.key)).toEqual([
      SettingsTabs.Profile,
      SettingsTabs.Appearance,
      SettingsTabs.Hotkey,
      SettingsTabs.Messenger,
    ]);
    expect(generalGroup?.items.map((item) => item.key)).toEqual([
      SettingsTabs.Stats,
      SettingsTabs.Devices,
      SettingsTabs.Notification,
    ]);
    expect(
      result.current.find((group) => group.key === SettingsGroupKey.Agent)?.items.map((i) => i.key),
    ).not.toContain(SettingsTabs.Messenger);
  });

  it('keeps Provider visible when provider settings are enabled', () => {
    expect(getItemKeys()).toContain(SettingsTabs.Provider);
  });

  it('hides Provider when provider settings are disabled', () => {
    expect(getItemKeys(false)).not.toContain(SettingsTabs.Provider);
  });

  it('hides admin settings entry for non-admin users', () => {
    act(() => {
      useUserStore.setState({
        isSignedIn: true,
        user: { id: 'user-1', role: 'user', username: 'user' } as any,
      });
    });

    const { result } = renderHook(() => useCategory());

    expect(hasAdminItem(result.current)).toBe(false);
  });

  it('shows admin settings entry for admin users', () => {
    act(() => {
      useUserStore.setState({
        isSignedIn: true,
        user: { id: 'admin-1', role: 'admin', username: 'admin' } as any,
      });
    });

    const { result } = renderHook(() => useCategory());

    expect(hasAdminItem(result.current)).toBe(true);
  });

  it('hides OAuth Apps by default', () => {
    expect(getItemKeys()).not.toContain(SettingsTabs.OAuthApps);
  });

  it('shows OAuth Apps when the Labs preference is enabled', () => {
    useUserStore.setState({
      preference: {
        ...initialUserStoreState.preference,
        lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
      },
    });

    const { result } = renderHook(() => useCategory());
    const developerGroup = result.current.find((group) => group.key === SettingsGroupKey.Developer);
    const systemGroup = result.current.find((group) => group.key === SettingsGroupKey.System);

    expect(developerGroup?.items.map((item) => item.key)).toContain(SettingsTabs.OAuthApps);
    expect(systemGroup?.items.map((item) => item.key)).not.toContain(SettingsTabs.OAuthApps);
  });
});
