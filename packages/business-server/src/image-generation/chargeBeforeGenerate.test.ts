import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chargeBeforeGenerate } from './chargeBeforeGenerate';

const mocks = vi.hoisted(() => ({
  releaseCommercialAiUsageReservation: vi.fn(),
  reserveCommercialAiUsage: vi.fn(),
  getAppSettingValue: vi.fn(),
  getServerModelPricing: vi.fn(),
}));

vi.mock('@/business/server/commercialBilling', () => ({
  releaseCommercialAiUsageReservation: mocks.releaseCommercialAiUsageReservation,
  reserveCommercialAiUsage: mocks.reserveCommercialAiUsage,
}));

vi.mock('@/business/server/serverModelPricing', () => ({
  getServerModelPricing: mocks.getServerModelPricing,
}));

vi.mock('@/server/services/appSettings', () => ({
  APP_SETTING_KEYS: {
    pricingCreditMultiplier: 'pricing.creditMultiplier',
    pricingModelRules: 'pricing.modelRules',
  },
  getAppSettingValue: mocks.getAppSettingValue,
}));

describe('image chargeBeforeGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reserveCommercialAiUsage.mockImplementation(async ({ operationId }) => ({
      amount: 104_940,
      id: `reservation-${operationId}`,
    }));
    mocks.getAppSettingValue.mockImplementation(async (key: string) =>
      key === 'pricing.creditMultiplier'
        ? 1.65
        : [{ model: 'gpt-image-2', multiplier: 1.2, provider: 'newapi' }],
    );
    mocks.getServerModelPricing.mockResolvedValue({
      approximatePricePerImage: 0.053,
      units: [],
    });
  });

  it('checks budget using the model image price with the configured multiplier', async () => {
    const result = await chargeBeforeGenerate({
      configForDatabase: { prompt: 'draw a cat' },
      db: {} as any,
      generationParams: { prompt: 'draw a cat' },
      generationTopicId: 'topic-1',
      imageNum: 2,
      model: 'gpt-image-2',
      provider: 'newapi',
      userId: 'user-1',
    });

    expect(mocks.getServerModelPricing).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-2', provider: 'newapi', type: 'image' }),
    );
    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledTimes(2);
    expect(mocks.reserveCommercialAiUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        estimatedCredits: 53_000,
        operationId: expect.stringMatching(/^image:.+:0$/),
        usageType: 'image',
      }),
    );
    expect(result && 'prechargeItems' in result ? result.prechargeItems : undefined).toHaveLength(
      2,
    );
  });

  it('checks image budget with NewAPI route metadata pricing', async () => {
    mocks.reserveCommercialAiUsage.mockImplementation(async ({ operationId }) => ({
      amount: 159_000,
      id: `reservation-${operationId}`,
    }));
    mocks.getAppSettingValue.mockImplementation(async (key: string) =>
      key === 'pricing.creditMultiplier'
        ? 1
        : [{ group: 'pro', model: 'gpt-image-2', multiplier: 2, provider: 'newapi' }],
    );

    await chargeBeforeGenerate({
      configForDatabase: { prompt: 'draw a cat' },
      db: {} as any,
      generationParams: { prompt: 'draw a cat' },
      generationTopicId: 'topic-1',
      imageNum: 2,
      model: 'gpt-image-2',
      provider: 'newapi',
      routeMetadata: {
        groupKey: 'pro',
        groupMultiplier: 1.5,
      },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.reserveCommercialAiUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        estimatedCredits: 53_000,
        routeMetadata: {
          groupKey: 'pro',
          groupMultiplier: 1.5,
        },
        workspaceId: 'workspace-1',
      }),
    );
  });

  it('releases earlier image reservations if a later reservation fails', async () => {
    mocks.reserveCommercialAiUsage
      .mockResolvedValueOnce({ id: 'reservation-1' })
      .mockRejectedValueOnce(new Error('insufficient balance'));

    await expect(
      chargeBeforeGenerate({
        configForDatabase: { prompt: 'draw a cat' },
        db: {} as any,
        generationParams: { prompt: 'draw a cat' },
        generationTopicId: 'topic-1',
        imageNum: 2,
        model: 'gpt-image-2',
        provider: 'newapi',
        userId: 'user-1',
      }),
    ).rejects.toThrow('insufficient balance');

    expect(mocks.releaseCommercialAiUsageReservation).toHaveBeenCalledWith({
      db: {},
      reason: 'image_reservation_batch_failed',
      reservationId: 'reservation-1',
    });
  });
});
