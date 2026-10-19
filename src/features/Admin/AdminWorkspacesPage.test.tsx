import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminWorkspacesPage from './AdminWorkspacesPage';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  mutate: vi.fn(),
  role: 'admin' as string,
}));

vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaceListQuery: () => ({
    data: [{ id: 'ws-a', name: 'A区', role: 'owner', slug: 'area-a' }],
    error: undefined,
    isLoading: false,
    mutate: mocks.mutate,
  }),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { workspace: { create: { mutate: mocks.create } } },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: mocks.role } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { user: unknown }) => state.user },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'admin';
  mocks.create.mockResolvedValue({ id: 'ws-new', name: '新工作区', slug: 'pilot-new' });
  mocks.mutate.mockResolvedValue([]);
});

describe('AdminWorkspacesPage', () => {
  it('lists workspaces and creates one through the guarded A2 API', async () => {
    render(
      <MemoryRouter>
        <AdminWorkspacesPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'A区' })).toHaveAttribute(
      'href',
      '/area-a/settings/members',
    );
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新工作区' } });
    fireEvent.change(screen.getByLabelText('标识'), { target: { value: 'pilot-new' } });
    fireEvent.click(screen.getByRole('button', { name: '创建工作区' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({ name: '新工作区', slug: 'pilot-new' }),
    );
    expect(await screen.findByRole('link', { name: '管理成员' })).toHaveAttribute(
      'href',
      '/pilot-new/settings/members',
    );
  });

  it('does not render creation controls without systemWrite', () => {
    mocks.role = 'viewer';
    render(
      <MemoryRouter>
        <AdminWorkspacesPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '创建工作区' })).not.toBeInTheDocument();
  });
});
