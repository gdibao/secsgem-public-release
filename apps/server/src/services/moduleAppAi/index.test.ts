// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createModuleAppTextGenerator } from './index';

const mocks = vi.hoisted(() => ({
  estimateCommercialChatCredits: vi.fn(),
  initModelRuntimeFromDB: vi.fn(),
  quoteCommercialAiUsage: vi.fn(),
  release: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
}));

vi.mock('@/business/server/commercialBilling', () => ({
  estimateCommercialChatCredits: mocks.estimateCommercialChatCredits,
  quoteCommercialAiUsage: mocks.quoteCommercialAiUsage,
}));

vi.mock('@/database/models/moduleAppCredit', () => ({
  ModuleAppCreditModel: vi.fn(() => ({
    release: mocks.release,
    reserve: mocks.reserve,
    settle: mocks.settle,
  })),
}));

describe('createModuleAppTextGenerator', () => {
  const db = { id: 'request-db' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.estimateCommercialChatCredits.mockResolvedValue(100);
    mocks.reserve.mockResolvedValue({ id: 'reservation-1', status: 'active' });
    mocks.quoteCommercialAiUsage.mockResolvedValue({
      credits: 80,
      costSource: 'gateway',
      pricing: { creditsPerDollar: 1000, multiplier: 1.35 },
      usdCost: 0.08,
    });
    mocks.settle.mockResolvedValue({ ledgerEntryId: 'ledger-1' });
  });

  it('routes through the user runtime and settles multiplied actual usage once', async () => {
    const chat = vi.fn(async (_payload, options) => {
      await options.callback.onText('Hello ');
      await options.callback.onText('world');
      await options.callback.onCompletion({
        usage: {
          totalInputTokens: 20,
          totalOutputTokens: 10,
          totalTokens: 30,
          cost: 0.08,
        },
      });
      return new Response('');
    });
    mocks.initModelRuntimeFromDB.mockImplementation(async (_db, _userId, _provider, options) => {
      options.onRouteResolved({
        groupKey: 'premium',
        instanceId: 'instance-2',
        instanceName: 'Fallback',
        providerType: 'newapi',
      });
      return { chat };
    });

    const generator = createModuleAppTextGenerator({ db, workspaceId: 'workspace-1' });
    const result = await generator({
      actionMultiplier: 1.35,
      appMultiplier: 1,
      chargeAiUsage: true,
      idempotencyKey: 'run-1:generate',
      model: 'model-a',
      prompt: 'hello',
      provider: 'newapi',
      userId: 'user-1',
    });

    expect(mocks.initModelRuntimeFromDB).toHaveBeenCalledWith(
      db,
      'user-1',
      'newapi',
      expect.objectContaining({
        model: 'model-a',
        onRouteResolved: expect.any(Function),
        requireAdminManagedNewapi: true,
        workspaceId: 'workspace-1',
      }),
    );
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 135,
        idempotencyKey: 'module-app-ai:run-1:generate',
        payer: { scopeType: 'workspace', workspaceId: 'workspace-1' },
      }),
    );
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'model-a' }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          operationId: 'run-1:generate',
          skipCommercialBilling: true,
        }),
      }),
    );
    expect(mocks.quoteCommercialAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        model: 'model-a',
        provider: 'newapi',
        forceCharge: true,
        routeMetadata: expect.objectContaining({
          groupKey: 'premium',
          instanceId: 'instance-2',
          providerType: 'newapi',
        }),
        usage: expect.objectContaining({ totalInputTokens: 20, totalOutputTokens: 10 }),
        userId: 'user-1',
      }),
    );
    expect(mocks.settle).toHaveBeenCalledOnce();
    expect(mocks.settle).toHaveBeenCalledWith({
      actualAmount: 108,
      metadata: expect.objectContaining({
        actionMultiplier: '1.35',
        appMultiplier: '1',
        baseCredits: 80,
        combinedMultiplier: '1.35',
        costSource: 'gateway',
        model: 'model-a',
        provider: 'newapi',
        routeMetadata: expect.objectContaining({
          groupKey: 'premium',
          instanceId: 'instance-2',
          providerType: 'newapi',
        }),
      }),
      reservationId: 'reservation-1',
    });
    expect(result).toMatchObject({
      actualAiCredits: 80,
      text: 'Hello world',
      tokenUsage: { input: 20, output: 10, total: 30 },
    });
  });

  it('rejects a module request that attempts to select a non-platform AI provider', async () => {
    const generator = createModuleAppTextGenerator({ db });

    await expect(
      generator({
        actionMultiplier: 1,
        appMultiplier: 1,
        chargeAiUsage: true,
        idempotencyKey: 'run-provider-denied:generate',
        model: 'model-a',
        prompt: 'hello',
        provider: 'openai',
        userId: 'user-1',
      }),
    ).rejects.toThrow('MODULE_APP_AI_PROVIDER_DENIED');
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.initModelRuntimeFromDB).not.toHaveBeenCalled();
  });

  it('releases the reservation when runtime initialization fails before a provider response', async () => {
    mocks.initModelRuntimeFromDB.mockRejectedValue(new Error('provider_not_started'));
    const generator = createModuleAppTextGenerator({ db });

    await expect(
      generator({
        actionMultiplier: 1,
        appMultiplier: 1,
        chargeAiUsage: true,
        idempotencyKey: 'run-2:generate',
        model: 'model-a',
        prompt: 'hello',
        provider: 'newapi',
        userId: 'user-1',
      }),
    ).rejects.toThrow('provider_not_started');
    expect(mocks.release).toHaveBeenCalledWith({
      reason: 'provider_not_started',
      reservationId: 'reservation-1',
    });
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it('charges managed NewAPI usage even when a user has their own provider credential', async () => {
    mocks.initModelRuntimeFromDB.mockResolvedValue({
      chat: vi.fn(async (_payload, options) => {
        await options.callback.onText('Managed response');
        await options.callback.onCompletion({
          usage: { cost: 0.01, totalInputTokens: 2, totalOutputTokens: 3, totalTokens: 5 },
        });
        return new Response('');
      }),
    });
    const generator = createModuleAppTextGenerator({ db });

    await expect(
      generator({
        actionMultiplier: 1.35,
        appMultiplier: 2,
        chargeAiUsage: true,
        idempotencyKey: 'run-byok:generate',
        model: 'model-a',
        prompt: 'hello',
        provider: 'newapi',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ actualAiCredits: 80, text: 'Managed response' });

    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.estimateCommercialChatCredits).toHaveBeenCalledOnce();
    expect(mocks.quoteCommercialAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ forceCharge: true, provider: 'newapi' }),
    );
    expect(mocks.settle).toHaveBeenCalledOnce();
  });

  it('falls back to the reserved estimate when managed usage cannot be quoted', async () => {
    mocks.quoteCommercialAiUsage.mockResolvedValue(null);
    mocks.initModelRuntimeFromDB.mockResolvedValue({
      chat: vi.fn(async (_payload, options) => {
        await options.callback.onText('Managed response');
        await options.callback.onCompletion({ usage: {} });
        return new Response('');
      }),
    });
    const generator = createModuleAppTextGenerator({ db });

    await expect(
      generator({
        actionMultiplier: 1,
        appMultiplier: 1,
        chargeAiUsage: true,
        idempotencyKey: 'run-unquoted:generate',
        model: 'model-a',
        prompt: 'hello',
        provider: 'newapi',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ actualAiCredits: 100, text: 'Managed response' });

    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ actualAmount: 100, reservationId: 'reservation-1' }),
    );
  });

  it('rejects replay after the reservation has already been settled', async () => {
    mocks.reserve.mockResolvedValueOnce({ id: 'reservation-1', status: 'settled' });
    const generator = createModuleAppTextGenerator({ db });

    await expect(
      generator({
        actionMultiplier: 1,
        appMultiplier: 1,
        chargeAiUsage: true,
        idempotencyKey: 'run-3:generate',
        model: 'model-a',
        prompt: 'hello',
        provider: 'newapi',
        userId: 'user-1',
      }),
    ).rejects.toThrow('MODULE_APP_AI_IDEMPOTENCY_REPLAY');
    expect(mocks.initModelRuntimeFromDB).not.toHaveBeenCalled();
  });

  it('skips platform AI billing when the action charge mode disables AI usage', async () => {
    mocks.initModelRuntimeFromDB.mockResolvedValue({
      chat: vi.fn(async (_payload, options) => {
        await options.callback.onText('Uncharged response');
        await options.callback.onCompletion({
          usage: { totalInputTokens: 2, totalOutputTokens: 3, totalTokens: 5 },
        });
        return new Response('');
      }),
    });
    const generator = createModuleAppTextGenerator({ db });

    await expect(
      generator({
        actionMultiplier: 1,
        appMultiplier: 1,
        chargeAiUsage: false,
        idempotencyKey: 'run-free:generate',
        model: 'model-a',
        prompt: 'hello',
        provider: 'newapi',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ actualAiCredits: 0, text: 'Uncharged response' });

    expect(mocks.estimateCommercialChatCredits).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.quoteCommercialAiUsage).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it('rejects a missing AI charge-mode decision instead of silently bypassing billing', async () => {
    mocks.initModelRuntimeFromDB.mockResolvedValue({
      chat: vi.fn(async () => new Response('')),
    });
    const generator = createModuleAppTextGenerator({ db });

    await expect(
      generator({
        actionMultiplier: 1,
        appMultiplier: 1,
        idempotencyKey: 'run-missing-charge-mode:generate',
        model: 'model-a',
        prompt: 'hello',
        provider: 'newapi',
        userId: 'user-1',
      } as never),
    ).rejects.toThrow('MODULE_APP_AI_CHARGE_MODE_REQUIRED');
    expect(mocks.initModelRuntimeFromDB).not.toHaveBeenCalled();
  });
});
