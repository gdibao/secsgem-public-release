// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from './index';

const mocks = vi.hoisted(() => ({
  buildNewapiRouteMetadata: vi.fn((instance?: any) =>
    instance
      ? {
          ...(instance.groupKey ? { groupKey: instance.groupKey } : {}),
          ...(instance.groupMultiplier === null || instance.groupMultiplier === undefined
            ? {}
            : { groupMultiplier: instance.groupMultiplier }),
          ...(instance.groupName ? { groupName: instance.groupName } : {}),
          ...(instance.instanceId ? { instanceId: instance.instanceId } : {}),
          ...(instance.instanceName ? { instanceName: instance.instanceName } : {}),
          ...(instance.providerType ? { providerType: instance.providerType } : {}),
        }
      : undefined,
  ),
  getAiProviderById: vi.fn(),
  getBusinessModelRuntimeHooks: vi.fn(),
  createLLMGenerationTracingHook: vi.fn(),
  initializeWithProvider: vi.fn(),
  mergeModelRuntimeHooks: vi.fn((...hooks: any[]) => Object.assign({}, ...hooks.filter(Boolean))),
  resolveDefaultNewapiInstance: vi.fn(),
  resolveNewapiInstanceByProviderId: vi.fn(),
  resolveNewapiInstancesForModel: vi.fn(),
}));

vi.mock('@lobechat/model-runtime', () => ({
  mergeModelRuntimeHooks: mocks.mergeModelRuntimeHooks,
  ModelRuntime: {
    initializeWithProvider: mocks.initializeWithProvider,
  },
}));

vi.mock('@lobechat/model-runtime/vertexai', () => ({
  LobeVertexAI: {
    initFromVertexAI: vi.fn(),
  },
}));

vi.mock('@/business/server/model-runtime', () => ({
  getBusinessModelRuntimeHooks: mocks.getBusinessModelRuntimeHooks,
}));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(() => ({
    getAiProviderById: mocks.getAiProviderById,
  })),
}));

vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(() => ({})),
}));

vi.mock('@/server/services/llmGenerationTracing/hook', () => ({
  createLLMGenerationTracingHook: mocks.createLLMGenerationTracingHook,
}));

vi.mock('@/server/services/newapiInstance', () => ({
  buildNewapiRouteMetadata: mocks.buildNewapiRouteMetadata,
  resolveDefaultNewapiInstance: mocks.resolveDefaultNewapiInstance,
  resolveNewapiInstanceByProviderId: mocks.resolveNewapiInstanceByProviderId,
  resolveNewapiInstancesForModel: mocks.resolveNewapiInstancesForModel,
}));

vi.mock('../KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    getUserKeyVaults: vi.fn(),
  },
}));

vi.mock('./apiKeyManager', () => ({
  default: {
    pick: vi.fn((key) => key),
  },
}));

