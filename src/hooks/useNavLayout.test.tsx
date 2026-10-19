import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface GlobalStateMock {
  toggleCommandMenu: () => void;
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  adminRole: null as string | null,
  adminEntry: undefined as { available: boolean; url?: string } | undefined,
  adminByWorkspace: {} as Record<string, { available: boolean } | undefined>,
  canvasByWorkspace: {} as Record<string, { available: boolean; workflows: unknown[] } | undefined>,
  errorByWorkspace: {} as Record<string, unknown>,
  engineeringMenu: undefined as { enabled: boolean; key: string; label: string; path: string; sortOrder: number }[] | undefined,
  queryKeys: [] as unknown[],
  showMarket: true,
}));

vi.mock('@/config/routes', () => ({ getRouteById: (id: string) => ({ icon: () => id }) }));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: GlobalStateMock) => unknown) =>
    selector({ toggleCommandMenu: vi.fn() }),
}));
vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  serverConfigSelectors: {},
  useServerConfigStore: () => ({
    enableBusinessFeatures: false,
    hideGitHub: false,
    showMarket: mocks.showMarket,
  }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({ role: mocks.adminRole }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { role: string | null }) => ({ role: state.role }) },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    difyCanvas: {
      adminEntry: { query: vi.fn() },
      adminList: { query: vi.fn() },
      list: { query: vi.fn() },
    },
    engineeringTools: { menu: { query: vi.fn() } },
  },
}));
vi.mock('@/libs/swr', () => ({ useClientDataSWR: () => ({ data: undefined }) }));
vi.mock('swr', () => ({
  default: (key: unknown) => {
    mocks.queryKeys.push(key);
    if (key === 'engineering-tools-menu') return { data: mocks.engineeringMenu };
    if (key === 'dify-canvas-admin-entry') return { data: mocks.adminEntry };
    const workspaceId = Array.isArray(key) ? String(key[1]) : undefined;
    const isAdmin = Array.isArray(key) && String(key[0]).includes('admin');
    return {
      data: workspaceId
        ? isAdmin
          ? mocks.adminByWorkspace[workspaceId]
          : mocks.canvasByWorkspace[workspaceId]
        : undefined,
      error: workspaceId ? mocks.errorByWorkspace[workspaceId] : undefined,
    };
  },
}));

describe('useNavLayout', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
    mocks.adminRole = null;
    mocks.adminEntry = undefined;
    mocks.adminByWorkspace = {};
    mocks.canvasByWorkspace = {};
    mocks.errorByWorkspace = {};
    mocks.engineeringMenu = undefined;
    mocks.queryKeys = [];
    mocks.showMarket = true;
  });

  it('keeps Memory visible in personal mode and routes authorized admins to the internal Dify page', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result, rerender } = renderHook(() => useNavLayout());
    expect(result.current.bottomMenuItems.find((item) => item.key === 'memory')?.hidden).not.toBe(
      true,
    );
    expect(result.current.topNavItems.some((item) => item.key === 'dify-canvas')).toBe(false);
    expect(mocks.queryKeys).not.toContain('dify-canvas-admin-entry');

    mocks.adminRole = 'system_admin';
    mocks.adminEntry = { available: true, url: 'https://studio.secsgem.com.cn/' };
    rerender();
    expect(result.current.topNavItems.find((item) => item.key === 'dify-canvas')).toMatchObject({
      title: 'AI 流程 / Dify',
      url: '/settings/dify-canvas',
    });
  });

  it('hides Memory in workspace mode', async () => {
    mocks.activeWorkspaceSlug = 'team-a';
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    expect(result.current.bottomMenuItems.find((item) => item.key === 'memory')?.hidden).toBe(true);
  });

  it('uses configured engineering links in a workspace even when the old market switch is off', async () => {
    mocks.activeWorkspaceSlug = 'workspace-a';
    mocks.showMarket = false;
    mocks.engineeringMenu = [
      { enabled: true, key: 'image', label: '工艺与厂务', path: '/engineering-tools?section=process', sortOrder: 0 },
      { enabled: true, key: 'ppt', label: '自动化与网络', path: '/engineering-tools?section=automation', sortOrder: 1 },
      { enabled: true, key: 'community', label: '设计与项目', path: '/engineering-tools?section=design', sortOrder: 2 },
    ];
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    expect(result.current.bottomMenuItems.slice(0, 3).map((item) => [item.key, item.title, item.url])).toEqual([
      ['catalog', '工具目录', '/engineering-tools?view=catalog'],
      ['favorites', '我的收藏', '/engineering-tools?view=favorites'],
      ['local_mcp', '本地工具与 MCP', '/engineering-tools?view=local_mcp'],
    ]);
    expect(result.current.bottomMenuItems.some((item) => item.key === 'community')).toBe(false);
  });

  it('uses the shared three-entry engineering menu when published', async () => {
    mocks.engineeringMenu = [
      { enabled: true, key: 'favorites', label: '我的收藏', path: '/engineering-tools?view=favorites', sortOrder: 2 },
      { enabled: true, key: 'catalog', label: '工具目录', path: '/engineering-tools?view=catalog', sortOrder: 1 },
      { enabled: false, key: 'local_mcp', label: '本地工具与 MCP', path: '/engineering-tools?view=local_mcp', sortOrder: 3 },
    ];
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    expect(result.current.bottomMenuItems.slice(0, 3).map((item) => [item.key, item.hidden])).toEqual([
      ['catalog', false], ['favorites', false], ['local_mcp', true],
    ]);
  });

  it('shows mapped workspace flows to members and server-authorized Studio entry to admins', async () => {
    mocks.activeWorkspaceSlug = 'workspace-a';
    mocks.canvasByWorkspace['workspace-a'] = { available: true, workflows: [{ appId: 'a' }] };
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    expect(result.current.topNavItems.find((item) => item.key === 'dify-canvas')?.url).toBe(
      '/settings/dify-canvas',
    );

    expect(result.current.topNavItems.some((item) => item.key === 'dify-canvas')).toBe(true);
  });

  it('keeps the internal Dify page discoverable from an unrelated workspace for an authorized admin', async () => {
    mocks.activeWorkspaceSlug = 'unmapped-workspace';
    mocks.adminRole = 'module_admin';
    mocks.adminEntry = { available: true, url: 'https://studio.secsgem.com.cn/' };
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    expect(result.current.topNavItems.find((item) => item.key === 'dify-canvas')).toMatchObject({
      url: '/settings/dify-canvas',
    });
  });

  it('does not expose the workspace entry while loading, unavailable, or denied', async () => {
    mocks.activeWorkspaceSlug = 'workspace-a';
    mocks.adminRole = 'system_admin';
    const { useNavLayout } = await import('./useNavLayout');
    const { result, rerender } = renderHook(() => useNavLayout());
    expect(result.current.topNavItems.some((item) => item.key === 'dify-canvas')).toBe(false);

    mocks.adminByWorkspace['workspace-a'] = { available: true };
    rerender();
    expect(result.current.topNavItems.some((item) => item.key === 'dify-canvas')).toBe(true);

    delete mocks.adminByWorkspace['workspace-a'];
    mocks.errorByWorkspace['workspace-a'] = new Error('FORBIDDEN');
    rerender();
    expect(result.current.topNavItems.some((item) => item.key === 'dify-canvas')).toBe(false);
  });
});
