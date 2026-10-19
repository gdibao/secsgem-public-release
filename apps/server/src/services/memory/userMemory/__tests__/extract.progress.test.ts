import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemorySourceType } from '@/types/userMemory';

const {
  mockFindTopic,
  mockGetServerDB,
  mockGetUserState,
  mockIncrementUserMemoryExtractionProgress,
} = vi.hoisted(() => {
  const mockFindTopic = vi.fn();
  const mockGetUserState = vi.fn();
  const mockIncrementUserMemoryExtractionProgress = vi.fn();
  const mockDb = {
    query: {
      topics: {
        findFirst: mockFindTopic,
      },
    },
  };

  return {
    mockFindTopic,
    mockGetServerDB: vi.fn(() => Promise.resolve(mockDb)),
    mockGetUserState,
    mockIncrementUserMemoryExtractionProgress,
  };
});

vi.mock('@/database/server', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserState: mockGetUserState,
  })),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn().mockImplementation(() => ({
    incrementUserMemoryExtractionProgress: mockIncrementUserMemoryExtractionProgress,
  })),
}));

const { MemoryExtractionExecutor } = await import('../extract');

const createExecutor = () => {
  const serverConfig = {
    aiProvider: {},
    memory: {},
  };
  const privateConfig = {
    agentGateKeeper: { model: 'gate', provider: 'provider' },
    agentLayerExtractor: {
      contextLimit: 2048,
      layers: {},
      model: 'layer',
      provider: 'provider',
    },
    agentPersonaWriter: { model: 'persona', provider: 'provider' },
    concurrency: 1,
    embedding: { model: 'embed', provider: 'provider' },
    featureFlags: { enableBenchmarkLoCoMo: false },
    observabilityS3: { enabled: false },
    webhook: {},
  };

  // @ts-ignore accessing private constructor for focused unit coverage
  const executor = new MemoryExtractionExecutor(serverConfig, privateConfig);

  (executor as any).getAiProviderRuntimeState = vi.fn().mockResolvedValue({
    enabledAiModels: [],
    enabledAiProviders: [],
    enabledChatAiProviders: [],
    enabledImageAiProviders: [],
    enabledVideoAiProviders: [],
    runtimeConfig: {},
  });
  (executor as any).resolveRuntimeKeyVaults = vi.fn().mockResolvedValue({});
  (executor as any).getRuntime = vi.fn().mockResolvedValue({});
  (executor as any).listConversationsForTopic = vi.fn().mockResolvedValue([]);
  (executor as any).recordJobMetrics = vi.fn();

  return executor;
};

describe('MemoryExtractionExecutor.extractTopic progress reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindTopic.mockResolvedValue({
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 'topic-1',
      metadata: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      userId: 'user-1',
    });
    mockGetUserState.mockResolvedValue({
      settings: {
        general: {
          responseLanguage: 'zh-CN',
        },
      },
    });
  });

  it('increments user-initiated task progress when a topic has no conversations', async () => {
    const executor = createExecutor();

    const result = await executor.extractTopic({
      asyncTaskId: 'task-1',
      forceAll: false,
      forceTopics: false,
      layers: [],
      source: MemorySourceType.ChatTopic,
      topicId: 'topic-1',
      userId: 'user-1',
      userInitiated: true,
    });

    expect(result).toMatchObject({
      extracted: false,
      layers: {},
      memoryIds: [],
    });
    expect(mockIncrementUserMemoryExtractionProgress).toHaveBeenCalledWith('task-1');
  });
});
