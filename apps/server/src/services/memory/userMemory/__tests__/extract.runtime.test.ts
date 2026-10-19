// @vitest-environment node
import { type AiProviderRuntimeState } from '@lobechat/types';
import { type EnabledAiModel } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MemoryExtractionPrivateConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

import { makeTaskErrorItem, MemoryExtractionExecutor } from '../extract';

const mocks = vi.hoisted(() => ({
  getServerDB: vi.fn(async () => ({ id: 'server-db' })),
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
}));

const createRuntimeState = (models: EnabledAiModel[], keyVaults: Record<string, any>) =>
  ({
    enabledAiModels: models,
    enabledAiProviders: [],
    enabledChatAiProviders: [],
    enabledImageAiProviders: [],
    enabledVideoAiProviders: [],
    runtimeConfig: Object.fromEntries(
      Object.entries(keyVaults).map(([providerId, vault]) => [
        providerId,
        { config: {}, keyVaults: vault, settings: {} },
      ]),
    ),
  }) as AiProviderRuntimeState;

const createExecutor = (privateOverrides?: Partial<MemoryExtractionPrivateConfig>) => {
  const basePrivateConfig: MemoryExtractionPrivateConfig = {
    agentBenchmarkLoCoMo: { model: 'benchmark-1', provider: 'provider-b' },
    agentGateKeeper: { model: 'gate-2', provider: 'provider-b' },
    agentLayerExtractor: {
      contextLimit: 2048,
      layers: {
        activity: 'layer-act',
        context: 'layer-ctx',
        experience: 'layer-exp',
        identity: 'layer-id',
        preference: 'layer-pref',
      },
      model: 'layer-1',
      provider: 'provider-l',
    },
    agentPersonaWriter: { model: 'persona-1', provider: 'provider-s' },
    concurrency: 1,
    embedding: { model: 'embed-1', provider: 'provider-e' },
    featureFlags: { enableBenchmarkLoCoMo: false },
    observabilityS3: { enabled: false },
    webhook: {},
  };

  const serverConfig = {
    aiProvider: {},
    memory: {},
  };

  // @ts-ignore accessing private constructor for testing
  return new MemoryExtractionExecutor(serverConfig as any, {
    ...basePrivateConfig,
    ...privateOverrides,
  });
};

const resolveRuntimeTargets = async (
  executor: MemoryExtractionExecutor,
  runtimeState: AiProviderRuntimeState,
  systemAgent?: Record<string, unknown>,
) => {
  const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig(systemAgent);

  return (executor as any).resolveRuntimeTargets(runtimeState, memoryServiceConfig);
};

const resolveRuntimeKeyVaults = async (
  executor: MemoryExtractionExecutor,
  runtimeState: AiProviderRuntimeState,
  systemAgent?: Record<string, unknown>,
) => {
  const targets = await resolveRuntimeTargets(executor, runtimeState, systemAgent);

  return targets.keyVaults;
};

