import { type AdminDependencyImpact } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import {
  adminNewapiInstanceModels,
  adminNewapiInstances,
  appSettings,
} from '@/database/schemas';
import { type LobeChatDatabase, type Transaction } from '@/database/type';
import { getRuntimeProviderId } from '@/server/services/newapiInstance';

const DEPENDENCY_SETTING_KEYS = [
  APP_SETTING_KEYS.defaultAgentModel,
  APP_SETTING_KEYS.defaultAgentProvider,
  APP_SETTING_KEYS.defaultImageModel,
  APP_SETTING_KEYS.defaultImageProvider,
  APP_SETTING_KEYS.defaultVideoModel,
  APP_SETTING_KEYS.defaultVideoProvider,
  APP_SETTING_KEYS.modelPolicyDefaultModelFallback,
  APP_SETTING_KEYS.pricingModelRules,
] as const;

export type AdminModelDependencyRoute = {
  enabled: boolean;
  groupKey: null | string;
  instanceEnabled: boolean;
  instanceId: string;
  instanceName: string;
  modelId: string;
  modelType: string;
  providerId: string;
  providerType: null | string;
};

type PlanRuleRow = { modelRules: unknown; plan: string };

export type AdminModelDependencyTarget =
  | { instanceId: string; kind: 'instance' }
  | { instanceId: string; kind: 'model'; modelId: string; modelType: string };

