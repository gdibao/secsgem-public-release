import type { FixedPricingUnit, LookupPricingUnit, Pricing, PricingUnit, TieredPricingUnit } from 'model-bank';

export interface BusinessModelPricingParams {
  model?: string;
  priceMultiplier?: number;
  pricing?: Pricing;
  profitMarginRate?: number;
  provider?: string;
}

const PRICE_DECIMALS = 12;

const multiplyPrice = (value: number | undefined, multiplier: number) =>
  typeof value === 'number' ? Number((value * multiplier).toFixed(PRICE_DECIMALS)) : value;

const resolvePriceMultiplier = ({
  priceMultiplier,
  profitMarginRate,
}: Pick<BusinessModelPricingParams, 'priceMultiplier' | 'profitMarginRate'>) => {
  if (typeof priceMultiplier === 'number' && Number.isFinite(priceMultiplier))
    return priceMultiplier;

  if (typeof profitMarginRate === 'number' && Number.isFinite(profitMarginRate))
    return 1 + profitMarginRate;

  return undefined;
};

const applyFixedUnitMultiplier = (
  unit: FixedPricingUnit,
  multiplier: number,
): FixedPricingUnit => ({
  ...unit,
  originalRate: multiplyPrice(unit.originalRate, multiplier),
  rate: multiplyPrice(unit.rate, multiplier) ?? unit.rate,
});

const applyTieredUnitMultiplier = (
  unit: TieredPricingUnit,
  multiplier: number,
): TieredPricingUnit => ({
  ...unit,
  tiers: unit.tiers.map((tier) => ({
    ...tier,
    rate: multiplyPrice(tier.rate, multiplier) ?? tier.rate,
  })),
});

const applyLookupUnitMultiplier = (
  unit: LookupPricingUnit,
  multiplier: number,
): LookupPricingUnit => ({
  ...unit,
  lookup: {
    ...unit.lookup,
    prices: Object.fromEntries(
      Object.entries(unit.lookup.prices).map(([key, value]) => [
        key,
        multiplyPrice(value, multiplier) ?? value,
      ]),
    ),
  },
});

const applyPricingUnitMultiplier = (unit: PricingUnit, multiplier: number): PricingUnit => {
  switch (unit.strategy) {
    case 'fixed': {
      return applyFixedUnitMultiplier(unit, multiplier);
    }

    case 'lookup': {
      return applyLookupUnitMultiplier(unit, multiplier);
    }

    case 'tiered': {
      return applyTieredUnitMultiplier(unit, multiplier);
    }

    default: {
      return unit;
    }
  }
};

export const applyBusinessModelPricing = ({
  priceMultiplier,
  pricing,
  profitMarginRate,
}: BusinessModelPricingParams) => {
  if (!pricing) return pricing;

  const multiplier = resolvePriceMultiplier({ priceMultiplier, profitMarginRate });
  if (multiplier === undefined) return pricing;

  return {
    ...pricing,
    approximatePricePerImage: multiplyPrice(pricing.approximatePricePerImage, multiplier),
    approximatePricePerVideo: multiplyPrice(pricing.approximatePricePerVideo, multiplier),
    units: pricing.units.map((unit) => applyPricingUnitMultiplier(unit, multiplier)),
  };
};

export const useBusinessModelPricing = () => applyBusinessModelPricing;

export const useBusinessModelPricingPrefetch = () => {};
