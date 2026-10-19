// @vitest-environment node
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertCommercialChatBudget,
  assertCommercialMinimumBudget,
  assertCommercialModelSellable,
  estimateCommercialChatCredits,
  estimateCommercialEmbeddingsCredits,
  isCommercialPricingQuote,
  quoteCommercialAiUsage,
  recordCommercialAiUsage,
  recordCommercialChatUsage,
  releaseCommercialAiUsageReservation,
  reserveCommercialAiUsage,
  resolveCommercialAsrCredits,
  settleCommercialAiUsageReservation,
} from './commercialBilling';

const validCommercialPricingQuote = {
  baseEstimatedCredits: 25,
  creditsPerDollar: 1_000_000,
  matchedPricingRule: {
    model: 'gpt-test',
    multiplier: 1.25,
    provider: 'openai',
  },
  modelPricing: {
    currency: 'USD',
    units: [
      {
        name: 'textInput',
        rate: 0.5,
        strategy: 'fixed',
        unit: 'millionTokens',
      },
    ],
  },
  modelPricingSource: 'database',
  pricingMultiplier: 1.25,
  quotedAt: '2026-07-28T10:00:00.000Z',
  version: 1,
} as const;

const mocks = vi.hoisted(() => ({
  canStartChatUsage: vi.fn(),
  consumeCreditsForAiUsage: vi.fn(),
  consumeCreditsForChatUsage: vi.fn(),
  getAiProviderModelList: vi.fn(),
  getAiProviderById: vi.fn(),
  getAdminNewapiModelCard: vi.fn(),
  getCreditAccountSummary: vi.fn(),
  getServerGlobalConfig: vi.fn(),
  getServerModelPricingSnapshot: vi.fn(),
  quoteCreditsForAiUsage: vi.fn(),
  recordSettlementFailure: vi.fn(),
  releaseCredits: vi.fn(),
  reserveCredits: vi.fn(),
  resolveAdminNewapiModelPricing: vi.fn(),
  resolveSettlementFailure: vi.fn(),
  settleCredits: vi.fn(),
}));

vi.mock('./adminNewapiPricing', () => ({
  getAdminNewapiModelCard: mocks.getAdminNewapiModelCard,
  resolveAdminNewapiModelPricing: mocks.resolveAdminNewapiModelPricing,
}));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(function AiProviderModel() {
    return {
      getAiProviderById: mocks.getAiProviderById,
    };
  }),
}));

vi.mock('@/database/models/commercial', () => ({
  CommercialModel: vi.fn().mockImplementation(function CommercialModel() {
    return {
      canStartChatUsage: mocks.canStartChatUsage,
      consumeCreditsForAiUsage: mocks.consumeCreditsForAiUsage,
      consumeCreditsForChatUsage: mocks.consumeCreditsForChatUsage,
      getCreditAccountSummary: mocks.getCreditAccountSummary,
      quoteCreditsForAiUsage: mocks.quoteCreditsForAiUsage,
    };
  }),
}));

vi.mock('@/database/models/moduleAppCredit', () => ({
  ModuleAppCreditModel: vi.fn().mockImplementation(function ModuleAppCreditModel() {
    return {
      recordSettlementFailure: mocks.recordSettlementFailure,
      release: mocks.releaseCredits,
      reserve: mocks.reserveCredits,
      resolveSettlementFailure: mocks.resolveSettlementFailure,
      settle: mocks.settleCredits,
    };
  }),
}));

vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: vi.fn().mockImplementation(function AiInfraRepos() {
    return {
      getAiProviderModelList: mocks.getAiProviderModelList,
    };
  }),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: mocks.getServerGlobalConfig,
}));

vi.mock('./serverModelPricing', () => ({
  getServerModelPricingSnapshot: mocks.getServerModelPricingSnapshot,
}));

beforeEach(() => {
  mocks.getAdminNewapiModelCard.mockResolvedValue(undefined);
  mocks.resolveAdminNewapiModelPricing.mockImplementation(async ({ adminModelCard }) =>
    adminModelCard.modelCard.pricing
      ? { pricing: adminModelCard.modelCard.pricing, source: 'database' }
      : { source: 'missing' },
  );
});

