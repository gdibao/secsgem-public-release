import { CreateAgentSchema, upsertPluginMode } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { agentService } from '@/services/agent';

import {
  getLocalAssistantConfig,
  localMarketIdentifier,
  resolveLocalMirrorAvatar,
} from './catalog';
import { isFabPluginPinned } from './offlineProfile';

type MirrorAssistantDetails = {
  config?: {
    openingMessage?: string;
    openingQuestions?: string[];
    systemRole?: string;
  };
  item: {
    avatar?: string;
    description?: string;
    iconKey?: string;
    id: string;
    name: string;
    sourceId: string;
    status: 'installable' | 'needs-config' | 'metadata-only' | 'blocked';
    tags?: string[];
    version?: string;
  };
};

export const installLocalAssistant = async (identifier: string, userId: string) => {
  if (!userId) throw new Error('Local application sign-in required');
  const config = getLocalAssistantConfig(identifier);
  const existingId = await agentService.getAgentByMarketIdentifier(
    localMarketIdentifier(identifier),
    true,
  );

  if (existingId) {
    // The ownedPrivateOnly lookup already enforces caller ownership and private visibility.
    // Re-running the install is also the migration path for assistants created
    // before the Fab skill catalog was registered in the image.
    const existingConfig = await agentService.getAgentConfigById(existingId);
    let plugins = existingConfig.plugins;
    for (const plugin of config.plugins ?? []) {
      if (plugin.mode === 'pinned' && !isFabPluginPinned(plugins, plugin.identifier))
        plugins = upsertPluginMode(plugins, plugin.identifier, plugin.mode);
    }
    await agentService.updateAgentConfig(existingId, { plugins });
    await lambdaClient.connector.provisionFabOfflineKnowledge.mutate({
      agentId: existingId,
    });
    return { agentId: existingId };
  }

  const result = await agentService.createAgent({
    config,
    visibility: 'private',
  });
  await lambdaClient.connector.provisionFabOfflineKnowledge.mutate({
    agentId: result.agentId,
  });
  return result;
};

/** Installs a complete local mirror assistant through Fab's native private-agent API. */
export const installMirrorAssistant = async (sourceId: string, userId: string) => {
  if (!userId) throw new Error('Local application sign-in required');

  const response = await fetch(`/market/local/assistants/${encodeURIComponent(sourceId)}`);
  if (!response.ok) throw new Error(`Local mirror assistant unavailable (${response.status})`);
  const details = (await response.json()) as MirrorAssistantDetails;
  if (!['installable', 'needs-config'].includes(details.item.status) || !details.config?.systemRole)
    throw new Error('This mirror assistant does not contain a complete assistant definition');

  const marketIdentifier = `local:official-mirror:${details.item.sourceId}:${details.item.version || 'unknown'}`;
  const existingId = await agentService.getAgentByMarketIdentifier(marketIdentifier, true);
  if (existingId) return { agentId: existingId };

  const config = CreateAgentSchema.parse({
    avatar: resolveLocalMirrorAvatar(
      details.item.avatar,
      details.item.iconKey ||
        `local:assistant:${details.item.sourceId}:${details.item.version || 'unknown'}`,
    ),
    description: details.item.description || '',
    marketIdentifier,
    openingMessage: details.config.openingMessage || '',
    openingQuestions: [...(details.config.openingQuestions || [])],
    params: {},
    plugins: [],
    systemRole: details.config.systemRole,
    tags: [...(details.item.tags || [])],
    title: details.item.name,
    visibility: 'private',
  });

  return agentService.createAgent({ config, visibility: 'private' });
};
