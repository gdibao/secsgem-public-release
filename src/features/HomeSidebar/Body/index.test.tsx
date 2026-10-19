import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Body from './index';

vi.hoisted(() => {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
});

interface MockGlobalState {
  status: {
    hiddenSidebarSections?: string[];
    sidebarExpandedKeys?: string[];
    sidebarItems?: string[];
  };
  updateSystemStatus: (patch: Partial<MockGlobalState['status']>) => void;
}

const mocks = vi.hoisted(() => ({
  globalState: undefined as unknown as MockGlobalState,
  navigate: vi.fn(),
  navLayout: {
    bottomMenuItems: [] as Array<{ hidden?: boolean; key: string; title: string; url: string }>,
    topNavItems: [] as Array<{ hidden?: boolean; key: string; title: string; url: string }>,
  },
  updateSystemStatus: vi.fn(),
  workspaceSlug: null as string | null,
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Flexbox: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-body">{children}</div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  AccordionRoot: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (keys: string[]) => void;
    value?: string[];
  }) => (
    <div data-expanded-keys={JSON.stringify(value)} data-testid="sidebar-accordion">
      <button aria-label="collapse recents" onClick={() => onValueChange?.(['agent'])} />
      {children}
    </div>
  ),
}));

vi.mock('react-router', () => ({
  Link: ({
    children,
    onClick,
    to,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    to: string;
  }) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('@/hooks/useActiveTabKey', () => ({
  useActiveTabKey: () => 'home',
}));

vi.mock('@/hooks/useNavLayout', () => ({
  useNavLayout: () => mocks.navLayout,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.workspaceSlug,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => (mocks.workspaceSlug ? 'workspace-id' : null),
  useActiveWorkspaceId: () => (mocks.workspaceSlug ? 'workspace-id' : null),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { useFetchWorkspaceUserPreference: () => void }) => unknown) =>
    selector({ useFetchWorkspaceUserPreference: vi.fn() }),
}));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: () => false },
}));
vi.mock('./useSyncWorkspaceSidebarPreference', () => ({
  useSyncWorkspaceSidebarPreference: vi.fn(),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/utils/navigation', () => ({
  isExternalUrl: (url?: string) => !!url?.startsWith('https://'),
  isModifierClick: () => false,
}));

vi.mock('@/features/Home/Recents', () => ({
  default: ({ itemKey }: { itemKey: string }) => <div data-testid={`sidebar-item-${itemKey}`} />,
}));

vi.mock('./Agent', () => ({
  default: ({ itemKey }: { itemKey: string }) => <div data-testid={`sidebar-item-${itemKey}`} />,
}));

vi.mock('./Private', () => ({
  default: ({ itemKey }: { itemKey: string }) => <div data-testid={`sidebar-item-${itemKey}`} />,
}));

vi.mock('./CustomizeSidebarModal', () => ({
  CustomizeSidebarModal: () => null,
  openCustomizeSidebarModal: vi.fn(),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: MockGlobalState) => unknown) => selector(mocks.globalState),
}));

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.updateSystemStatus.mockReset();
  mocks.workspaceSlug = null;
  mocks.navLayout = {
    bottomMenuItems: [],
    topNavItems: [],
  };
  mocks.globalState = {
    status: {
      hiddenSidebarSections: [],
      sidebarExpandedKeys: ['recents', 'agent'],
      sidebarItems: ['recents', 'agent'],
    },
    updateSystemStatus: mocks.updateSystemStatus,
  };
});

afterEach(() => {
  cleanup();
});