describe('isCommercialPricingQuote', () => {
  it('accepts a complete versioned pricing snapshot', () => {
    expect(isCommercialPricingQuote(validCommercialPricingQuote)).toBe(true);
  });

  it('accepts LobeHub official pricing as a trusted server-side source', () => {
    expect(
      isCommercialPricingQuote({
        ...validCommercialPricingQuote,
        modelPricingSource: 'lobehub-official',
      }),
    ).toBe(true);
  });

  it.each([
    ['unknown pricing source', { ...validCommercialPricingQuote, modelPricingSource: 'client' }],
    ['invalid quote timestamp', { ...validCommercialPricingQuote, quotedAt: 'today' }],
    [
      'invalid matched rule',
      { ...validCommercialPricingQuote, matchedPricingRule: { multiplier: -1 } },
    ],
    [
      'malformed model pricing',
      { ...validCommercialPricingQuote, modelPricing: { units: [{ strategy: 'fixed' }] } },
    ],
    ['excessive pricing multiplier', { ...validCommercialPricingQuote, pricingMultiplier: 1001 }],
    ['unexpected fields', { ...validCommercialPricingQuote, trusted: true }],
  ])('rejects %s', (_label, quote) => {
    expect(isCommercialPricingQuote(quote)).toBe(false);
  });
});

describe('estimateCommercialChatCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerGlobalConfig.mockResolvedValue({
      aiProvider: { openai: { enabled: true } },
    });
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: {} });
    mocks.canStartChatUsage.mockResolvedValue(true);
    mocks.getCreditAccountSummary.mockResolvedValue({
      balance: 0,
      breakdown: {
        other: { available: 0, consumed: 0, credited: 0 },
        referral: { available: 0, consumed: 0, credited: 0 },
        subscription: { available: 0, consumed: 0, credited: 0 },
        topup: { available: 0, consumed: 0, credited: 0 },
      },
      currency: 'CREDITS',
      totalCredited: 0,
      totalDebited: 0,
      updatedAt: null,
    });
  });

  it('should estimate credits from model pricing and payload size', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'gpt-test',
        pricing: {
          units: [
            { name: 'textInput', rate: 0.5, strategy: 'fixed' },
            { name: 'textOutput', rate: 1, strategy: 'fixed' },
          ],
        },
      },
    ]);

    const result = await estimateCommercialChatCredits({
      db: {} as any,
      payload: {
        max_tokens: 500,
        messages: [{ content: 'Hello world', role: 'user' }],
        model: 'gpt-test',
      },
      provider: 'openai',
      userId: 'user-1',
    });

    expect(result).toBe(502);
  });

  it('converts CNY-denominated embedding prices to USD credits', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'embedding-cny',
        pricing: {
          currency: 'CNY',
          units: [
            {
              name: 'textInput',
              rate: 7.12,
              strategy: 'fixed',
              unit: 'millionTokens',
            },
          ],
        },
      },
    ]);

    await expect(
      estimateCommercialEmbeddingsCredits({
        db: {} as any,
        input: 'abcd',
        model: 'embedding-cny',
        provider: 'openai',
        userId: 'user-1',
      }),
    ).resolves.toBe(1);
  });

  it('should resolve provider model card with the request database for admin-managed models', async () => {
    const serverDB = { id: 'request-db' } as any;
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'gpt-test',
        pricing: {
          units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed' }],
        },
      },
    ]);

    await estimateCommercialChatCredits({
      db: serverDB,
      payload: {
        messages: [{ content: 'Hello world', role: 'user' }],
        model: 'gpt-test',
      },
      provider: 'openai',
      userId: 'user-1',
    });

    expect(mocks.getServerGlobalConfig).toHaveBeenCalledWith(serverDB);
  });

  it('uses enabled model-bank fallback pricing for admin-managed estimates', async () => {
    mocks.getAdminNewapiModelCard.mockResolvedValue({
      modelBankFallbackEnabled: true,
      modelBankProvider: undefined,
      modelCard: { enabled: true, id: 'gpt-test', type: 'chat' },
    });
    const modelBankPricing = {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };
    mocks.resolveAdminNewapiModelPricing.mockResolvedValue({
      pricing: modelBankPricing,
      source: 'model-bank',
    });

    await expect(
      estimateCommercialChatCredits({
        db: {} as any,
        payload: {
          max_tokens: 500,
          messages: [{ content: 'Hello world', role: 'user' }],
          model: 'gpt-test',
        },
        provider: 'instance-id',
        userId: 'user-1',
      }),
    ).resolves.toBe(502);
    expect(mocks.resolveAdminNewapiModelPricing).toHaveBeenCalledWith({
      adminModelCard: {
        modelBankFallbackEnabled: true,
        modelBankProvider: undefined,
        modelCard: { enabled: true, id: 'gpt-test', type: 'chat' },
      },
      model: 'gpt-test',
    });
    expect(mocks.getAiProviderModelList).not.toHaveBeenCalled();
  });

  it('should return undefined when model pricing is unavailable', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([{ id: 'gpt-test' }]);

    const result = await estimateCommercialChatCredits({
      db: {} as any,
      payload: {
        messages: [{ content: 'Hello world', role: 'user' }],
        model: 'gpt-test',
      },
      provider: 'openai',
      userId: 'user-1',
    });

    expect(result).toBeUndefined();
  });

  it('should include structured balance details when blocking a paid chat', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'gpt-test',
        pricing: {
          units: [
            { name: 'textInput', rate: 0.5, strategy: 'fixed' },
            { name: 'textOutput', rate: 1, strategy: 'fixed' },
          ],
        },
      },
    ]);
    mocks.canStartChatUsage.mockResolvedValue(false);
    mocks.getCreditAccountSummary.mockResolvedValue({
      balance: 120,
      breakdown: {
        other: { available: 0, consumed: 0, credited: 0 },
        referral: { available: 0, consumed: 0, credited: 0 },
        subscription: { available: 120, consumed: 0, credited: 120 },
        topup: { available: 0, consumed: 0, credited: 0 },
      },
      currency: 'CREDITS',
      totalCredited: 120,
      totalDebited: 0,
      updatedAt: null,
    });

    await expect(
      assertCommercialChatBudget({
        db: {} as any,
        payload: {
          max_tokens: 500,
          messages: [{ content: 'Hello world', role: 'user' }],
          model: 'gpt-test',
        },
        provider: 'openai',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      error: {
        availableCredits: 120,
        currency: 'CREDITS',
        message: 'COMMERCIAL_BALANCE_EXHAUSTED',
        model: 'gpt-test',
        provider: 'openai',
        requiredCredits: 502,
        shortfallCredits: 382,
      },
      errorType: ChatErrorType.InsufficientBudgetForModel,
    });

    expect(mocks.canStartChatUsage).toHaveBeenCalledWith(502);
  });
});

