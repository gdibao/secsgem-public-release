import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FavoriteControl from './FavoriteControl';
import type { EngineeringCollection } from './workspaceTypes';

const mocks = vi.hoisted(() => ({ data: [] as EngineeringCollection[], ready: true, save: vi.fn(), refresh: vi.fn() }));
vi.mock('./useEngineeringWorkspace', () => ({
  useEngineeringWorkspaceScope: () => ({ ready: mocks.ready }),
  useFetchPersonalCollections: () => ({ data: mocks.data, mutate: mocks.refresh, isLoading: false }),
}));
vi.mock('@/services/engineeringWorkspace', () => ({ engineeringWorkspaceService: { savePersonal: mocks.save } }));

describe('FavoriteControl', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.data = []; mocks.ready = true; });

  it('blocks personal writes while a workspace route has no resolved identity', () => {
    mocks.ready = false;
    render(<FavoriteControl toolId="EXAMPLE" toolName="Example" />);
    expect(screen.getByRole('button', { name: '加入收藏 Example' })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('creates a persisted collection with the selected tool and remains saved after remount', async () => {
    mocks.save.mockImplementation(async (input) => {
      mocks.data = [{ ...input, id: 'collection', ownerId: 'owner', workspaceId: null, version: 1 }];
      return { id: 'collection', version: 1 };
    });
    const { unmount } = render(<FavoriteControl toolId="EXAMPLE" toolName="Example" />);
    fireEvent.click(screen.getByRole('button', { name: '加入收藏 Example' }));
    fireEvent.change(screen.getByLabelText('Example 新收藏夹名称'), { target: { value: 'My tools' } });
    fireEvent.click(screen.getByRole('button', { name: '新建并收藏' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'My tools', entries: [expect.objectContaining({ toolId: 'EXAMPLE', groupId: null })] })));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    unmount();
    render(<FavoriteControl toolId="EXAMPLE" toolName="Example" />);
    expect(screen.getByRole('button', { name: '管理收藏 Example' })).toHaveTextContent('已收藏（1）');
  });

  it('removes only the chosen group copy using the current server version', async () => {
    const user = userEvent.setup();
    mocks.data = [{
      id: 'collection', name: 'My tools', ownerId: 'owner', workspaceId: null, version: 7, sortOrder: 0,
      groups: [{ id: 'group', name: 'Group', sortOrder: 0 }],
      entries: [
        { toolId: 'EXAMPLE', groupId: null, alias: 'Ungrouped', defaultEndpointId: null, sortOrder: 0 },
        { toolId: 'EXAMPLE', groupId: 'group', alias: 'Grouped', defaultEndpointId: null, sortOrder: 1 },
      ],
    }];
    mocks.save.mockResolvedValue({ id: 'collection', version: 8 });
    render(<FavoriteControl toolId="EXAMPLE" toolName="Example" />);
    await user.click(screen.getByRole('button', { name: '管理收藏 Example' }));
    await user.click(screen.getByRole('combobox', { name: 'Example 收藏夹' }));
    await user.click(screen.getByRole('option', { name: 'My tools' }));
    await user.click(screen.getByRole('button', { name: '取消此处收藏' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7, entries: [expect.objectContaining({ groupId: 'group', alias: 'Grouped' })] })));
  });
});