describe('initModelRuntimeFromDB newapi routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: {} });
    mocks.getBusinessModelRuntimeHooks.mockReturnValue({ beforeChat: vi.fn() });
    mocks.createLLMGenerationTracingHook.mockReturnValue({ afterChat: vi.fn() });
    mocks.initializeWithProvider.mockReturnValue({ chat: vi.fn() });
    mocks.resolveNewapiInstanceByProviderId.mockResolvedValue(null);
  });

  it('should resolve newapi route by user plan and pass primary route metadata into hooks', async () => {
    const db = { id: 'db' } as any;
    const onRouteResolved = vi.fn();
    const primaryRoute = {
      apiKey: 'sk-pro',
      baseUrl: 'https://newapi.example.com/v1',
      groupKey: 'pro',
      groupMultiplier: 1.5,
      groupName: 'Pro Group',
      instanceId: 'instance-pro',
      instanceName: 'NewAPI Pro',
      priority: 10,
      providerType: 'newapi',
      source: 'instance' as const,
    };
    mocks.resolveNewapiInstancesForModel.mockResolvedValue([primaryRoute]);

    await initModelRuntimeFromDB(db, 'user-1', 'newapi', {
      model: 'gpt-test',
      modelType: 'chat',
      onRouteResolved,
    });

    expect(mocks.resolveNewapiInstancesForModel).toHaveBeenCalledWith(db, {
      modelId: 'gpt-test',
      modelType: 'chat',
      userId: 'user-1',
    });
    expect(mocks.getBusinessModelRuntimeHooks).toHaveBeenCalledWith(
      'user-1',
      'newapi',
      {
        groupKey: 'pro',
        groupMultiplier: 1.5,
        groupName: 'Pro Group',
        instanceId: 'instance-pro',
        instanceName: 'NewAPI Pro',
        providerType: 'newapi',
      },
      undefined,
    );
    expect(onRouteResolved).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'instance-pro', providerType: 'newapi' }),
    );
    expect(mocks.createLLMGenerationTracingHook).toHaveBeenCalledWith(
      'user-1',
      'newapi',
      undefined,
    );
    expect(mocks.mergeModelRuntimeHooks).toHaveBeenCalledWith(
      expect.objectContaining({ beforeChat: expect.any(Function) }),
      expect.objectContaining({ afterChat: expect.any(Function) }),
    );
    expect(mocks.initializeWithProvider).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        apiKey: 'sk-pro',
        baseURL: 'https://newapi.example.com/v1',
        userId: 'user-1',
      }),
      expect.anything(),
    );
  });

  it('routes Sub2API instances through the NewAPI-compatible runtime', async () => {
    const db = { id: 'db' } as any;
    mocks.resolveNewapiInstancesForModel.mockResolvedValue([
      {
        apiKey: 'sk-sub2api',
        baseUrl: 'https://sub2api.example.com/v1',
        groupKey: 'default',
        instanceId: 'instance-sub2api',
        instanceName: 'Sub2API',
        priority: 1,
        providerType: 'sub2api',
        source: 'instance' as const,
      },
    ]);

    await initModelRuntimeFromDB(db, 'user-1', 'newapi', {
      model: 'gpt-test',
      modelType: 'chat',
    });

    expect(mocks.initializeWithProvider).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        apiKey: 'sk-sub2api',
        baseURL: 'https://sub2api.example.com/v1',
      }),
      expect.anything(),
    );
    expect(mocks.getBusinessModelRuntimeHooks).toHaveBeenCalledWith(
      'user-1',
      'newapi',
      expect.objectContaining({ providerType: 'sub2api' }),
      undefined,
    );
  });

  it('uses the managed NewAPI credential when a caller requires the platform route', async () => {
    const db = { id: 'db' } as any;
    mocks.getAiProviderById.mockResolvedValue({
      keyVaults: { apiKey: 'user-supplied-key', baseURL: 'https://user.example.com/v1' },
    });
    mocks.resolveNewapiInstancesForModel.mockResolvedValue([
      {
        apiKey: 'platform-managed-key',
        baseUrl: 'https://newapi.example.com/v1',
        groupKey: 'default',
        instanceId: 'platform-instance',
        instanceName: 'Platform NewAPI',
        priority: 1,
        providerType: 'newapi',
        source: 'instance' as const,
      },
    ]);

    await initModelRuntimeFromDB(db, 'user-1', 'newapi', {
      model: 'gpt-test',
      requireAdminManagedNewapi: true,
    });

    expect(mocks.initializeWithProvider).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        apiKey: 'platform-managed-key',
        baseURL: 'https://newapi.example.com/v1',
      }),
      expect.anything(),
    );
  });

  it('does not read user NewAPI credentials for a required platform route', async () => {
    mocks.getAiProviderById.mockRejectedValue(new Error('user-key-decryption-failed'));
    mocks.resolveNewapiInstancesForModel.mockResolvedValue([
      {
        apiKey: 'platform-managed-key',
        baseUrl: 'https://newapi.example.com/v1',
        groupKey: 'default',
        instanceId: 'platform-instance',
        instanceName: 'Platform NewAPI',
        priority: 1,
        providerType: 'newapi',
        source: 'instance' as const,
      },
    ]);

    await expect(
      initModelRuntimeFromDB({ id: 'db' } as any, 'user-1', 'newapi', {
        model: 'gpt-test',
        requireAdminManagedNewapi: true,
      }),
    ).resolves.toBeDefined();

    expect(mocks.getAiProviderById).not.toHaveBeenCalled();
  });

  it('fails closed when a required managed NewAPI model route is unavailable', async () => {
    mocks.resolveNewapiInstancesForModel.mockResolvedValue([]);

    await expect(
      initModelRuntimeFromDB({ id: 'db' } as any, 'user-1', 'newapi', {
        model: 'missing-model',
        requireAdminManagedNewapi: true,
      }),
    ).rejects.toThrow('MODULE_APP_NEWAPI_ROUTE_NOT_AVAILABLE');
    expect(mocks.initializeWithProvider).not.toHaveBeenCalled();
  });

  it('routes admin virtual provider ids through their matching newapi instance', async () => {
    const db = { id: 'db' } as any;
    const primaryRoute = {
      apiKey: 'sk-sf',
      baseUrl: 'https://sf.example.com/v1',
      groupKey: 'pro',
      instanceId: 'siliconflow-id',
      instanceName: 'SiliconFlow',
      priority: 10,
      providerType: 'newapi',
      source: 'instance' as const,
    };
    mocks.resolveNewapiInstanceByProviderId.mockResolvedValue(primaryRoute);
    mocks.resolveNewapiInstancesForModel.mockResolvedValue([primaryRoute]);

    await initModelRuntimeFromDB(db, 'user-1', 'siliconflow-id', {
      model: 'gpt-4o',
      modelType: 'chat',
    });

    expect(mocks.resolveNewapiInstancesForModel).toHaveBeenCalledWith(db, {
      modelId: 'gpt-4o',
      modelType: 'chat',
      preferredInstanceId: 'siliconflow-id',
      userId: 'user-1',
    });
    expect(mocks.initializeWithProvider).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        apiKey: 'sk-sf',
        baseURL: 'https://sf.example.com/v1',
      }),
      expect.anything(),
    );
  });

  it('should initialize provider-specific runtime for admin OpenAI-compatible instances', async () => {
    const db = { id: 'db' } as any;
    mocks.resolveNewapiInstancesForModel.mockResolvedValue([
      {
        apiKey: 'sk-deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        groupKey: 'default',
        instanceId: 'instance-deepseek',
        instanceName: 'DeepSeek',
        priority: 1,
        providerType: 'deepseek',
        source: 'instance' as const,
      },
    ]);

    await initModelRuntimeFromDB(db, 'user-1', 'newapi', {
      model: 'deepseek-chat',
      modelType: 'chat',
    });

    expect(mocks.initializeWithProvider).toHaveBeenCalledWith(
      'deepseek',
      expect.objectContaining({
        apiKey: 'sk-deepseek',
        baseURL: 'https://api.deepseek.com/v1',
        userId: 'user-1',
      }),
      expect.anything(),
    );
    expect(mocks.getBusinessModelRuntimeHooks).toHaveBeenCalledWith(
      'user-1',
      'newapi',
      expect.objectContaining({
        instanceId: 'instance-deepseek',
        providerType: 'deepseek',
      }),
      undefined,
    );
  });

  it('should initialize Claude and OpenCode Go admin provider formats with matching runtimes', async () => {
    const db = { id: 'db' } as any;
    mocks.resolveNewapiInstancesForModel.mockResolvedValueOnce([
      {
        apiKey: 'sk-claude',
        baseUrl: 'https://api.anthropic.com',
        groupKey: 'default',
        instanceId: 'instance-claude',
        instanceName: 'Claude',
        priority: 1,
        providerType: 'claude',
        source: 'instance' as const,
      },
    ]);

    await initModelRuntimeFromDB(db, 'user-1', 'newapi', {
      model: 'claude-sonnet-4-5',
      modelType: 'chat',
    });

    expect(mocks.initializeWithProvider).toHaveBeenLastCalledWith(
      'anthropic',
      expect.objectContaining({
        apiKey: 'sk-claude',
        baseURL: 'https://api.anthropic.com',
      }),
      expect.anything(),
    );

    mocks.resolveNewapiInstancesForModel.mockResolvedValueOnce([
      {
        apiKey: 'sk-opencode',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        groupKey: 'default',
        instanceId: 'instance-opencode',
        instanceName: 'OpenCode Go',
        priority: 1,
        providerType: 'opencode-go',
        source: 'instance' as const,
      },
    ]);

    await initModelRuntimeFromDB(db, 'user-1', 'newapi', {
      model: 'qwen3-coder-plus',
      modelType: 'chat',
    });

    expect(mocks.initializeWithProvider).toHaveBeenLastCalledWith(
      'opencodecodingplan',
      expect.objectContaining({
        apiKey: 'sk-opencode',
        baseURL: 'https://opencode.ai/zen/go/v1',
      }),
      expect.anything(),
    );
  });

  it('should preserve billing and tracing hooks when retrying on a fallback instance', async () => {
    const db = { id: 'db' } as any;
    const onRouteResolved = vi.fn();
    const primaryChat = vi.fn().mockRejectedValue({ statusCode: 503 });
    const fallbackChat = vi.fn().mockResolvedValue({ text: 'ok' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mocks.getBusinessModelRuntimeHooks.mockImplementation((_userId, _provider, routeMetadata) => ({
      beforeChat: vi.fn(),
      routeMetadata,
    }));
    mocks.createLLMGenerationTracingHook.mockReturnValue({ afterChat: vi.fn() });
    mocks.initializeWithProvider
      .mockReturnValueOnce({ chat: primaryChat })
      .mockReturnValueOnce({ chat: fallbackChat });
    mocks.resolveNewapiInstancesForModel.mockResolvedValue([
      {
        apiKey: 'sk-primary',
        baseUrl: 'https://primary.example.com/v1',
        groupKey: 'primary',
        instanceId: 'instance-primary',
        instanceName: 'Primary',
        priority: 1,
        providerType: 'newapi',
        source: 'instance' as const,
      },
      {
        apiKey: 'sk-fallback',
        baseUrl: 'https://fallback.example.com/v1',
        groupKey: 'fallback',
        groupMultiplier: 2,
        groupName: 'Fallback Group',
        instanceId: 'instance-fallback',
        instanceName: 'Fallback',
        priority: 2,
        providerType: 'deepseek',
        source: 'instance' as const,
      },
    ]);

    const runtime = await initModelRuntimeFromDB(db, 'user-1', 'newapi', {
      model: 'gpt-test',
      modelType: 'chat',
      onRouteResolved,
      workspaceId: 'workspace-1',
    });

    await expect(
      runtime.chat({ messages: [{ content: 'hello', role: 'user' }], model: 'gpt-test' } as any, {
        metadata: { assistantMessageId: 'assistant-message-1' },
      }),
    ).resolves.toEqual({ text: 'ok' });

    expect(fallbackChat).toHaveBeenCalledTimes(1);
    expect(onRouteResolved).toHaveBeenLastCalledWith(
      expect.objectContaining({ instanceId: 'instance-fallback', providerType: 'deepseek' }),
    );
    expect(mocks.getBusinessModelRuntimeHooks).toHaveBeenLastCalledWith(
      'user-1',
      'newapi',
      {
        groupKey: 'fallback',
        groupMultiplier: 2,
        groupName: 'Fallback Group',
        instanceId: 'instance-fallback',
        instanceName: 'Fallback',
        providerType: 'deepseek',
      },
      'workspace-1',
    );
    expect(mocks.createLLMGenerationTracingHook).toHaveBeenLastCalledWith(
      'user-1',
      'newapi',
      'workspace-1',
    );
    expect(mocks.initializeWithProvider).toHaveBeenLastCalledWith(
      'deepseek',
      expect.objectContaining({
        apiKey: 'sk-fallback',
        baseURL: 'https://fallback.example.com/v1',
        userId: 'user-1',
      }),
      expect.objectContaining({
        afterChat: expect.any(Function),
        beforeChat: expect.any(Function),
        routeMetadata: expect.objectContaining({ instanceId: 'instance-fallback' }),
      }),
    );

    warnSpy.mockRestore();
  });
});
