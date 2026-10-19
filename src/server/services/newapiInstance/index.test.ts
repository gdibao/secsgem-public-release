import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PlanModelRulesModule from '@/business/server/planModelRules';
import { resolvePlanModelRules } from '@/business/server/planModelRules';

import {
  getAllEnabledModels,
  invalidateNewapiInstancesCache,
  resolveDefaultNewapiInstance,
  resolveNewapiInstancesForModel,
  resolveNewapiModelPricingFromMetadata,
} from './index';

const pricingMocks = vi.hoisted(() => ({
  resolveNewapiModelPricing: vi.fn(),
}));

vi.mock('@/business/server/planModelRules', async () => {
  const actual = await vi.importActual<typeof PlanModelRulesModule>(
    '@/business/server/planModelRules',
  );

  return {
    ...actual,
    resolvePlanModelRules: vi.fn(),
  };
});

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({
      decrypt: vi.fn(async (value: string) => ({
        plaintext: value === 'bad-cipher' ? '' : value.replace(/^enc:/, ''),
        wasAuthentic: value !== 'bad-cipher',
      })),
      encrypt: vi.fn(async (value: string) => `enc:${value}`),
    }),
  },
}));

vi.mock('./pricingResolution', () => ({
  resolveNewapiModelPricing: pricingMocks.resolveNewapiModelPricing,
}));

const createDb = (rows: any[]) => {
  const updateSet = vi.fn(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    orderBy: vi.fn().mockResolvedValue(rows),
    where: vi.fn(() => chain),
  };

  const db = {
    select: vi.fn(() => chain),
  } as any;

  db.update = vi.fn(() => ({
    set: updateSet,
  }));
  db.updateSet = updateSet;

  return db;
};

