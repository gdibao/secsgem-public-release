import {
  isModelAllowedByPlanRules,
  type PlanModelRuleType,
} from '@/business/server/planModelRules';
import type { PlanModelRules } from '@/database/schemas';
import type { AiProviderRuntimeState } from '@/types/aiProvider';

type RuntimeModel = AiProviderRuntimeState['enabledAiModels'][number] & {
  displayName?: string | null;
  groupKey?: string | null;
  groupName?: string | null;
  instanceId?: string | null;
  instanceName?: string | null;
  name?: string | null;
  providerName?: string | null;
  providerType?: string | null;
};

export interface ModelVisibilityReason {
  code: 'disabled_by_plan_rule' | 'visible' | 'wrong_provider' | 'wrong_type';
  message: string;
}

export interface ModelCatalogEntry {
  groupKey?: string | null;
  groupName?: string | null;
  instanceId?: string | null;
  instanceName?: string | null;
  model: RuntimeModel;
  providerType?: string | null;
  visibilityReason: ModelVisibilityReason;
  visible: boolean;
}

export interface ModelCatalogView {
  abilities: unknown;
  displayName: string;
  enabled: boolean;
  modelId: string;
  pricing: unknown;
  providerId: string;
  providerName: string;
  restricted: boolean;
  source: unknown;
  type: string;
}

export interface ModelCatalogDuplicateModelGroup {
  count: number;
  key: string;
  modelId: string;
  providers: string[];
  type: string;
}

export interface ResolveVisibleModelCatalogParams {
  modelType?: PlanModelRuleType;
  planRules?: PlanModelRules | null;
  providerId?: string;
  state: AiProviderRuntimeState;
}

const getModelType = (model: RuntimeModel) => model.type as PlanModelRuleType;

const UUID_RE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== 'string') continue;

    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
};

export const resolveModelCatalogProviderDisplayName = (entry: ModelCatalogEntry) =>
  pickString(
    entry.instanceName,
    entry.groupName,
    entry.model.instanceName,
    entry.model.groupName,
    entry.model.providerName,
    entry.providerType,
    entry.model.providerType,
    entry.model.providerId && !UUID_RE.test(entry.model.providerId)
      ? entry.model.providerId
      : undefined,
  ) || 'Custom provider';

export const resolveModelCatalogModelDisplayName = (entry: ModelCatalogEntry) =>
  pickString(entry.model.displayName, entry.model.name, entry.model.id) || 'Untitled model';

export const buildModelCatalogViews = (catalog: ModelCatalogEntry[]): ModelCatalogView[] =>
  catalog.map((entry) => {
    const model = entry.model as RuntimeModel & {
      abilities?: unknown;
      pricing?: unknown;
      source?: unknown;
    };

    return {
      abilities: model.abilities ?? null,
      displayName: resolveModelCatalogModelDisplayName(entry),
      enabled: model.enabled !== false,
      modelId: model.id,
      pricing: model.pricing ?? null,
      providerId: model.providerId,
      providerName: resolveModelCatalogProviderDisplayName(entry),
      restricted: !entry.visible,
      source: model.source ?? model.providerType ?? null,
      type: String(model.type || 'unknown'),
    };
  });

const resolveVisibilityReason = (
  model: RuntimeModel,
  params: Pick<ResolveVisibleModelCatalogParams, 'modelType' | 'planRules' | 'providerId'>,
): ModelVisibilityReason => {
  if (params.providerId && model.providerId !== params.providerId) {
    return { code: 'wrong_provider', message: 'Model belongs to a different AI provider.' };
  }

  if (params.modelType && getModelType(model) !== params.modelType) {
    return { code: 'wrong_type', message: 'Model type does not match this entry point.' };
  }

  const allowed = isModelAllowedByPlanRules(
    params.planRules,
    model.id,
    getModelType(model),
    model.groupKey,
  );

  if (!allowed) {
    return {
      code: 'disabled_by_plan_rule',
      message: 'Current plan rules do not allow this model.',
    };
  }

  return { code: 'visible', message: 'Model is enabled and visible for the current plan.' };
};

