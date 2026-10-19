import { useCallback, useMemo } from 'react';

import {
  buildLobeHubModelCatalogIndex,
  isLobeHubProModel,
} from '@/business/client/modelCatalog/lobeHub';

import { useLobeHubModelCatalog } from './useLobeHubModelCatalog';

export interface BusinessModelListGuard {
  isModelPro?: (modelId: string, providerId: string) => boolean;
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  onBeforeModelSelect?: (modelId: string, providerId: string) => boolean | Promise<boolean>;
  onRestrictedModelClick?: () => void;
  sortModelLast?: (modelId: string, providerId: string) => boolean;
}

export const useBusinessModelListGuard = (): BusinessModelListGuard => {
  const { data } = useLobeHubModelCatalog();
  const catalog = useMemo(() => buildLobeHubModelCatalogIndex(data), [data]);
  const isModelPro = useCallback(
    (modelId: string) => isLobeHubProModel(modelId, catalog),
    [catalog],
  );

  return useMemo(() => ({ isModelPro }), [isModelPro]);
};
