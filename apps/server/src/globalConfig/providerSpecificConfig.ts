import type { ProviderSpecificConfig } from './genServerAiProviderConfig';

export const ADMIN_MANAGED_AI_PROVIDER = 'newapi';

export interface ProviderSpecificConfigOptions {
  enableBusinessFeatures: boolean;
  isDesktop: boolean;
  ollamaProxyUrl?: string;
}

export const getProviderSpecificConfig = ({
  enableBusinessFeatures,
  isDesktop,
  ollamaProxyUrl,
}: ProviderSpecificConfigOptions): Record<string, ProviderSpecificConfig> => ({
  ...(enableBusinessFeatures
    ? {
        [ADMIN_MANAGED_AI_PROVIDER]: {
          enabled: true,
        },
      }
    : {}),
  azure: {
    enabledKey: 'ENABLED_AZURE_OPENAI',
    withDeploymentName: true,
  },
  azureai: {
    withDeploymentName: true,
  },
  bedrock: {
    enabledKey: 'ENABLED_AWS_BEDROCK',
    modelListKey: 'AWS_BEDROCK_MODEL_LIST',
  },
  deepseek: enableBusinessFeatures ? {} : { enabled: true },
  giteeai: {
    enabledKey: 'ENABLED_GITEE_AI',
    modelListKey: 'GITEE_AI_MODEL_LIST',
  },
  kimicodingplan: {
    withDeploymentName: true,
  },
  lmstudio: {
    fetchOnClient: isDesktop ? false : undefined,
  },
  ollama: {
    enabled: isDesktop ? true : undefined,
    fetchOnClient: isDesktop ? false : !ollamaProxyUrl,
  },
  ollamacloud: {
    enabledKey: 'ENABLED_OLLAMA_CLOUD',
  },
  qwen: {
    withDeploymentName: true,
  },
  spark: {
    withDeploymentName: true,
  },
  tencentcloud: {
    enabledKey: 'ENABLED_TENCENT_CLOUD',
    modelListKey: 'TENCENT_CLOUD_MODEL_LIST',
  },
  volcengine: {
    withDeploymentName: true,
  },
  volcenginecodingplan: {
    withDeploymentName: true,
  },
});