describe('resolveCommercialAsrCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerModelPricingSnapshot.mockResolvedValue({
      pricing: {
        currency: 'USD',
        units: [{ name: 'audioInput', rate: 0.02, strategy: 'fixed', unit: 'second' }],
      },
      source: 'database',
    });
  });

  it('uses the file estimate when second-based pricing lacks provider duration', async () => {
    const credits = await resolveCommercialAsrCredits({
      db: {} as any,
      model: 'whisper-test',
      payload: { file: new Blob([new Uint8Array(10_000)]), model: 'whisper-test' },
      provider: 'openai',
      usage: { totalInputTokens: 100 },
      userId: 'user-1',
    });

    expect(credits).toBe(200_000);
  });
});

describe('recordCommercialChatUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerGlobalConfig.mockResolvedValue({
      aiProvider: { openai: { enabled: true } },
    });
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: {} });
    mocks.canStartChatUsage.mockResolvedValue(true);
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'gpt-test',
        pricing: {
          units: [
            { name: 'textInput', rate: 0.5, strategy: 'fixed' },
            { name: 'textOutput', rate: 1, strategy: 'fixed' },
          ],
        },
      },
    ]);
    mocks.consumeCreditsForAiUsage.mockResolvedValue({ id: 'ledger-1' });
    mocks.consumeCreditsForChatUsage.mockResolvedValue({ id: 'ledger-1' });
    mocks.quoteCreditsForAiUsage.mockResolvedValue({
      amount: 338,
      creditsPerDollar: 1000,
      matchedPricingRule: null,
      pricingMultiplier: 1.35,
      usdCost: 0.25,
    });
  });

  it('quotes commercial AI usage without writing a ledger entry', async () => {
    const result = await quoteCommercialAiUsage({
      db: {} as any,
      model: 'gpt-test',
      provider: 'openai',
      usage: { cost: 0.25, totalInputTokens: 100, totalOutputTokens: 50 },
      usageType: 'chat',
      userId: 'user-1',
    });

    expect(mocks.quoteCreditsForAiUsage).toHaveBeenCalledWith({
      model: 'gpt-test',
      provider: 'openai',
      routeMetadata: undefined,
      usage: { cost: 0.25 },
    });
    expect(mocks.consumeCreditsForAiUsage).not.toHaveBeenCalled();
    expect(result).toEqual({
      credits: 338,
      costSource: 'gateway',
      pricing: {
        creditsPerDollar: 1000,
        matchedPricingRule: null,
        multiplier: 1.35,
      },
      usdCost: 0.25,
    });
  });

  it('resolves ASR quotes against the ASR model catalog', async () => {
    const freePricing = {
      units: [
        {
          name: 'audioInput' as const,
          rate: 0,
          strategy: 'fixed' as const,
          unit: 'second' as const,
        },
      ],
    };
    mocks.getAdminNewapiModelCard.mockResolvedValue({
      modelCard: { id: 'free-asr', pricing: freePricing, type: 'asr' },
    });
    mocks.resolveAdminNewapiModelPricing.mockResolvedValue({
      pricing: freePricing,
      source: 'model-bank',
    });

    await quoteCommercialAiUsage({
      db: {} as any,
      model: 'free-asr',
      provider: 'newapi',
      usage: { cost: 0 },
      usageType: 'asr',
      userId: 'user-1',
    });

    expect(mocks.getAdminNewapiModelCard).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'asr' }),
    );
    expect(mocks.quoteCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usage: { cost: 0 } }),
    );
  });

  it('quotes managed module usage when forceCharge overrides a user BYOK credential', async () => {
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: { apiKey: 'user-key' } });

    const result = await quoteCommercialAiUsage({
      db: {} as any,
      forceCharge: true,
      model: 'gpt-test',
      provider: 'newapi',
      usage: { cost: 0.25, totalInputTokens: 100, totalOutputTokens: 50 },
      usageType: 'chat',
      userId: 'user-1',
    });

    expect(mocks.quoteCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-test', provider: 'newapi' }),
    );
    expect(result).toMatchObject({ credits: 338, costSource: 'gateway' });
  });

  it('should trust positive gateway cost and record gateway costSource', async () => {
    await recordCommercialChatUsage({
      db: {} as any,
      messageId: 'assistant-message-1',
      model: 'gpt-test',
      operationId: 'operation-1',
      provider: 'openai',
      usage: { cost: 0.25, totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith({
      model: 'gpt-test',
      operationId: 'operation-1',
      provider: 'openai',
      referenceId: 'assistant-message-1',
      referenceType: 'assistant_message',
      title: 'AI Chat Usage',
      usage: {
        cost: 0.25,
        costSource: 'gateway',
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      },
      usageType: 'chat',
    });
  });

  it('should pass newapi route metadata to final credit consumption', async () => {
    await recordCommercialChatUsage({
      db: {} as any,
      messageId: 'assistant-message-newapi-route-1',
      model: 'gpt-test',
      provider: 'newapi',
      routeMetadata: {
        groupKey: 'pro',
        groupMultiplier: 1.5,
        groupName: 'Pro Group',
        instanceId: 'instance-pro',
        instanceName: 'NewAPI Pro',
        providerType: 'deepseek',
      },
      usage: { cost: 0.25, totalTokens: 100 },
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        routeMetadata: {
          groupKey: 'pro',
          groupMultiplier: 1.5,
          groupName: 'Pro Group',
          instanceId: 'instance-pro',
          instanceName: 'NewAPI Pro',
          providerType: 'deepseek',
        },
      }),
    );
  });

  it('should compute local pricing when gateway cost is missing', async () => {
    await recordCommercialChatUsage({
      db: {} as any,
      messageId: 'assistant-message-2',
      model: 'gpt-test',
      provider: 'openai',
      usage: { totalInputTokens: 1_000_000, totalOutputTokens: 2_000_000 },
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          cost: 2.5,
          costSource: 'local-pricing',
        }),
      }),
    );
  });

  it.each([
    ['non-finite', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['negative', -1],
  ])('should ignore %s gateway costs and use local pricing', async (_label, cost) => {
    await recordCommercialChatUsage({
      db: {} as any,
      messageId: `assistant-message-invalid-gateway-cost-${_label}`,
      model: 'gpt-test',
      provider: 'openai',
      usage: { cost, totalInputTokens: 1_000_000, totalOutputTokens: 2_000_000 },
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          cost: 2.5,
          costSource: 'local-pricing',
        }),
      }),
    );
  });

  it('converts CNY local token pricing before recording USD cost', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'gpt-cny',
        pricing: {
          currency: 'CNY',
          units: [
            {
              name: 'textInput',
              rate: 7.12,
              strategy: 'fixed',
              unit: 'millionTokens',
            },
            {
              name: 'textOutput',
              rate: 14.24,
              strategy: 'fixed',
              unit: 'millionTokens',
            },
          ],
        },
      },
    ]);

    await recordCommercialChatUsage({
      db: {} as any,
      messageId: 'assistant-message-cny',
      model: 'gpt-cny',
      provider: 'openai',
      usage: { totalInputTokens: 1_000_000, totalOutputTokens: 1_000_000 },
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({ cost: 3, costSource: 'local-pricing' }),
      }),
    );
  });

  it('should use fallback pricing when model pricing is unavailable', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([{ id: 'gpt-test' }]);

    await recordCommercialChatUsage({
      db: {} as any,
      messageId: 'assistant-message-3',
      model: 'gpt-test',
      provider: 'openai',
      usage: { totalInputTokens: 1_000_000, totalOutputTokens: 1_000_000 },
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          cost: 18,
          costSource: 'fallback-rate',
        }),
      }),
    );
  });

  it('keeps a trusted catalog free price at zero instead of using fallback pricing', async () => {
    const freePricing = {
      currency: 'CNY' as const,
      units: [
        {
          name: 'textInput' as const,
          rate: 0,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
      ],
    };
    mocks.getAdminNewapiModelCard.mockResolvedValue({
      modelCard: { id: 'free-model', pricing: freePricing, type: 'chat' },
    });
    mocks.resolveAdminNewapiModelPricing.mockResolvedValue({
      pricing: freePricing,
      source: 'model-bank',
    });

    await recordCommercialChatUsage({
      db: {} as any,
      messageId: 'assistant-message-free',
      model: 'free-model',
      provider: 'newapi',
      usage: { totalInputTokens: 1_000_000 },
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({ cost: 0, costSource: 'local-pricing' }),
      }),
    );
  });

  it('keeps trusted free ASR pricing at zero when the provider reports no usage cost', async () => {
    const freePricing = {
      currency: 'CNY' as const,
      units: [
        {
          name: 'audioInput' as const,
          rate: 0,
          strategy: 'fixed' as const,
          unit: 'second' as const,
        },
      ],
    };
    mocks.getAdminNewapiModelCard.mockResolvedValue({
      modelCard: { id: 'free-asr', pricing: freePricing, type: 'asr' },
    });
    mocks.resolveAdminNewapiModelPricing.mockResolvedValue({
      pricing: freePricing,
      source: 'model-bank',
    });

    await recordCommercialAiUsage({
      db: {} as any,
      model: 'free-asr',
      provider: 'newapi',
      referenceId: 'asr-free',
      referenceType: 'asr',
      usage: { cost: 0 },
      usageType: 'asr',
      userId: 'user-1',
    });

    expect(mocks.getAdminNewapiModelCard).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'asr' }),
    );
    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({ cost: 0, costSource: 'local-pricing' }),
      }),
    );
  });

  it('should not charge when the user has self-managed provider credentials', async () => {
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: { apiKey: 'user-key' } });

    const result = await recordCommercialChatUsage({
      db: {} as any,
      messageId: 'assistant-message-4',
      model: 'gpt-test',
      provider: 'openai',
      usage: { cost: 0.25, totalTokens: 100 },
      userId: 'user-1',
    });

    expect(result).toBeNull();
    expect(mocks.consumeCreditsForAiUsage).not.toHaveBeenCalled();
  });

  it('should still charge branding provider usage even when the user configured a personal key', async () => {
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: { apiKey: 'user-key' } });

    await recordCommercialChatUsage({
      db: {} as any,
      messageId: 'assistant-message-branding-1',
      model: 'gpt-test',
      provider: BRANDING_PROVIDER,
      usage: { cost: 0.25, totalTokens: 100 },
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: BRANDING_PROVIDER,
        referenceId: 'assistant-message-branding-1',
      }),
    );
  });

  it('should record non-chat model runtime usage with a dedicated reference type', async () => {
    await recordCommercialAiUsage({
      db: {} as any,
      model: 'gpt-test',
      operationId: 'operation-5',
      provider: 'openai',
      referenceId: 'operation-5',
      referenceType: 'model_runtime_generate_object',
      title: 'AI Structured Output Usage',
      usage: { cost: 0.12, totalTokens: 100 },
      usageType: 'generate_object',
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'operation-5',
        referenceId: 'operation-5',
        referenceType: 'model_runtime_generate_object',
        title: 'AI Structured Output Usage',
        usage: expect.objectContaining({ cost: 0.12, costSource: 'gateway' }),
        usageType: 'generate_object',
      }),
    );
  });

  it('should treat embeddings totalTokens as input tokens for local pricing', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'embedding-test',
        pricing: {
          units: [{ name: 'textInput', rate: 0.1, strategy: 'fixed' }],
        },
      },
    ]);

    await recordCommercialAiUsage({
      db: {} as any,
      model: 'embedding-test',
      provider: 'openai',
      referenceId: 'embedding-operation-1',
      referenceType: 'model_runtime_embeddings',
      title: 'AI Embeddings Usage',
      usage: { totalTokens: 1_000_000 },
      usageType: 'embeddings',
      userId: 'user-1',
    });

    expect(mocks.consumeCreditsForAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: 'embedding-operation-1',
        usage: expect.objectContaining({
          cost: 0.1,
          costSource: 'local-pricing',
        }),
        usageType: 'embeddings',
      }),
    );
  });
});

