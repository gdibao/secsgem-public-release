import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { applyBusinessModelPricing } from './useBusinessModelPricing';

describe('applyBusinessModelPricing', () => {
  it('returns undefined pricing unchanged', () => {
    expect(applyBusinessModelPricing({ pricing: undefined })).toBeUndefined();
  });

  it('returns the same pricing object when no margin or multiplier is provided', () => {
    const pricing: Pricing = {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
    };

    expect(applyBusinessModelPricing({ pricing })).toBe(pricing);
  });

  it('applies a 35 percent profit margin to known price fields without mutating input', () => {
    const pricing: Pricing = {
      approximatePricePerImage: 0.02,
      approximatePricePerVideo: 0.5,
      currency: 'USD',
      units: [
        {
          name: 'textInput',
          originalRate: 2,
          rate: 1,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 3, upTo: 128_000 },
            { rate: 6, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              high: 0.08,
              low: 0.04,
            },
            pricingParams: ['quality'],
          },
          name: 'imageGeneration',
          strategy: 'lookup',
          unit: 'image',
        },
      ],
    };

    const result = applyBusinessModelPricing({ pricing, profitMarginRate: 0.35 });

    expect(result).toEqual({
      approximatePricePerImage: 0.027,
      approximatePricePerVideo: 0.675,
      currency: 'USD',
      units: [
        {
          name: 'textInput',
          originalRate: 2.7,
          rate: 1.35,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 4.05, upTo: 128_000 },
            { rate: 8.1, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              high: 0.108,
              low: 0.054,
            },
            pricingParams: ['quality'],
          },
          name: 'imageGeneration',
          strategy: 'lookup',
          unit: 'image',
        },
      ],
    });
    expect(pricing.units[0]).toEqual({
      name: 'textInput',
      originalRate: 2,
      rate: 1,
      strategy: 'fixed',
      unit: 'millionTokens',
    });
  });

  it('lets an explicit multiplier override the margin rate', () => {
    const pricing: Pricing = {
      currency: 'USD',
      units: [{ name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' }],
    };

    expect(
      applyBusinessModelPricing({ priceMultiplier: 2, pricing, profitMarginRate: 0.35 }),
    ).toEqual({
      currency: 'USD',
      units: [{ name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' }],
    });
  });
});
