import { CREDITS_PER_DOLLAR, DEFAULT_PRICING_CREDIT_MULTIPLIER } from '@lobechat/const/currency';
import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  estimateImageCharge,
  estimateVideoCharge,
  resolveGenerationPricingMultiplier,
  resolveImageChargeCredits,
  resolveVideoChargeCredits,
} from './generationBilling';

describe('generationBilling', () => {
  it('estimates image charge from detailed pricing', () => {
    const pricing: Pricing = {
      units: [
        {
          lookup: {
            prices: {
              standard_1024x1024: 0.04,
            },
            pricingParams: ['quality', 'size'],
          },
          name: 'imageGeneration',
          strategy: 'lookup',
          unit: 'image',
        },
      ],
    };

    const result = estimateImageCharge(pricing, { quality: 'standard', size: '1024x1024' }, 2);

    expect(result).toEqual({
      estimatedCredits: 80000,
      totalCost: 0.08,
    });
  });

  it('converts CNY fixed image pricing when the exact calculator is unavailable', () => {
    const pricing: Pricing = {
      currency: 'CNY',
      units: [
        {
          name: 'imageGeneration',
          rate: 7.12,
          strategy: 'fixed',
          unit: 'megapixel',
        },
      ],
    };

    const result = estimateImageCharge(pricing, {}, 1);

    expect(result.totalCost).toBeCloseTo(1.048_576);
    expect(result.estimatedCredits).toBe(1_048_576);
  });

  it('falls back to approximate video price when exact usage is unavailable', () => {
    const pricing: Pricing = {
      approximatePricePerVideo: 0.25,
      units: [],
    };

    const result = estimateVideoCharge(pricing, { generateAudio: true, resolution: '720p' });

    expect(result).toEqual({
      estimatedCredits: 250_000,
      totalCost: 0.25,
    });
  });

  it('prefers image model usage cost over fallback pricing', () => {
    const pricing: Pricing = {
      approximatePricePerImage: 0.053,
      units: [],
    };

    const credits = resolveImageChargeCredits({
      modelUsage: { cost: 0.034 },
      pricing,
    });

    expect(credits).toBe(34_000);
  });

  it('resolves video charge from actual usage tokens when available', () => {
    const pricing: Pricing = {
      units: [
        {
          name: 'videoGeneration',
          rate: 0.21,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    };

    const credits = resolveVideoChargeCredits({
      computePriceParams: { generateAudio: true, resolution: '720p' },
      prechargeResult: { estimatedCredits: CREDITS_PER_DOLLAR },
      pricing,
      usage: { completionTokens: 500_000, totalTokens: 500_000 },
    });

    expect(credits).toBe(105_000);
  });

  it('falls back to the precharge amount for video when usage is unavailable', () => {
    const pricing: Pricing = {
      approximatePricePerVideo: 0.6,
      units: [],
    };

    const credits = resolveVideoChargeCredits({
      prechargeResult: { costDetail: { totalCredits: 60_000 }, estimatedCredits: 60_000 },
      pricing,
    });

    expect(credits).toBe(60_000);
  });

  it('uses the default 35 percent pricing multiplier when settings are unavailable', async () => {
    await expect(
      resolveGenerationPricingMultiplier({
        model: 'gpt-image-2',
        provider: 'newapi',
      }),
    ).resolves.toBe(DEFAULT_PRICING_CREDIT_MULTIPLIER);
  });
});
