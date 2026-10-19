import debug from 'debug';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AiModelType, ModelAbilities, Pricing } from 'model-bank';
import { normalizeAiModelType } from 'model-bank';

import { isModelAllowedByPlanRules, resolvePlanModelRules } from '@/business/server/planModelRules';
import { type AiUsageRouteMetadata } from '@/database/models/commercial';
import { adminNewapiInstanceModels, adminNewapiInstances } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

import {
  maybeBackfillPlaintextAdminProviderApiKey,
  tryDecryptAdminProviderApiKey,
} from './credentials';
import {
  resolveAdminProviderPricingPolicy,
  resolveModelBankProviderForAdminType,
} from './pricingPolicy';
import { resolveNewapiModelPricing } from './pricingResolution';

const log = debug('newapi-instance:runtime');

export type NewapiModelType =
  'chat' | 'embedding' | 'tts' | 'asr' | 'stt' | 'image' | 'video' | 'text2music' | 'realtime';

const getCompatibleNewapiModelTypes = (modelType: NewapiModelType): NewapiModelType[] => {
  const normalized = normalizeAiModelType(modelType) as AiModelType | NewapiModelType;
  return normalized === 'asr' ? ['asr', 'stt'] : [modelType];
};

export const toAiModelType = (modelType: NewapiModelType): AiModelType =>
  normalizeAiModelType(modelType) as AiModelType;

export type AdminModelApiProviderType =
  | 'newapi'
  | 'sub2api'
  | 'openai-compatible'
  | 'openai'
  | 'claude'
  | 'deepseek'
  | 'aliyun'
  | 'opencode-go'
  | 'siliconflow';

export interface ResolvedNewapiInstance {
  apiKey: string;
  baseUrl: string;
  groupKey: string;
  groupMultiplier?: number | null;
  groupName?: string | null;
  instanceId: string;
  instanceName: string;
  priority: number;
  providerType: AdminModelApiProviderType;
  source: 'instance';
}

export const getRuntimeProviderId = (
  instance?: Pick<ResolvedNewapiInstance, 'instanceId' | 'providerType'> | null,
) => instance?.instanceId || instance?.providerType || 'newapi';

export const buildNewapiRouteMetadata = (
  instance?: Partial<ResolvedNewapiInstance> | null,
): AiUsageRouteMetadata | undefined => {
  if (!instance) return undefined;

  return {
    ...(instance.groupKey ? { groupKey: instance.groupKey } : {}),
    ...(instance.groupMultiplier === null || instance.groupMultiplier === undefined
      ? {}
      : { groupMultiplier: instance.groupMultiplier }),
    ...(instance.groupName ? { groupName: instance.groupName } : {}),
    ...(instance.instanceId ? { instanceId: instance.instanceId } : {}),
    ...(instance.instanceName ? { instanceName: instance.instanceName } : {}),
    ...(instance.providerType ? { providerType: instance.providerType } : {}),
  };
};

const TTL_MS = 30_000;
let cache: { at: number; rows: InstanceRowCache[] } | null = null;

interface InstanceRowCache {
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  groupKey: string;
  groupMultiplier?: number | null;
  groupName?: string | null;
  id: string;
  name: string;
  priority: number;
  providerType?: AdminModelApiProviderType | null;
  usageScope?: NewapiModelType[] | null;
}

const decryptRuntimeRows = async <T extends { apiKey: string; id: string }>(
  db: LobeChatDatabase,
  rows: T[],
): Promise<Array<T & { apiKey: string }>> => {
  const decryptedRows: Array<T & { apiKey: string }> = [];

  for (const row of rows) {
    const result = await tryDecryptAdminProviderApiKey(row.apiKey);
    if (!result.ok) {
      log('skipped instance %s with invalid API key: %s', row.id, result.error.message);
      continue;
    }

    await maybeBackfillPlaintextAdminProviderApiKey(db, {
      apiKey: row.apiKey,
      instanceId: row.id,
    });

    decryptedRows.push({
      ...row,
      apiKey: result.apiKey,
    });
  }

  return decryptedRows;
};

