import type * as BusinessConst from '@lobechat/business-const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerGlobalConfig } from './index';

const mocks = vi.hoisted(() => ({
  genServerAiProvidersConfig: vi.fn(),
  getServerComposioConfig: vi.fn(),
  getServerDefaultAgentSettingOverrides: vi.fn(),
  getServerDefaultGenerationModelSettingOverrides: vi.fn(),
  getServerPublicCustomizationConfig: vi.fn(),
  getServerFileS3Config: vi.fn(),
  getServerUserGlobalSettingsDefaults: vi.fn(),
  getAllEnabledModels: vi.fn(),
  parseAgentConfig: vi.fn(),
  parseSSOProviders: vi.fn(),
  parseSystemAgent: vi.fn(),
}));

vi.mock('@lobechat/business-const', async (importOriginal) => {
  const actual = await importOriginal<typeof BusinessConst>();

  return {
    ...actual,
    BRANDING_PROVIDER: 'lobehub',
    ENABLE_BUSINESS_FEATURES: true,
  };
});

vi.mock('@/config/klavis', () => ({
  klavisEnv: { KLAVIS_API_KEY: '' },
}));

vi.mock('@/config/composio', () => ({
  composioEnv: { COMPOSIO_API_KEY: '' },
}));

vi.mock('@/const/version', () => ({
  isDesktop: false,
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    AGENT_GATEWAY_URL: '',
    MARKET_TRUSTED_CLIENT_ID: '',
    MARKET_TRUSTED_CLIENT_SECRET: '',
    SYSTEM_AGENT: '',
    enableQueueAgentRuntime: false,
  },
  getAppConfig: vi.fn(() => ({
    DEFAULT_AGENT_CONFIG: 'test-agent-config',
  })),
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_DISABLE_EMAIL_PASSWORD: false,
    AUTH_EMAIL_VERIFICATION: false,
    AUTH_ENABLE_MAGIC_LINK: false,
    AUTH_SSO_PROVIDERS: '',
  },
}));

vi.mock('@/envs/file', () => ({
  fileEnv: {
    S3_SECRET_ACCESS_KEY: '',
  },
}));

vi.mock('@/envs/knowledge', () => ({
  knowledgeEnv: {
    DEFAULT_FILES_CONFIG: '',
  },
}));

vi.mock('@/envs/langfuse', () => ({
  langfuseEnv: {
    ENABLE_LANGFUSE: false,
  },
}));

vi.mock('@/envs/image', () => ({
  imageEnv: {
    AI_IMAGE_DEFAULT_IMAGE_NUM: 1,
  },
}));

vi.mock('@/envs/tools', () => ({
  toolsEnv: {
    VISUAL_UNDERSTANDING_MODEL: '',
    VISUAL_UNDERSTANDING_PROVIDER: '',
  },
}));

vi.mock('@/libs/better-auth/utils/server', () => ({
  parseSSOProviders: mocks.parseSSOProviders,
}));

vi.mock('@/server/globalConfig/parseSystemAgent', () => ({
  parseSystemAgent: mocks.parseSystemAgent,
}));

vi.mock('@/server/services/appSettings', () => ({
  getServerComposioConfig: mocks.getServerComposioConfig,
  getServerDefaultAgentSettingOverrides: mocks.getServerDefaultAgentSettingOverrides,
  getServerDefaultGenerationModelSettingOverrides:
    mocks.getServerDefaultGenerationModelSettingOverrides,
  getServerPublicCustomizationConfig: mocks.getServerPublicCustomizationConfig,
  getServerFileS3Config: mocks.getServerFileS3Config,
  getServerUserGlobalSettingsDefaults: mocks.getServerUserGlobalSettingsDefaults,
}));

vi.mock('@/server/services/newapiInstance', () => ({
  getAllEnabledModels: mocks.getAllEnabledModels,
  toAiModelType: vi.fn((type: string) => (type === 'stt' ? 'asr' : type)),
}));

vi.mock('./genServerAiProviderConfig', () => ({
  genServerAiProvidersConfig: mocks.genServerAiProvidersConfig,
}));

