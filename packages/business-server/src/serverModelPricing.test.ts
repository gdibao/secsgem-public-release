// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerModelPricing, getServerModelPricingSnapshot } from './serverModelPricing';

const mocks = vi.hoisted(() => ({
  getAiProviderModelList: vi.fn(),
  getAdminNewapiModelCard: vi.fn(),
  getModelPricing: vi.fn(),
  getServerGlobalConfig: vi.fn(),
  resolveAdminNewapiModelPricing: vi.fn(),
}));

vi.mock('@lobechat/model-runtime', () => ({
  getModelPricing: mocks.getModelPricing,
}));

vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: vi.fn().mockImplementation(() => ({
    getAiProviderModelList: mocks.getAiProviderModelList,
  })),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: mocks.getServerGlobalConfig,
}));

vi.mock('./adminNewapiPricing', () => ({
  getAdminNewapiModelCard: mocks.getAdminNewapiModelCard,
  resolveAdminNewapiModelPricing: mocks.resolveAdminNewapiModelPricing,
}));

describe('getServerModelPricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerGlobalConfig.mockResolvedValue({ aiProvider: { newapi: { enabled: true } } });
    mocks.getAdminNewapiModelCard.mockResolvedValue(undefined);
    mocks.getModelPricing.mockResolvedValue(undefined);
    mocks.resolveAdminNewapiModelPricing.mockImplementation(async ({ adminModelCard }) =>
      adminModelCard.modelCard.pricing
        ? { pricing: adminModelCard.modelCard.pricing, source: 'database' }
        : { source: 'missing' },
    );
  });

  it('prefers pricing from the selected admin-managed NewAPI instance', async () => {
    const adminPricing = {
      units: [
        {
          name: 'textInput',
          rate: 75,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    };
    const adminModelCard = {
      enabled: true,
      id: 'gpt-5.6-sol',
      pricing: adminPricing,
      type: 'chat',
    } as const;
    const db = { id: 'request-db' } as any;
    mocks.getAdminNewapiModelCard.mockResolvedValue({
      modelBankFallbackEnabled: false,
      modelCard: adminModelCard,
    });

    const snapshot = await getServerModelPricingSnapshot({
      db,
      model: 'gpt-5.6-sol',
      provider: 'a61d4caa-adcb-45cd-a9b6-0d3fd9d5535a',
      type: 'chat',
      userId: 'user-1',
    });

    expect(snapshot).toMatchObject({
      modelCard: adminModelCard,
      pricing: adminPricing,
      source: 'database',
    });
    expect(mocks.getAdminNewapiModelCard).toHaveBeenCalledWith({
      db,
      model: 'gpt-5.6-sol',
      provider: 'a61d4caa-adcb-45cd-a9b6-0d3fd9d5535a',
      routeMetadata: undefined,
      type: 'chat',
    });
    expect(mocks.getAiProviderModelList).not.toHaveBeenCalled();
    expect(mocks.getModelPricing).not.toHaveBeenCalled();
  });

  it('prefers request database pricing for admin-managed generation models', async () => {
    const dbPricing = {
      approximatePricePerImage: 0.02,
      units: [],
    };
    const db = { id: 'request-db' } as any;
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'gpt-image-2',
        pricing: dbPricing,
        type: 'image',
      },
    ]);

    const pricing = await getServerModelPricing({
      db,
      model: 'gpt-image-2',
      provider: 'newapi',
      type: 'image',
      userId: 'user-1',
    });

    expect(pricing).toBe(dbPricing);
    expect(mocks.getServerGlobalConfig).toHaveBeenCalledWith(db);
    expect(mocks.getAiProviderModelList).toHaveBeenCalledWith('newapi', { type: 'image' });
    expect(mocks.getModelPricing).not.toHaveBeenCalled();
  });

  it('returns a database pricing snapshot when admin-managed pricing is available', async () => {
    const dbPricing = {
      approximatePricePerImage: 0.02,
      units: [],
    };
    const db = { id: 'request-db' } as any;
    mocks.getAiProviderModelList.mockResolvedValue([
      {
        id: 'gpt-image-2',
        pricing: dbPricing,
        type: 'image',
      },
    ]);

    const snapshot = await getServerModelPricingSnapshot({
      db,
      model: 'gpt-image-2',
      provider: 'newapi',
      type: 'image',
      userId: 'user-1',
    });

    expect(snapshot).toMatchObject({
      pricing: dbPricing,
      source: 'database',
    });
    expect(snapshot.modelCard?.id).toBe('gpt-image-2');
    expect(mocks.getModelPricing).not.toHaveBeenCalled();
  });

  it('does not borrow model-bank pricing for an enabled unpriced admin row', async () => {
    const adminModelCard = {
      enabled: true,
      id: 'gpt-5.6-sol',
      type: 'chat',
    } as const;
    mocks.getAdminNewapiModelCard.mockResolvedValue({
      modelBankFallbackEnabled: false,
      modelCard: adminModelCard,
    });
    mocks.getModelPricing.mockResolvedValue({
      units: [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
    });

    await expect(
      getServerModelPricingSnapshot({
        db: {} as any,
        model: 'gpt-5.6-sol',
        provider: 'a61d4caa-adcb-45cd-a9b6-0d3fd9d5535a',
        type: 'chat',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({
      modelCard: adminModelCard,
      pricing: undefined,
      source: 'missing',
    });
    expect(mocks.getModelPricing).not.toHaveBeenCalled();
    expect(mocks.getAiProviderModelList).not.toHaveBeenCalled();
  });

  it('uses exact-name model-bank pricing when the admin instance enables it', async () => {
    const adminModelCard = {
      enabled: true,
      id: 'gpt-5.6-sol',
      type: 'chat',
    } as const;
    const staticPricing = {
      units: [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
    } as const;
    mocks.getAdminNewapiModelCard.mockResolvedValue({
      modelBankFallbackEnabled: true,
      modelBankProvider: undefined,
      modelCard: adminModelCard,
    });
    mocks.resolveAdminNewapiModelPricing.mockResolvedValue({
      pricing: staticPricing,
      source: 'model-bank',
    });

    await expect(
      getServerModelPricingSnapshot({
        db: {} as any,
        model: 'gpt-5.6-sol',
        provider: 'a61d4caa-adcb-45cd-a9b6-0d3fd9d5535a',
        type: 'chat',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({
      modelCard: adminModelCard,
      pricing: staticPricing,
      source: 'model-bank',
    });
    expect(mocks.resolveAdminNewapiModelPricing).toHaveBeenCalledWith({
      adminModelCard: {
        modelBankFallbackEnabled: true,
        modelBankProvider: undefined,
        modelCard: adminModelCard,
      },
      model: 'gpt-5.6-sol',
    });
    expect(mocks.getModelPricing).not.toHaveBeenCalled();
    expect(mocks.getAiProviderModelList).not.toHaveBeenCalled();
  });

  it('returns a distinct LobeHub official pricing source for admin-managed models', async () => {
    const adminModelCard = {
      enabled: true,
      id: 'gpt-5.6-sol',
      type: 'chat',
    } as const;
    const officialPricing = {
      units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
    } as const;
    const resolvedAdminModelCard = {
      lobeHubOfficialPricingEnabled: true,
      modelBankFallbackEnabled: true,
      modelBankProvider: undefined,
      modelCard: adminModelCard,
    };
    mocks.getAdminNewapiModelCard.mockResolvedValue(resolvedAdminModelCard);
    mocks.resolveAdminNewapiModelPricing.mockResolvedValue({
      pricing: officialPricing,
      source: 'lobehub-official',
    });

    await expect(
      getServerModelPricingSnapshot({
        db: {} as any,
        model: 'gpt-5.6-sol',
        provider: 'a61d4caa-adcb-45cd-a9b6-0d3fd9d5535a',
        type: 'chat',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({
      modelCard: adminModelCard,
      pricing: officialPricing,
      source: 'lobehub-official',
    });
    expect(mocks.resolveAdminNewapiModelPricing).toHaveBeenCalledWith({
      adminModelCard: resolvedAdminModelCard,
      model: 'gpt-5.6-sol',
    });
  });

  it('falls back to static model-bank pricing when database pricing is missing', async () => {
    const staticPricing = {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    };
    mocks.getAiProviderModelList.mockResolvedValue([{ id: 'gpt-image-2', type: 'image' }]);
    mocks.getModelPricing.mockResolvedValue(staticPricing);

    const pricing = await getServerModelPricing({
      db: {} as any,
      model: 'gpt-image-2',
      provider: 'newapi',
      type: 'image',
      userId: 'user-1',
    });

    expect(pricing).toBe(staticPricing);
    expect(mocks.getModelPricing).toHaveBeenCalledWith('gpt-image-2', 'newapi');
  });

  it('falls back to canonical model-bank pricing for a dated provider snapshot', async () => {
    const staticPricing = {
      units: [{ name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' }],
    };
    mocks.getAiProviderModelList.mockResolvedValue([
      { id: 'deepseek-v4-flash-0731', type: 'chat' },
    ]);
    mocks.getModelPricing.mockImplementation(async (model: string) =>
      model === 'deepseek-v4-flash' ? staticPricing : undefined,
    );

    await expect(
      getServerModelPricingSnapshot({
        db: {} as any,
        model: 'deepseek-v4-flash-0731',
        provider: 'newapi',
        type: 'chat',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ pricing: staticPricing, source: 'model-bank' });
    expect(mocks.getModelPricing).toHaveBeenNthCalledWith(1, 'deepseek-v4-flash-0731', 'newapi');
    expect(mocks.getModelPricing).toHaveBeenNthCalledWith(2, 'deepseek-v4-flash', 'newapi');
  });

  it('returns a model-bank pricing snapshot when database pricing is unavailable', async () => {
    const staticPricing = {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    };
    mocks.getAiProviderModelList.mockResolvedValue([{ id: 'gpt-image-2', type: 'image' }]);
    mocks.getModelPricing.mockResolvedValue(staticPricing);

    const snapshot = await getServerModelPricingSnapshot({
      db: {} as any,
      model: 'gpt-image-2',
      provider: 'newapi',
      type: 'image',
      userId: 'user-1',
    });

    expect(snapshot).toMatchObject({
      pricing: staticPricing,
      source: 'model-bank',
    });
    expect(snapshot.modelCard?.id).toBe('gpt-image-2');
  });

  it('returns a missing pricing snapshot when no pricing source is available', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([{ id: 'gpt-image-2', type: 'image' }]);
    mocks.getModelPricing.mockResolvedValue(undefined);

    await expect(
      getServerModelPricingSnapshot({
        db: {} as any,
        model: 'gpt-image-2',
        provider: 'newapi',
        type: 'image',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({
      pricing: undefined,
      source: 'missing',
    });
  });
});
