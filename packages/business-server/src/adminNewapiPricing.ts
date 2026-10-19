import { and, eq } from 'drizzle-orm';
import type { AiProviderModelListItem, Pricing } from 'model-bank';
import { normalizeAiModelType } from 'model-bank';

import type { AiUsageRouteMetadata } from '@/database/models/commercial';
import { adminNewapiInstanceModels, adminNewapiInstances } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  type NewapiModelType,
  resolveNewapiModelPricingFromMetadata,
} from '@/server/services/newapiInstance';
import {
  resolveAdminProviderPricingPolicy,
  resolveModelBankProviderForAdminType,
} from '@/server/services/newapiInstance/pricingPolicy';
import {
  type NewapiModelPricingSource,
  resolveNewapiModelPricing,
} from '@/server/services/newapiInstance/pricingResolution';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdminNewapiPricingParams = {
  db?: LobeChatDatabase;
  model: string;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  type?: AiProviderModelListItem['type'];
};

export interface AdminNewapiModelCardResult {
  lobeHubOfficialPricingEnabled: boolean;
  modelBankFallbackEnabled: boolean;
  modelBankProvider?: string;
  modelCard: AiProviderModelListItem;
}

export type AdminNewapiModelPricingSource = NewapiModelPricingSource;

export interface AdminNewapiModelPricingResolution {
  pricing?: Pricing;
  source: AdminNewapiModelPricingSource;
}

export const resolveAdminNewapiModelPricing = async ({
  adminModelCard,
  model,
}: {
  adminModelCard: AdminNewapiModelCardResult;
  model: string;
}): Promise<AdminNewapiModelPricingResolution> => {
  return resolveNewapiModelPricing({
    databasePricing: adminModelCard.modelCard.pricing,
    lobeHubOfficialPricingEnabled: adminModelCard.lobeHubOfficialPricingEnabled,
    model,
    modelBankFallbackEnabled: adminModelCard.modelBankFallbackEnabled,
    modelBankProvider: adminModelCard.modelBankProvider,
  });
};

const resolveInstanceId = ({
  provider,
  routeMetadata,
}: Pick<AdminNewapiPricingParams, 'provider' | 'routeMetadata'>) => {
  const metadataInstanceId = routeMetadata?.instanceId?.trim();
  if (metadataInstanceId && UUID_PATTERN.test(metadataInstanceId)) return metadataInstanceId;

  const providerId = provider.trim();
  return UUID_PATTERN.test(providerId) ? providerId : undefined;
};

const isRequestedModelType = (
  storedType: string,
  requestedType?: AiProviderModelListItem['type'],
) => {
  if (!requestedType) return true;

  return normalizeAiModelType(storedType) === normalizeAiModelType(requestedType);
};

/**
 * Read pricing from the selected admin-managed gateway instance.
 *
 * The regular AI infrastructure repository is user-provider scoped and cannot
 * see model metadata keyed by an admin instance UUID. Keep this lookup exact to
 * the selected instance so another gateway's price is never applied silently.
 */
export const getAdminNewapiModelCard = async ({
  db,
  model,
  provider,
  routeMetadata,
  type,
}: AdminNewapiPricingParams): Promise<AdminNewapiModelCardResult | undefined> => {
  const instanceId = resolveInstanceId({ provider, routeMetadata });
  const modelId = model.trim();
  if (!db || !instanceId || !modelId) return undefined;

  try {
    const rows = await db
      .select({
        displayName: adminNewapiInstanceModels.displayName,
        instanceMetadata: adminNewapiInstances.metadata,
        metadata: adminNewapiInstanceModels.metadata,
        modelId: adminNewapiInstanceModels.modelId,
        modelType: adminNewapiInstanceModels.modelType,
        providerType: adminNewapiInstances.providerType,
      })
      .from(adminNewapiInstanceModels)
      .innerJoin(
        adminNewapiInstances,
        eq(adminNewapiInstanceModels.instanceId, adminNewapiInstances.id),
      )
      .where(
        and(
          eq(adminNewapiInstances.id, instanceId),
          eq(adminNewapiInstances.enabled, true),
          eq(adminNewapiInstanceModels.enabled, true),
          eq(adminNewapiInstanceModels.modelId, modelId),
        ),
      );

    const row = rows.find((candidate) => isRequestedModelType(candidate.modelType, type));
    if (!row) return undefined;

    const modelType = normalizeAiModelType(row.modelType) as NewapiModelType;
    const pricingPolicy = resolveAdminProviderPricingPolicy(row.instanceMetadata, row.providerType);
    const pricing = resolveNewapiModelPricingFromMetadata(
      row.metadata as Record<string, unknown> | null | undefined,
      modelType,
      { includeSyncedPricing: pricingPolicy.upstreamSyncEnabled },
    );

    return {
      lobeHubOfficialPricingEnabled: pricingPolicy.lobeHubOfficialPricingEnabled,
      modelBankFallbackEnabled: pricingPolicy.modelBankFallbackEnabled,
      modelBankProvider: resolveModelBankProviderForAdminType(row.providerType),
      modelCard: {
        displayName: row.displayName ?? undefined,
        enabled: true,
        id: row.modelId,
        pricing,
        source: 'custom',
        type: modelType as AiProviderModelListItem['type'],
      },
    };
  } catch {
    return undefined;
  }
};