describe('Home sidebar body', () => {
  it('uses persisted sidebar accordion expanded keys', () => {
    mocks.globalState.status.sidebarExpandedKeys = ['agent'];

    render(<Body />);

    expect(screen.getByTestId('sidebar-accordion')).toHaveAttribute(
      'data-expanded-keys',
      '["agent"]',
    );
  });

  it('persists sidebar accordion expanded changes', () => {
    render(<Body />);

    fireEvent.click(screen.getByRole('button', { name: 'collapse recents' }));

    expect(mocks.updateSystemStatus).toHaveBeenCalledWith({ sidebarExpandedKeys: ['agent'] });
  });

  it('renders enabled PPT and expert plaza entries when sidebar order contains them', () => {
    mocks.globalState.status.sidebarItems = ['ppt', 'experts', 'recents', 'agent'];
    mocks.navLayout.bottomMenuItems = [
      { key: 'ppt', title: 'PPT', url: '/ppt' },
      { key: 'experts', title: '专家广场', url: '/experts' },
    ];

    render(<Body />);

    expect(screen.getByText('PPT')).toBeInTheDocument();
    expect(screen.getByText('专家广场')).toBeInTheDocument();
  });

  it('renders items strictly in sidebarItems order with the spacer at its stored position', () => {
    mocks.navLayout = {
      bottomMenuItems: [
        { key: 'image', title: 'Image', url: '/image' },
        { key: 'resource', title: 'Resource', url: '/resource' },
      ],
      topNavItems: [
        { key: 'pages', title: 'Pages', url: '/page' },
        { key: 'tasks', title: 'Tasks', url: '/tasks' },
      ],
    };
    mocks.globalState.status.sidebarItems = [
      'pages',
      'recents',
      'agent',
      '__spacer__',
      'image',
      'tasks',
      'resource',
    ];

    render(<Body />);

    const children = Array.from(screen.getByTestId('sidebar-body').children);
    const spacerIndex = children.findIndex((child) =>
      child.hasAttribute('data-sidebar-bottom-spacer'),
    );

    expect(spacerIndex).toBe(2);
    expect(children[0]).toHaveTextContent('Pages');
    expect(children[1]).toHaveAttribute('data-testid', 'sidebar-accordion');
    expect(children[3]).toHaveTextContent('Image');
    expect(children[4]).toHaveTextContent('Tasks');
    expect(children[5]).toHaveTextContent('Resource');
  });

  it('keeps a top item that was dragged past the spacer in its new position', () => {
    mocks.navLayout = {
      bottomMenuItems: [{ key: 'image', title: 'Image', url: '/image' }],
      topNavItems: [{ key: 'tasks', title: 'Tasks', url: '/tasks' }],
    };
    // User dragged `tasks` from the top section to sit after `image`.
    mocks.globalState.status.sidebarItems = ['recents', 'agent', '__spacer__', 'image', 'tasks'];

    render(<Body />);

    const children = Array.from(screen.getByTestId('sidebar-body').children);

    expect(children[0]).toHaveAttribute('data-testid', 'sidebar-accordion');
    expect(children[1]).toHaveAttribute('data-sidebar-bottom-spacer');
    expect(children[2]).toHaveTextContent('Image');
    expect(children[3]).toHaveTextContent('Tasks');
  });

  it('renders external nav URLs as native links', () => {
    mocks.navLayout.bottomMenuItems = [
      { key: 'external', title: 'External Plans', url: 'https://pay.example.com' },
    ];
    mocks.globalState.status.sidebarItems = ['external'];

    render(<Body />);

    const link = screen.getByRole('link', { name: /External Plans/ });
    expect(link).toHaveAttribute('href', 'https://pay.example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders and navigates to the authorized Dify page when a saved layout lacks the key', () => {
    mocks.workspaceSlug = 'team-a';
    mocks.globalState.status.sidebarItems = ['recents', 'agent', '__spacer__', 'image'];
    mocks.navLayout.topNavItems = [
      { key: 'dify-canvas', title: 'AI 流程 / Dify', url: '/settings/dify-canvas' },
    ];

    render(<Body />);

    const link = screen.getByRole('link', { name: 'AI 流程 / Dify' });
    expect(link).toHaveAttribute('href', '/team-a/settings/dify-canvas');

    fireEvent.click(link);
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/dify-canvas');
  });

  it('does not render Dify when the current workspace has no authorized nav item', () => {
    mocks.workspaceSlug = 'team-b';
    mocks.globalState.status.sidebarItems = ['recents', 'agent', '__spacer__', 'image'];
    mocks.navLayout.topNavItems = [];

    render(<Body />);

    expect(screen.queryByRole('link', { name: 'AI 流程 / Dify' })).not.toBeInTheDocument();
  });

  it('routes an authorized admin through the internal Dify page in personal scope', () => {
    mocks.workspaceSlug = null;
    mocks.globalState.status.sidebarItems = ['recents', 'agent'];
    mocks.navLayout.topNavItems = [
      { key: 'dify-canvas', title: 'AI 流程 / Dify', url: '/settings/dify-canvas' },
    ];

    render(<Body />);

    const link = screen.getByRole('link', { name: 'AI 流程 / Dify' });
    expect(link).toHaveAttribute('href', '/settings/dify-canvas');
    expect(link).not.toHaveAttribute('target', '_blank');

    fireEvent.click(link);
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/dify-canvas');
  });
});
