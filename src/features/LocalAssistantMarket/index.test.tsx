import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  userId: 'ordinary-user',
  install: vi.fn(),
  installMirror: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(async () => undefined),
  invalidate: vi.fn(),
}));

vi.mock('./install', () => ({
  installLocalAssistant: fixture.install,
  installMirrorAssistant: fixture.installMirror,
}));
vi.mock('./style', () => ({ styles: {} }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector({ user: { id: fixture.userId } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: (state: any) => state.user.id },
}));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: any) => selector({ refreshAgentList: fixture.refresh }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) => selector({ invalidateAvailableAgents: fixture.invalidate }),
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({ default: Link }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => {
    const navigate = useNavigate();
    return (path: string, options?: any) => {
      fixture.navigate(path, options);
      navigate(path);
    };
  },
}));
vi.mock('@/routes/(main)/community/_layout/Sidebar', () => ({
  default: () => <aside data-testid="local-market-sidebar" />,
}));
vi.mock('@/routes/(main)/community/_layout/style', () => ({ styles: {} }));

import DesktopLayout from '@/routes/(main)/community/_layout';
import MobileLayout from '@/routes/(mobile)/community/_layout';
import MobileDiscover from '@/routes/(mobile)/discover';

import LocalAssistantMarket from './index';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.userId = 'ordinary-user';
  fixture.install.mockResolvedValue({ agentId: 'my-private-copy' });
  fixture.installMirror.mockResolvedValue({ agentId: 'my-private-mirror' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({
        items: [
          {
            description: 'Local mirror assistant',
            iconKey: 'local:assistant:mirror-one:v1',
            id: 'local:assistant:mirror-one',
            name: 'Mirror one',
            sourceId: 'mirror-one',
            status: 'installable',
          },
        ],
        total: 1,
      }),
      ok: true,
    })),
  );
});

describe('default local market user flow', () => {
  it.each(['newly-registered-with-no-bindings', 'another-ordinary-account'])(
    'shows the same catalog for %s without installing anything',
    (userId) => {
      fixture.userId = userId;
      render(
        <MemoryRouter>
          <LocalAssistantMarket />
        </MemoryRouter>,
      );
      expect(screen.getAllByRole('article')).toHaveLength(195);
      expect(
        new Set(
          screen.getAllByRole('article').map((card) => card.getAttribute('data-assistant-id')),
        ).size,
      ).toBe(195);
      expect(fixture.install).not.toHaveBeenCalled();
    },
  );

  it('switches between FAB and local featured assistants inside the modal', async () => {
    const close = vi.fn();
    render(
      <MemoryRouter>
        <LocalAssistantMarket embedded limit={6} onBrowse={close} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('article')).toHaveLength(6);
    fireEvent.click(screen.getByRole('tab', { name: '本地精选助手' }));
    await screen.findByText('Mirror one');
    expect(close).not.toHaveBeenCalled();
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/market/local/assistants?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fixture.install).not.toHaveBeenCalled();
  });

  it('filters all domain/role/brand controls and keeps search usable', () => {
    render(
      <MemoryRouter>
        <LocalAssistantMarket />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('All domains').querySelectorAll('option')).toHaveLength(19);
    fireEvent.change(screen.getByLabelText('All roles'), {
      target: { value: '厂商专精' },
    });
    expect(screen.getAllByRole('article')).toHaveLength(72);
    fireEvent.change(screen.getByLabelText('All brands'), {
      target: { value: 'ABB' },
    });
    expect(screen.getAllByRole('article').every((row) => row.textContent?.includes('ABB'))).toBe(
      true,
    );
  });
  it.each([DesktopLayout, MobileLayout, MobileDiscover])(
    'renders the merged local catalog on desktop/mobile without mounting upstream market UI',
    async (Component) => {
      render(
        <MemoryRouter initialEntries={['/community']}>
          <Component />
        </MemoryRouter>,
      );
      expect(screen.getAllByRole('article')).toHaveLength(6);
      expect(screen.queryByRole('link', { name: /local quality market/i })).toBeNull();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('本地市场');
      expect(screen.getAllByRole('button', { name: '打开市场' })).toHaveLength(6);
    },
  );

  it('filters by source identity without fabricated dependencies', () => {
    render(
      <MemoryRouter>
        <LocalAssistantMarket />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'c150-d04' },
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'no-such-assistant' },
    });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('No matching assistants');
  });

  it('keeps old official assistant bookmarks local with an honest empty state', () => {
    render(
      <MemoryRouter initialEntries={['/community/agent/old-official-template']}>
        <DesktopLayout />
      </MemoryRouter>,
    );
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('No matching assistants');
    expect(screen.getByRole('link', { name: 'Local assistants (195)' }).getAttribute('href')).toBe(
      '/community/agent',
    );
  });

  it('installs one selected assistant and opens its native local route', async () => {
    render(
      <MemoryRouter initialEntries={['/community/agent/c150-d04']}>
        <LocalAssistantMarket />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add / open my copy' }));
    await waitFor(() =>
      expect(fixture.navigate).toHaveBeenCalledWith('/agent/my-private-copy', undefined),
    );
    expect(fixture.install).toHaveBeenCalledWith('c150-d04', 'ordinary-user');
    expect(fixture.install).toHaveBeenCalledTimes(1);
    expect(fixture.invalidate).toHaveBeenCalledTimes(1);
  });

  it('does not double-submit while installation is pending', async () => {
    let finish!: (value: { agentId: string }) => void;
    fixture.install.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <MemoryRouter>
        <LocalAssistantMarket />
      </MemoryRouter>,
    );
    const button = screen.getAllByRole('button', {
      name: 'Add / open my copy',
    })[0];
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fixture.install).toHaveBeenCalledTimes(1);
    finish({ agentId: 'once' });
    await waitFor(() => expect(fixture.navigate).toHaveBeenCalled());
  });

  it('keeps local application sign-in and never opens official login', () => {
    fixture.userId = '';
    render(
      <MemoryRouter>
        <LocalAssistantMarket />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in to add' })[0]);
    expect(fixture.navigate).toHaveBeenCalledWith('/signin', { escape: true });
    expect(fixture.install).not.toHaveBeenCalled();
  });

  it('shows an installation failure and allows retry without navigating away', async () => {
    fixture.install.mockRejectedValueOnce(new Error('FORBIDDEN'));
    render(
      <MemoryRouter initialEntries={['/community/agent/c150-d04']}>
        <LocalAssistantMarket />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add / open my copy' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'local sign-in and permissions',
    );
    expect(fixture.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add / open my copy' }));
    await waitFor(() => expect(fixture.navigate).toHaveBeenCalled());
  });
});
