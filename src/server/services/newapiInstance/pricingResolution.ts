import { getModelPricing } from '@lobechat/model-runtime';
import type { Pricing } from 'model-bank';

import { getLobeHubOfficialModelPricing } from './lobeHubOfficialPricing';
import { getModelPricingCandidates } from './modelPricingCandidates';

export type NewapiModelPricingSource = 'database' | 'lobehub-official' | 'missing' | 'model-bank';

export interface NewapiModelPricingResolution {
  pricing?: Pricing;
  source: NewapiModelPricingSource;
}

export interface ResolveNewapiModelPricingParams {
  databasePricing?: Pricing;
  lobeHubOfficialPricingEnabled: boolean;
  model: string;
  modelBankFallbackEnabled: boolean;
  modelBankProvider?: string;
}

/**
 * Resolve the price exposed to model consumers using the same precedence as
 * commercial billing. Keeping this outside the admin router ensures the
 * runtime model catalog and billing cannot silently disagree.
 */
export const resolveNewapiModelPricing = async ({
  databasePricing,
  lobeHubOfficialPricingEnabled,
  model,
  modelBankFallbackEnabled,
  modelBankProvider,
}: ResolveNewapiModelPricingParams): Promise<NewapiModelPricingResolution> => {
  if (databasePricing) return { pricing: databasePricing, source: 'database' };

  if (lobeHubOfficialPricingEnabled) {
    try {
      const officialPricing = await getLobeHubOfficialModelPricing(model);
      if (officialPricing) return { pricing: officialPricing, source: 'lobehub-official' };
    } catch {
      // A pricing catalog outage must not make the model unavailable.
    }
  }

  if (modelBankFallbackEnabled) {
    try {
      for (const candidate of getModelPricingCandidates(model)) {
        const modelBankPricing = await getModelPricing(candidate, modelBankProvider);
        if (modelBankPricing) return { pricing: modelBankPricing, source: 'model-bank' };
      }
    } catch {
      // Keep the model visible even when the local fallback lookup fails.
    }
  }

  return { source: 'missing' };
};