describe('assertCommercialMinimumBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: {} });
    mocks.getCreditAccountSummary.mockResolvedValue({
      balance: 0,
      breakdown: {
        other: { available: 0, consumed: 0, credited: 0 },
        referral: { available: 0, consumed: 0, credited: 0 },
        subscription: { available: 0, consumed: 0, credited: 0 },
        topup: { available: 0, consumed: 0, credited: 0 },
      },
      currency: 'CREDITS',
      totalCredited: 0,
      totalDebited: 0,
      updatedAt: null,
    });
  });

  it('should check a minimum commercial balance for non-chat calls', async () => {
    mocks.canStartChatUsage.mockResolvedValue(true);

    await assertCommercialMinimumBudget({
      db: {} as any,
      model: 'embedding-test',
      provider: 'openai',
      requiredCredits: 3,
      userId: 'user-1',
    });

    expect(mocks.canStartChatUsage).toHaveBeenCalledWith(3);
  });

  it('should throw with structured balance details when minimum balance is unavailable', async () => {
    mocks.canStartChatUsage.mockResolvedValue(false);

    await expect(
      assertCommercialMinimumBudget({
        db: {} as any,
        model: 'embedding-test',
        provider: 'openai',
        requiredCredits: 3,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      error: {
        availableCredits: 0,
        currency: 'CREDITS',
        message: 'COMMERCIAL_BALANCE_EXHAUSTED',
        model: 'embedding-test',
        provider: 'openai',
        requiredCredits: 3,
        shortfallCredits: 3,
      },
      errorType: ChatErrorType.InsufficientBudgetForModel,
    });
  });
});

