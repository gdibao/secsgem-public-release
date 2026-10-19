import type { ModelRating } from 'model-bank';

import type { EnabledProviderWithModels } from '@/types/aiProvider';
import type {
  LobeHubModelCatalogPayload,
  LobeHubModelDisplayCard,
  LobeHubModelRatingsPayload,
} from '@/types/lobeHubModelCatalog';

interface ModelIdIndex<T> {
  idsByLength: string[];
  values: Map<string, T>;
}

const normalizeModelId = (modelId: string) => modelId.trim().toLowerCase();

const buildModelIdIndex = <T>(entries: Array<[string, T]>): ModelIdIndex<T> => {
  const values = new Map<string, T>();

  for (const [modelId, value] of entries) {
    const normalized = normalizeModelId(modelId);
    if (normalized) values.set(normalized, value);
  }

  return {
    idsByLength: [...values.keys()].toSorted((a, b) => b.length - a.length),
    values,
  };
};

const resolveIndexedValue = <T>(modelId: string | undefined, index: ModelIdIndex<T>) => {
  if (!modelId) return undefined;

  const normalized = normalizeModelId(modelId);
  const exact = index.values.get(normalized);
  if (exact !== undefined) return exact;

  const matchedId = index.idsByLength.find(
    (candidate) =>
      normalized.endsWith(`/${candidate}`) ||
      normalized.endsWith(`:${candidate}`) ||
      normalized.endsWith(`.${candidate}`),
  );

  return matchedId ? index.values.get(matchedId) : undefined;
};

export interface LobeHubModelCatalogIndex {
  models: ModelIdIndex<LobeHubModelDisplayCard>;
  proModels: ModelIdIndex<true>;
}

export const buildLobeHubModelCatalogIndex = (
  catalog?: LobeHubModelCatalogPayload,
): LobeHubModelCatalogIndex => ({
  models: buildModelIdIndex((catalog?.models ?? []).map((model) => [model.id, model])),
  proModels: buildModelIdIndex((catalog?.proModels ?? []).map((modelId) => [modelId, true])),
});

export const resolveLobeHubModelDisplayCard = (
  modelId: string | undefined,
  index: LobeHubModelCatalogIndex,
) => resolveIndexedValue(modelId, index.models);

export const isLobeHubProModel = (modelId: string | undefined, index: LobeHubModelCatalogIndex) =>
  resolveIndexedValue(modelId, index.proModels) === true;

export const mergeLobeHubModelDisplayMetadata = (
  enabledList: EnabledProviderWithModels[],
  catalog?: LobeHubModelCatalogPayload,
): EnabledProviderWithModels[] => {
  if (!catalog?.models.length) return enabledList;

  const index = buildLobeHubModelCatalogIndex(catalog);
  let listChanged = false;

  const nextList = enabledList.map((provider) => {
    let providerChanged = false;
    const children = provider.children.map((model) => {
      const official = resolveLobeHubModelDisplayCard(model.id, index);
      if (!official) return model;

      const abilities = { ...official.abilities, ...model.abilities };
      const nextModel = {
        ...model,
        abilities,
        contextWindowTokens: model.contextWindowTokens ?? official.contextWindowTokens,
        description: model.description ?? official.description,
        displayName: model.displayName || official.displayName,
        family: model.family ?? official.family,
        generation: model.generation ?? official.generation,
        knowledgeCutoff: model.knowledgeCutoff ?? official.knowledgeCutoff,
        releasedAt: model.releasedAt ?? official.releasedAt,
      };

      const changed =
        nextModel.contextWindowTokens !== model.contextWindowTokens ||
        nextModel.description !== model.description ||
        nextModel.displayName !== model.displayName ||
        nextModel.family !== model.family ||
        nextModel.generation !== model.generation ||
        nextModel.knowledgeCutoff !== model.knowledgeCutoff ||
        nextModel.releasedAt !== model.releasedAt ||
        Object.keys(abilities).some(
          (key) =>
            abilities[key as keyof typeof abilities] !==
            model.abilities[key as keyof typeof abilities],
        );

      if (!changed) return model;
      providerChanged = true;
      return nextModel;
    });

    if (!providerChanged) return provider;
    listChanged = true;
    return { ...provider, children };
  });

  return listChanged ? nextList : enabledList;
};

export const buildLobeHubModelRatingsIndex = (
  payload?: LobeHubModelRatingsPayload,
): ModelIdIndex<ModelRating> => buildModelIdIndex(Object.entries(payload?.ratings ?? {}));

export const resolveLobeHubModelRating = (
  modelId: string | undefined,
  index: ModelIdIndex<ModelRating>,
) => resolveIndexedValue(modelId, index);