const readEnabledInstances = async (db: LobeChatDatabase): Promise<InstanceRowCache[]> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  try {
    const rows = await db
      .select({
        apiKey: adminNewapiInstances.apiKey,
        baseUrl: adminNewapiInstances.baseUrl,
        enabled: adminNewapiInstances.enabled,
        groupKey: adminNewapiInstances.groupKey,
        groupMultiplier: adminNewapiInstances.groupMultiplier,
        groupName: adminNewapiInstances.groupName,
        id: adminNewapiInstances.id,
        name: adminNewapiInstances.name,
        priority: adminNewapiInstances.priority,
        providerType: adminNewapiInstances.providerType,
        usageScope: adminNewapiInstances.usageScope,
      })
      .from(adminNewapiInstances)
      .where(eq(adminNewapiInstances.enabled, true))
      .orderBy(asc(adminNewapiInstances.priority));
    const decryptedRows = await decryptRuntimeRows(db, rows);
    cache = { at: Date.now(), rows: decryptedRows };
    return decryptedRows;
  } catch {
    cache = { at: Date.now(), rows: [] };
    return [];
  }
};

export const invalidateNewapiInstancesCache = () => {
  cache = null;
};

interface ResolveNewapiInstancesParams {
  modelId?: string | null;
  modelType?: NewapiModelType;
  preferredGroupKey?: string | null;
  preferredInstanceId?: string | null;
  userId?: string;
}

interface NewapiRouteRow {
  apiKey: string;
  baseUrl: string;
  groupKey?: string | null;
  groupMultiplier?: number | null;
  groupName?: string | null;
  id: string;
  name: string;
  priority: number;
  providerType?: AdminModelApiProviderType | null;
  usageScope?: NewapiModelType[] | null;
}

const toResolvedInstance = (row: NewapiRouteRow): ResolvedNewapiInstance => ({
  apiKey: row.apiKey,
  baseUrl: row.baseUrl,
  groupKey: row.groupKey || 'default',
  groupMultiplier: row.groupMultiplier,
  groupName: row.groupName,
  instanceId: row.id,
  instanceName: row.name,
  priority: row.priority,
  providerType: row.providerType || 'newapi',
  source: 'instance',
});

const usageScopeAllows = (
  usageScope: NewapiModelType[] | null | undefined,
  modelType: NewapiModelType,
) => {
  if (!Array.isArray(usageScope) || usageScope.length === 0) return true;
  const compatibleTypes = getCompatibleNewapiModelTypes(modelType);
  return usageScope.some((type) => compatibleTypes.includes(type));
};

/**
 * Resolve the NewAPI instances that can serve a given model.
 *
 * Selection order: enabled instance(s) that have the (modelId, modelType)
 * registered and enabled, sorted by ascending priority (lower wins) for failover.
 */
export const resolveNewapiInstancesForModel = async (
  db: LobeChatDatabase,
  modelIdOrParams: string | undefined | null | ResolveNewapiInstancesParams,
  legacyModelType: NewapiModelType = 'chat',
): Promise<ResolvedNewapiInstance[]> => {
  const rawParams = modelIdOrParams as any;
  const params: ResolveNewapiInstancesParams =
    typeof rawParams === 'object' && rawParams !== null
      ? rawParams
      : { modelId: rawParams, modelType: legacyModelType };
  const modelType = params.modelType ?? 'chat';
  const compatibleModelTypes = getCompatibleNewapiModelTypes(modelType);
  const preferredGroupKey = params.preferredGroupKey?.trim();
  const preferredInstanceId = params.preferredInstanceId?.trim();
  const trimmedModel = params.modelId?.trim();

  if (trimmedModel) {
    const rows: NewapiRouteRow[] = await db
      .select({
        apiKey: adminNewapiInstances.apiKey,
        baseUrl: adminNewapiInstances.baseUrl,
        groupKey: adminNewapiInstances.groupKey,
        groupMultiplier: adminNewapiInstances.groupMultiplier,
        groupName: adminNewapiInstances.groupName,
        id: adminNewapiInstances.id,
        name: adminNewapiInstances.name,
        priority: adminNewapiInstances.priority,
        providerType: adminNewapiInstances.providerType,
        usageScope: adminNewapiInstances.usageScope,
      })
      .from(adminNewapiInstanceModels)
      .innerJoin(
        adminNewapiInstances,
        eq(adminNewapiInstanceModels.instanceId, adminNewapiInstances.id),
      )
      .where(
        and(
          eq(adminNewapiInstances.enabled, true),
          eq(adminNewapiInstanceModels.enabled, true),
          eq(adminNewapiInstanceModels.modelId, trimmedModel),
          inArray(adminNewapiInstanceModels.modelType, compatibleModelTypes),
        ),
      )
      .orderBy(asc(adminNewapiInstances.priority));

    if (rows.length > 0) {
      const decryptedRows = await decryptRuntimeRows(db, rows);
      const rules = params.userId
        ? await resolvePlanModelRules({ db, userId: params.userId })
        : null;

      const allowedRows = decryptedRows.filter((row) => {
        const groupKey = row.groupKey || 'default';
        if (preferredInstanceId && row.id !== preferredInstanceId) return false;
        if (preferredGroupKey && groupKey !== preferredGroupKey) return false;
        if (!usageScopeAllows(row.usageScope, modelType)) return false;

        return isModelAllowedByPlanRules(rules, trimmedModel, toAiModelType(modelType), groupKey);
      });

      const selectedGroupKey = preferredGroupKey || allowedRows[0]?.groupKey || 'default';
      return allowedRows
        .filter((row) => (row.groupKey || 'default') === selectedGroupKey)
        .map(toResolvedInstance);
    }
  }

  return [];
};

