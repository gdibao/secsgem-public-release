import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFetchPersonalCollections, useFetchSharedCollections, useFetchToolEndpoints } from './useEngineeringWorkspace';

const mocks = vi.hoisted(() => ({
  clientData: vi.fn(() => ({ data: [] })),
  userId: 'user-a',
  workspaceId: null as string | null,
  workspaceSlug: undefined as string | undefined,
}));

vi.mock('react-router', () => ({ useParams: () => ({ workspaceSlug: mocks.workspaceSlug }) }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ useActiveWorkspaceId: () => mocks.workspaceId }));
vi.mock('@/business/client/hooks/useActiveWorkspace', () => ({
  useActiveWorkspace: () => mocks.workspaceId ? { id: mocks.workspaceId, role: 'member' } : null,
}));
vi.mock('@/store/user', () => ({ useUserStore: () => mocks.userId }));
vi.mock('@/libs/swr', () => ({ useClientDataSWR: mocks.clientData }));
vi.mock('@/services/engineeringWorkspace', () => ({
  engineeringWorkspaceService: { listEndpoints: vi.fn(), listPersonal: vi.fn(), listShared: vi.fn() },
}));

beforeEach(() => {
  mocks.clientData.mockClear();
  mocks.userId = 'user-a';
  mocks.workspaceId = null;
  mocks.workspaceSlug = undefined;
});

describe('engineering workspace cache scope', () => {
  it('does not reuse personal or endpoint data while workspace identity is loading', () => {
    mocks.workspaceSlug = 'alpha';
    const personal = renderHook(() => useFetchPersonalCollections());
    expect(mocks.clientData).toHaveBeenLastCalledWith(null, expect.any(Function));
    const endpoints = renderHook(() => useFetchToolEndpoints('PG-001'));
    expect(mocks.clientData).toHaveBeenLastCalledWith(null, expect.any(Function));

    mocks.workspaceId = 'ws-a';
    personal.rerender();
    expect(mocks.clientData).toHaveBeenLastCalledWith(['engineering-workspace-personal', 'user-a', 'ws-a'], expect.any(Function));
    endpoints.rerender();
    expect(mocks.clientData).toHaveBeenLastCalledWith(['engineering-workspace-endpoints', 'user-a', 'ws-a', 'PG-001'], expect.any(Function));

    mocks.workspaceSlug = 'beta';
    mocks.workspaceId = 'ws-b';
    personal.rerender();
    expect(mocks.clientData).toHaveBeenLastCalledWith(['engineering-workspace-personal', 'user-a', 'ws-b'], expect.any(Function));
    endpoints.rerender();
    expect(mocks.clientData).toHaveBeenLastCalledWith(['engineering-workspace-endpoints', 'user-a', 'ws-b', 'PG-001'], expect.any(Function));
  });

  it('separates personal and shared collections across workspaces', () => {
    renderHook(() => useFetchPersonalCollections());
    expect(mocks.clientData).toHaveBeenLastCalledWith(['engineering-workspace-personal', 'user-a', null], expect.any(Function));

    mocks.workspaceSlug = 'alpha';
    mocks.workspaceId = 'ws-a';
    const shared = renderHook(() => useFetchSharedCollections(true));
    expect(mocks.clientData).toHaveBeenLastCalledWith(['engineering-workspace-shared', 'user-a', 'ws-a'], expect.any(Function));
    mocks.workspaceId = 'ws-b';
    shared.rerender();
    expect(mocks.clientData).toHaveBeenLastCalledWith(['engineering-workspace-shared', 'user-a', 'ws-b'], expect.any(Function));
  });
});
