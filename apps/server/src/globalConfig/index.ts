import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { parseToolNameMaxLength } from '@lobechat/const/plugin';
import { type ProviderConfig } from '@lobechat/types';
import { merge } from '@lobechat/utils';
import { type AiFullModelCard, ModelProvider } from 'model-bank';
import { gptImage1Schema, seedance15ProParams } from 'model-bank/lobehub';

import { isDesktop } from '@/const/version';
import { type LobeChatDatabase } from '@/database/type';
import { appEnv, getAppConfig } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { imageEnv } from '@/envs/image';
import { knowledgeEnv } from '@/envs/knowledge';
import { langfuseEnv } from '@/envs/langfuse';
import { toolsEnv } from '@/envs/tools';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';
import {
  getServerComposioConfig,
  getServerDefaultAgentSettingOverrides,
  getServerDefaultGenerationModelSettingOverrides,
  getServerFileS3Config,
  getServerPublicCustomizationConfig,
  getServerUserGlobalSettingsDefaults,
  getServerVectorSettingOverrides,
} from '@/server/services/appSettings';
import { getAllEnabledModels, toAiModelType } from '@/server/services/newapiInstance';
import { type GlobalServerConfig } from '@/types/serverConfig';
import { cleanObject } from '@/utils/object';

import { genServerAiProvidersConfig } from './genServerAiProviderConfig';
import { parseAgentConfig } from './parseDefaultAgent';
import { parseFilesConfig } from './parseFilesConfig';
import { getResolvedPublicMemoryExtractionConfig } from './parseMemoryExtractionConfig';
import { ADMIN_MANAGED_AI_PROVIDER, getProviderSpecificConfig } from './providerSpecificConfig';

/**
 * Get Better-Auth SSO providers list
 * Parses AUTH_SSO_PROVIDERS and returns enabled providers
 */
const getBetterAuthSSOProviders = () => {
  return parseSSOProviders(authEnv.AUTH_SSO_PROVIDERS);
};

const getGenericNewapiParameters = (type: string) => {
  if (type === 'image') return gptImage1Schema;
  if (type === 'video') return seedance15ProParams;
  return undefined;
};

type AdminManagedServerModelCard = AiFullModelCard & {
  groupKey?: string | null;
  groupName?: string | null;
  instanceId?: string | null;
  instanceName?: string | null;
  providerId?: string | null;
  providerType?: string | null;
};

type AdminManagedProviderConfig = ProviderConfig & {
  logo?: string;
  name?: string;
  parentProviderId?: string;
};

const uniqueModelIds = (models: AdminManagedServerModelCard[]) =>
  Array.from(new Set(models.map((m) => m.id)));

