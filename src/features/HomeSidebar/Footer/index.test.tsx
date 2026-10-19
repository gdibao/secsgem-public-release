import type * as LobechatConst from '@lobechat/const';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

const analyticsTrack = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) =>
      ({
        'changelog': 'Changelog',
        'getApp': 'Get App',
        'userPanel.discord': 'Discord',
        'userPanel.docs': 'Docs',
        'userPanel.feedback': 'Feedback',
        'userPanel.help': 'Help',
        'userPanel.inviteFriend': 'Invite a friend',
        'userPanel.setting': 'Settings',
      })[key] || key,
  }),
}));

interface RenderFooterOptions {
  billboardItems?: unknown[];
  customization?: Record<string, unknown>;
  desktop?: boolean;
  enableBusinessFeatures?: boolean;
  hideGitHub?: boolean;
  homeSidebar?: boolean;
  mobile?: boolean;
  publicHelpMenu?: unknown;
  readSlugs?: string[];
  serverConfigInit?: boolean;
}

let mockServerConfigState: Record<string, unknown>;
let mockUserState: Record<string, unknown>;

interface MockStoreHook {
  (selector: (state: Record<string, unknown>) => unknown): unknown;
  getState: () => Record<string, unknown>;
}

const createGlobalState = (readSlugs: string[] = []) => ({
  status: {
    readNotificationSlugs: readSlugs,
  },
  updateSystemStatus: vi.fn((patch: { readNotificationSlugs?: string[] }) => {
    mockGlobalState = {
      ...mockGlobalState,
      status: {
        ...(mockGlobalState.status as Record<string, unknown>),
        ...patch,
      },
    };
  }),
});

let mockGlobalState: {
  status: Record<string, unknown>;
  updateSystemStatus: ReturnType<typeof vi.fn>;
};

