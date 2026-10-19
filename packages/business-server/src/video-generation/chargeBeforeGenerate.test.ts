import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chargeBeforeGenerate } from './chargeBeforeGenerate';

const mocks = vi.hoisted(() => ({
  reserveCommercialAiUsage: vi.fn(),
  getAppSettingValue: vi.fn(),
  getServerModelPricing: vi.fn(),
}));

vi.mock('@/business/server/commercialBilling', () => ({
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

describe('video chargeBeforeGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reserveCommercialAiUsage.mockResolvedValue({
      amount: 577_500,
      id: 'reservation-1',
    });
    mocks.getAppSettingValue.mockImplementation(async (key: string) =>
      key === 'pricing.creditMultiplier'
        ? 1.65
        : [{ model: 'veo3.1-fast', multiplier: 1.4, provider: 'newapi' }],
    );
    mocks.getServerModelPricing.mockResolvedValue({
      approximatePricePerVideo: 0.25,
      units: [],
    });
  });

  it('checks budget using the model video price with the configured multiplier', async () => {
    const result = await chargeBeforeGenerate({
      db: {} as any,
      generationTopicId: 'topic-1',
      model: 'veo3.1-fast',
      params: { prompt: 'make a video' },
      provider: 'newapi',
      userId: 'user-1',
    });

    expect(mocks.getServerModelPricing).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'veo3.1-fast', provider: 'newapi', type: 'video' }),
    );
    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedCredits: 250_000,
        operationId: expect.stringMatching(/^video:/),
        reservationTtlMs: 2 * 60 * 60 * 1000,
        usageType: 'video',
      }),
    );
    expect(result.prechargeResult?.estimatedCredits).toBe(577_500);
    expect(result.prechargeResult?.costDetail?.totalCost).toBe(0.25);
    expect(result.prechargeResult?.reservationId).toBe('reservation-1');
  });

  it('checks video budget with NewAPI route metadata pricing', async () => {
    mocks.reserveCommercialAiUsage.mockResolvedValue({
      amount: 750_000,
      id: 'reservation-1',
    });
    mocks.getAppSettingValue.mockImplementation(async (key: string) =>
      key === 'pricing.creditMultiplier'
        ? 1
        : [{ group: 'pro', model: 'veo3.1-fast', multiplier: 2, provider: 'newapi' }],
    );

    const result = await chargeBeforeGenerate({
      db: {} as any,
      generationTopicId: 'topic-1',
      model: 'veo3.1-fast',
      params: { prompt: 'make a video' },
      provider: 'newapi',
      routeMetadata: {
        groupKey: 'pro',
        groupMultiplier: 1.5,
      },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.reserveCommercialAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedCredits: 250_000,
        routeMetadata: {
          groupKey: 'pro',
          groupMultiplier: 1.5,
        },
        workspaceId: 'workspace-1',
      }),
    );
    expect(result.prechargeResult?.estimatedCredits).toBe(750_000);
  });
});