vi.mock('./parseDefaultAgent', () => ({
  parseAgentConfig: mocks.parseAgentConfig,
}));

vi.mock('./parseFilesConfig', () => ({
  parseFilesConfig: vi.fn(() => ({})),
}));

vi.mock('./parseMemoryExtractionConfig', () => ({
  getResolvedPublicMemoryExtractionConfig: vi.fn(() => undefined),
}));

describe('getServerGlobalConfig business newapi model injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.genServerAiProvidersConfig.mockResolvedValue({
      newapi: {
        enabled: true,
        enabledModels: undefined,
        serverModelLists: [],
      },
      openai: {
        enabled: true,
        enabledModels: ['gpt-4o'],
        serverModelLists: [{ id: 'gpt-4o', type: 'chat' }],
      },
    });
    mocks.getServerComposioConfig.mockResolvedValue({
      apiKey: '',
      authConfigIds: '',
      enabled: false,
    });
    mocks.getServerDefaultAgentSettingOverrides.mockResolvedValue({});
    mocks.getServerDefaultGenerationModelSettingOverrides.mockResolvedValue({});
    mocks.getServerPublicCustomizationConfig.mockResolvedValue({});
    mocks.getServerFileS3Config.mockResolvedValue({
      accessKeyId: '',
      bucket: '',
      enablePathStyle: false,
      endpoint: '',
      filePath: 'files',
      previewUrlExpireIn: 7200,
      publicDomain: '',
      region: '',
      secretAccessKey: '',
      setAcl: false,
    });
    mocks.getServerUserGlobalSettingsDefaults.mockResolvedValue({});
    mocks.getAllEnabledModels.mockResolvedValue([]);
    mocks.parseAgentConfig.mockReturnValue({});
    mocks.parseSSOProviders.mockReturnValue([]);
    mocks.parseSystemAgent.mockReturnValue(undefined);
  });

  it('exposes backend controlled public customization config', async () => {
    mocks.getServerPublicCustomizationConfig.mockResolvedValue({
      helpMenuItems: [{ label: 'Docs', url: 'https://docs.example.com' }],
      skillUseButtonLabel: 'Use in QingyouAI',
    });

    const result = await getServerGlobalConfig({} as any);

    expect(result.customization).toEqual({
      helpMenuItems: [{ label: 'Docs', url: 'https://docs.example.com' }],
      skillUseButtonLabel: 'Use in QingyouAI',
    });
  });

  it('injects global newapi model IDs with all types into server provider config', async () => {
    mocks.getAllEnabledModels.mockResolvedValue([
      { id: 'gpt-4o-mini', type: 'chat', displayName: null },
      { id: 'dall-e-3', type: 'image', displayName: 'DALL-E 3' },
      { id: 'tts-1', type: 'tts', displayName: null },
    ]);

    const result = await getServerGlobalConfig({} as any);

    expect(mocks.genServerAiProvidersConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        newapi: { enabled: true },
      }),
    );
    expect(mocks.genServerAiProvidersConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        deepseek: {},
      }),
    );
    expect(mocks.genServerAiProvidersConfig).toHaveBeenCalledWith(
      expect.not.objectContaining({
        lobehub: expect.anything(),
      }),
    );
    expect(result.aiProvider.newapi!.enabledModels).toEqual(['gpt-4o-mini', 'dall-e-3', 'tts-1']);
    expect(result.aiProvider.newapi!.serverModelLists).toEqual([
      expect.objectContaining({
        displayName: 'gpt-4o-mini',
        enabled: true,
        id: 'gpt-4o-mini',
        type: 'chat',
      }),
      expect.objectContaining({
        displayName: 'DALL-E 3',
        enabled: true,
        id: 'dall-e-3',
        type: 'image',
      }),
      expect.objectContaining({
        displayName: 'tts-1',
        enabled: true,
        id: 'tts-1',
        type: 'tts',
      }),
    ]);
  });

  it('adds generic parameters for admin-managed NewAPI image and video models', async () => {
    mocks.getAllEnabledModels.mockResolvedValue([
      { displayName: 'Flux', id: 'flux-pro', type: 'image' },
      { displayName: 'Sora', id: 'sora-2', type: 'video' },
    ]);

    const result = await getServerGlobalConfig({} as any);
    const models = result.aiProvider.newapi!.serverModelLists!;

    expect(models.find((m) => m.id === 'flux-pro')?.parameters).toEqual(
      expect.objectContaining({ prompt: { default: '' } }),
    );
    expect(models.find((m) => m.id === 'sora-2')?.parameters).toEqual(
      expect.objectContaining({ duration: expect.objectContaining({ default: 5 }) }),
    );
  });

  it('injects admin-managed model pricing into server model lists', async () => {
    const pricing = {
      approximatePricePerImage: 0.03,
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    };
    mocks.getAllEnabledModels.mockResolvedValue([
      { displayName: 'GPT Image', id: 'gpt-image-2', pricing, type: 'image' },
    ]);

    const result = await getServerGlobalConfig({} as any);

    expect(result.aiProvider.newapi!.serverModelLists).toEqual([
      expect.objectContaining({
        id: 'gpt-image-2',
        pricing,
      }),
    ]);
  });

  it('uses only enabled NewAPI instance models for provider injection', async () => {
    mocks.getAllEnabledModels.mockResolvedValue([
      {
        displayName: null,
        groupKey: 'pro',
        groupName: 'Pro',
        id: 'gpt-4o-mini',
        instanceId: 'instance-pro',
        instanceName: 'Pro Gateway',
        providerType: 'deepseek',
        type: 'chat',
      },
    ]);

    const result = await getServerGlobalConfig({} as any);

    expect(result.aiProvider.newapi!.enabledModels).toEqual(['gpt-4o-mini']);
    expect(result.aiProvider.newapi!.serverModelLists).toEqual([
      {
        displayName: 'gpt-4o-mini',
        enabled: true,
        groupKey: 'pro',
        groupName: 'Pro',
        id: 'gpt-4o-mini',
        instanceId: 'instance-pro',
        instanceName: 'Pro Gateway',
        providerType: 'deepseek',
        type: 'chat',
      },
    ]);
  });

  it('exposes admin AI services as separate user-facing provider groups', async () => {
    mocks.getAllEnabledModels.mockResolvedValue([
      {
        displayName: 'GPT-4o',
        groupKey: 'pro',
        groupName: 'Pro',
        id: 'gpt-4o',
        instanceId: 'siliconflow-id',
        instanceName: 'SiliconFlow',
        providerId: 'siliconflow-id',
        providerType: 'newapi',
        type: 'chat',
      },
      {
        displayName: 'GPT-4o',
        groupKey: 'pro',
        groupName: 'Pro',
        id: 'gpt-4o',
        instanceId: 'toapi-id',
        instanceName: 'ToAPI',
        providerId: 'toapi-id',
        providerType: 'newapi',
        type: 'chat',
      },
    ]);

    const result = await getServerGlobalConfig({} as any);

    expect(result.aiProvider.newapi!.enabled).toBe(false);
    expect(result.aiProvider['siliconflow-id']).toEqual(
      expect.objectContaining({
        enabled: true,
        enabledModels: ['gpt-4o'],
        name: 'SiliconFlow',
        parentProviderId: 'newapi',
        serverModelLists: [expect.objectContaining({ displayName: 'GPT-4o', id: 'gpt-4o' })],
      }),
    );
    expect(result.aiProvider['toapi-id']).toEqual(
      expect.objectContaining({
        enabled: true,
        enabledModels: ['gpt-4o'],
        name: 'ToAPI',
        parentProviderId: 'newapi',
        serverModelLists: [expect.objectContaining({ displayName: 'GPT-4o', id: 'gpt-4o' })],
      }),
    );
  });

  it('disables non-admin built-in providers in business mode even when generated config enables them', async () => {
    mocks.genServerAiProvidersConfig.mockResolvedValue({
      anthropic: {
        enabled: true,
        serverModelLists: [{ enabled: true, id: 'claude-sonnet-4-6', type: 'chat' }],
      },
      google: {
        enabled: true,
        serverModelLists: [{ enabled: true, id: 'gemini-3.1-pro-preview', type: 'chat' }],
      },
      lobehub: {
        enabled: true,
        serverModelLists: [{ enabled: true, id: 'lobehub-chat', type: 'chat' }],
      },
      newapi: {
        enabled: true,
        serverModelLists: [{ enabled: true, id: 'admin-chat', type: 'chat' }],
      },
      openai: {
        enabled: true,
        serverModelLists: [{ enabled: true, id: 'gpt-5.4-mini', type: 'chat' }],
      },
    });

    const result = await getServerGlobalConfig({} as any);

    expect(result.aiProvider.newapi!.enabled).toBe(true);
    expect(result.aiProvider.anthropic!.enabled).toBe(false);
    expect(result.aiProvider.google!.enabled).toBe(false);
    expect(result.aiProvider.lobehub!.enabled).toBe(false);
    expect(result.aiProvider.openai!.enabled).toBe(false);
  });

  it('keeps the generated provider config unchanged when no global newapi model IDs are configured', async () => {
    const result = await getServerGlobalConfig({} as any);

    expect(result.aiProvider.newapi!.enabledModels).toBeUndefined();
    expect(result.aiProvider.newapi!.serverModelLists).toEqual([]);
    expect(result.aiProvider.openai!.serverModelLists).toEqual([{ id: 'gpt-4o', type: 'chat' }]);
  });

  it('merges backend default provider and model overrides into default agent config', async () => {
    mocks.parseAgentConfig.mockReturnValue({ model: 'env-model', provider: 'openai' });
    mocks.getServerDefaultAgentSettingOverrides.mockResolvedValue({
      avatar: '/admin-avatar.svg',
      model: 'deepseek-chat',
      provider: 'newapi',
      title: 'Admin Assistant',
    });

    const result = await getServerGlobalConfig({} as any);

    expect(result.defaultAgent?.config).toMatchObject({
      model: 'deepseek-chat',
      provider: 'newapi',
    });
    expect(result.defaultAgent?.meta).toMatchObject({
      avatar: '/admin-avatar.svg',
      title: 'Admin Assistant',
    });
  });

  it('exposes backend default image and video generation models', async () => {
    mocks.getServerDefaultGenerationModelSettingOverrides.mockResolvedValue({
      image: { model: 'flux-pro', provider: 'newapi' },
      video: { model: 'sora-2', provider: 'newapi' },
    });

    const result = await getServerGlobalConfig({} as any);

    expect(result.image).toMatchObject({
      defaultModel: 'flux-pro',
      defaultProvider: 'newapi',
    });
    expect(result.video).toMatchObject({
      defaultModel: 'sora-2',
      defaultProvider: 'newapi',
    });
  });

  it('enables upload support when S3 is configured from backend settings', async () => {
    mocks.getServerFileS3Config.mockResolvedValue({
      accessKeyId: 'admin-access-key',
      bucket: 'admin-bucket',
      enablePathStyle: true,
      endpoint: 'https://s3.example.com',
      filePath: 'admin-files',
      previewUrlExpireIn: 7200,
      publicDomain: '',
      region: 'us-east-1',
      secretAccessKey: 'admin-secret-key',
      setAcl: false,
    });

    const result = await getServerGlobalConfig({} as any);

    expect(result.enableUploadFileToServer).toBe(true);
  });

  it('exposes backend user default settings in server config', async () => {
    mocks.getServerUserGlobalSettingsDefaults.mockResolvedValue({
      general: { language: 'zh-CN' },
      tool: { uninstalledBuiltinTools: ['web-browsing'] },
    });

    const result = await getServerGlobalConfig({} as any);

    expect(result.userDefaults).toMatchObject({
      general: { language: 'zh-CN' },
      tool: { uninstalledBuiltinTools: ['web-browsing'] },
    });
  });
});