export const getServerGlobalConfig = async (db?: LobeChatDatabase) => {
  const defaultAgentConfig = await getResolvedServerDefaultAgentConfig(db);
  const defaultAgentMeta = cleanObject({
    avatar: defaultAgentConfig.avatar,
    title: defaultAgentConfig.title,
  });
  const generationModelConfig = await getServerDefaultGenerationModelSettingOverrides(db);
  const userDefaults = await getServerUserGlobalSettingsDefaults(db);
  const composioConfig = await getServerComposioConfig(db);
  const s3Config = await getServerFileS3Config(db);
  const customization = await getServerPublicCustomizationConfig(db);
  const aiProvider = (await genServerAiProvidersConfig(
    getProviderSpecificConfig({
      enableBusinessFeatures: ENABLE_BUSINESS_FEATURES,
      isDesktop,
      ollamaProxyUrl: process.env.OLLAMA_PROXY_URL,
    }),
  )) as Record<string, AdminManagedProviderConfig>;

  if (ENABLE_BUSINESS_FEATURES) {
    // ComHub business mode: backend admin provider settings are authoritative.
    // Upstream/env built-in providers may still exist in generated config, but
    // users must not see or call them unless ComHub explicitly opts them in.
    for (const [providerId, providerConfig] of Object.entries(aiProvider)) {
      if (providerId !== ADMIN_MANAGED_AI_PROVIDER) {
        aiProvider[providerId] = { ...providerConfig, enabled: false };
      }
    }

    const instanceModels = await getAllEnabledModels(db);
    const managedNewApiModelIds = Array.from(new Set(instanceModels.map((m) => m.id)));

    if (managedNewApiModelIds.length > 0) {
      const serverModelLists: AdminManagedServerModelCard[] = instanceModels.map((m) => {
        const modelType = toAiModelType(m.type);
        const parameters = getGenericNewapiParameters(modelType);

        return {
          ...(m.abilities ? { abilities: m.abilities } : {}),
          displayName: m.displayName || m.id,
          enabled: true,
          groupKey: m.groupKey,
          groupName: m.groupName,
          id: m.id,
          instanceId: m.instanceId,
          instanceName: m.instanceName,
          ...(parameters ? { parameters } : {}),
          ...(m.pricing ? { pricing: m.pricing } : {}),
          providerId: m.providerId,
          providerType: m.providerType,
          type: modelType,
        };
      });

      const groupedProviderModels = new Map<string, AdminManagedServerModelCard[]>();
      for (const model of serverModelLists) {
        const providerId = model.providerId || ADMIN_MANAGED_AI_PROVIDER;
        groupedProviderModels.set(providerId, [
          ...(groupedProviderModels.get(providerId) ?? []),
          model,
        ]);
      }
      const virtualProviderIds = Array.from(groupedProviderModels.keys()).filter(
        (providerId) => providerId !== ADMIN_MANAGED_AI_PROVIDER,
      );

      aiProvider[ADMIN_MANAGED_AI_PROVIDER] = {
        ...aiProvider[ADMIN_MANAGED_AI_PROVIDER],
        enabled: virtualProviderIds.length > 0 ? false : aiProvider[ADMIN_MANAGED_AI_PROVIDER]?.enabled,
        enabledModels: managedNewApiModelIds,
        serverModelLists,
      };

      for (const providerId of virtualProviderIds) {
        const models = groupedProviderModels.get(providerId) ?? [];
        const first = models[0];

        aiProvider[providerId] = {
          enabled: true,
          enabledModels: uniqueModelIds(models),
          name: first?.instanceName || first?.groupName || providerId,
          parentProviderId: ADMIN_MANAGED_AI_PROVIDER,
          serverModelLists: models,
        };
      }
    }
  }

  const config: GlobalServerConfig = {
    aiProvider,
    customization,
    defaultAgent: {
      config: defaultAgentConfig,
      ...(Object.keys(defaultAgentMeta).length > 0 ? { meta: defaultAgentMeta } : {}),
    },
    disableEmailPassword: authEnv.AUTH_DISABLE_EMAIL_PASSWORD,
    enableBusinessFeatures: ENABLE_BUSINESS_FEATURES,
    enableEmailVerification: authEnv.AUTH_EMAIL_VERIFICATION,
    enableComposio: composioConfig.enabled && Boolean(composioConfig.apiKey),
    enableGatewayMode:
      ENABLE_BUSINESS_FEATURES || (!!appEnv.ENABLE_AGENT_GATEWAY && !!appEnv.AGENT_GATEWAY_URL),
    enableLobehubSkill: !!(appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID),
    enableMagicLink: authEnv.AUTH_ENABLE_MAGIC_LINK,
    enableMarketTrustedClient: !!(
      appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID
    ),
    enableUploadFileToServer: !!(
      s3Config.accessKeyId &&
      s3Config.secretAccessKey &&
      s3Config.endpoint &&
      s3Config.bucket
    ),
    enableMultimodalUnderstanding: !!(
      toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER && toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL
    ),
    ...(toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER && toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL
      ? {
          multimodalUnderstanding: {
            model: toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL,
            provider: toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER,
          },
        }
      : undefined),

    // Expose Agent Gateway URL to client (used by hetero agents; also required for queue mode)
    ...(appEnv.AGENT_GATEWAY_URL ? { agentGatewayUrl: appEnv.AGENT_GATEWAY_URL } : undefined),

    image: cleanObject({
      defaultModel: generationModelConfig.image?.model,
      defaultImageNum: imageEnv.AI_IMAGE_DEFAULT_IMAGE_NUM,
      defaultProvider: generationModelConfig.image?.provider,
    }),
    video: cleanObject({
      defaultModel: generationModelConfig.video?.model,
      defaultProvider: generationModelConfig.video?.provider,
    }),
    memory: {
      userMemory: cleanObject(await getResolvedPublicMemoryExtractionConfig(db)),
    },
    oAuthSSOProviders: getBetterAuthSSOProviders(),
    systemAgent: parseSystemAgent(appEnv.SYSTEM_AGENT),
    telemetry: {
      langfuse: langfuseEnv.ENABLE_LANGFUSE,
    },
    userDefaults,
    // The client-driven chat path generates tool names in the browser, so the
    // server-only `TOOL_NAME_MAX_LENGTH` has to travel with the config for `0`
    // (compression off) to have any effect outside gateway mode. Parsed with the
    // resolver's own function so both sides read the raw value identically —
    // unset/invalid stays `undefined`, i.e. the resolver's default 64.
    toolNameMaxLength: parseToolNameMaxLength(toolsEnv.TOOL_NAME_MAX_LENGTH),
  };

  return config;
};

export const getServerDefaultAgentConfig = () => {
  const { DEFAULT_AGENT_CONFIG } = getAppConfig();

  return parseAgentConfig(DEFAULT_AGENT_CONFIG) || {};
};

export const getResolvedServerDefaultAgentConfig = async (db?: LobeChatDatabase) => {
  const envDefaultAgentConfig = getServerDefaultAgentConfig();
  const appSettingOverrides = await getServerDefaultAgentSettingOverrides(db);

  return merge(envDefaultAgentConfig, appSettingOverrides);
};

export const getServerDefaultFilesConfig = () => {
  return parseFilesConfig(knowledgeEnv.DEFAULT_FILES_CONFIG);
};

export const getResolvedServerDefaultFilesConfig = async (db?: LobeChatDatabase) => {
  const envFilesConfig = getServerDefaultFilesConfig();
  const overrides = await getServerVectorSettingOverrides(db);

  return merge(envFilesConfig, overrides);
};