const normalizeText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const wildcardMatch = (pattern: string, value: string) => {
  const expression = pattern
    .split('*')
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${expression}$`, 'i').test(value);
};

const ruleEntryMatchesRoute = (entry: unknown, route: AdminModelDependencyRoute) => {
  const normalized = normalizeText(entry)?.toLowerCase();
  if (!normalized) return false;

  const separator = normalized.indexOf(':');
  if (separator < 0) return wildcardMatch(normalized, route.modelId.toLowerCase());

  const groupPattern = normalized.slice(0, separator).trim();
  const modelPattern = normalized.slice(separator + 1).trim();
  if (!groupPattern || !modelPattern) return false;

  return (
    wildcardMatch(groupPattern, (route.groupKey || 'default').toLowerCase()) &&
    wildcardMatch(modelPattern, route.modelId.toLowerCase())
  );
};

const providerMatchesRoute = (provider: string | undefined, route: AdminModelDependencyRoute) =>
  !provider ||
  provider === route.instanceId ||
  provider === route.providerId ||
  provider === route.providerType ||
  provider === 'newapi';

const toSettingsRecord = (rows: Array<{ key: string; value: unknown }>) =>
  Object.fromEntries(rows.map((row) => [row.key, row.value]));

const getTargetRoutes = (
  routes: AdminModelDependencyRoute[],
  target: AdminModelDependencyTarget,
) =>
  routes.filter(
    (route) =>
      route.instanceId === target.instanceId &&
      (target.kind === 'instance' ||
        (route.modelId === target.modelId && route.modelType === target.modelType)),
  );

export const analyzeModelDependencyImpact = ({
  instanceLabel,
  planRules,
  routes,
  settings,
  target,
  targetExists,
}: {
  instanceLabel?: string;
  planRules: PlanRuleRow[];
  routes: AdminModelDependencyRoute[];
  settings: Record<string, unknown>;
  target: AdminModelDependencyTarget;
  targetExists: boolean;
}): AdminDependencyImpact => {
  const targetRoutes = getTargetRoutes(routes, target);
  const remainingRoutes = routes.filter((route) => !targetRoutes.includes(route));
  const enabledRemainingRoutes = remainingRoutes.filter(
    (route) => route.enabled && route.instanceEnabled,
  );
  const defaultReferences = [
    {
      model: normalizeText(settings[APP_SETTING_KEYS.defaultAgentModel]),
      modelType: 'chat',
      provider: normalizeText(settings[APP_SETTING_KEYS.defaultAgentProvider]),
    },
    {
      model: normalizeText(settings[APP_SETTING_KEYS.defaultImageModel]),
      modelType: 'image',
      provider: normalizeText(settings[APP_SETTING_KEYS.defaultImageProvider]),
    },
    {
      model: normalizeText(settings[APP_SETTING_KEYS.defaultVideoModel]),
      modelType: 'video',
      provider: normalizeText(settings[APP_SETTING_KEYS.defaultVideoProvider]),
    },
  ];
  const defaultDetails = defaultReferences.flatMap(({ model, modelType, provider }) => {
    if (!model) return [];
    const removesDefaultRoute = targetRoutes.some(
      (route) =>
        route.modelId === model &&
        route.modelType === modelType &&
        providerMatchesRoute(provider, route),
    );
    const hasFallbackRoute = enabledRemainingRoutes.some(
      (route) =>
        route.modelId === model &&
        route.modelType === modelType &&
        providerMatchesRoute(provider, route),
    );

    return removesDefaultRoute && !hasFallbackRoute ? [`${modelType}:${provider || '*'}:${model}`] : [];
  });
  const fallbackModel = normalizeText(settings[APP_SETTING_KEYS.modelPolicyDefaultModelFallback]);
  const fallbackDetails =
    fallbackModel && targetRoutes.some((route) => route.modelId === fallbackModel) &&
    !enabledRemainingRoutes.some((route) => route.modelId === fallbackModel)
      ? [fallbackModel]
      : [];
  const planRuleDetails = planRules.flatMap(({ modelRules, plan }) => {
    if (!modelRules || typeof modelRules !== 'object' || Array.isArray(modelRules)) return [];

    return Object.entries(modelRules as Record<string, unknown>).flatMap(([modelType, rule]) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return [];
      const record = rule as Record<string, unknown>;
      const entries = [...(Array.isArray(record.allowlist) ? record.allowlist : []), ...(Array.isArray(record.blocklist) ? record.blocklist : [])];

      return entries.flatMap((entry) =>
        targetRoutes.some(
          (route) => route.modelType === modelType && ruleEntryMatchesRoute(entry, route),
        )
          ? [`${plan}:${modelType}:${String(entry)}`]
          : [],
      );
    });
  });
  const pricingRules = Array.isArray(settings[APP_SETTING_KEYS.pricingModelRules])
    ? (settings[APP_SETTING_KEYS.pricingModelRules] as Array<Record<string, unknown>>)
    : [];
  const pricingDetails = pricingRules.flatMap((rule, index) => {
    const referenced = targetRoutes.some(
      (route) =>
        (normalizeText(rule.instanceId) === route.instanceId ||
          normalizeText(rule.model) === route.modelId) &&
        (!normalizeText(rule.group) || normalizeText(rule.group) === route.groupKey),
    );

    return referenced ? [`pricing.modelRules[${index}]`] : [];
  });
  const blocking = [
    {
      code: 'SYSTEM_DEFAULT_MODEL_REFERENCE',
      count: defaultDetails.length,
      details: defaultDetails,
      title: 'System default model references',
    },
    {
      code: 'PLAN_MODEL_RULE_REFERENCE',
      count: planRuleDetails.length,
      details: planRuleDetails,
      title: 'Plan model rule references',
    },
    {
      code: 'PRICING_RULE_REFERENCE',
      count: pricingDetails.length,
      details: pricingDetails,
      title: 'Pricing rule references',
    },
    {
      code: 'MODEL_FALLBACK_REFERENCE',
      count: fallbackDetails.length,
      details: fallbackDetails,
      title: 'Model fallback references',
    },
  ].filter((item) => item.count > 0);
  const targetId =
    target.kind === 'instance'
      ? target.instanceId
      : `${target.instanceId}:${target.modelType}:${target.modelId}`;

  return {
    blocking,
    canProceed: targetExists && blocking.length === 0,
    immediateEffects: targetExists
      ? [
          {
            code: target.kind === 'instance' ? 'PROVIDER_INSTANCE_DELETE' : 'PROVIDER_MODEL_DELETE',
            count: target.kind === 'instance' ? 1 : targetRoutes.length,
            title:
              target.kind === 'instance' ? 'Provider instance removed' : 'Provider model route removed',
          },
        ]
      : [],
    liveEffects: targetExists
      ? [
          {
            code: 'MODEL_RUNTIME_ROUTES_REFRESH',
            count: targetRoutes.filter((route) => route.enabled && route.instanceEnabled).length,
            title: 'Live model routes removed after cache refresh',
          },
        ]
      : [],
    target: {
      id: targetId,
      label: target.kind === 'instance' ? instanceLabel || target.instanceId : target.modelId,
      type: target.kind === 'instance' ? 'provider-instance' : 'provider-model',
    },
    targetExists,
  };
};

export const getModelDependencyImpact = async (
  db: LobeChatDatabase | Transaction,
  target: AdminModelDependencyTarget,
): Promise<AdminDependencyImpact> => {
  const [instance, routeRows, settingRows, planRuleRows] = await Promise.all([
    db.query.adminNewapiInstances.findFirst({
      columns: { id: true, name: true },
      where: eq(adminNewapiInstances.id, target.instanceId),
    }),
    db
      .select({
        enabled: adminNewapiInstanceModels.enabled,
        groupKey: adminNewapiInstances.groupKey,
        instanceEnabled: adminNewapiInstances.enabled,
        instanceId: adminNewapiInstances.id,
        instanceName: adminNewapiInstances.name,
        modelId: adminNewapiInstanceModels.modelId,
        modelType: adminNewapiInstanceModels.modelType,
        providerType: adminNewapiInstances.providerType,
      })
      .from(adminNewapiInstanceModels)
      .innerJoin(
        adminNewapiInstances,
        eq(adminNewapiInstanceModels.instanceId, adminNewapiInstances.id),
      ),
    db.query.appSettings.findMany({
      columns: { key: true, value: true },
      where: inArray(appSettings.key, DEPENDENCY_SETTING_KEYS),
    }),
    db.query.planCatalog.findMany({ columns: { modelRules: true, plan: true } }),
  ]);
  const routes: AdminModelDependencyRoute[] = routeRows.map((route) => ({
    ...route,
    providerId: getRuntimeProviderId({
      instanceId: route.instanceId,
      providerType: route.providerType,
    }),
  }));
  const targetRoutes = getTargetRoutes(routes, target);

  return analyzeModelDependencyImpact({
    instanceLabel: instance?.name,
    planRules: planRuleRows,
    routes,
    settings: toSettingsRecord(settingRows),
    target,
    targetExists: target.kind === 'instance' ? Boolean(instance) : targetRoutes.length > 0,
  });
};
