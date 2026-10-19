import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LocalMcpPanel, { loadConfiguredMcp } from './LocalMcpPanel';

const fixture = vi.hoisted(() => ({
  safeList: vi.fn(),
  rows: [] as Array<{ id: string; identifier: string; isEnabled: boolean; name: string; status: string;
    mcpConnectionType: string; tools: Array<{ displayName: string; id: string; name: string; permission: string; crudType: string }> }>,
  workspace: { id: 'w1', slug: 'team-a' } as { id: string; slug: string } | null,
}));

vi.mock('@/libs/trpc/client', () => ({ lambdaClient: { engineeringTools: { listConfiguredMcp: { query: fixture.safeList } } } }));
vi.mock('@/business/client/hooks/useActiveWorkspace', () => ({ useActiveWorkspace: () => fixture.workspace }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ useActiveWorkspaceId: () => fixture.workspace?.id ?? null }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-a' } }) }));
vi.mock('./useEngineeringWorkspace', () => ({ useEngineeringWorkspaceScope: () => ({ ready: true }) }));
vi.mock('swr', () => ({ default: () => ({ data: fixture.rows, error: undefined, isLoading: false, mutate: vi.fn() }) }));

describe('LocalMcpPanel', () => {
  beforeEach(() => { fixture.workspace = { id: 'w1', slug: 'team-a' }; fixture.rows = []; fixture.safeList.mockReset(); });

  it('reads only the server-scoped safe MCP inventory API', async () => {
    const safeInventory = [{ id: 'c1', identifier: 'mcp-1', isEnabled: true, mcpConnectionType: 'http',
      name: 'Workspace MCP', status: 'connected',
      tools: [{ displayName: 'Inspect', id: 't1', permission: 'needs_approval', name: 'inspect', crudType: 'read' }] }];
    fixture.safeList.mockResolvedValue(safeInventory);
    expect(await loadConfiguredMcp()).toEqual(safeInventory);
    expect(fixture.safeList).toHaveBeenCalledOnce();
  });

  it('links only to the active workspace native connector manager', () => {
    fixture.rows = [{ id: 'c1', identifier: 'mcp-1', isEnabled: true, mcpConnectionType: 'http', name: 'Workspace MCP', status: 'connected',
      tools: [{ displayName: 'Inspect', id: 't1', permission: 'needs_approval', name: 'inspect', crudType: 'read' }] }];
    render(<MemoryRouter><LocalMcpPanel /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /管理连接器/ })).toHaveAttribute('href', '/team-a/settings/connector');
    expect(screen.getByText(/当前健康与许可未核/)).toBeInTheDocument();
    expect(screen.getByText(/调用需批准/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /运行|调用/ })).not.toBeInTheDocument();
  });

  it('does not invent a personal or cross-workspace management route', () => {
    fixture.workspace = null;
    render(<MemoryRouter><LocalMcpPanel /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /管理连接器/ })).not.toBeInTheDocument();
    expect(screen.getByText(/当前个人\/工作区范围暂无已配置的 MCP/)).toBeInTheDocument();
  });
});
