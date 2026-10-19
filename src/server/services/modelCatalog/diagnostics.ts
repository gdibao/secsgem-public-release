import type { PlanModelRules } from '@/database/schemas';
import type { AiProviderRuntimeState } from '@/types/aiProvider';

import {
  buildModelCatalog,
  buildModelCatalogViews,
  getModelCatalogDuplicateModelGroups,
  getModelCatalogHealth,
} from './visibleModels';

export interface ModelCatalogDiagnosticsParams {
  planRules?: PlanModelRules | null;
  state: AiProviderRuntimeState;
}

export const getModelCatalogDiagnostics = ({ planRules, state }: ModelCatalogDiagnosticsParams) => {
  const catalog = buildModelCatalog({ planRules, state });
  const health = getModelCatalogHealth(catalog);
  const hiddenByReason = catalog.reduce<Record<string, number>>((map, entry) => {
    if (entry.visible) return map;
    map[entry.visibilityReason.code] = (map[entry.visibilityReason.code] ?? 0) + 1;
    return map;
  }, {});
  const duplicateModelKeys = catalog
    .reduce<Map<string, number>>((map, entry) => {
      const key = `${entry.model.providerId}:${entry.model.id}:${entry.model.type}`;
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
    .entries();
  const duplicateModelGroups = getModelCatalogDuplicateModelGroups(catalog);
  const views = buildModelCatalogViews(catalog);

  return {
    catalog,
    views,
    health,
    hiddenByReason,
    risks: [
      ...(health.totalCount === 0
        ? [{ key: 'no_models', level: 'error' as const, message: 'No enabled AI provider models.' }]
        : []),
      ...(health.visibleCount === 0 && health.totalCount > 0
        ? [
            {
              key: 'no_visible_models',
              level: 'error' as const,
              message: 'Enabled models exist, but current plan rules do not allow any of them.',
            },
          ]
        : []),
      ...(Array.from(duplicateModelKeys)
        .filter(([, count]) => count > 1)
        .map(([key, count]) => ({
          key: `duplicate:${key}`,
          level: 'warning' as const,
          message: `Model ${key} appears ${count} times. Confirm whether it should be split by group or merged.`,
        })) ?? []),
      ...duplicateModelGroups.map((group) => ({
        key: `duplicate:${group.key}`,
        level: 'warning' as const,
        message: `Model ${group.modelId} appears ${group.count} times across providers: ${group.providers.join(
          ', ',
        )}. Keep all enabled entries visible by provider group.`,
      })),
    ],
  };
};