const renderFooter = async ({
  billboardItems = [],
  customization,
  desktop = false,
  enableBusinessFeatures = false,
  homeSidebar = false,
  hideGitHub = true,
  mobile = false,
  publicHelpMenu = null,
  readSlugs = [],
  serverConfigInit = true,
}: RenderFooterOptions = {}) => {
  vi.resetModules();
  analyticsTrack.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  });

  mockGlobalState = createGlobalState(readSlugs);
  mockServerConfigState = {
    enableBusinessFeatures,
    isMobile: mobile,
    serverConfig: { customization, enableBusinessFeatures },
    serverConfigInit,
  };
  mockUserState = {
    defaultSettings: {},
    settings: { general: { isDevMode: false } },
  };

  vi.doMock('@lobechat/const', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof LobechatConst;

    return {
      ...actual,
      isDesktop: desktop,
    };
  });
  function createAnalyticsApi() {
    return {
      analytics: { track: analyticsTrack },
    };
  }
  vi.doMock('@/libs/analytics/client', () => ({
    useAnalytics: createAnalyticsApi,
  }));
  const renderMenuLabels = (
    items?: Array<{
      key?: string;
      label?: ReactNode;
      onClick?: (info: unknown) => void;
      type?: string;
    }>,
  ) => (
    <div data-testid="help-menu-items">
      {(items || []).map((item, index) =>
        item?.type === 'divider' ? null : (
          <div
            key={item?.key || index}
            onClick={(event) => {
              event.stopPropagation();
              item?.onClick?.({});
            }}
          >
            {item?.label}
          </div>
        ),
      )}
    </div>
  );
  vi.doMock('@lobehub/ui', () => ({
    ActionIcon: ({
      'aria-label': ariaLabel,
      onClick,
      title,
    }: {
      'aria-label'?: string;
      'onClick'?: () => void;
      'title'?: string;
    }) => <button aria-label={ariaLabel} title={title} type="button" onClick={onClick} />,
    DropdownMenu: ({
      children,
      items,
      onOpenChange,
    }: {
      children?: ReactNode;
      items?: Array<{
        key?: string;
        label?: ReactNode;
        onClick?: (info: unknown) => void;
        type?: string;
      }>;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <div onClick={() => onOpenChange?.(true)}>
        {children}
        {renderMenuLabels(items)}
      </div>
    ),
    Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Icon: () => <span />,
  }));
  vi.doMock('@/components/ChangelogModal', () => ({
    default: vi.fn(),
    openChangelogModal: vi.fn(),
  }));
  vi.doMock('@/components/FeedbackModal', () => ({
    default: vi.fn(),
    openFeedbackModal: vi.fn(),
  }));
  vi.doMock('@/features/Billboard', () => ({
    default: () => null,
  }));
  vi.doMock('@/features/Billboard/MenuItems', () => ({
    useBillboardMenuItems: () => billboardItems,
  }));
  vi.doMock('@/features/Brand', () => ({
    useBrand: () => ({ sidebarMemberLabel: 'Upgrade plan', sidebarMemberUrl: '/settings/plans' }),
  }));
  vi.doMock('@/features/NavPanel/useActiveNavKey', () => ({
    useActiveNavKey: () => (homeSidebar ? 'home' : 'discover'),
  }));
  vi.doMock('@/business/client/hooks/useHasActiveWorkspace', () => ({
    useHasActiveWorkspace: () => false,
  }));
  vi.doMock('@/features/User/UserPanel/ThemeButton', () => ({
    default: () => null,
  }));
  vi.doMock('@/features/Workspace/WorkspaceLink', () => ({
    default: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  }));
  function createNavLayoutState() {
    return {
      bottomMenuItems: [],
      footer: {
        hideGitHub,
        layout: 'compact',
        showEvalEntry: false,
        showSettingsEntry: true,
      },
      topNavItems: [],
      userPanel: {
        showDataImporter: false,
        showMemory: true,
      },
    };
  }
  vi.doMock('@/hooks/useNavLayout', () => ({
    useNavLayout: createNavLayoutState,
  }));
  function selectFromServerConfigStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector(mockServerConfigState);
  }
  vi.doMock('@/store/serverConfig', () => ({
    serverConfigSelectors: {
      enableBusinessFeatures: (state: Record<string, unknown>) =>
        Boolean((state.serverConfig as Record<string, unknown>)?.enableBusinessFeatures),
    },
    useServerConfigStore: selectFromServerConfigStore,
  }));
  function selectFromUserStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector(mockUserState);
  }
  vi.doMock('@/store/user', () => ({
    useUserStore: selectFromUserStore,
  }));
  vi.doMock('@/store/user/selectors', () => ({
    userGeneralSettingsSelectors: {
      config: (state: Record<string, unknown>) =>
        ((state.settings as Record<string, unknown>)?.general as Record<string, unknown>) ?? {},
    },
  }));
  vi.doMock('@/services/adminCommercial', () => ({
    adminCommercialService: {
      getPublicHelpMenu: vi.fn().mockResolvedValue(publicHelpMenu),
    },
  }));

  const { default: Footer } = await import('./index');

  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <Footer />
    </SWRConfig>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock('@lobechat/const');
  vi.doUnmock('@lobehub/analytics/react');
  vi.doUnmock('@lobehub/ui');
  vi.doUnmock('@/libs/analytics/client');
  vi.doUnmock('@/components/ChangelogModal');
  vi.doUnmock('@/components/FeedbackModal');
  vi.doUnmock('@/features/Billboard');
  vi.doUnmock('@/features/Billboard/MenuItems');
  vi.doUnmock('@/features/Brand');
  vi.doUnmock('@/business/client/hooks/useHasActiveWorkspace');
  vi.doUnmock('@/features/NavPanel/useActiveNavKey');
  vi.doUnmock('@/features/User/UserPanel/ThemeButton');
  vi.doUnmock('@/features/Workspace/WorkspaceLink');
  vi.doUnmock('@/hooks/useNavLayout');
  vi.doUnmock('@/store/serverConfig');
  vi.doUnmock('@/store/user');
  vi.doUnmock('@/store/user/selectors');
  vi.doUnmock('@/services/adminCommercial');
});

