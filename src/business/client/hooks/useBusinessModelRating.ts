import type { ModelRating } from 'model-bank';
import { useCallback, useMemo } from 'react';

import {
  buildLobeHubModelRatingsIndex,
  resolveLobeHubModelRating,
} from '@/business/client/modelCatalog/lobeHub';

import { useLobeHubModelRatings } from './useLobeHubModelCatalog';

export interface BusinessModelRatingParams {
  model?: string;
  provider?: string;
}

export const createBusinessModelRatingResolver =
  (ratings: ReturnType<typeof buildLobeHubModelRatingsIndex>) =>
  ({ model }: BusinessModelRatingParams): ModelRating | undefined =>
    resolveLobeHubModelRating(model, ratings);

export const useBusinessModelRating = () => {
  const { data } = useLobeHubModelRatings();
  const ratings = useMemo(() => buildLobeHubModelRatingsIndex(data), [data]);

  return useCallback(createBusinessModelRatingResolver(ratings), [ratings]);
};

export const useBusinessModelRatingPrefetch = () => {
  useLobeHubModelRatings();
};
