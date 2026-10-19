// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAdminNewapiModelCard, resolveAdminNewapiModelPricing } from './adminNewapiPricing';

const mocks = vi.hoisted(() => ({
  resolveNewapiModelPricing: vi.fn(),
  resolveNewapiModelPricingFromMetadata: vi.fn(),
}));

vi.mock('@/server/services/newapiInstance', () => ({
  resolveNewapiModelPricingFromMetadata: mocks.resolveNewapiModelPricingFromMetadata,
}));

vi.mock('@/server/services/newapiInstance/pricingResolution', () => ({
  resolveNewapiModelPricing: mocks.resolveNewapiModelPricing,
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
}));

vi.mock('@/database/schemas', () => ({
  adminNewapiInstanceModels: {
    displayName: 'displayName',
    enabled: 'modelEnabled',
    instanceId: 'instanceId',
    metadata: 'metadata',
    modelId: 'modelId',
    modelType: 'modelType',
  },
  adminNewapiInstances: {
    enabled: 'instanceEnabled',
    id: 'id',
    metadata: 'instanceMetadata',
    providerType: 'providerType',
  },
}));

const createDb = (rows: any[]) => {
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn().mockResolvedValue(rows),
  };

  return { select: vi.fn(() => chain) } as any;
};

describe('getAdminNewapiModelCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveNewapiModelPricing.mockResolvedValue({ source: 'missing' });
  });

  it('reads pricing metadata for the exact selected instance', async () => {
    const metadata = {
      modelRatio: 37.5,
      pricingSyncStatus: 'available',
      quotaType: 0,
    };
    const pricing = {
      units: [
        {
          name: 'textInput',
          rate: 75,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    };
    const db = createDb([
      {
        displayName: 'GPT 5.6 SOL',
        instanceMetadata: null,
        metadata,
        modelId: 'gpt-5.6-sol',
        modelType: 'chat',
        providerType: 'newapi',
      },
    ]);
    mocks.resolveNewapiModelPricingFromMetadata.mockReturnValue(pricing);

    await expect(
      getAdminNewapiModelCard({
        db,
        model: 'gpt-5.6-sol',
        provider: 'a61d4caa-adcb-45cd-a9b6-0d3fd9d5535a',
        type: 'chat',
      }),
    ).resolves.toEqual({
      lobeHubOfficialPricingEnabled: false,
      modelBankFallbackEnabled: false,
      modelBankProvider: undefined,
      modelCard: {
        displayName: 'GPT 5.6 SOL',
        enabled: true,
        id: 'gpt-5.6-sol',
        pricing,
        source: 'custom',
        type: 'chat',
      },
    });
    expect(mocks.resolveNewapiModelPricingFromMetadata).toHaveBeenCalledWith(metadata, 'chat', {
      includeSyncedPricing: true,
    });
  });

  it('uses the route metadata instance when the runtime provider is generic', async () => {
    const db = createDb([
      {
        displayName: null,
        instanceMetadata: null,
        metadata: { manualPricing: { inputRate: 1 } },
        modelId: 'custom-chat',
        modelType: 'chat',
        providerType: 'newapi',
      },
    ]);
    mocks.resolveNewapiModelPricingFromMetadata.mockReturnValue({ units: [] });

    await expect(
      getAdminNewapiModelCard({
        db,
        model: 'custom-chat',
        provider: 'newapi',
        routeMetadata: { instanceId: 'bd31d12b-3edc-480c-8fbe-e05a305f5384' },
        type: 'chat',
      }),
    ).resolves.toMatchObject({ modelCard: { id: 'custom-chat', type: 'chat' } });
  });

  it('returns the instance pricing policy with the selected model card', async () => {
    const db = createDb([
      {
        displayName: null,
        instanceMetadata: {
          pricingPolicy: {
            lobeHubOfficialPricingEnabled: true,
            modelBankFallbackEnabled: true,
            upstreamSyncEnabled: false,
          },
        },
        metadata: { modelRatio: 10 },
        modelId: 'gpt-4o',
        modelType: 'chat',
        providerType: 'openai',
      },
    ]);
    mocks.resolveNewapiModelPricingFromMetadata.mockReturnValue(undefined);

    await expect(
      getAdminNewapiModelCard({
        db,
        model: 'gpt-4o',
        provider: 'bd31d12b-3edc-480c-8fbe-e05a305f5384',
        type: 'chat',
      }),
    ).resolves.toMatchObject({
      lobeHubOfficialPricingEnabled: true,
      modelBankFallbackEnabled: true,
      modelBankProvider: 'openai',
      modelCard: { id: 'gpt-4o', pricing: undefined },
    });
    expect(mocks.resolveNewapiModelPricingFromMetadata).toHaveBeenCalledWith(
      { modelRatio: 10 },
      'chat',
      { includeSyncedPricing: false },
    );
  });

  it('does not query admin rows for a non-instance provider id', async () => {
    const db = createDb([]);

    await expect(
      getAdminNewapiModelCard({
        db,
        model: 'gpt-5.6-sol',
        provider: 'newapi',
        type: 'chat',
      }),
    ).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('prefers LobeHub official pricing before the generic model bank', async () => {
    const official = {
      units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
    };
    mocks.resolveNewapiModelPricing.mockResolvedValue({
      pricing: official,
      source: 'lobehub-official',
    });
    const adminModelCard = {
      lobeHubOfficialPricingEnabled: true,
      modelBankFallbackEnabled: true,
      modelBankProvider: 'openai',
      modelCard: { enabled: true, id: 'gpt-test', type: 'chat' },
    } as any;

    await expect(
      resolveAdminNewapiModelPricing({ adminModelCard, model: 'gpt-test' }),
    ).resolves.toEqual({ pricing: official, source: 'lobehub-official' });
    expect(mocks.resolveNewapiModelPricing).toHaveBeenCalledWith({
      databasePricing: undefined,
      lobeHubOfficialPricingEnabled: true,
      model: 'gpt-test',
      modelBankFallbackEnabled: true,
      modelBankProvider: 'openai',
    });
  });

  it('falls back to the generic model bank when official pricing has no exact match', async () => {
    const modelBankPricing = {
      units: [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
    };
    mocks.resolveNewapiModelPricing.mockResolvedValue({
      pricing: modelBankPricing,
      source: 'model-bank',
    });
    const adminModelCard = {
      lobeHubOfficialPricingEnabled: true,
      modelBankFallbackEnabled: true,
      modelBankProvider: 'openai',
      modelCard: { enabled: true, id: 'gpt-test', type: 'chat' },
    } as any;

    await expect(
      resolveAdminNewapiModelPricing({ adminModelCard, model: 'gpt-test' }),
    ).resolves.toEqual({ pricing: modelBankPricing, source: 'model-bank' });
    expect(mocks.resolveNewapiModelPricing).toHaveBeenCalledWith({
      databasePricing: undefined,
      lobeHubOfficialPricingEnabled: true,
      model: 'gpt-test',
      modelBankFallbackEnabled: true,
      modelBankProvider: 'openai',
    });
  });
});
