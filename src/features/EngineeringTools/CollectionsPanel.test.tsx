import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CollectionsPanel from './CollectionsPanel';

const mocks = vi.hoisted(() => ({ canEdit: false, ready: true, data: [{ id: 'collection', name: 'Shared', ownerId: 'owner', workspaceId: 'team', version: 1, sortOrder: 0, groups: [], entries: [] }], error: undefined as unknown }));
vi.mock('./useEngineeringWorkspace', () => ({
  useEngineeringWorkspaceScope: () => ({ ready: mocks.ready }),
  useFetchPersonalCollections: () => ({ data: [], mutate: vi.fn() }),
  useFetchSharedCollections: () => ({ data: mocks.data, available: true, canEdit: mocks.canEdit, error: mocks.error, mutate: vi.fn() }),
}));
vi.mock('@/services/engineeringWorkspace', () => ({ engineeringWorkspaceService: {} }));

describe('CollectionsPanel', () => {
  beforeEach(() => { mocks.canEdit = false; mocks.ready = true; mocks.error = undefined; });
  it('hides personal collection writes until the workspace identity is ready', () => {
    mocks.ready = false;
    render(<CollectionsPanel tools={[]} />);
    expect(screen.getByText('工作区加载中，收藏夹暂不可用')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建收藏夹' })).not.toBeInTheDocument();
  });
  it('shows shared collections read-only to workspace viewers', () => {
    render(<CollectionsPanel shared tools={[]} />);
    expect(screen.getByRole('heading', { name: 'Shared' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建收藏夹' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑收藏夹 Shared' })).not.toBeInTheDocument();
  });
  it('allows shared collection editing only when the workspace role grants it', () => {
    mocks.canEdit = true;
    render(<CollectionsPanel shared tools={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑收藏夹 Shared' }));
    expect(screen.getByLabelText('收藏夹名称')).toHaveValue('Shared');
  });
});
