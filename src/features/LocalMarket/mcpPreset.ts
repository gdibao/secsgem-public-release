import { type LobeToolCustomPlugin } from '@lobechat/types';

import { type LocalMarketItem } from './types';

type DeploymentConnection = {
  configSchema?: { required?: unknown };
  type?: string;
  url?: string;
};

export interface LocalMcpConnectorPreset {
  metadata: Record<string, unknown>;
  value: LobeToolCustomPlugin;
}

export const loadLocalMcpConnectorPreset = async (
  item: LocalMarketItem,
): Promise<LocalMcpConnectorPreset> => {
  if (!item.sourceId) throw new Error('Local MCP source identifier is missing');
  const response = await fetch(`/market/local/mcp/${encodeURIComponent(item.sourceId)}`);
  if (!response.ok) throw new Error(`Local MCP manifest returned ${response.status}`);
  const body = (await response.json()) as {
    manifest?: { deploymentOptions?: Array<{ connection?: DeploymentConnection }> };
  };
  const connection = body.manifest?.deploymentOptions
    ?.map((option) => option.connection)
    .find((option) => option?.type === 'http' && option.url);
  if (!connection?.url) throw new Error('Local MCP has no remote HTTP endpoint');

  const required = Array.isArray(connection.configSchema?.required)
    ? connection.configSchema.required.filter((key): key is string => typeof key === 'string')
    : [];

  return {
    metadata: {
      description: item.description,
      displayName: item.name,
      localMarket: true,
      requiredConfig: required,
      sourceId: item.sourceId,
      version: item.version,
    },
    value: {
      customParams: {
        description: item.description,
        mcp: { type: 'http', url: connection.url },
      },
      identifier: item.sourceId,
      type: 'customPlugin',
    },
  };
};
