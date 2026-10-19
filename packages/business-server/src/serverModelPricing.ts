import { getModelPricing } from '@lobechat/model-runtime';
import type { AiProviderModelListItem, Pricing } from 'model-bank';

import type { AiUsageRouteMetadata } from '@/database/models/commercial';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import type { LobeChatDatabase } from '@/database/type';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { getModelPricingCandidates } from '@/server/services/newapiInstance/modelPricingCandidates';
import type { ProviderConfig } from '@/types/user/settings';

import {
  type AdminNewapiModelCardResult,
  getAdminNewapiModelCard,
  resolveAdminNewapiModelPricing,
} from './adminNewapiPricing';

type ServerModelType = AiProviderModelListItem['type'];

export type ServerModelPricingParams = {
  db?: LobeChatDatabase;
  model: string;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  type?: ServerModelType;
  userId?: string;
};

export type ServerModelPricingSource = 'database' | 'lobehub-official' | 'missing' | 'model-bank';

export interface ServerModelPricingSnapshot {
  modelCard?: AiProviderModelListItem;
  pricing?: Pricing;
  source: ServerModelPricingSource;
}

type ResolvedServerModelCard = {
  adminModelCard?: AdminNewapiModelCardResult;
  adminManaged: boolean;
  modelCard?: AiProviderModelListItem;
};

const resolveServerModelCard = async ({
  db,
  model,
  provider,
  routeMetadata,
  type,
  userId,
}: ServerModelPricingParams): Promise<ResolvedServerModelCard> => {
  const adminModelCard = await getAdminNewapiModelCard({
    db,
    model,
    provider,
    routeMetadata,
    type,
  });
  if (adminModelCard) {
    return {
      adminModelCard,
      adminManaged: true,
      modelCard: adminModelCard.modelCard,
    };
  }

  if (!db || !userId) return { adminManaged: false };

  try {
    const { aiProvider } = await getServerGlobalConfig(db);
    const aiInfraRepos = new AiInfraRepos(db, userId, aiProvider as Record<string, ProviderConfig>);
    const models = await aiInfraRepos.getAiProviderModelList(provider, type ? { type } : undefined);

    return { adminManaged: false, modelCard: models.find((item) => item.id === model) };
  } catch {
    return { adminManaged: false };
  }
};

export const getServerModelCard = async (
  params: ServerModelPricingParams,
): Promise<AiProviderModelListItem | undefined> => (await resolveServerModelCard(params)).modelCard;

export const getServerModelPricingSnapshot = async (
  params: ServerModelPricingParams,
): Promise<ServerModelPricingSnapshot> => {
  const { adminManaged, adminModelCard, modelCard } = await resolveServerModelCard(params);

  if (adminManaged && adminModelCard) {
    const resolution = await resolveAdminNewapiModelPricing({
      adminModelCard,
      model: params.model,
    });
    return {
      modelCard,
      pricing: resolution.pricing,
      source: resolution.source,
    };
  }

  if (modelCard?.pricing) {
    return {
      modelCard,
      pricing: modelCard.pricing,
      source: 'database',
    };
  }

  for (const candidate of getModelPricingCandidates(params.model)) {
    const staticPricing = await getModelPricing(candidate, params.provider);
    if (staticPricing) {
      return {
        modelCard,
        pricing: staticPricing,
        source: 'model-bank',
      };
    }
  }

  return {
    modelCard,
    pricing: undefined,
    source: 'missing',
  };
};

export const getServerModelPricing = async (
  params: ServerModelPricingParams,
): Promise<Pricing | undefined> => (await getServerModelPricingSnapshot(params)).pricing;