describe('MemoryExtractionExecutor.resolveRuntimeTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps matched providers even when admin-managed providers do not have user key vaults', async () => {
    const executor = createExecutor({
      agentGateKeeper: { model: 'gate-2', provider: 'openai' },
      agentLayerExtractor: {
        contextLimit: 2048,
        layers: {
          activity: 'layer-1',
          context: 'layer-1',
          experience: 'layer-1',
          identity: 'layer-1',
          preference: 'layer-1',
        },
        model: 'layer-1',
        provider: 'openai',
      },
      embedding: { model: 'embed-1', provider: 'openai' },
    });

    const runtimeState = createRuntimeState(
      [
        { abilities: {}, enabled: true, id: 'gate-2', providerId: 'newapi', type: 'chat' },
        { abilities: {}, enabled: true, id: 'layer-1', providerId: 'newapi', type: 'chat' },
        { abilities: {}, enabled: true, id: 'embed-1', providerId: 'newapi', type: 'embedding' },
      ],
      {},
    );

    const targets = await resolveRuntimeTargets(executor, runtimeState);

    expect(targets.providers).toEqual({
      embedding: 'newapi',
      gatekeeper: 'newapi',
      layerExtractor: 'newapi',
    });
    expect(targets.keyVaults).toEqual({});
  });

  it('initializes admin-managed NewAPI memory runtimes from the database', async () => {
    const executor = createExecutor({
      agentGateKeeper: { model: 'gate-2', provider: 'openai' },
      agentLayerExtractor: {
        contextLimit: 2048,
        layers: {
          activity: 'layer-1',
          context: 'layer-1',
          experience: 'layer-1',
          identity: 'layer-1',
          preference: 'layer-1',
        },
        model: 'layer-1',
        provider: 'openai',
      },
      embedding: { model: 'embed-1', provider: 'openai' },
    });

    const runtimeState = createRuntimeState(
      [
        { abilities: {}, enabled: true, id: 'gate-2', providerId: 'newapi', type: 'chat' },
        { abilities: {}, enabled: true, id: 'layer-1', providerId: 'newapi', type: 'chat' },
        { abilities: {}, enabled: true, id: 'embed-1', providerId: 'newapi', type: 'embedding' },
      ],
      {},
    );
    const runtime = { chat: vi.fn(), embeddings: vi.fn(), generateObject: vi.fn() };
    mocks.initModelRuntimeFromDB.mockResolvedValue(runtime);

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig();
    const targets = await resolveRuntimeTargets(executor, runtimeState);
    const bundle = await (executor as any).getRuntime('user-1', memoryServiceConfig, targets);

    expect(bundle).toEqual({
      embeddings: runtime,
      gatekeeper: runtime,
      layerExtractor: runtime,
    });
    expect(mocks.initModelRuntimeFromDB).toHaveBeenNthCalledWith(
      1,
      { id: 'server-db' },
      'user-1',
      'newapi',
      {
        model: 'embed-1',
        modelType: 'embedding',
      },
    );
    expect(mocks.initModelRuntimeFromDB).toHaveBeenNthCalledWith(
      2,
      { id: 'server-db' },
      'user-1',
      'newapi',
      {
        model: 'gate-2',
        modelType: 'chat',
      },
    );
    expect(mocks.initModelRuntimeFromDB).toHaveBeenNthCalledWith(
      3,
      { id: 'server-db' },
      'user-1',
      'newapi',
      {
        model: 'layer-1',
        modelType: 'chat',
      },
    );
  });

  it('drops fallback credentials when user memory provider is overridden', () => {
    const executor = createExecutor({
      embedding: {
        apiKey: 'openai-system-key',
        baseURL: 'https://openai.example.com',
        model: 'embed-1',
        provider: 'openai',
      },
    });

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig({
      userMemoryEmbedding: {
        model: 'embed-2',
        provider: 'anthropic',
      },
    });

    expect(memoryServiceConfig.agents.embedding).toMatchObject({
      model: 'embed-2',
      provider: 'anthropic',
    });
    expect(memoryServiceConfig.agents.embedding.apiKey).toBeUndefined();
    expect(memoryServiceConfig.agents.embedding.baseURL).toBeUndefined();
  });

  it('keeps fallback credentials when user memory provider is unchanged', () => {
    const executor = createExecutor({
      embedding: {
        apiKey: 'openai-system-key',
        baseURL: 'https://openai.example.com',
        model: 'embed-1',
        provider: 'openai',
      },
    });

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig({
      userMemoryEmbedding: {
        model: 'embed-2',
        provider: 'openai',
      },
    });

    expect(memoryServiceConfig.agents.embedding).toMatchObject({
      apiKey: 'openai-system-key',
      baseURL: 'https://openai.example.com',
      model: 'embed-2',
      provider: 'openai',
    });
  });

  it('shares ServiceModel memory analysis config between gatekeeper and layer extractor', () => {
    const executor = createExecutor({
      agentGateKeeper: {
        apiKey: 'gate-system-key',
        baseURL: 'https://gate.example.com',
        model: 'gate-1',
        provider: 'provider-gate',
      },
      agentLayerExtractor: {
        apiKey: 'layer-system-key',
        baseURL: 'https://layer.example.com',
        contextLimit: 2048,
        layers: {
          activity: 'layer-act',
          context: 'layer-ctx',
          experience: 'layer-exp',
          identity: 'layer-id',
          preference: 'layer-pref',
        },
        model: 'layer-1',
        provider: 'provider-layer',
      },
    });

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig({
      memoryAnalysisAgentConfig: {
        contextLimit: 4096,
        model: 'analysis-1',
        provider: 'provider-analysis',
      },
    });

    expect(memoryServiceConfig.agents.gatekeeper).toMatchObject({
      model: 'analysis-1',
      provider: 'provider-analysis',
    });
    expect(memoryServiceConfig.agents.layerExtractor).toMatchObject({
      contextLimit: 4096,
      model: 'analysis-1',
      provider: 'provider-analysis',
    });
    expect(memoryServiceConfig.agents.gatekeeper.apiKey).toBeUndefined();
    expect(memoryServiceConfig.agents.layerExtractor.apiKey).toBeUndefined();
    expect(memoryServiceConfig.modelConfig.gateModel).toBe('analysis-1');
    expect(memoryServiceConfig.modelConfig.layerModels).toEqual({
      activity: 'analysis-1',
      context: 'analysis-1',
      experience: 'analysis-1',
      identity: 'analysis-1',
      preference: 'analysis-1',
    });
  });

  it('uses ServiceModel provider before env preferred providers when provider is overridden', async () => {
    const executor = createExecutor({
      agentGateKeeper: {
        model: 'gate-1',
        provider: 'provider-g',
      },
      agentLayerExtractor: {
        contextLimit: 2048,
        layers: {
          activity: 'layer-1',
          context: 'layer-1',
          experience: 'layer-1',
          identity: 'layer-1',
          preference: 'layer-1',
        },
        model: 'layer-1',
        provider: 'provider-l',
      },
      embedding: {
        apiKey: 'openai-system-key',
        baseURL: 'https://openai.example.com',
        model: 'embed-1',
        provider: 'openai',
      },
      embeddingPreferredProviders: ['provider-b'],
    });

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig({
      userMemoryEmbedding: {
        model: 'embed-2',
        provider: 'provider-a',
      },
    });
    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: true,
          id: 'gate-1',
          providerId: 'provider-g',
          type: 'chat',
        },
        {
          abilities: {},
          enabled: true,
          id: 'layer-1',
          providerId: 'provider-l',
          type: 'chat',
        },
        {
          abilities: {},
          enabled: true,
          id: 'embed-2',
          providerId: 'provider-a',
          type: 'embedding',
        },
        {
          abilities: {},
          enabled: true,
          id: 'embed-2',
          providerId: 'provider-b',
          type: 'embedding',
        },
      ],
      {
        'provider-a': { apiKey: 'a-key' },
        'provider-b': { apiKey: 'b-key' },
        'provider-g': { apiKey: 'g-key' },
        'provider-l': { apiKey: 'l-key' },
      },
    );

    const targets = await (executor as any).resolveRuntimeTargets(
      runtimeState,
      memoryServiceConfig,
    );

    expect(targets.keyVaults).toMatchObject({
      'provider-a': { apiKey: 'a-key' },
    });
    expect(targets.keyVaults).not.toHaveProperty('provider-b');
  });

  it('prefers configured providers/models for gatekeeper, embedding, and layer extractors', async () => {
    const executor = createExecutor({
      embeddingPreferredProviders: ['provider-c', 'provider-a'],
      agentGateKeeperPreferredModels: ['model-chat-1', 'vendor-prefix/model-chat-1'],
      agentGateKeeperPreferredProviders: ['provider-c', 'provider-a'],
      agentLayerExtractorPreferredProviders: ['provider-c', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: true,
          id: 'model-chat-1',
          type: 'chat',
          providerId: 'provider-a',
        },
        {
          abilities: {},
          enabled: true,
          id: 'model-embedding-1',
          type: 'embedding',
          providerId: 'provider-e',
        },
        {
          abilities: {},
          enabled: true,
          id: 'vendor-prefix/model-chat-1',
          type: 'chat',
          providerId: 'provider-b',
        },
        {
          abilities: {},
          enabled: true,
          id: 'vendor-prefix/model-embedding-1',
          type: 'embedding',
          providerId: 'provider-b',
        },
        {
          abilities: {},
          enabled: false,
          id: 'model-chat-1',
          type: 'chat',
          providerId: 'provider-c',
        },
        {
          abilities: {},
          enabled: false,
          id: 'model-embedding-1',
          type: 'embedding',
          providerId: 'provider-c',
        },
      ],
      {
        'provider-a': { apiKey: 'a-key' },
        'provider-b': { apiKey: 'b-key' },
        'provider-c': { apiKey: 'c-key' },
        'provider-e': { apiKey: 'e-key' },
      },
    );

    const keyVaults = await resolveRuntimeKeyVaults(executor, runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-a': { apiKey: 'a-key' },
      'provider-e': { apiKey: 'e-key' },
    });
  });

  it('warns and falls back to server provider when no enabled provider satisfies embedding model', async () => {
    const executor = createExecutor();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: true,
          id: 'model-chat-1',
          type: 'chat',
          providerId: 'provider-a',
        },
        {
          abilities: {},
          enabled: true,
          id: 'model-embedding-1',
          type: 'embedding',
          providerId: 'provider-e',
        },
        {
          abilities: {},
          enabled: true,
          id: 'vendor-prefix/model-chat-1',
          type: 'chat',
          providerId: 'provider-b',
        },
        {
          abilities: {},
          enabled: true,
          id: 'vendor-prefix/model-embedding-1',
          type: 'embedding',
          providerId: 'provider-b',
        },
        {
          abilities: {},
          enabled: false,
          id: 'model-chat-1',
          type: 'chat',
          providerId: 'provider-c',
        },
        {
          abilities: {},
          enabled: false,
          id: 'model-embedding-1',
          type: 'embedding',
          providerId: 'provider-c',
        },
      ],
      {
        'provider-b': { apiKey: 'b-key' },
        'provider-l': { apiKey: 'l-key' },
      },
    );

    const keyVaults = await resolveRuntimeKeyVaults(executor, runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-b': { apiKey: 'b-key' },
      'provider-l': { apiKey: 'l-key' },
    });
    expect(keyVaults).not.toHaveProperty('provider-e');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('ignores disabled providers when resolving key vaults', async () => {
    const executor = createExecutor({
      embeddingPreferredProviders: ['provider-disabled', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: false,
          id: 'embed-1',
          type: 'embedding',
          providerId: 'provider-disabled',
        },
        {
          abilities: {},
          enabled: true,
          id: 'embed-1',
          type: 'embedding',
          providerId: 'provider-a',
        },
      ],
      {
        'provider-disabled': { apiKey: 'disabled-key' },
        'provider-a': { apiKey: 'a-key' },
      },
    );

    const keyVaults = await resolveRuntimeKeyVaults(executor, runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-a': { apiKey: 'a-key' },
    });
    expect(keyVaults).not.toHaveProperty('provider-disabled');
  });

  it('respects preferred provider order when multiple providers have the model', async () => {
    const executor = createExecutor({
      agentGateKeeper: {
        model: 'gate-2',
        provider: 'provider-a', // fallback provider differs from preferred order
        apiKey: 'sys-a-key',
        baseURL: 'https://api-a.example.com',
        language: 'English',
      },
      agentGateKeeperPreferredProviders: ['provider-b', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        { abilities: {}, enabled: true, id: 'gate-2', type: 'chat', providerId: 'provider-a' },
        { abilities: {}, enabled: true, id: 'gate-2', type: 'chat', providerId: 'provider-b' },
      ],
      {
        'provider-a': { apiKey: 'a-key' },
        'provider-b': { apiKey: 'b-key' },
      },
    );

    const keyVaults = await resolveRuntimeKeyVaults(executor, runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-b': { apiKey: 'b-key' }, // picks first preferred provider
    });
    expect(keyVaults).not.toHaveProperty('provider-a');
  });

  it('falls back to configured provider when no enabled models match', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const executor = createExecutor({
      agentGateKeeper: { model: 'gate-2', provider: 'provider-fallback', apiKey: 'sys-fb-key' },
    });

    const runtimeState = createRuntimeState([], {
      'provider-fallback': { apiKey: 'fb-key' },
    });

    const keyVaults = await resolveRuntimeKeyVaults(executor, runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-fallback': { apiKey: 'fb-key' },
    });

    warnSpy.mockRestore();
  });
});

describe('makeTaskErrorItem', () => {
  it('preserves database driver details from nested causes', () => {
    const driverError = new Error('must be able to parse query');
    driverError.name = 'PostgresError';
    Object.assign(driverError, { code: 'XX000' });

    const queryError = new Error('Failed query: select ...', { cause: driverError });
    queryError.name = 'DrizzleQueryError';

    const item = makeTaskErrorItem('retrieval', queryError, {
      sourceId: 'topic-1',
      sourceType: 'chat_topic',
    });

    expect(item).toMatchObject({
      cause: {
        code: 'XX000',
        message: 'must be able to parse query',
        name: 'PostgresError',
      },
      message: 'Failed query: select ...',
      name: 'DrizzleQueryError',
      sourceId: 'topic-1',
      sourceType: 'chat_topic',
      stage: 'retrieval',
    });
  });
});