describe('Footer', () => {
  it('shows the configured membership CTA in the home sidebar footer', async () => {
    await renderFooter({ enableBusinessFeatures: true, homeSidebar: true });

    expect(screen.getByRole('link', { name: /Upgrade plan/ })).toHaveAttribute(
      'href',
      '/settings/plans',
    );
  }, 20000);

  it('does not restore default help links when the public help menu is explicitly empty', async () => {
    await renderFooter({ publicHelpMenu: [] });

    await waitFor(() => {
      expect(screen.queryByText('Docs')).not.toBeInTheDocument();
      expect(screen.queryByText('Feedback')).not.toBeInTheDocument();
      expect(screen.queryByText('Discord')).not.toBeInTheDocument();
      expect(screen.queryByText('Changelog')).not.toBeInTheDocument();
    });
  }, 20000);

  it('uses default help links while the public help menu setting is missing', async () => {
    await renderFooter({ publicHelpMenu: null });

    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('Feedback')).toBeInTheDocument();
    expect(screen.getByText('Discord')).toBeInTheDocument();
    expect(screen.getByText('Changelog')).toBeInTheDocument();
  }, 20000);
});

describe('Footer help menu tracking', () => {
  it('shows Get App immediately before GitHub on web', async () => {
    const user = userEvent.setup();
    await renderFooter({ hideGitHub: false });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const getApp = await screen.findByRole('link', { name: 'Get App' });
    const github = screen.getByRole('link', { name: 'GitHub' });

    expect(getApp).toHaveAttribute('href', '/apps');
    expect(getApp.compareDocumentPosition(github) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 20000);

  it('shows Get App in desktop builds too', async () => {
    const user = userEvent.setup();
    await renderFooter({ desktop: true, hideGitHub: false });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(await screen.findByRole('link', { name: 'Get App' })).toHaveAttribute('href', '/apps');
  }, 20000);

  it('tracks menu open with the visible item keys', async () => {
    const user = userEvent.setup();
    await renderFooter({ enableBusinessFeatures: true });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const openedCall = analyticsTrack.mock.calls.find(
      ([event]) => event?.name === 'home_footer_menu_opened',
    );
    expect(openedCall).toBeTruthy();
    expect((openedCall![0].properties.keys as string).split(',')).toContain('inviteFriend');
  }, 20000);

  it('tracks a unified click event when the invite friend entry is clicked', async () => {
    const user = userEvent.setup();
    await renderFooter({ enableBusinessFeatures: true });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(await screen.findByText('Invite a friend'));

    expect(analyticsTrack).toHaveBeenCalledWith({
      name: 'home_footer_menu_clicked',
      properties: { key: 'inviteFriend', spm: 'homepage.footer.inviteFriend.clicked' },
    });
  }, 20000);

  it('does not render the invite friend entry without business features', async () => {
    const user = userEvent.setup();
    await renderFooter({ enableBusinessFeatures: false });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.queryByText('Invite a friend')).not.toBeInTheDocument();
  }, 20000);

  it('excludes billboard items from the opened keys to keep per-key CTR aligned', async () => {
    const user = userEvent.setup();
    await renderFooter({
      billboardItems: [{ key: 'billboard-promo', label: 'Promo', onClick: vi.fn() }],
      enableBusinessFeatures: true,
      homeSidebar: true,
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const openedCall = analyticsTrack.mock.calls.find(
      ([event]) => event?.name === 'home_footer_menu_opened',
    );
    const keys = (openedCall![0].properties.keys as string).split(',');
    // own items are tracked and reported as exposure...
    expect(keys).toContain('inviteFriend');
    // ...but billboard items (which emit their own billboard_* events) are not,
    // so their CTR denominator never gets an orphaned exposure.
    expect(keys).not.toContain('billboard-promo');
  }, 20000);
});