describe('commercial AI reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerGlobalConfig.mockResolvedValue({
      aiProvider: { openai: { enabled: true } },
    });
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: {} });
    mocks.getServerModelPricingSnapshot.mockResolvedValue({
      pricing: {
        units: [
          { name: 'textInput', rate: 0.5, strategy: 'fixed' },
          { name: 'textOutput', rate: 1, strategy: 'fixed' },
        ],
      },
      source: 'database',
    });
    mocks.reserveCredits.mockResolvedValue({ id: 'reservation-1', status: 'active' });
    mocks.settleCredits.mockResolvedValue({ id: 'reservation-1', status: 'settled' });
    mocks.releaseCredits.mockResolvedValue({ id: 'reservation-1', status: 'released' });
    mocks.recordSettlementFailure.mockResolvedValue({ id: 'failure-1', status: 'pending' });
    mocks.resolveSettlementFailure.mockResolvedValue(undefined);
    mocks.quoteCreditsForAiUsage.mockResolvedValue({
      amount: 20,
      creditsPerDollar: 1_000_000,
      matchedPricingRule: null,
      pricingMultiplier: 1,
      usdCost: 0.02,
    });
  });

  it('estimates embedding input credits from model pricing', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'embedding-test',
        pricing: { units: [{ name: 'textInput', rate: 2, strategy: 'fixed' }] },
      },
    ]);

    await expect(
      estimateCommercialEmbeddingsCredits({
        db: {} as any,
        input: 'abcdefgh',
        model: 'embedding-test',
        provider: 'openai',
        userId: 'user-1',
      }),
    ).resolves.toBe(4);
  });

  it('creates an idempotent personal reservation before provider dispatch', async () => {
    await expect(
      reserveCommercialAiUsage({
        db: {} as any,
        estimatedCredits: 25,
        model: 'gpt-test',
        operationId: 'operation-1',
        provider: 'openai',
        usageType: 'chat',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ id: 'reservation-1' });

    expect(mocks.reserveCredits).toHaveBeenCalledWith({
      amount: 20,
      idempotencyKey: 'commercial-ai:personal:user-1:chat:operation-1',
      metadata: {
        model: 'gpt-test',
        operationId: 'operation-1',
        pricingQuote: expect.objectContaining({
          baseEstimatedCredits: 25,
          creditsPerDollar: 1_000_000,
          matchedPricingRule: null,
          modelPricingSource: 'database',
          pricingMultiplier: 1,
          quotedAt: expect.any(String),
          version: 1,
        }),
        provider: 'openai',
        usageType: 'chat',
      },
      payer: { scopeType: 'personal', userId: 'user-1' },
      requireNew: true,
    });
  });

  it('prices a generic NewAPI provider from the selected gateway instance', async () => {
    const routeMetadata = {
      groupKey: 'pro',
      instanceId: 'bd31d12b-3edc-480c-8fbe-e05a305f5384',
      providerType: 'newapi',
    };

    await reserveCommercialAiUsage({
      db: {} as any,
      estimatedCredits: 25,
      model: 'gpt-5.6-sol',
      operationId: 'operation-newapi',
      provider: 'newapi',
      routeMetadata,
      usageType: 'chat',
      userId: 'user-1',
    });

    expect(mocks.getServerModelPricingSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.getServerModelPricingSnapshot).toHaveBeenNthCalledWith(1, {
      db: {},
      model: 'gpt-5.6-sol',
      provider: 'newapi',
      routeMetadata,
      type: 'chat',
      userId: 'user-1',
    });
    expect(mocks.getServerModelPricingSnapshot).toHaveBeenNthCalledWith(2, {
      db: {},
      model: 'gpt-5.6-sol',
      provider: 'newapi',
      routeMetadata,
      type: 'chat',
      userId: 'user-1',
    });
  });

  it('rejects platform-billed models without reliable pricing', async () => {
    mocks.getServerModelPricingSnapshot.mockResolvedValue({
      pricing: undefined,
      source: 'missing',
    });

    await expect(
      assertCommercialModelSellable({
        db: {} as any,
        model: 'unpriced-model',
        provider: 'openai',
        usageType: 'chat',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      error: {
        message: 'COMMERCIAL_MODEL_PRICING_MISSING',
        reason: 'COMMERCIAL_MODEL_NOT_SELLABLE',
      },
      errorType: ChatErrorType.Forbidden,
    });
  });

  it('accepts explicit zero pricing only from a trusted server catalog', async () => {
    const pricing = {
      units: [{ name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' }],
    } as const;

    mocks.getServerModelPricingSnapshot.mockResolvedValue({ pricing, source: 'model-bank' });
    await expect(
      assertCommercialModelSellable({
        db: {} as any,
        model: 'free-embedding',
        provider: 'newapi',
        usageType: 'embeddings',
        userId: 'user-1',
      }),
    ).resolves.toBe(true);

    mocks.getServerModelPricingSnapshot.mockResolvedValue({ pricing, source: 'database' });
    await expect(
      assertCommercialModelSellable({
        db: {} as any,
        model: 'untrusted-free-embedding',
        provider: 'newapi',
        usageType: 'embeddings',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      error: { message: 'COMMERCIAL_MODEL_PRICING_MISSING' },
      errorType: ChatErrorType.Forbidden,
    });
  });

  it.each([
    { name: 'fixed', rate: 0.2, strategy: 'fixed', unit: 'second' },
    {
      name: 'tiered',
      strategy: 'tiered',
      tiers: [{ rate: 0.15, upTo: 'infinity' }],
      unit: 'second',
    },
    {
      lookup: { prices: { standard: 0.3 }, pricingParams: ['quality'] },
      name: 'lookup',
      strategy: 'lookup',
      unit: 'video',
    },
  ])('accepts reliable $name video generation pricing', async (pricingUnit) => {
    mocks.getServerModelPricingSnapshot.mockResolvedValue({
      pricing: {
        units: [{ ...pricingUnit, name: 'videoGeneration' }],
      },
      source: 'database',
    });

    await expect(
      assertCommercialModelSellable({
        db: {} as any,
        model: 'video-model',
        provider: 'openai',
        usageType: 'video',
        userId: 'user-1',
      }),
    ).resolves.toBe(true);
  });

  it('treats SuperGrok as external-subscription usage', async () => {
    await expect(
      assertCommercialModelSellable({
        db: {} as any,
        model: 'grok-4.5',
        provider: 'supergrok',
        usageType: 'chat',
        userId: 'user-1',
      }),
    ).resolves.toBe(false);

    expect(mocks.getServerModelPricingSnapshot).not.toHaveBeenCalled();
  });

  it('creates a workspace reservation when usage belongs to a workspace', async () => {
    await reserveCommercialAiUsage({
      db: {} as any,
      estimatedCredits: 25,
      model: 'gpt-test',
      operationId: 'operation-1',
      provider: 'openai',
      usageType: 'chat',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.reserveCredits).toHaveBeenCalledWith({
      amount: 20,
      idempotencyKey: 'commercial-ai:workspace:workspace-1:chat:operation-1',
      metadata: {
        model: 'gpt-test',
        operationId: 'operation-1',
        pricingQuote: expect.objectContaining({
          baseEstimatedCredits: 25,
          creditsPerDollar: 1_000_000,
          matchedPricingRule: null,
          modelPricingSource: 'database',
          pricingMultiplier: 1,
          quotedAt: expect.any(String),
          version: 1,
        }),
        provider: 'openai',
        usageType: 'chat',
        workspaceId: 'workspace-1',
      },
      payer: { scopeType: 'workspace', workspaceId: 'workspace-1' },
      requireNew: true,
    });
  });

  it('separates personal and workspace reservation idempotency', async () => {
    const base = {
      db: {} as any,
      estimatedCredits: 25,
      model: 'gpt-test',
      operationId: 'shared-operation',
      provider: 'openai',
      usageType: 'chat' as const,
      userId: 'user-1',
    };

    await reserveCommercialAiUsage(base);
    await reserveCommercialAiUsage({ ...base, workspaceId: 'workspace-1' });

    expect(mocks.reserveCredits.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      'commercial-ai:personal:user-1:chat:shared-operation',
      'commercial-ai:workspace:workspace-1:chat:shared-operation',
    ]);
  });

  it('bounds the reservation idempotency key without losing operation metadata', async () => {
    const operationId = 'x'.repeat(240);

    await reserveCommercialAiUsage({
      db: {} as any,
      estimatedCredits: 25,
      model: 'gpt-test',
      operationId,
      provider: 'openai',
      usageType: 'chat',
      userId: 'user-1',
    });

    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^commercial-ai:[a-f\d]{64}$/),
        metadata: expect.objectContaining({ operationId }),
        requireNew: true,
      }),
    );
    expect(mocks.reserveCredits.mock.calls[0][0].idempotencyKey).toHaveLength(78);
  });

  it('settles final usage through the existing reservation', async () => {
    await settleCommercialAiUsageReservation({
      db: {} as any,
      estimatedCredits: 25,
      model: 'gpt-test',
      operationId: 'operation-1',
      provider: 'openai',
      reservationId: 'reservation-1',
      title: 'AI Chat Usage',
      usage: { cost: 0.02, totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
      usageType: 'chat',
      userId: 'user-1',
    });

    expect(mocks.settleCredits).toHaveBeenCalledWith({
      actualAmount: 20,
      ledger: {
        description: 'Consumed on openai/gpt-test',
        referenceType: 'ai_usage_reservation',
        title: 'AI Chat Usage',
      },
      metadata: expect.objectContaining({
        chargedCredits: 20,
        costSource: 'gateway',
        estimatedCredits: 25,
        model: 'gpt-test',
        operationId: 'operation-1',
        provider: 'openai',
        usageType: 'chat',
      }),
      reservationId: 'reservation-1',
    });
  });

  it('settles generated media with the measured credit amount', async () => {
    await settleCommercialAiUsageReservation({
      actualCredits: 42,
      db: {} as any,
      estimatedCredits: 50,
      model: 'image-test',
      operationId: 'image-operation-1',
      provider: 'openai',
      reservationId: 'reservation-1',
      title: 'Image Generation',
      usageType: 'image',
      userId: 'user-1',
    });

    expect(mocks.settleCredits).toHaveBeenCalledWith({
      actualAmount: 42,
      ledger: {
        description: 'Consumed on openai/image-test',
        referenceType: 'ai_usage_reservation',
        title: 'Image Generation',
      },
      metadata: expect.objectContaining({
        chargedCredits: 42,
        costSource: 'generation-pricing',
        estimatedCredits: 50,
        operationId: 'image-operation-1',
        usageType: 'image',
      }),
      reservationId: 'reservation-1',
    });
  });

  it('releases provider failures without debiting the payer', async () => {
    await releaseCommercialAiUsageReservation({
      db: {} as any,
      reason: 'provider_error',
      reservationId: 'reservation-1',
    });

    expect(mocks.releaseCredits).toHaveBeenCalledWith({
      reason: 'provider_error',
      reservationId: 'reservation-1',
    });
  });
});
