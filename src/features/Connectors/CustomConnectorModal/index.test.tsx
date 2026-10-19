/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CustomConnectorModal from './index';

const fixture = vi.hoisted(() => ({
  createConnector: vi.fn(),
  deleteConnector: vi.fn(),
  devModalProps: undefined as Record<string, any> | undefined,
  fetchConnectors: vi.fn(),
  getConnectorForEdit: vi.fn(),
  startConnectorOAuth: vi.fn(),
  syncConnectorTools: vi.fn(),
  uninstallCustomPlugin: vi.fn(),
  updateConnector: vi.fn(),
}));

const toolState = {
  connectors: [],
  createConnector: fixture.createConnector,
  deleteConnector: fixture.deleteConnector,
  fetchConnectors: fixture.fetchConnectors,
  getConnectorForEdit: fixture.getConnectorForEdit,
  startConnectorOAuth: fixture.startConnectorOAuth,
  syncConnectorTools: fixture.syncConnectorTools,
  uninstallCustomPlugin: fixture.uninstallCustomPlugin,
  updateConnector: fixture.updateConnector,
};

vi.mock('@/store/tool', () => ({
  useToolStore: Object.assign(
    (selector: (state: typeof toolState) => unknown) => selector(toolState),
    { getState: () => toolState },
  ),
}));
vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: {
    connectorById: () => () => undefined,
    connectorByIdentifier: () => () => undefined,
  },
}));
vi.mock('@/features/PluginDevModal', () => ({
  default: (props: Record<string, unknown>) => {
    fixture.devModalProps = props;
    return props.open ? <div data-testid="dev-modal" /> : null;
  },
}));

describe('CustomConnectorModal local market preset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.devModalProps = undefined;
    fixture.createConnector.mockResolvedValue({ id: 'connector-1', isNew: true });
    fixture.syncConnectorTools.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('creates and verifies the connector directly in the selected agent scope', async () => {
    const onEditSuccess = vi.fn();
    render(
      <CustomConnectorModal
        open
        agentId="agent-1"
        initialMetadata={{
          displayName: 'Example MCP',
          localMarket: true,
          sourceId: 'example-mcp',
          version: '1.2.3',
        }}
        initialValue={{
          customParams: {
            description: 'Example connector',
            mcp: { type: 'http', url: 'https://mcp.example.test/api' },
          },
          identifier: 'example-mcp',
          type: 'customPlugin',
        }}
        onClose={vi.fn()}
        onEditSuccess={onEditSuccess}
      />,
    );

    await act(async () => {
      await fixture.devModalProps?.onSave({
        customParams: {
          description: 'Example connector',
          mcp: { auth: { type: 'none' }, type: 'http', url: 'https://mcp.example.test/api' },
        },
        identifier: 'example-mcp',
        type: 'customPlugin',
      });
    });

    expect(fixture.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        identifier: 'example-mcp',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.test/api',
        metadata: expect.objectContaining({
          localMarket: true,
          sourceId: 'example-mcp',
          version: '1.2.3',
        }),
        name: 'Example MCP',
      }),
    );
    expect(fixture.syncConnectorTools).toHaveBeenCalledWith('connector-1');
    expect(onEditSuccess).toHaveBeenCalledOnce();
  });

  it('rolls back only a newly-created connector when tools/list fails', async () => {
    fixture.syncConnectorTools.mockRejectedValue(new Error('tools/list failed'));
    render(
      <CustomConnectorModal
        open
        agentId="agent-1"
        initialMetadata={{ displayName: 'Broken MCP', localMarket: true }}
        initialValue={{
          customParams: { mcp: { type: 'http', url: 'https://broken.example.test/api' } },
          identifier: 'broken-mcp',
          type: 'customPlugin',
        }}
        onClose={vi.fn()}
      />,
    );

    await expect(
      fixture.devModalProps?.onSave({
        customParams: {
          mcp: { auth: { type: 'none' }, type: 'http', url: 'https://broken.example.test/api' },
        },
        identifier: 'broken-mcp',
        type: 'customPlugin',
      }),
    ).rejects.toThrow('tools/list failed');
    expect(fixture.deleteConnector).toHaveBeenCalledWith('connector-1');
  });
});
