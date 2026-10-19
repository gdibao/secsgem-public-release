import { LobeHubPath, OFFICIAL_URL } from '@lobechat/const/url';
import type { Pricing } from 'model-bank';
import { z } from 'zod';

import { getModelPricingCandidates } from './modelPricingCandidates';

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_STALE_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

const LOBEHUB_MODEL_CONFIG_URL = new URL(LobeHubPath.webapi.modelConfig, OFFICIAL_URL).toString();

const nonNegativeRateSchema = z.number().finite().nonnegative();
const pricingUnitNameSchema = z.enum([
  'textInput',
  'textOutput',
  'textInput_cacheRead',
  'textInput_cacheWrite',
  'audioInput',
  'audioOutput',
  'audioInput_cacheRead',
  'imageGeneration',
  'imageInput',
  'imageInput_cacheRead',
  'imageOutput',
  'videoInput',
  'videoGeneration',
]);
const pricingUnitTypeSchema = z.enum([
  'millionTokens',
  'millionCharacters',
  'image',
  'video',
  'megapixel',
  'second',
]);
const pricingUnitBaseSchema = z.object({
  name: pricingUnitNameSchema,
  unit: pricingUnitTypeSchema,
});
const pricingUnitSchema = z.discriminatedUnion('strategy', [
  pricingUnitBaseSchema.extend({
    originalRate: nonNegativeRateSchema.optional(),
    rate: nonNegativeRateSchema,
    strategy: z.literal('fixed'),
  }),
  pricingUnitBaseSchema.extend({
    strategy: z.literal('tiered'),
    tiers: z
      .array(
        z.object({
          originalRate: nonNegativeRateSchema.optional(),
          rate: nonNegativeRateSchema,
          upTo: z.union([nonNegativeRateSchema, z.literal('infinity')]),
        }),
      )
      .min(1)
      .max(100),
  }),
  pricingUnitBaseSchema.extend({
    lookup: z.object({
      originalPrices: z.record(z.string(), nonNegativeRateSchema).optional(),
      prices: z.record(z.string(), nonNegativeRateSchema),
      pricingParams: z.array(z.string().min(1).max(100)).max(20),
    }),
    strategy: z.literal('lookup'),
  }),
]);
const pricingSchema = z.object({
  approximatePricePerImage: nonNegativeRateSchema.optional(),
  approximatePricePerVideo: nonNegativeRateSchema.optional(),
  currency: z.enum(['CNY', 'USD']).optional(),
  units: z.array(pricingUnitSchema).max(100),
});
const officialModelSchema = z.object({
  id: z.string().trim().min(1).max(256),
  pricing: pricingSchema.optional(),
});
const lobeHubModelConfigSchema = z.object({
  models: z.array(z.unknown()).max(2000),
});

interface CachedOfficialPricing {
  fetchedAt: number;
  pricingByModel: Map<string, Pricing>;
}

let cachedPricing: CachedOfficialPricing | undefined;
let pendingCatalogRequest: Promise<CachedOfficialPricing> | undefined;

const hasUsablePricing = (pricing: Pricing) =>
  pricing.units.length > 0 ||
  pricing.approximatePricePerImage !== undefined ||
  pricing.approximatePricePerVideo !== undefined;

const fetchOfficialPricingCatalog = async (): Promise<CachedOfficialPricing> => {
  const response = await fetch(LOBEHUB_MODEL_CONFIG_URL, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`LobeHub model config returned HTTP ${response.status}`);
  }

  const parsed = lobeHubModelConfigSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('LobeHub model config returned an invalid pricing payload');
  }

  const pricingByModel = new Map<string, Pricing>();
  for (const rawModel of parsed.data.models) {
    const model = officialModelSchema.safeParse(rawModel);
    if (!model.success) continue;

    const pricing = model.data.pricing as Pricing | undefined;
    if (pricing && hasUsablePricing(pricing)) pricingByModel.set(model.data.id, pricing);
  }
  if (pricingByModel.size === 0) {
    throw new Error('LobeHub model config did not contain usable pricing');
  }

  return { fetchedAt: Date.now(), pricingByModel };
};

const loadOfficialPricingCatalog = async (): Promise<CachedOfficialPricing | undefined> => {
  const now = Date.now();
  if (cachedPricing && now - cachedPricing.fetchedAt < CACHE_TTL_MS) return cachedPricing;

  if (!pendingCatalogRequest) {
    pendingCatalogRequest = fetchOfficialPricingCatalog().finally(() => {
      pendingCatalogRequest = undefined;
    });
  }

  try {
    cachedPricing = await pendingCatalogRequest;
    return cachedPricing;
  } catch {
    return cachedPricing && now - cachedPricing.fetchedAt < MAX_STALE_AGE_MS
      ? cachedPricing
      : undefined;
  }
};

export const getLobeHubOfficialModelPricing = async (
  model: string,
): Promise<Pricing | undefined> => {
  const modelId = model.trim();
  if (!modelId) return undefined;

  const pricingByModel = (await loadOfficialPricingCatalog())?.pricingByModel;
  if (!pricingByModel) return undefined;

  for (const candidate of getModelPricingCandidates(modelId)) {
    const pricing = pricingByModel.get(candidate);
    if (pricing) return pricing;
  }

  return undefined;
};

export const invalidateLobeHubOfficialPricingCache = () => {
  cachedPricing = undefined;
  pendingCatalogRequest = undefined;
};
