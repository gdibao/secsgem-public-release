import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MOBILE_WORKSPACE_CONTENT_MAX_WIDTH } from '@/const/layoutTokens';
import { DEFAULT_MOBILE_CONFIG, normalizeMobileConfig } from '@/const/mobileConfig';

import MobileTabBar from './MobileTabBar';
import { useMobileConfig } from './useMobileConfig';

const navigate = vi.fn();
const workspaceState = vi.hoisted(() => ({ slug: 'acme' as string | null }));
const menuState = vi.hoisted(() => ({ entries: undefined as undefined | { enabled: boolean; key: string; label: string; path: string; sortOrder: number }[] }));

vi.mock('swr', () => ({ default: () => ({ data: menuState.entries }) }));
vi.mock('@/libs/trpc/client', () => ({ lambdaClient: { engineeringTools: { menu: { query: vi.fn() } } } }));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => workspaceState.slug,
}));

vi.mock('./useMobileConfig', () => ({
  useMobileConfig: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'mobile.navigation.ariaLabel' ? 'Mobile workspace navigation' : key,
  }),
}));

vi.mock('@lobehub/ui', () => ({ Icon: () => <span aria-hidden="true" /> }));

describe('MobileTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceState.slug = 'acme';
    menuState.entries = undefined;
    vi.mocked(useMobileConfig).mockReturnValue({
      config: normalizeMobileConfig({
        ...DEFAULT_MOBILE_CONFIG,
        navigation: {
          items: DEFAULT_MOBILE_CONFIG.navigation.items.map((item) =>
            item.id === 'slot-2'
              ? { ...item, label: 'Create', order: 4 }
              : item.id === 'slot-4'
                ? { ...item, label: 'Tools', order: 2 }
                : item,
          ),
        },
      }),
      error: undefined,
      isLoading: false,
      isUsingCachedConfig: false,
      isValidating: false,
      mutate: vi.fn(),
      revision: 0,
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('renders configured visible tabs in order and marks the active stable slot', () => {
    render(
      <MemoryRouter initialEntries={['/discover']}>
        <MobileTabBar />
      </MemoryRouter>,
    );

    const tabBar = screen.getByRole('navigation', { name: 'Mobile workspace navigation' });
    const inner = screen.getByTestId('mobile-tab-bar-inner');
    expect(tabBar).toHaveAttribute('data-active-key', 'slot-3');
    expect(inner).toHaveAttribute(
      'data-mobile-content-max-width',
      String(MOBILE_WORKSPACE_CONTENT_MAX_WIDTH),
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '最近',
      'Tools',
      '发现',
      'Create',
    ]);
    expect(screen.getByRole('button', { name: '发现' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Tools' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('button').every((button) => button.tagName === 'BUTTON')).toBe(true);
  });

  it('keeps all four primary slots visible when persisted config hides one', () => {
    vi.mocked(useMobileConfig).mockReturnValue({
      config: normalizeMobileConfig({
        ...DEFAULT_MOBILE_CONFIG,
        navigation: {
          items: DEFAULT_MOBILE_CONFIG.navigation.items.map((item) =>
            item.id === 'slot-4' ? { ...item, label: 'Hidden slot', visible: false } : item,
          ),
        },
      }),
      error: undefined,
      isLoading: false,
      isUsingCachedConfig: false,
      isValidating: false,
      mutate: vi.fn(),
      revision: 0,
      updatedAt: '1970-01-01T00:00:00.000Z',
    });

    render(
      <MemoryRouter initialEntries={['/discover']}>
        <MobileTabBar />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Mobile workspace navigation' });
    expect(navigation.querySelectorAll('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Hidden slot' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-current')),
    ).toHaveLength(1);
  });

  it('keeps workspace tabs scoped while global discovery escapes the workspace', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <MobileTabBar />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Tools' }));
    expect(navigate).toHaveBeenCalledWith('/apps');

    await user.click(screen.getByRole('button', { name: '发现' }));
    expect(navigate).toHaveBeenCalledWith('/discover', { escape: true });
  });

  it('uses the shared menu destination in a workspace and hides a disabled engineering entry', async () => {
    menuState.entries = [{ enabled: true, key: 'catalog', label: '工具目录', path: '/engineering-tools?view=catalog', sortOrder: 1 }];
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/acme/engineering-tools?view=catalog']}><MobileTabBar /></MemoryRouter>);
    const entry = screen.getByRole('button', { name: '工具目录' });
    expect(entry).toHaveAttribute('aria-current', 'page');
    await user.click(entry);
    expect(navigate).toHaveBeenCalledWith('/engineering-tools?view=catalog');
  });

  it('projects persisted section menu and untouched Design tab into the catalog entry', async () => {
    menuState.entries = [
      { enabled: true, key: 'image', label: '工艺与厂务', path: '/engineering-tools?section=process', sortOrder: 0 },
      { enabled: true, key: 'ppt', label: '自动化与网络', path: '/engineering-tools?section=automation', sortOrder: 1 },
      { enabled: true, key: 'community', label: '设计与项目', path: '/engineering-tools?section=design', sortOrder: 2 },
    ];
    vi.mocked(useMobileConfig).mockReturnValue({
      ...vi.mocked(useMobileConfig)(),
      config: normalizeMobileConfig({
        ...DEFAULT_MOBILE_CONFIG,
        navigation: { items: DEFAULT_MOBILE_CONFIG.navigation.items.map((item) =>
          item.id === 'slot-2' ? { ...item, icon: 'palette', label: '设计', path: '/design' } : item,
        ) },
      }),
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/acme/engineering-tools?view=catalog']}><MobileTabBar /></MemoryRouter>);
    const entry = screen.getByRole('button', { name: '工具目录' });
    await user.click(entry);
    expect(navigate).toHaveBeenCalledWith('/engineering-tools?view=catalog');
    expect(screen.getByRole('button', { name: '应用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发现' })).toBeInTheDocument();
  });

  it('does not render on deep pages', () => {
    render(
      <MemoryRouter initialEntries={['/agent/a/topic']}>
        <MobileTabBar />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole('navigation', { name: 'Mobile workspace navigation' }),
    ).not.toBeInTheDocument();
  });
});
