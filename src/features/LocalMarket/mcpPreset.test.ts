import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLocalMcpConnectorPreset } from './mcpPreset';

afterEach(() => vi.unstubAllGlobals());

describe('loadLocalMcpConnectorPreset', () => {
  it('maps a mirrored remote manifest to the native Fab connector form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          manifest: {
            deploymentOptions: [
              {
                connection: {
                  configSchema: { required: ['API_TOKEN'] },
                  type: 'http',
                  url: 'https://mcp.example.test/api',
                },
              },
            ],
          },
        }),
        ok: true,
      }),
    );

    await expect(
      loadLocalMcpConnectorPreset({
        author: 'Mirror',
        description: 'Example connector',
        id: 'local:mcp:example',
        installable: true,
        name: 'Example MCP',
        source: 'local-mirror',
        sourceId: 'example',
        version: '1.0.0',
      }),
    ).resolves.toEqual({
      metadata: {
        description: 'Example connector',
        displayName: 'Example MCP',
        localMarket: true,
        requiredConfig: ['API_TOKEN'],
        sourceId: 'example',
        version: '1.0.0',
      },
      value: {
        customParams: {
          description: 'Example connector',
          mcp: { type: 'http', url: 'https://mcp.example.test/api' },
        },
        identifier: 'example',
        type: 'customPlugin',
      },
    });
  });

  it('refuses a manifest without a remote HTTP deployment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          manifest: {
            deploymentOptions: [{ connection: { command: 'local-command', type: 'stdio' } }],
          },
        }),
        ok: true,
      }),
    );

    await expect(
      loadLocalMcpConnectorPreset({
        author: 'Mirror',
        description: 'Example connector',
        id: 'local:mcp:example',
        installable: true,
        name: 'Example MCP',
        source: 'local-mirror',
        sourceId: 'example',
      }),
    ).rejects.toThrow('no remote HTTP endpoint');
  });
});