describe('NewAPI instance resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateNewapiInstancesCache();
    vi.mocked(resolvePlanModelRules).mockResolvedValue(null);
    pricingMocks.resolveNewapiModelPricing.mockImplementation(
      async ({ databasePricing }: { databasePricing?: unknown }) => ({
        pricing: databasePricing,
        source: databasePricing ? 'database' : 'missing',
      }),
    );
  });

  it('allows free plan basic group and denies pro group for the same model', async () => {
    vi.mocked(resolvePlanModelRules).mockResolvedValue({
      chat: { allowlist: ['basic:gpt-4o-mini'], mode: 'allowlist' },
    });
    const db = createDb([
      {
        apiKey: 'sk-basic',
        baseUrl: 'https://basic.example.com',
        groupKey: 'basic',
        groupName: 'Basic',
        groupMultiplier: 1,
        id: 'basic-1',
        name: 'Basic 1',
        priority: 0,
        usageScope: ['chat'],
      },
      {
        apiKey: 'sk-pro',
        baseUrl: 'https://pro.example.com',
        groupKey: 'pro',
        groupName: 'Pro',
        groupMultiplier: 2,
        id: 'pro-1',
        name: 'Pro 1',
        priority: 1,
        usageScope: ['chat'],
      },
    ]);

    const routes = await resolveNewapiInstancesForModel(db, {
      modelId: 'gpt-4o-mini',
      modelType: 'chat',
      userId: 'user-1',
    });

    expect(routes.map((route) => route.groupKey)).toEqual(['basic']);
  });

  it('allows premium plan pro group models', async () => {
    vi.mocked(resolvePlanModelRules).mockResolvedValue({
      chat: { allowlist: ['pro:gpt-4o'], mode: 'allowlist' },
    });
    const db = createDb([
      {
        apiKey: 'sk-pro',
        baseUrl: 'https://pro.example.com',
        groupKey: 'pro',
        groupName: 'Pro',
        groupMultiplier: 2,
        id: 'pro-1',
        name: 'Pro 1',
        priority: 0,
        providerType: 'aliyun',
        usageScope: ['chat'],
      },
    ]);

    const routes = await resolveNewapiInstancesForModel(db, {
      modelId: 'gpt-4o',
      modelType: 'chat',
      userId: 'user-1',
    });

    expect(routes[0]).toEqual(
      expect.objectContaining({
        groupKey: 'pro',
        groupName: 'Pro',
        groupMultiplier: 2,
        providerType: 'aliyun',
      }),
    );
  });

  it('decrypts encrypted api keys for resolved routes', async () => {
    const db = createDb([
      {
        apiKey: 'kv:enc:sk-encrypted',
        baseUrl: 'https://pro.example.com',
        groupKey: 'pro',
        id: 'pro-1',
        name: 'Pro 1',
        priority: 0,
        providerType: 'newapi',
        usageScope: ['chat'],
      },
    ]);

    const routes = await resolveNewapiInstancesForModel(db, {
      modelId: 'gpt-4o',
      modelType: 'chat',
    });

    expect(routes[0]).toEqual(expect.objectContaining({ apiKey: 'sk-encrypted' }));
  });

  it('skips invalid encrypted api keys while keeping healthy routes available', async () => {
    const db = createDb([
      {
        apiKey: 'kv:bad-cipher',
        baseUrl: 'https://bad.example.com',
        groupKey: 'pro',
        id: 'bad-1',
        name: 'Bad 1',
        priority: 0,
        providerType: 'newapi',
        usageScope: ['chat'],
      },
      {
        apiKey: 'kv:enc:sk-good',
        baseUrl: 'https://good.example.com',
        groupKey: 'pro',
        id: 'good-1',
        name: 'Good 1',
        priority: 1,
        providerType: 'newapi',
        usageScope: ['chat'],
      },
    ]);

    const routes = await resolveNewapiInstancesForModel(db, {
      modelId: 'gpt-4o',
      modelType: 'chat',
      preferredGroupKey: 'pro',
    });

    expect(routes).toEqual([
      expect.objectContaining({
        apiKey: 'sk-good',
        instanceId: 'good-1',
      }),
    ]);
  });

  it('backfills legacy plaintext api keys during runtime resolution', async () => {
    const db = createDb([
      {
        apiKey: 'sk-legacy',
        baseUrl: 'https://legacy.example.com',
        groupKey: 'default',
        id: 'legacy-1',
        name: 'Legacy 1',
        priority: 0,
        providerType: 'newapi',
        usageScope: ['chat'],
      },
    ]);

    await resolveNewapiInstancesForModel(db, {
      modelId: 'gpt-4o',
      modelType: 'chat',
    });

    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'kv:enc:sk-legacy' }),
    );
  });

  it('returns fallback candidates from the same group only', async () => {
    const db = createDb([
      {
        apiKey: 'sk-pro-1',
        baseUrl: 'https://a.example.com',
        groupKey: 'pro',
        id: 'pro-1',
        name: 'Pro 1',
        priority: 0,
      },
      {
        apiKey: 'sk-vip-1',
        baseUrl: 'https://b.example.com',
        groupKey: 'vip',
        id: 'vip-1',
        name: 'Vip 1',
        priority: 1,
      },
      {
        apiKey: 'sk-pro-2',
        baseUrl: 'https://c.example.com',
        groupKey: 'pro',
        id: 'pro-2',
        name: 'Pro 2',
        priority: 2,
      },
    ]);

    const routes = await resolveNewapiInstancesForModel(db, {
      modelId: 'gpt-4o',
      modelType: 'chat',
      preferredGroupKey: 'pro',
    });

    expect(routes.map((route) => route.instanceId)).toEqual(['pro-1', 'pro-2']);
  });

  it('respects instance usage scope', async () => {
    const db = createDb([
      {
        apiKey: 'sk-image',
        baseUrl: 'https://image.example.com',
        groupKey: 'basic',
        id: 'image-1',
        name: 'Image only',
        priority: 0,
        usageScope: ['image'],
      },
      {
        apiKey: 'sk-chat',
        baseUrl: 'https://chat.example.com',
        groupKey: 'basic',
        id: 'chat-1',
        name: 'Chat',
        priority: 1,
        usageScope: ['chat'],
      },
    ]);

    const routes = await resolveNewapiInstancesForModel(db, {
      modelId: 'gpt-4o',
      modelType: 'chat',
    });

    expect(routes.map((route) => route.instanceId)).toEqual(['chat-1']);
  });

  it('routes normalized asr requests to legacy stt model rows and usage scopes', async () => {
    const db = createDb([
      {
        apiKey: 'sk-asr',
        baseUrl: 'https://asr.example.com',
        groupKey: 'basic',
        id: 'asr-1',
        name: 'ASR',
        priority: 0,
        usageScope: ['stt'],
      },
    ]);

    const routes = await resolveNewapiInstancesForModel(db, {
      modelId: 'whisper-1',
      modelType: 'asr',
    });

    expect(routes.map((route) => route.instanceId)).toEqual(['asr-1']);
  });

  it('prefers default group for default instance resolution', async () => {
    const db = createDb([
      {
        apiKey: 'sk-pro',
        baseUrl: 'https://pro.example.com',
        groupKey: 'pro',
        id: 'pro-1',
        name: 'Pro',
        priority: 0,
      },
      {
        apiKey: 'sk-default',
        baseUrl: 'https://default.example.com',
        groupKey: 'default',
        id: 'default-1',
        name: 'Default',
        priority: 1,
      },
    ]);

    await expect(resolveDefaultNewapiInstance(db)).resolves.toEqual(
      expect.objectContaining({
        groupKey: 'default',
        instanceId: 'default-1',
      }),
    );
  });

  it('keeps enabled model routes distinct when the same model exists in multiple groups', async () => {
    const db = createDb([
      {
        displayName: 'GPT-4o',
        groupKey: 'basic',
        groupName: 'Basic',
        instanceId: 'basic-1',
        instanceName: 'Basic Gateway',
        modelId: 'gpt-4o',
        modelType: 'chat',
        providerType: 'newapi',
      },
      {
        displayName: 'GPT-4o',
        groupKey: 'pro',
        groupName: 'Pro',
        instanceId: 'pro-1',
        instanceName: 'Pro Gateway',
        modelId: 'gpt-4o',
        modelType: 'chat',
        providerType: 'openai-compatible',
      },
    ]);

    await expect(getAllEnabledModels(db)).resolves.toEqual([
      expect.objectContaining({
        groupKey: 'basic',
        id: 'gpt-4o',
        instanceName: 'Basic Gateway',
      }),
      expect.objectContaining({
        groupKey: 'pro',
        id: 'gpt-4o',
        instanceName: 'Pro Gateway',
      }),
    ]);
  });

  it('returns pricing converted from stored NewAPI metadata', async () => {
    const db = createDb([
      {
        displayName: 'GPT-4o Mini',
        groupKey: 'basic',
        groupName: 'Basic',
        instanceId: 'basic-1',
        instanceName: 'Basic Gateway',
        metadata: {
          completionRatio: 2,
          modelRatio: 0.15,
          pricingAvailable: true,
          quotaType: 0,
        },
        modelId: 'gpt-4o-mini',
        modelType: 'chat',
        providerType: 'newapi',
      },
      {
        displayName: 'GPT Image',
        groupKey: 'basic',
        groupName: 'Basic',
        instanceId: 'basic-1',
        instanceName: 'Basic Gateway',
        metadata: {
          modelPrice: 0.03,
          pricingAvailable: true,
          quotaType: 1,
        },
        modelId: 'gpt-image-2',
        modelType: 'image',
        providerType: 'newapi',
      },
    ]);

    await expect(getAllEnabledModels(db)).resolves.toEqual([
      expect.objectContaining({
        id: 'gpt-4o-mini',
        pricing: {
          units: [
            { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
          ],
        },
      }),
      expect.objectContaining({
        id: 'gpt-image-2',
        pricing: {
          approximatePricePerImage: 0.03,
          units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
        },
      }),
    ]);
  });

  it('resolves official pricing into runtime model cards when upstream sync is disabled', async () => {
    const officialPricing = {
      units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
    };
    pricingMocks.resolveNewapiModelPricing.mockResolvedValue({
      pricing: officialPricing,
      source: 'lobehub-official',
    });
    const db = createDb([
      {
        displayName: 'Official Model',
        groupKey: 'basic',
        groupName: 'Basic',
        instanceId: 'basic-1',
        instanceMetadata: {
          pricingPolicy: {
            lobeHubOfficialPricingEnabled: true,
            modelBankFallbackEnabled: false,
            upstreamSyncEnabled: false,
          },
        },
        instanceName: 'Basic Gateway',
        metadata: {
          syncedPricing: {
            units: [{ name: 'textInput', rate: 9, strategy: 'fixed', unit: 'millionTokens' }],
          },
        },
        modelId: 'official-model',
        modelType: 'chat',
        providerType: 'newapi',
      },
    ]);

    await expect(getAllEnabledModels(db)).resolves.toEqual([
      expect.objectContaining({ id: 'official-model', pricing: officialPricing }),
    ]);
    expect(pricingMocks.resolveNewapiModelPricing).toHaveBeenCalledWith({
      databasePricing: undefined,
      lobeHubOfficialPricingEnabled: true,
      model: 'official-model',
      modelBankFallbackEnabled: false,
      modelBankProvider: undefined,
    });
  });

  it('prefers manual official cost pricing over synced NewAPI pricing metadata', async () => {
    const db = createDb([
      {
        displayName: 'Manual Cost Model',
        groupKey: 'basic',
        groupName: 'Basic',
        instanceId: 'basic-1',
        instanceName: 'Basic Gateway',
        metadata: {
          completionRatio: 10,
          manualPricing: {
            inputCostRate: 1.2,
            marginMultiplier: 1.35,
            outputCostRate: 3.4,
            source: 'admin-manual',
          },
          modelRatio: 0.15,
          pricingAvailable: true,
          quotaType: 0,
        },
        modelId: 'manual-cost-model',
        modelType: 'chat',
        providerType: 'newapi',
      },
    ]);

    await expect(getAllEnabledModels(db)).resolves.toEqual([
      expect.objectContaining({
        id: 'manual-cost-model',
        pricing: {
          units: [
            {
              name: 'textInput',
              originalRate: 1.2,
              rate: 1.2,
              strategy: 'fixed',
              unit: 'millionTokens',
            },
            {
              name: 'textOutput',
              originalRate: 3.4,
              rate: 3.4,
              strategy: 'fixed',
              unit: 'millionTokens',
            },
          ],
        },
      }),
    ]);
  });

  it('uses standardized synchronized pricing and can disable upstream metadata', () => {
    const syncedPricing = {
      units: [{ name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' }],
    } as const;
    const metadata = {
      modelRatio: 10,
      quotaType: 0,
      syncedPricing,
    };

    expect(resolveNewapiModelPricingFromMetadata(metadata, 'chat')).toBe(syncedPricing);
    expect(
      resolveNewapiModelPricingFromMetadata(metadata, 'chat', { includeSyncedPricing: false }),
    ).toBeUndefined();
  });

  it('keeps manual pricing active when upstream pricing is disabled', () => {
    expect(
      resolveNewapiModelPricingFromMetadata(
        {
          manualPricing: { inputRate: 1.5, outputRate: 3 },
          modelRatio: 10,
          quotaType: 0,
        },
        'chat',
        { includeSyncedPricing: false },
      ),
    ).toMatchObject({
      units: [
        expect.objectContaining({ name: 'textInput', rate: 1.5 }),
        expect.objectContaining({ name: 'textOutput', rate: 3 }),
      ],
    });
  });

  it('resolves synchronized cache and multimodal pricing ratios', () => {
    expect(
      resolveNewapiModelPricingFromMetadata(
        {
          audioCompletionRatio: 2,
          audioRatio: 4,
          cacheRatio: 0.25,
          completionRatio: 3,
          createCacheRatio: 1.25,
          imageRatio: 5,
          modelRatio: 2,
          quotaType: 0,
        },
        'chat',
      ),
    ).toMatchObject({
      units: [
        { name: 'textInput', rate: 4 },
        { name: 'textOutput', rate: 12 },
        { name: 'textInput_cacheRead', rate: 1 },
        { name: 'textInput_cacheWrite', rate: 5 },
        { name: 'audioInput', rate: 16 },
        { name: 'audioOutput', rate: 32 },
        { name: 'imageInput', rate: 20 },
      ],
    });
  });

  it('returns synchronized abilities while preserving explicit admin overrides', async () => {
    const db = createDb([
      {
        displayName: 'Synced Model',
        groupKey: 'basic',
        groupName: 'Basic',
        instanceId: 'basic-1',
        instanceName: 'Basic Gateway',
        metadata: {
          manualAbilities: { vision: false },
          syncedAbilities: {
            functionCall: true,
            reasoning: true,
            structuredOutput: true,
            vision: true,
          },
        },
        modelId: 'synced-model',
        modelType: 'chat',
        providerType: 'newapi',
      },
    ]);

    await expect(getAllEnabledModels(db)).resolves.toEqual([
      expect.objectContaining({
        abilities: {
          functionCall: true,
          reasoning: true,
          structuredOutput: true,
          vision: false,
        },
        id: 'synced-model',
      }),
    ]);
  });

  it('returns admin manual abilities and media pricing for frontend model cards', async () => {
    const db = createDb([
      {
        displayName: 'Vision Model',
        groupKey: 'basic',
        groupName: 'Basic',
        instanceId: 'basic-1',
        instanceName: 'Basic Gateway',
        metadata: {
          manualAbilities: {
            functionCall: true,
            reasoning: false,
            vision: true,
          },
          manualPricing: {
            imageRate: 0.05,
            marginMultiplier: 1.35,
            source: 'admin-manual',
          },
        },
        modelId: 'vision-image-model',
        modelType: 'image',
        providerType: 'newapi',
      },
      {
        displayName: 'Video Model',
        groupKey: 'basic',
        groupName: 'Basic',
        instanceId: 'basic-1',
        instanceName: 'Basic Gateway',
        metadata: {
          manualPricing: {
            marginMultiplier: 1.35,
            source: 'admin-manual',
            videoRate: 0.8,
          },
        },
        modelId: 'video-model',
        modelType: 'video',
        providerType: 'newapi',
      },
    ]);

    await expect(getAllEnabledModels(db)).resolves.toEqual([
      expect.objectContaining({
        abilities: {
          functionCall: true,
          reasoning: false,
          vision: true,
        },
        id: 'vision-image-model',
        pricing: {
          approximatePricePerImage: 0.05,
          units: [
            {
              name: 'imageGeneration',
              originalRate: 0.05,
              rate: 0.05,
              strategy: 'fixed',
              unit: 'image',
            },
          ],
        },
      }),
      expect.objectContaining({
        id: 'video-model',
        pricing: {
          approximatePricePerVideo: 0.8,
          units: [],
        },
      }),
    ]);
  });
});
