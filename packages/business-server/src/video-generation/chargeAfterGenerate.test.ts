import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import type * as ModelRuntimeModule from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CommercialModelModule from '@/database/models/commercial';

import { chargeAfterGenerate } from './chargeAfterGenerate';

const mocks = vi.hoisted(() => ({
  postCharge: vi.fn(),
  releaseCommercialAiUsageReservation: vi.fn(),
  settleCommercialAiUsageReservation: vi.fn(),
  shouldChargeCommercialUsage: vi.fn(),
  getModelPricing: vi.fn(),
  getAppSettingValue: vi.fn(),
}));

vi.mock('@lobechat/model-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelRuntimeModule>();
  return {
    ...actual,
    getModelPricing: mocks.getModelPricing,
  };
});

vi.mock('@/business/server/commercialBilling', () => ({
  isCommercialUsageReservationHandle: (value: any, usageType: string) =>
    value?.reservationId && value?.operationId && value?.usageType === usageType,
  releaseCommercialAiUsageReservation: mocks.releaseCommercialAiUsageReservation,
  settleCommercialAiUsageReservation: mocks.settleCommercialAiUsageReservation,
  shouldChargeCommercialUsage: mocks.shouldChargeCommercialUsage,
}));

vi.mock('@/server/services/appSettings', () => ({
  APP_SETTING_KEYS: {
    pricingCreditMultiplier: 'pricing.creditMultiplier',
    pricingModelRules: 'pricing.modelRules',
  },
  getAppSettingValue: mocks.getAppSettingValue,
}));

vi.mock('@/database/models/commercial', async (importOriginal) => {
  const actual = await importOriginal<typeof CommercialModelModule>();
  return {
    ...actual,
    CommercialModel: vi.fn().mockImplementation(() => ({
      postCharge: mocks.postCharge,
    })),
  };
});

describe('video chargeAfterGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shouldChargeCommercialUsage.mockResolvedValue(true);
    mocks.postCharge.mockResolvedValue({ id: 'ledger-1' });
    mocks.releaseCommercialAiUsageReservation.mockResolvedValue({ status: 'released' });
    mocks.settleCommercialAiUsageReservation.mockResolvedValue({ status: 'settled' });
    mocks.getAppSettingValue.mockImplementation(async (key: string) =>
      key === 'pricing.creditMultiplier' ? 1.65 : [],
    );
    mocks.getModelPricing.mockResolvedValue({
      units: [
        {
          name: 'videoGeneration',
          rate: 0.21,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    });
  });

  it('charges the actual video usage cost on successful generation', async () => {
    await chargeAfterGenerate({
      db: {} as any,
      computePriceParams: { generateAudio: true, resolution: '720p' },
      metadata: {
        asyncTaskId: 'task-1',
        generationBatchId: 'batch-1',
        modelId: 'veo3.1-fast',
      },
      model: 'veo3.1-fast',
      prechargeResult: { estimatedCredits: CREDITS_PER_DOLLAR },
      usage: { completionTokens: 500_000, totalTokens: 500_000 },
      provider: 'newapi',
      userId: 'user-1',
    });

    expect(mocks.getModelPricing).toHaveBeenCalledWith('veo3.1-fast', 'newapi');
    expect(mocks.postCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        credits: 173_250,
        referenceId: 'task-1',
        referenceType: 'video_generation',
      }),
    );
  });

  it('applies NewAPI route metadata to video pricing multiplier', async () => {
    mocks.getAppSettingValue.mockImplementation(async (key: string) =>
      key === 'pricing.creditMultiplier'
        ? 1
        : [{ group: 'pro', model: 'veo3.1-fast', multiplier: 2, provider: 'newapi' }],
    );

    await chargeAfterGenerate({
      db: {} as any,
      computePriceParams: { generateAudio: true, resolution: '720p' },
      metadata: {
        asyncTaskId: 'task-1',
        generationBatchId: 'batch-1',
        modelId: 'veo3.1-fast',
        routeMetadata: {
          groupKey: 'pro',
          groupMultiplier: 1.5,
          providerType: 'newapi',
        },
      },
      model: 'veo3.1-fast',
      prechargeResult: { estimatedCredits: CREDITS_PER_DOLLAR },
      provider: 'newapi',
      usage: { completionTokens: 500_000, totalTokens: 500_000 },
      userId: 'user-1',
    });

    expect(mocks.postCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        credits: 315_000,
      }),
    );
  });

  it('falls back to the precharge amount when usage is unavailable', async () => {
    await chargeAfterGenerate({
      db: {} as any,
      metadata: {
        asyncTaskId: 'task-1',
        generationBatchId: 'batch-1',
        modelId: 'veo3.1-fast',
      },
      model: 'veo3.1-fast',
      prechargeResult: { costDetail: { totalCredits: 60_000 } },
      provider: 'newapi',
      userId: 'user-1',
    });

    expect(mocks.postCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        credits: 60_000,
      }),
    );
  });

  it('does not deduct credits on failed generation because preCharge only checks budget', async () => {
    await chargeAfterGenerate({
      db: {} as any,
      isError: true,
      metadata: {
        asyncTaskId: 'task-1',
        generationBatchId: 'batch-1',
        modelId: 'veo3.1-fast',
      },
      model: 'veo3.1-fast',
      prechargeResult: { estimatedCredits: CREDITS_PER_DOLLAR },
      provider: 'newapi',
      userId: 'user-1',
    });

    expect(mocks.postCharge).not.toHaveBeenCalled();
  });

  it('settles a workspace video reservation instead of charging the member', async () => {
    await chargeAfterGenerate({
      computePriceParams: { generateAudio: true, resolution: '720p' },
      db: {} as any,
      metadata: {
        asyncTaskId: 'task-1',
        generationBatchId: 'batch-1',
        modelId: 'veo3.1-fast',
      },
      model: 'veo3.1-fast',
      prechargeResult: {
        estimatedCredits: 200_000,
        operationId: 'video:request-1',
        reservationId: 'reservation-1',
        usageType: 'video',
      },
      provider: 'newapi',
      usage: { completionTokens: 500_000, totalTokens: 500_000 },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.settleCommercialAiUsageReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        actualCredits: 173_250,
        estimatedCredits: 200_000,
        operationId: 'video:request-1',
        reservationId: 'reservation-1',
        usageType: 'video',
      }),
    );
    expect(mocks.postCharge).not.toHaveBeenCalled();
  });

  it('releases a video reservation after generation failure', async () => {
    await chargeAfterGenerate({
      db: {} as any,
      isError: true,
      metadata: {
        asyncTaskId: 'task-1',
        generationBatchId: 'batch-1',
        modelId: 'veo3.1-fast',
      },
      model: 'veo3.1-fast',
      prechargeResult: {
        estimatedCredits: 200_000,
        operationId: 'video:request-1',
        reservationId: 'reservation-1',
        usageType: 'video',
      },
      provider: 'newapi',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.releaseCommercialAiUsageReservation).toHaveBeenCalledWith({
      db: {},
      reason: 'video_generation_failed',
      reservationId: 'reservation-1',
    });
  });
});