export const resolveNewapiInstanceByProviderId = async (
  db: LobeChatDatabase,
  providerId: string,
): Promise<ResolvedNewapiInstance | null> => {
  const row = (await readEnabledInstances(db)).find((item) => item.id === providerId);
  return row ? toResolvedInstance(row) : null;
};

/**
 * Pick the highest-priority enabled instance, ignoring per-model registration.
 * Used when the call has no specific model (e.g. listing models, pulling models).
 */
export const resolveDefaultNewapiInstance = async (
  db: LobeChatDatabase,
): Promise<ResolvedNewapiInstance | null> => {
  const rows = await readEnabledInstances(db);
  if (rows.length > 0) {
    const r = rows.find((row) => (row.groupKey || 'default') === 'default') ?? rows[0];
    return toResolvedInstance(r);
  }

  return null;
};

export const resolveNewapiRouteMetadataForModel = async (
  db: LobeChatDatabase,
  params: ResolveNewapiInstancesParams,
): Promise<AiUsageRouteMetadata | undefined> => {
  const [primary] = await resolveNewapiInstancesForModel(db, params);
  return buildNewapiRouteMetadata(primary);
};

export interface EnabledModelEntry {
  abilities?: ModelAbilities;
  displayName: string | null;
  groupKey?: string | null;
  groupName?: string | null;
  id: string;
  instanceId?: string | null;
  instanceName?: string | null;
  pricing?: Pricing;
  providerId?: string | null;
  providerType?: AdminModelApiProviderType | null;
  type: NewapiModelType;
}

const ABILITY_KEYS: Array<keyof ModelAbilities> = [
  'vision',
  'files',
  'imageOutput',
  'video',
  'audio',
  'functionCall',
  'reasoning',
  'search',
  'structuredOutput',
];

const toPositiveNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const resolveManualPricing = (
  metadata: Record<string, unknown> | null | undefined,
  modelType: NewapiModelType,
): Pricing | undefined => {
  const manualPricing =
    metadata?.manualPricing && typeof metadata.manualPricing === 'object'
      ? (metadata.manualPricing as Record<string, unknown>)
      : undefined;
  if (!manualPricing) return undefined;

  const inputRate =
    toPositiveNumber(manualPricing.inputRate) ?? toPositiveNumber(manualPricing.inputCostRate);
  const outputRate =
    toPositiveNumber(manualPricing.outputRate) ?? toPositiveNumber(manualPricing.outputCostRate);
  const imageRate = toPositiveNumber(manualPricing.imageRate);
  const videoRate = toPositiveNumber(manualPricing.videoRate);

  if (modelType === 'image' && imageRate) {
    return {
      approximatePricePerImage: imageRate,
      units: [
        {
          name: 'imageGeneration' as const,
          originalRate: imageRate,
          rate: imageRate,
          strategy: 'fixed' as const,
          unit: 'image' as const,
        },
      ],
    };
  }

  if (modelType === 'video' && videoRate) {
    return {
      approximatePricePerVideo: videoRate,
      units: [],
    };
  }

  if (inputRate || outputRate) {
    return {
      units: [
        ...(inputRate
          ? [
              {
                originalRate: inputRate,
                name: 'textInput' as const,
                rate: inputRate,
                strategy: 'fixed' as const,
                unit: 'millionTokens' as const,
              },
            ]
          : []),
        ...(outputRate
          ? [
              {
                originalRate: outputRate,
                name: 'textOutput' as const,
                rate: outputRate,
                strategy: 'fixed' as const,
                unit: 'millionTokens' as const,
              },
            ]
          : []),
      ],
    };
  }

  if (imageRate) {
    return {
      approximatePricePerImage: imageRate,
      units: [
        {
          name: 'imageGeneration' as const,
          originalRate: imageRate,
          rate: imageRate,
          strategy: 'fixed' as const,
          unit: 'image' as const,
        },
      ],
    };
  }

  if (videoRate) {
    return {
      approximatePricePerVideo: videoRate,
      units: [],
    };
  }

  return undefined;
};

const readStoredAbilities = (value: unknown): ModelAbilities | undefined => {
  const storedAbilities =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  if (!storedAbilities) return undefined;

  const abilities = ABILITY_KEYS.reduce<ModelAbilities>((map, key) => {
    if (typeof storedAbilities[key] === 'boolean') {
      map[key] = storedAbilities[key] as boolean;
    }
    return map;
  }, {});

  return Object.keys(abilities).length > 0 ? abilities : undefined;
};

const resolveStoredAbilities = (
  metadata: Record<string, unknown> | null | undefined,
): ModelAbilities | undefined => {
  const syncedAbilities = readStoredAbilities(metadata?.syncedAbilities);
  const manualAbilities = readStoredAbilities(metadata?.manualAbilities);
  if (!syncedAbilities && !manualAbilities) return undefined;

  return { ...syncedAbilities, ...manualAbilities };
};

export const resolveNewapiModelPricingFromMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  modelType: NewapiModelType,
  options: { includeSyncedPricing?: boolean } = {},
): Pricing | undefined => {
  const manualPricing = resolveManualPricing(metadata, modelType);
  if (manualPricing) return manualPricing;

  if (options.includeSyncedPricing !== false) {
    const syncedPricing = metadata?.syncedPricing;
    if (
      syncedPricing &&
      typeof syncedPricing === 'object' &&
      !Array.isArray(syncedPricing) &&
      Array.isArray((syncedPricing as Pricing).units)
    ) {
      return syncedPricing as Pricing;
    }
  } else {
    return undefined;
  }

  const quotaType = Number(metadata?.quotaType);
  const modelPrice = toPositiveNumber(metadata?.modelPrice);
  const modelRatio = toPositiveNumber(metadata?.modelRatio);
  const completionRatio = toPositiveNumber(metadata?.completionRatio) ?? 1;

  if (quotaType === 0) {
    const inputRate = modelPrice ? modelPrice * 2 : modelRatio ? modelRatio * 2 : undefined;
    if (!inputRate) return undefined;
    const audioRatio = toPositiveNumber(metadata?.audioRatio);
    const audioCompletionRatio =
      toPositiveNumber(metadata?.audioCompletionRatio) ?? completionRatio;
    const cacheRatio = toPositiveNumber(metadata?.cacheRatio);
    const createCacheRatio = toPositiveNumber(metadata?.createCacheRatio);
    const imageRatio = toPositiveNumber(metadata?.imageRatio);

    return {
      units: [
        { name: 'textInput', rate: inputRate, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          rate: inputRate * completionRatio,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
        ...(cacheRatio
          ? [
              {
                name: 'textInput_cacheRead' as const,
                rate: inputRate * cacheRatio,
                strategy: 'fixed' as const,
                unit: 'millionTokens' as const,
              },
            ]
          : []),
        ...(createCacheRatio
          ? [
              {
                name: 'textInput_cacheWrite' as const,
                rate: inputRate * createCacheRatio,
                strategy: 'fixed' as const,
                unit: 'millionTokens' as const,
              },
            ]
          : []),
        ...(audioRatio
          ? [
              {
                name: 'audioInput' as const,
                rate: inputRate * audioRatio,
                strategy: 'fixed' as const,
                unit: 'millionTokens' as const,
              },
              {
                name: 'audioOutput' as const,
                rate: inputRate * audioRatio * audioCompletionRatio,
                strategy: 'fixed' as const,
                unit: 'millionTokens' as const,
              },
            ]
          : []),
        ...(imageRatio
          ? [
              {
                name: 'imageInput' as const,
                rate: inputRate * imageRatio,
                strategy: 'fixed' as const,
                unit: 'millionTokens' as const,
              },
            ]
          : []),
      ],
    };
  }

  if (quotaType === 1 && modelPrice) {
    if (modelType === 'image') {
      return {
        approximatePricePerImage: modelPrice,
        units: [{ name: 'imageGeneration', rate: modelPrice, strategy: 'fixed', unit: 'image' }],
      };
    }

    if (modelType === 'video') {
      return {
        approximatePricePerVideo: modelPrice,
        units: [],
      };
    }
  }

  return undefined;
};

/**
 * Read all enabled models across all enabled instances with their types and
 * display names. Used by globalConfig to inject the full model list (all 8
 * types) into the frontend.
 */
export const getAllEnabledModels = async (db?: LobeChatDatabase): Promise<EnabledModelEntry[]> => {
  if (!db) return [];
  try {
    const rows = await db
      .select({
        modelId: adminNewapiInstanceModels.modelId,
        modelType: adminNewapiInstanceModels.modelType,
        displayName: adminNewapiInstanceModels.displayName,
        groupKey: adminNewapiInstances.groupKey,
        groupName: adminNewapiInstances.groupName,
        instanceId: adminNewapiInstances.id,
        instanceMetadata: adminNewapiInstances.metadata,
        instanceName: adminNewapiInstances.name,
        metadata: adminNewapiInstanceModels.metadata,
        providerType: adminNewapiInstances.providerType,
      })
      .from(adminNewapiInstanceModels)
      .innerJoin(
        adminNewapiInstances,
        eq(adminNewapiInstanceModels.instanceId, adminNewapiInstances.id),
      )
      .where(
        and(eq(adminNewapiInstances.enabled, true), eq(adminNewapiInstanceModels.enabled, true)),
      )
      .orderBy(asc(adminNewapiInstanceModels.sortOrder));

    const seen = new Set<string>();
    const uniqueRows = rows.filter((row) => {
      const key = `${row.instanceId}:${row.modelId}:${row.modelType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return await Promise.all(
      uniqueRows.map(async (row): Promise<EnabledModelEntry> => {
        const modelType = row.modelType as NewapiModelType;
        const pricingPolicy = resolveAdminProviderPricingPolicy(
          row.instanceMetadata as Record<string, unknown> | null | undefined,
          row.providerType,
        );
        const metadataPricing = resolveNewapiModelPricingFromMetadata(
          row.metadata as Record<string, unknown> | null | undefined,
          modelType,
          { includeSyncedPricing: pricingPolicy.upstreamSyncEnabled },
        );
        const pricingResolution = await resolveNewapiModelPricing({
          databasePricing: metadataPricing,
          lobeHubOfficialPricingEnabled: pricingPolicy.lobeHubOfficialPricingEnabled,
          model: row.modelId,
          modelBankFallbackEnabled: pricingPolicy.modelBankFallbackEnabled,
          modelBankProvider: resolveModelBankProviderForAdminType(row.providerType),
        });

        return {
          abilities: resolveStoredAbilities(
            row.metadata as Record<string, unknown> | null | undefined,
          ),
          displayName: row.displayName,
          groupKey: row.groupKey,
          groupName: row.groupName,
          id: row.modelId,
          instanceId: row.instanceId,
          instanceName: row.instanceName,
          pricing: pricingResolution.pricing,
          providerId: getRuntimeProviderId({
            instanceId: row.instanceId,
            providerType: row.providerType,
          }),
          providerType: row.providerType,
          type: toAiModelType(modelType),
        };
      }),
    );
  } catch {
    return [];
  }
};
