import { LobeHubPath } from '@lobechat/const/url';

import { useOnlyFetchOnceSWR } from '@/libs/swr';
import type {
  LobeHubModelCatalogPayload,
  LobeHubModelRatingsPayload,
} from '@/types/lobeHubModelCatalog';

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Failed to load model display metadata: ${response.status}`);
  return response.json() as Promise<T>;
};

export const useLobeHubModelCatalog = () =>
  useOnlyFetchOnceSWR<LobeHubModelCatalogPayload>(LobeHubPath.webapi.modelConfig, () =>
    fetchJson<LobeHubModelCatalogPayload>(LobeHubPath.webapi.modelConfig),
  );

export const useLobeHubModelRatings = () =>
  useOnlyFetchOnceSWR<LobeHubModelRatingsPayload>(LobeHubPath.webapi.modelRatings, () =>
    fetchJson<LobeHubModelRatingsPayload>(LobeHubPath.webapi.modelRatings),
  );
