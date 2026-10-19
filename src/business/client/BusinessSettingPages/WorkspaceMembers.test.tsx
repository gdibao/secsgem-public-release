import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceMembers from './WorkspaceMembers';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  additionalMember: false,
  changeRole: vi.fn(),
  confirm: vi.fn(),
  list: vi.fn(),
  lookup: vi.fn(),
  mutate: vi.fn(),
  revoke: vi.fn(),
  role: 'owner' as string,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  return { ...(await importOriginal()), confirmModal: mocks.confirm };
});
vi.mock('@/business/client/hooks/useActiveWorkspace', () => ({
  useActiveWorkspace: () => ({ id: 'ws-a', name: 'A区', role: mocks.role, slug: 'area-a' }),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    workspaceMember: {
      addByUserId: { mutate: mocks.add },
      changeRoleByUserId: { mutate: mocks.changeRole },
      list: { query: mocks.list },
      lookupByUserId: { query: mocks.lookup },
      revokeByUserId: { mutate: mocks.revoke },
    },
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'owner' } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: (state: { user: { id: string } }) => state.user.id },
}));
vi.mock('swr', () => ({
  default: () => ({
    data: [
      {
        deletedAt: null,
        joinedAt: new Date(),
        role: 'owner',
        updatedAt: new Date(),
        user: { fullName: '管理员', username: 'owner' },
        userId: 'owner',
        workspaceId: 'ws-a',
      },
      ...(mocks.additionalMember
        ? [
            {
              deletedAt: null,
              joinedAt: new Date(),
              role: 'member',
              updatedAt: new Date(),
              user: { fullName: '测试成员', username: 'member' },
              userId: 'fab-user-1',
              workspaceId: 'ws-a',
            },
          ]
        : []),
    ],
    error: undefined,
    isLoading: false,
    mutate: mocks.mutate,
  }),
}));
vi.mock('./BusinessSettingsPageShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'owner';
  mocks.additionalMember = false;
  mocks.lookup.mockResolvedValue({
    user: { avatar: null, fullName: '测试成员', username: 'member' },
    userId: 'fab-user-1',
  });
  mocks.add.mockResolvedValue({ userId: 'fab-user-1' });
  mocks.changeRole.mockResolvedValue({ userId: 'fab-user-1' });
  mocks.revoke.mockResolvedValue({ userId: 'fab-user-1' });
  mocks.mutate.mockResolvedValue([]);
});

describe('WorkspaceMembers', () => {
  it('previews an exact Fab ID before a scoped, confirmed add', async () => {
    render(<WorkspaceMembers />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Fab 用户 ID' }), {
      target: { value: 'fab-user-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /查询/ }));
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledWith({ userId: 'fab-user-1' }));
    expect(await screen.findByText('测试成员')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /加入工作区/ }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('A区') }),
    );
    await mocks.confirm.mock.calls[0][0].onOk();
    expect(mocks.add).toHaveBeenCalledWith({ role: 'member', userId: 'fab-user-1' });
    expect(mocks.mutate).toHaveBeenCalled();
  });

  it('hides the add action for ordinary members', () => {
    mocks.role = 'member';
    render(<WorkspaceMembers />);
    expect(screen.queryByRole('textbox', { name: 'Fab 用户 ID' })).not.toBeInTheDocument();
  });

  it('ignores lookup results after the Fab ID changes', async () => {
    let resolveLookup!: (value: { user: { fullName: string }; userId: string }) => void;
    mocks.lookup.mockReturnValueOnce(new Promise((resolve) => (resolveLookup = resolve)));
    render(<WorkspaceMembers />);
    const input = screen.getByRole('textbox', { name: 'Fab 用户 ID' });
    fireEvent.change(input, { target: { value: 'fab-user-1' } });
    fireEvent.click(screen.getByRole('button', { name: /查询/ }));
    fireEvent.change(input, { target: { value: 'fab-user-2' } });
    resolveLookup({ user: { fullName: '旧用户' }, userId: 'fab-user-1' });
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledOnce());
    expect(screen.queryByText('旧用户')).not.toBeInTheDocument();
  });

  it('requires confirmation before changing a role or revoking access', async () => {
    mocks.additionalMember = true;
    render(<WorkspaceMembers />);
    fireEvent.click(screen.getByRole('button', { name: '撤权' }));
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('A区') }),
    );
    await mocks.confirm.mock.calls[0][0].onOk();
    expect(mocks.revoke).toHaveBeenCalledWith({ userId: 'fab-user-1' });
    expect(mocks.mutate).toHaveBeenCalled();
  });
});
