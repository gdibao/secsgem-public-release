/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentCapabilityStore from './AgentCapabilityStore';

const fixture = vi.hoisted(() => ({
  agentConfig: { plugins: [] as string[] },
  connectorModalProps: undefined as Record<string, unknown> | undefined,
  fetchAgentConnectors: vi.fn(),
  updateAgentConfigById: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Input: ({ onChange, ...props }: any) => <input onChange={onChange} {...props} />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Avatar: () => null,
  Button: ({ children, disabled, loading, onClick, ...props }: any) => (
    <button disabled={disabled || loading} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  confirmModal: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/hooks/useInitAgentConfig', () => ({
  useInitAgentConfig: () => ({ isLoading: false }),
}));
vi.mock('@/services/skill', () => ({ agentSkillService: {} }));
vi.mock('@/features/Connectors/CustomConnectorModal', () => ({
  default: (props: Record<string, unknown>) => {
    fixture.connectorModalProps = props;
    return props.open ? <div data-testid="fab-connector-modal" /> : null;
  },
}));

const agentState = {
  activeAgentId: 'agent-1',
  agentConfig: fixture.agentConfig,
  updateAgentConfigById: fixture.updateAgentConfigById,
};

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => agentState,
  useAgentStore: (selector: (state: typeof agentState) => unknown) => selector(agentState),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { getAgentConfigById: () => (state: typeof agentState) => state.agentConfig },
}));

const toolState = {
  agentConnectors: { 'agent-1': [] },
  detachConnectorFromAgent: vi.fn(),
  fetchAgentConnectors: fixture.fetchAgentConnectors,
  installedSkills: [],
  provisionFabLocalMcp: vi.fn(),
  provisionFabOfflineKnowledge: vi.fn(),
  refreshAgentSkills: vi.fn(),
};

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: typeof toolState) => unknown) => selector(toolState),
}));
vi.mock('@/store/tool/selectors', () => ({
  agentSkillsSelectors: {
    getMarketAgentSkills: (state: typeof toolState) => state.installedSkills,
  },
}));

vi.mock('./style', () => ({
  styles: new Proxy({}, { get: (_target, key) => String(key) }),
}));

describe('AgentCapabilityStore local MCP actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.agentConfig.plugins = [];
    fixture.connectorModalProps = undefined;
    fixture.updateAgentConfigById.mockImplementation(async (_agentId, patch) => {
      Object.assign(fixture.agentConfig, patch);
    });
  });

  afterEach(cleanup);

  it('binds the native OnlyBoxes tool instead of provisioning the legacy sandbox MCP', async () => {
    render(<AgentCapabilityStore agentId="agent-1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'FAB MCP' }));
    fireEvent.click(screen.getByRole('button', { name: '启用原生沙箱到当前助手' }));

    await waitFor(() => expect(fixture.updateAgentConfigById).toHaveBeenCalledOnce());
    expect(JSON.stringify(fixture.updateAgentConfigById.mock.calls[0][1])).toContain(
      'lobe-cloud-sandbox',
    );
    expect(toolState.provisionFabLocalMcp).not.toHaveBeenCalled();
  });

  it('opens the native Fab connector form for a remote needs-config MCP', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({
            items: [
              {
                author: 'Local mirror',
                description: 'Remote tools',
                id: 'local:mcp:remote-tools',
                installable: true,
                name: 'Remote tools',
                source: 'local-mirror',
                sourceId: 'remote-tools',
                status: 'needs-config',
                transport: 'http',
                version: '1.2.3',
              },
            ],
          }),
          ok: true,
        })
        .mockResolvedValueOnce({
          json: async () => ({
            manifest: {
              deploymentOptions: [
                { connection: { type: 'http', url: 'https://mcp.example.test/api' } },
              ],
            },
          }),
          ok: true,
        }),
    );

    render(<AgentCapabilityStore agentId="agent-1" />);
    fireEvent.click(screen.getByRole('tab', { name: '本地 MCP' }));
    const action = await screen.findByRole('button', { name: '配置到当前助手并验证' });
    fireEvent.click(action);

    await screen.findByTestId('fab-connector-modal');
    expect(fixture.connectorModalProps).toMatchObject({
      agentId: 'agent-1',
      initialMetadata: {
        description: 'Remote tools',
        displayName: 'Remote tools',
        localMarket: true,
        requiredConfig: [],
        sourceId: 'remote-tools',
        version: '1.2.3',
      },
      open: true,
    });
    expect(fixture.connectorModalProps?.initialValue).toMatchObject({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.test/api' } },
      identifier: 'remote-tools',
      type: 'customPlugin',
    });
  });

  it('does not pretend an stdio MCP is installable before a runner exists', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        items: [
          {
            author: 'Local mirror',
            description: 'Local process tools',
            id: 'local:mcp:stdio-tools',
            installable: true,
            name: 'Stdio tools',
            source: 'local-mirror',
            sourceId: 'stdio-tools',
            status: 'needs-config',
            transport: 'stdio',
          },
        ],
      }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetch);

    render(<AgentCapabilityStore agentId="agent-1" />);
    fireEvent.click(screen.getByRole('tab', { name: '本地 MCP' }));
    const action = await screen.findByRole('button', { name: '需要 OnlyBoxes runner' });
    fireEvent.click(action);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('fab-connector-modal')).not.toBeInTheDocument();
  });
});
