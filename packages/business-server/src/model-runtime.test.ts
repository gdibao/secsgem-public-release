// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getBusinessModelRuntimeHooks } from './model-runtime';

const mocks = vi.hoisted(() => ({
  assertCommercialChatBudget: vi.fn(),
  assertCommercialMinimumBudget: vi.fn(),
  assertModelPolicyAllowed: vi.fn(),
  assertPlanModelAllowed: vi.fn(),
  estimateCommercialAsrCredits: vi.fn(),
  estimateCommercialChatCredits: vi.fn(),
  estimateCommercialEmbeddingsCredits: vi.fn(),
  getServerDB: vi.fn(),
  isCommercialPricingQuote: vi.fn(),
  recordCommercialAiUsage: vi.fn(),
  recordCommercialChatUsage: vi.fn(),
  releaseCommercialAiUsageReservation: vi.fn(),
  reserveCommercialAiUsage: vi.fn(),
  resolveCommercialAsrCredits: vi.fn(),
  settleCommercialAiUsageReservation: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('./commercialBilling', () => ({
  assertCommercialChatBudget: mocks.assertCommercialChatBudget,
  assertCommercialMinimumBudget: mocks.assertCommercialMinimumBudget,
  estimateCommercialAsrCredits: mocks.estimateCommercialAsrCredits,
  estimateCommercialChatCredits: mocks.estimateCommercialChatCredits,
  estimateCommercialEmbeddingsCredits: mocks.estimateCommercialEmbeddingsCredits,
  isCommercialPricingQuote: mocks.isCommercialPricingQuote,
  recordCommercialAiUsage: mocks.recordCommercialAiUsage,
  recordCommercialChatUsage: mocks.recordCommercialChatUsage,
  releaseCommercialAiUsageReservation: mocks.releaseCommercialAiUsageReservation,
  reserveCommercialAiUsage: mocks.reserveCommercialAiUsage,
  resolveCommercialAsrCredits: mocks.resolveCommercialAsrCredits,
  settleCommercialAiUsageReservation: mocks.settleCommercialAiUsageReservation,
}));

vi.mock('./planModelRules', () => ({
  assertPlanModelAllowed: mocks.assertPlanModelAllowed,
}));

vi.mock('./modelPolicy', () => ({
  assertModelPolicyAllowed: mocks.assertModelPolicyAllowed,
}));

describe('getBusinessModelRuntimeHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({ id: 'db' });
    mocks.isCommercialPricingQuote.mockImplementation((value) => Boolean(value));
    mocks.estimateCommercialAsrCredits.mockResolvedValue(12);
    mocks.estimateCommercialChatCredits.mockResolvedValue(25);
    mocks.estimateCommercialEmbeddingsCredits.mockResolvedValue(5);
    mocks.reserveCommercialAiUsage.mockResolvedValue({ id: 'reservation-1', status: 'active' });
    mocks.resolveCommercialAsrCredits.mockResolvedValue(8);
  });

  it('enforces ASR policy and settles provider-reported usage', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi', {
      groupKey: 'speech',
      instanceId: 'instance-asr',
    });
    const payload = {
      file: new Blob(['audio']),
      model: 'whisper-1',
    } as any;
    const options = { metadata: { operationId: 'asr-operation-1' } };

    await hooks?.beforeTranscribe?.(payload, options);
    await hooks?.onTranscribeFinal?.(
      { text: 'hello', usage: { durationSeconds: 3 } },
      { options, payload },
    );

    expect(mocks.assertModelPolicyAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'whisper-1',
      provider: 'newapi',
      usageType: 'asr',
    });
    expect(mocks.assertPlanModelAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      groupKey: 'speech',
      model: 'whisper-1',
      modelType: 'asr',
      userId: 'user-1',
    });
    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCredits: 12, usageType: 'asr' }),
    );
    expect(mocks.resolveCommercialAsrCredits).toHaveBeenCalledWith(
      expect.objectContaining({ usage: { durationSeconds: 3 } }),
    );
    expect(mocks.settleCommercialAiUsageReservation).toHaveBeenCalledWith(
      expect.objectContaining({ actualCredits: 8, usageType: 'asr' }),
    );
  });

  it('should reserve commercial budget before chat starts', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi', {
      groupKey: 'pro',
      groupName: 'Pro Group',
      instanceId: 'instance-pro',
      instanceName: 'NewAPI Pro',
    });
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any;

    await hooks?.beforeChat?.(payload);

    expect(mocks.estimateCommercialChatCredits).toHaveBeenCalledWith({
      db: { id: 'db' },
      payload,
      provider: 'newapi',
      routeMetadata: {
        groupKey: 'pro',
        groupName: 'Pro Group',
        instanceId: 'instance-pro',
        instanceName: 'NewAPI Pro',
      },
      userId: 'user-1',
    });
    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith({
      db: { id: 'db' },
      estimatedCredits: 25,
      model: 'gpt-test',
      operationId: expect.any(String),
      provider: 'newapi',
      routeMetadata: {
        groupKey: 'pro',
        groupName: 'Pro Group',
        instanceId: 'instance-pro',
        instanceName: 'NewAPI Pro',
      },
      usageType: 'chat',
      userId: 'user-1',
    });
    expect(mocks.assertPlanModelAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'gpt-test',
      modelType: 'chat',
      groupKey: 'pro',
      userId: 'user-1',
    });
  });

  it('uses the per-step billing operation id before the root operation id', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any;

    await hooks?.beforeChat?.(payload, {
      metadata: {
        billingOperationId: 'operation-1:2',
        operationId: 'operation-1',
      },
    });

    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'operation-1:2' }),
    );
  });

  it('should charge the workspace passed after route metadata', async () => {
    const hooks = getBusinessModelRuntimeHooks(
      'user-1',
      'newapi',
      { groupKey: 'pro', instanceId: 'instance-pro' },
      'workspace-1',
    );

    await hooks?.beforeChat?.({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any);

    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        routeMetadata: { groupKey: 'pro', instanceId: 'instance-pro' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    );
  });

  it('should charge the workspace passed in the OpenAPI compatibility position', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi', 'workspace-1');

    await hooks?.beforeChat?.({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any);

    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    );
    expect(mocks.reserveCommercialAiUsage.mock.calls[0][0]).not.toHaveProperty('routeMetadata');
  });

  it('should pass root policy aliases for admin-managed virtual provider groups', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'siliconflow-id', {
      groupKey: 'pro',
      instanceId: 'siliconflow-id',
      instanceName: 'SiliconFlow',
      providerType: 'newapi',
    });
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any;

    await hooks?.beforeChat?.(payload);

    expect(mocks.assertModelPolicyAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'gpt-test',
      provider: 'siliconflow-id',
      providerAliases: ['newapi'],
      usageType: 'chat',
    });
    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith({
      db: { id: 'db' },
      estimatedCredits: 25,
      model: 'gpt-test',
      operationId: expect.any(String),
      provider: 'siliconflow-id',
      routeMetadata: {
        groupKey: 'pro',
        instanceId: 'siliconflow-id',
        instanceName: 'SiliconFlow',
        providerType: 'newapi',
      },
      usageType: 'chat',
      userId: 'user-1',
    });
  });

  it('should reserve commercial budget before structured output starts', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
      schema: { name: 'result', schema: { properties: {}, type: 'object' } },
    } as any;

    await hooks?.beforeGenerateObject?.(payload);

    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith({
      db: { id: 'db' },
      estimatedCredits: 25,
      model: 'gpt-test',
      operationId: expect.any(String),
      provider: 'newapi',
      usageType: 'generate_object',
      userId: 'user-1',
    });
    expect(mocks.assertPlanModelAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'gpt-test',
      modelType: 'chat',
      userId: 'user-1',
    });
  });

  it('should reserve commercial budget before embeddings start', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');

    await hooks?.beforeEmbeddings?.({ input: 'hello', model: 'embedding-test' });

    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith({
      db: { id: 'db' },
      estimatedCredits: 5,
      model: 'embedding-test',
      operationId: expect.any(String),
      provider: 'newapi',
      usageType: 'embeddings',
      userId: 'user-1',
    });
    expect(mocks.assertPlanModelAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'embedding-test',
      modelType: 'embedding',
      userId: 'user-1',
    });
  });

  it('should check policy, plan rules, and minimum budget before image generation starts', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi', {
      groupKey: 'image-pro',
      groupName: 'Image Pro',
      instanceId: 'instance-image',
      instanceName: 'Image Provider',
    });

    await hooks?.beforeCreateImage?.({
      model: 'image-test',
      params: { height: 1024, prompt: 'hello', width: 1024 },
    } as any);

    expect(mocks.assertModelPolicyAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'image-test',
      provider: 'newapi',
      usageType: 'image',
    });
    expect(mocks.assertPlanModelAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      groupKey: 'image-pro',
      model: 'image-test',
      modelType: 'image',
      userId: 'user-1',
    });
    expect(mocks.assertCommercialMinimumBudget).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'image-test',
      provider: 'newapi',
      userId: 'user-1',
    });
  });

  it('should check policy, plan rules, and minimum budget before video generation starts', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi', {
      groupKey: 'video-pro',
      groupName: 'Video Pro',
      instanceId: 'instance-video',
      instanceName: 'Video Provider',
    });

    await hooks?.beforeCreateVideo?.({
      model: 'video-test',
      params: { prompt: 'hello' },
    } as any);

    expect(mocks.assertModelPolicyAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'video-test',
      provider: 'newapi',
      usageType: 'video',
    });
    expect(mocks.assertPlanModelAllowed).toHaveBeenCalledWith({
      db: { id: 'db' },
      groupKey: 'video-pro',
      model: 'video-test',
      modelType: 'video',
      userId: 'user-1',
    });
    expect(mocks.assertCommercialMinimumBudget).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'video-test',
      provider: 'newapi',
      userId: 'user-1',
    });
  });

  it('should record final chat usage with assistant message metadata', async () => {
    const routeMetadata = {
      groupKey: 'pro',
      groupMultiplier: 1.5,
      groupName: 'Pro Group',
      instanceId: 'instance-pro',
      instanceName: 'NewAPI Pro',
    };
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi', routeMetadata);

    await hooks?.onChatFinal?.(
      {
        text: 'done',
        usage: { cost: 0.25, totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
      },
      {
        options: {
          metadata: {
            assistantMessageId: 'assistant-message-1',
            operationId: 'operation-1',
          },
        },
        payload: {
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-test',
        } as any,
      },
    );

    expect(mocks.recordCommercialChatUsage).toHaveBeenCalledWith({
      db: { id: 'db' },
      messageId: 'assistant-message-1',
      model: 'gpt-test',
      operationId: 'operation-1',
      provider: 'newapi',
      routeMetadata,
      usage: { cost: 0.25, totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
      userId: 'user-1',
    });
  });

  it('should skip final billing when usage is missing', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');

    await hooks?.onChatFinal?.(
      { text: 'done' },
      {
        options: { metadata: { assistantMessageId: 'assistant-message-1' } },
        payload: {
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-test',
        } as any,
      },
    );

    expect(mocks.recordCommercialChatUsage).not.toHaveBeenCalled();
  });

  it('should skip and warn when no idempotent billing reference is available', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');

    await hooks?.onChatFinal?.(
      { text: 'done', usage: { cost: 0.25, totalTokens: 150 } },
      {
        options: { metadata: {} },
        payload: {
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-test',
        } as any,
      },
    );

    expect(mocks.recordCommercialChatUsage).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[billing] skip chat usage charge because no billing reference metadata',
      { model: 'gpt-test', provider: 'newapi' },
    );

    warnSpy.mockRestore();
  });

  it('should allow callers to explicitly skip commercial billing', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');

    await hooks?.onChatFinal?.(
      { text: 'done', usage: { cost: 0.25, totalTokens: 150 } },
      {
        options: {
          metadata: {
            assistantMessageId: 'assistant-message-1',
            skipCommercialBilling: true,
          },
        },
        payload: {
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-test',
        } as any,
      },
    );

    expect(mocks.recordCommercialChatUsage).not.toHaveBeenCalled();
  });

  it('should keep policy checks but skip the legacy budget check for reservation billing', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any;

    await hooks?.beforeChat?.(payload, {
      metadata: { skipCommercialBilling: true },
    });

    expect(mocks.assertModelPolicyAllowed).toHaveBeenCalled();
    expect(mocks.assertPlanModelAllowed).toHaveBeenCalled();
    expect(mocks.assertCommercialChatBudget).not.toHaveBeenCalled();
    expect(mocks.reserveCommercialAiUsage).not.toHaveBeenCalled();
  });

  it('should settle a reserved chat against final usage', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any;
    const options = { metadata: { operationId: 'operation-chat-1' } };

    await hooks?.beforeChat?.(payload, options);
    await hooks?.onChatFinal?.(
      { text: 'done', usage: { cost: 0.25, totalTokens: 150 } },
      { options, payload },
    );

    expect(mocks.settleCommercialAiUsageReservation).toHaveBeenCalledWith({
      db: { id: 'db' },
      estimatedCredits: 25,
      model: 'gpt-test',
      operationId: 'operation-chat-1',
      provider: 'newapi',
      reservationId: 'reservation-1',
      title: 'AI Chat Usage',
      usage: { cost: 0.25, totalTokens: 150 },
      usageType: 'chat',
      userId: 'user-1',
    });
    expect(mocks.recordCommercialChatUsage).not.toHaveBeenCalled();
  });

  it('should release a reserved chat when the stream finishes with an error event', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any;

    await hooks?.beforeChat?.(payload);
    await hooks?.onChatFinal?.(
      {
        error: { message: 'stream failed' },
        text: '',
        usage: { cost: 0.25, totalTokens: 150 },
      },
      { payload },
    );

    expect(mocks.releaseCommercialAiUsageReservation).toHaveBeenCalledWith({
      db: { id: 'db' },
      reason: 'provider_error',
      reservationId: 'reservation-1',
    });
    expect(mocks.settleCommercialAiUsageReservation).not.toHaveBeenCalled();
    expect(mocks.recordCommercialChatUsage).not.toHaveBeenCalled();
  });

  it('should release a reserved chat when provider dispatch fails', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any;

    await hooks?.beforeChat?.(payload);
    await hooks?.onChatError?.(
      { error: { message: 'provider failed' }, errorType: 'ProviderBizError' } as any,
      { payload },
    );

    expect(mocks.releaseCommercialAiUsageReservation).toHaveBeenCalledWith({
      db: { id: 'db' },
      reason: 'provider_error',
      reservationId: 'reservation-1',
    });
  });

  it('should settle structured output once from the completion hook', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-test',
    } as any;

    await hooks?.beforeGenerateObject?.(payload);
    await hooks?.onGenerateObjectComplete?.(
      {
        latencyMs: 10,
        output: { ok: true },
        success: true,
        usage: { cost: 0.12, totalTokens: 80 },
      },
      { payload },
    );

    expect(mocks.settleCommercialAiUsageReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedCredits: 25,
        model: 'gpt-test',
        reservationId: 'reservation-1',
        usageType: 'generate_object',
      }),
    );
  });

  it('should record structured output usage with operation metadata', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');

    await hooks?.onGenerateObjectFinal?.(
      { usage: { cost: 0.12, totalInputTokens: 60, totalOutputTokens: 20, totalTokens: 80 } },
      {
        options: { metadata: { operationId: 'operation-structured-1' } },
        payload: {
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-test',
        } as any,
      },
    );

    expect(mocks.recordCommercialAiUsage).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'gpt-test',
      operationId: 'operation-structured-1',
      provider: 'newapi',
      referenceId: 'operation-structured-1',
      referenceType: 'model_runtime_generate_object',
      title: 'AI Structured Output Usage',
      usage: { cost: 0.12, totalInputTokens: 60, totalOutputTokens: 20, totalTokens: 80 },
      usageType: 'generate_object',
      userId: 'user-1',
    });
  });

  it('should record embeddings usage with operation metadata', async () => {
    const hooks = getBusinessModelRuntimeHooks('user-1', 'newapi');

    await hooks?.onEmbeddingsFinal?.(
      {
        latencyMs: 123,
        usage: { cost: 0.01, totalInputTokens: 100, totalTokens: 100 },
      },
      {
        options: { metadata: { operationId: 'operation-embeddings-1' } },
        payload: { input: 'hello', model: 'embedding-test' },
      },
    );

    expect(mocks.recordCommercialAiUsage).toHaveBeenCalledWith({
      db: { id: 'db' },
      model: 'embedding-test',
      operationId: 'operation-embeddings-1',
      provider: 'newapi',
      referenceId: 'operation-embeddings-1',
      referenceType: 'model_runtime_embeddings',
      title: 'AI Embeddings Usage',
      usage: { cost: 0.01, totalInputTokens: 100, totalTokens: 100 },
      usageType: 'embeddings',
      userId: 'user-1',
    });
  });
});