export const buildModelCatalog = (
  params: ResolveVisibleModelCatalogParams,
): ModelCatalogEntry[] => {
  return params.state.enabledAiModels.map((model) => {
    const runtimeModel = model as RuntimeModel;
    const visibilityReason = resolveVisibilityReason(runtimeModel, params);

    return {
      groupKey: runtimeModel.groupKey,
      groupName: runtimeModel.groupName,
      instanceId: runtimeModel.instanceId,
      instanceName: runtimeModel.instanceName,
      model: runtimeModel,
      providerType: runtimeModel.providerType,
      visible: visibilityReason.code === 'visible',
      visibilityReason,
    };
  });
};

const filterProvidersByModels = (
  providers: AiProviderRuntimeState['enabledAiProviders'],
  models: RuntimeModel[],
  modelType?: PlanModelRuleType,
) =>
  providers.filter((provider) =>
    models.some(
      (model) =>
        model.providerId === provider.id && (!modelType || getModelType(model) === modelType),
    ),
  );

export const resolveVisibleAiProviderRuntimeState = (
  params: ResolveVisibleModelCatalogParams,
): AiProviderRuntimeState => {
  const catalog = buildModelCatalog(params);
  const enabledAiModels = catalog.filter((entry) => entry.visible).map((entry) => entry.model);

  return {
    ...params.state,
    enabledAiModels,
    enabledAiProviders: filterProvidersByModels(params.state.enabledAiProviders, enabledAiModels),
    enabledChatAiProviders: filterProvidersByModels(
      params.state.enabledChatAiProviders,
      enabledAiModels,
      'chat',
    ),
    enabledImageAiProviders: filterProvidersByModels(
      params.state.enabledImageAiProviders,
      enabledAiModels,
      'image',
    ),
    enabledVideoAiProviders: filterProvidersByModels(
      params.state.enabledVideoAiProviders,
      enabledAiModels,
      'video',
    ),
  };
};

export const getModelCatalogHealth = (catalog: ModelCatalogEntry[]) => {
  const visibleCount = catalog.filter((entry) => entry.visible).length;
  const hiddenByPlanCount = catalog.filter(
    (entry) => entry.visibilityReason.code === 'disabled_by_plan_rule',
  ).length;
  const modelTypes = new Set(catalog.map((entry) => entry.model.type));

  return {
    hiddenByPlanCount,
    modelTypeCount: modelTypes.size,
    totalCount: catalog.length,
    visibleCount,
  };
};

export const getModelCatalogDuplicateModelGroups = (
  catalog: ModelCatalogEntry[],
): ModelCatalogDuplicateModelGroup[] => {
  const groups = catalog.reduce<
    Map<
      string,
      {
        count: number;
        modelId: string;
        providerIdentities: Set<string>;
        providers: Set<string>;
        type: string;
      }
    >
  >((map, entry) => {
    const type = String(entry.model.type || 'unknown');
    const modelId = entry.model.id;
    const key = `${type}:${modelId}`;
    const providerLabel = resolveModelCatalogProviderDisplayName(entry);
    const providerIdentity =
      entry.instanceId || entry.model.instanceId || entry.model.providerId || providerLabel;
    const group =
      map.get(key) ||
      ({
        count: 0,
        modelId,
        providerIdentities: new Set<string>(),
        providers: new Set<string>(),
        type,
      } satisfies {
        count: number;
        modelId: string;
        providerIdentities: Set<string>;
        providers: Set<string>;
        type: string;
      });

    group.count += 1;
    group.providerIdentities.add(providerIdentity);
    group.providers.add(providerLabel);
    map.set(key, group);
    return map;
  }, new Map());

  return Array.from(groups.entries())
    .filter(([, group]) => group.count > 1 && group.providerIdentities.size > 1)
    .map(([key, group]) => ({
      count: group.count,
      key,
      modelId: group.modelId,
      providers: Array.from(group.providers),
      type: group.type,
    }));
};
