import type { ModelAbilities, ModelRating } from 'model-bank';

export interface LobeHubModelDisplayCard {
  abilities?: ModelAbilities;
  contextWindowTokens?: number;
  description?: string;
  displayName?: string;
  family?: string;
  generation?: string;
  id: string;
  knowledgeCutoff?: string;
  releasedAt?: string;
}

export interface LobeHubModelCatalogPayload {
  models: LobeHubModelDisplayCard[];
  proModels: string[];
  updatedAt?: string;
  version?: number;
}

export interface LobeHubModelRatingsPayload {
  fetchedAt?: string;
  ratings: Record<string, ModelRating>;
}
