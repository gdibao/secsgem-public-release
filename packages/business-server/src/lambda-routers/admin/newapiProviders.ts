import { TRPCError } from '@trpc/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { LOBE_DEFAULT_MODEL_LIST, normalizeAiModelType } from 'model-bank';
import { z } from 'zod';

import {
  type AdminNewapiInstanceItem,
  type AdminNewapiInstanceModelItem,
  adminNewapiInstanceModels,
  adminNewapiInstances,
  NEWAPI_MODEL_TYPES,
} from '@/database/schemas';
import {
  ADMIN_CAPABILITIES,
  adminAnyCapabilityProcedure,
  adminCapabilityProcedure,
  router,
} from '@/libs/trpc/lambda';
import { getModelCatalogDiagnostics } from '@/server/services/modelCatalog/diagnostics';
import { invalidateNewapiInstancesCache } from '@/server/services/newapiInstance';
import {
  buildNewapiPricingSyncWarnings,
  fetchNewapiModels,
  fetchNewapiPricing,
  normalizeNewapiSyncRows,
  supportsNewapiPricingSync,
} from '@/server/services/newapiInstance/catalog';
import {
  encryptAdminProviderApiKey,
  maybeBackfillPlaintextAdminProviderApiKey,
  tryDecryptAdminProviderApiKey,
} from '@/server/services/newapiInstance/credentials';
import { getLobeHubOfficialModelPricing } from '@/server/services/newapiInstance/lobeHubOfficialPricing';
import { getModelPricingCandidates } from '@/server/services/newapiInstance/modelPricingCandidates';
import {
  resolveAdminProviderPricingPolicy,
  resolveModelBankProviderForAdminType,
} from '@/server/services/newapiInstance/pricingPolicy';

import { getModelDependencyImpact } from '../../adminImpact/modelDependencyImpact';
import { createAdminCommand } from './adminCommand';
import { recordAdminAudit, runRequiredAdminAuditMutation } from './audit';

const maskApiKey = (key: string | null | undefined): string | null => {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
};

const NewapiModelTypeSchema = z.enum(NEWAPI_MODEL_TYPES);

const ProviderTypeSchema = z
  .enum([
    'newapi',
    'sub2api',
    'openai-compatible',
    'openai',
    'claude',
    'deepseek',
    'aliyun',
    'opencode-go',
    'siliconflow',
  ])
  .default('newapi');

const PricingPolicySchema = z.object({
  lobeHubOfficialPricingEnabled: z.boolean().optional(),
  modelBankFallbackEnabled: z.boolean(),
  upstreamSyncEnabled: z.boolean(),
});

const InstanceInputSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  fetchOnClient: z.boolean().default(false),
  groupKey: z.string().min(1).max(64).default('default'),
  groupMultiplier: z.number().positive().optional(),
  groupName: z.string().max(128).optional(),
  name: z.string().min(1).max(128),
  pricingPolicy: PricingPolicySchema.optional(),
  priority: z.number().int().min(0).default(0),
  providerType: ProviderTypeSchema,
  usageScope: z.array(NewapiModelTypeSchema).optional(),
});

const ModelInputSchema = z.object({
  displayName: z.string().optional(),
  enabled: z.boolean().default(true),
  modelId: z.string().min(1).max(128),
  modelType: NewapiModelTypeSchema,
  sortOrder: z.number().int().default(0),
});

const ModelMetadataSchema = z
  .object({
    manualPricing: z
      .object({
        imageRate: z.number().positive().optional(),
        inputCostRate: z.number().positive().optional(),
        inputRate: z.number().positive().optional(),
        marginMultiplier: z.number().positive().optional(),
        outputCostRate: z.number().positive().optional(),
        outputRate: z.number().positive().optional(),
        source: z.string().optional(),
        videoRate: z.number().positive().optional(),
      })
      .optional(),
  })
  .passthrough();

const INVALID_API_KEY_MESSAGE = 'Instance API key is invalid. Please reset it before retrying.';
const modelOpsReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.modelOpsRead);
const modelOpsWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.modelOpsWrite);
const sharedModelReadProcedure = adminAnyCapabilityProcedure([
  ADMIN_CAPABILITIES.modelOpsRead,
  ADMIN_CAPABILITIES.financeRead,
  ADMIN_CAPABILITIES.systemRead,
]);
const deleteInstanceCommand = createAdminCommand('newapiProvider.deleteInstance');

const normalizeInstanceInput = async <
  T extends {
    apiKey?: string;
    fetchOnClient?: boolean;
    pricingPolicy?: z.infer<typeof PricingPolicySchema>;
  },
>(
  input: T,
  existingMetadata?: Record<string, unknown> | null,
) => {
  const { pricingPolicy, ...inputWithoutPricingPolicy } = input;
  const data = {
    ...inputWithoutPricingPolicy,
    fetchOnClient: false,
  } as Omit<T, 'pricingPolicy'> & {
    fetchOnClient: boolean;
    metadata?: Record<string, unknown>;
  };
  if (pricingPolicy) {
    data.metadata = { ...existingMetadata, pricingPolicy };
  }
  if (!data.apiKey) return data;

  return {
    ...data,
    apiKey: await encryptAdminProviderApiKey(data.apiKey),
  };
};

const decryptInstance = async <T extends { apiKey: string | null; id: string }>(
  db: any,
  instance: T,
) => {
  const result = await tryDecryptAdminProviderApiKey(instance.apiKey);
  if (!result.ok) {
    return {
      ...instance,
      apiKey: '',
      apiKeyStatus: 'invalid' as const,
    };
  }

  await maybeBackfillPlaintextAdminProviderApiKey(db, {
    apiKey: instance.apiKey ?? '',
    instanceId: instance.id,
  });

  return {
    ...instance,
    apiKey: result.apiKey,
    apiKeyStatus: 'ok' as const,
  };
};

const assertInstanceApiKeyReady = <T extends { apiKeyStatus?: 'invalid' | 'ok' }>(instance: T) => {
  if (instance.apiKeyStatus === 'invalid') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: INVALID_API_KEY_MESSAGE,
    });
  }
};

const MODEL_PRICING_KEYS = [
  'inputCostRate',
  'inputRate',
  'outputCostRate',
  'outputRate',
  'imageRate',
  'videoRate',
];

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasPositiveNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
};

const resolveModelPricingCompleteness = (
  metadata: Record<string, unknown> | null | undefined,
  includeSyncedPricing = true,
) => {
  if (!isPlainRecord(metadata)) return false;

  const manualPricing = metadata.manualPricing;
  if (
    isPlainRecord(manualPricing) &&
    MODEL_PRICING_KEYS.some((key) => hasPositiveNumber(manualPricing[key]))
  ) {
    return true;
  }

  if (!includeSyncedPricing) return false;
  if (metadata.pricingAvailable === true) return true;
  if (hasPositiveNumber(metadata.modelPrice) || hasPositiveNumber(metadata.modelRatio)) return true;

  return false;
};

const hasModelBankPricing = ({
  modelId,
  providerType,
}: {
  modelId: string;
  providerType: string | null | undefined;
}) => {
  const modelBankProviderId = resolveModelBankProviderForAdminType(providerType);

  return getModelPricingCandidates(modelId).some((candidate) =>
    LOBE_DEFAULT_MODEL_LIST.some(
      (item) =>
        (!modelBankProviderId || item.providerId === modelBankProviderId) &&
        item.id === candidate &&
        Boolean(item.pricing),
    ),
  );
};

type AdminEnabledProviderModelRow = {
  displayName: AdminNewapiInstanceModelItem['displayName'];
  groupKey: AdminNewapiInstanceItem['groupKey'];
  groupName: AdminNewapiInstanceItem['groupName'];
  instanceId: AdminNewapiInstanceItem['id'];
  instanceMetadata: AdminNewapiInstanceItem['metadata'];
  instanceName: AdminNewapiInstanceItem['name'];
  metadata: AdminNewapiInstanceModelItem['metadata'];
  modelId: AdminNewapiInstanceModelItem['modelId'];
  modelType: AdminNewapiInstanceModelItem['modelType'];
  priority: AdminNewapiInstanceItem['priority'];
  providerType: AdminNewapiInstanceItem['providerType'];
};

const resolveModelPricingSource = async ({
  metadata,
  modelId,
  providerType,
  instanceMetadata,
}: {
  instanceMetadata: Record<string, unknown> | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  modelId: string;
  providerType: string | null | undefined;
}): Promise<'database' | 'lobehub-official' | 'missing' | 'model-bank'> => {
  const pricingPolicy = resolveAdminProviderPricingPolicy(instanceMetadata, providerType);
  if (resolveModelPricingCompleteness(metadata, pricingPolicy.upstreamSyncEnabled))
    return 'database';
  if (
    pricingPolicy.lobeHubOfficialPricingEnabled &&
    (await getLobeHubOfficialModelPricing(modelId))
  ) {
    return 'lobehub-official';
  }
  if (!pricingPolicy.modelBankFallbackEnabled) return 'missing';

  return hasModelBankPricing({ modelId, providerType }) ? 'model-bank' : 'missing';
};

const resolveModelAbilityCompleteness = (
  metadata: Record<string, unknown> | null | undefined,
  modelType: string,
) => {
  if (normalizeAiModelType(modelType) !== 'chat') return true;
  if (!isPlainRecord(metadata)) return false;

  return [metadata.manualAbilities, metadata.syncedAbilities].some(
    (abilities) =>
      isPlainRecord(abilities) &&
      Object.values(abilities).some((value) => typeof value === 'boolean'),
  );
};

export const adminNewapiProvidersRouter = router({
  // ─── Instance CRUD ─────────────────────────────────────────────────────────

  createInstance: modelOpsWriteProcedure
    .input(InstanceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const data = await normalizeInstanceInput(input);
      const row = await runRequiredAdminAuditMutation<{ id: string }>(ctx, {
        audit: (row) => ({
          action: 'newapiInstance.create',
          payload: { name: input.name },
          resourceId: row.id,
          resourceType: 'admin_newapi_instances',
        }),
        mutation: async (tx) => {
          const [row] = await tx
            .insert(adminNewapiInstances)
            .values(data)
            .returning({ id: adminNewapiInstances.id });
          return row;
        },
      });
      invalidateNewapiInstancesCache();
      return { id: row.id };
    }),

  deleteInstance: modelOpsWriteProcedure
    .input(
      z.object({
        command: deleteInstanceCommand.schema,
        id: z.string().uuid(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = deleteInstanceCommand.validate(input.command, input.reason);
      const reason = command.reason;
      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: command.auditAction,
          payload: reason ? { reason } : undefined,
          resourceId: input.id,
          resourceType: 'admin_newapi_instances',
        }),
        mutation: async (tx) => {
          const impact = await getModelDependencyImpact(tx, {
            instanceId: input.id,
            kind: 'instance',
          });
          if (!impact.targetExists) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
          }
          if (!impact.canProceed) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'PROVIDER_DELETE_BLOCKED',
            });
          }

          const result = await tx
            .delete(adminNewapiInstances)
            .where(eq(adminNewapiInstances.id, input.id))
            .returning({ id: adminNewapiInstances.id });

          if (result.length === 0)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
        },
      });
      invalidateNewapiInstancesCache();
      return { ok: true };
    }),

  getDeleteInstanceImpact: modelOpsReadProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getModelDependencyImpact(ctx.serverDB, { instanceId: input.id, kind: 'instance' }),
    ),

  getInstance: modelOpsReadProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const instance = await ctx.serverDB.query.adminNewapiInstances.findFirst({
        where: eq(adminNewapiInstances.id, input.id),
      });
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
      const decrypted = await decryptInstance(ctx.serverDB, instance);

      return {
        ...instance,
        apiKey: decrypted.apiKeyStatus === 'invalid' ? null : maskApiKey(decrypted.apiKey),
        apiKeyStatus: decrypted.apiKeyStatus,
      };
    }),

  listInstances: modelOpsReadProcedure.query(async ({ ctx }) => {
    const items = await ctx.serverDB.query.adminNewapiInstances.findMany({
      orderBy: asc(adminNewapiInstances.priority),
    });
    const decryptedItems = await Promise.all(
      items.map((i: AdminNewapiInstanceItem) => decryptInstance(ctx.serverDB, i)),
    );
    return {
      items: decryptedItems.map((i) => ({
        ...i,
        apiKey: i.apiKeyStatus === 'invalid' ? null : maskApiKey(i.apiKey),
      })),
    };
  }),

  updateInstance: modelOpsWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: InstanceInputSchema.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingInstance = input.data.pricingPolicy
        ? await ctx.serverDB.query.adminNewapiInstances.findFirst({
            columns: { metadata: true },
            where: eq(adminNewapiInstances.id, input.id),
          })
        : undefined;
      if (input.data.pricingPolicy && !existingInstance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
      }
      const data = await normalizeInstanceInput(input.data, existingInstance?.metadata);
      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'newapiInstance.update',
          payload: { ...input.data, apiKey: input.data.apiKey ? '***' : undefined },
          resourceId: input.id,
          resourceType: 'admin_newapi_instances',
        }),
        mutation: async (tx) => {
          const result = await tx
            .update(adminNewapiInstances)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(adminNewapiInstances.id, input.id))
            .returning({ id: adminNewapiInstances.id });

          if (result.length === 0)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
        },
      });
      invalidateNewapiInstancesCache();
      return { ok: true };
    }),

  toggleInstanceEnabled: modelOpsWriteProcedure
    .input(z.object({ enabled: z.boolean(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'newapiInstance.toggle',
          payload: { enabled: input.enabled },
          resourceId: input.id,
          resourceType: 'admin_newapi_instances',
        }),
        mutation: async (tx) => {
          await tx
            .update(adminNewapiInstances)
            .set({ enabled: input.enabled, updatedAt: new Date() })
            .where(eq(adminNewapiInstances.id, input.id));
        },
      });
      invalidateNewapiInstancesCache();
      return { ok: true };
    }),

  // ─── Instance Models CRUD ──────────────────────────────────────────────────

  syncInstanceModels: modelOpsWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.serverDB.query.adminNewapiInstances.findFirst({
        where: eq(adminNewapiInstances.id, input.id),
      });
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
      const decryptedInstance = await decryptInstance(ctx.serverDB, instance);
      assertInstanceApiKeyReady(decryptedInstance);
      const [models, pricingResult] = await Promise.all([
        fetchNewapiModels({
          apiKey: decryptedInstance.apiKey,
          baseUrl: instance.baseUrl,
          providerType: instance.providerType,
        }),
        fetchNewapiPricing({
          apiKey: decryptedInstance.apiKey,
          baseUrl: instance.baseUrl,
          providerType: instance.providerType,
        }),
      ]);

      if (models.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Upstream model catalog is empty; existing models were preserved',
        });
      }
      if (
        supportsNewapiPricingSync(instance.providerType) &&
        pricingResult.status !== 'available'
      ) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message:
            pricingResult.status === 'unsafe'
              ? 'Upstream pricing could not be represented safely; existing models were preserved'
              : 'Upstream pricing is unavailable; existing models were preserved',
        });
      }

      const normalizedRows = normalizeNewapiSyncRows({
        modelBankProviderId: resolveModelBankProviderForAdminType(instance.providerType),
        models,
        pricing: pricingResult.items,
        pricingStatus: pricingResult.status,
        syncSource: instance.providerType === 'sub2api' ? 'sub2api' : 'newapi',
      });
      const rows = normalizedRows.map((row) => ({ ...row, instanceId: input.id }));
      if (rows.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Upstream model catalog contains no valid model IDs; existing models were preserved',
        });
      }
      const abilitiesCount = normalizedRows.filter(
        (row) =>
          row.metadata.syncedAbilities &&
          typeof row.metadata.syncedAbilities === 'object' &&
          Object.keys(row.metadata.syncedAbilities).length > 0,
      ).length;
      const pricingCount = normalizedRows.filter(
        (row) => row.metadata.pricingAvailable === true,
      ).length;

      const replacement = await runRequiredAdminAuditMutation<{
        deletedCount: number;
        importedCount: number;
      }>(ctx, {
        audit: (result) => ({
          action: 'newapiInstanceModels.sync',
          payload: { ...result, abilitiesCount, pricingCount },
          resourceId: input.id,
          resourceType: 'admin_newapi_instance_models',
        }),
        mutation: async (tx) => {
          const deletedRows = await tx
            .delete(adminNewapiInstanceModels)
            .where(eq(adminNewapiInstanceModels.instanceId, input.id))
            .returning({ modelId: adminNewapiInstanceModels.modelId });
          await tx.insert(adminNewapiInstanceModels).values(rows);

          return { deletedCount: deletedRows.length, importedCount: rows.length };
        },
      });
      invalidateNewapiInstancesCache();

      return {
        abilitiesCount,
        deletedCount: replacement.deletedCount,
        importedCount: replacement.importedCount,
        modelsCount: replacement.importedCount,
        ok: true,
        pricingCount,
        staleCount: 0,
        warnings: [
          ...buildNewapiPricingSyncWarnings(
            instance.providerType,
            pricingCount,
            pricingResult.status,
          ),
          ...(pricingResult.warnings ?? []),
        ],
      };
    }),

  testInstanceConnection: modelOpsWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const instance = await ctx.serverDB.query.adminNewapiInstances.findFirst({
        where: eq(adminNewapiInstances.id, input.id),
      });
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
      const decryptedInstance = await decryptInstance(ctx.serverDB, instance);

      if (decryptedInstance.apiKeyStatus === 'invalid') {
        return {
          error: INVALID_API_KEY_MESSAGE,
          modelsCount: 0,
          ok: false,
          pricingCount: 0,
          warnings: [],
        };
      }

      try {
        const pricingPolicy = resolveAdminProviderPricingPolicy(
          instance.metadata,
          instance.providerType,
        );
        const models = await fetchNewapiModels({
          apiKey: decryptedInstance.apiKey,
          baseUrl: instance.baseUrl,
          providerType: instance.providerType,
        });
        const pricingResult = pricingPolicy.upstreamSyncEnabled
          ? await fetchNewapiPricing({
              apiKey: decryptedInstance.apiKey,
              baseUrl: instance.baseUrl,
              providerType: instance.providerType,
            })
          : { items: [], status: 'disabled' as const, warnings: [] };

        return {
          modelsCount: models.length,
          ok: true,
          pricingCount: pricingResult.items.length,
          warnings: [
            ...buildNewapiPricingSyncWarnings(
              instance.providerType,
              pricingResult.items.length,
              pricingResult.status,
            ),
            ...(pricingResult.warnings ?? []),
          ],
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          modelsCount: 0,
          ok: false,
          pricingCount: 0,
          warnings: [],
        };
      }
    }),

  getModelCatalogDiagnostics: modelOpsReadProcedure.query(async ({ ctx }) => {
    const { AiInfraRepos } = await import('@/database/repositories/aiInfra');
    const { getServerGlobalConfig } = await import('@/server/globalConfig');
    const { resolvePlanModelRules } = await import('@/business/server/planModelRules');
    const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');

    const { aiProvider } = await getServerGlobalConfig(ctx.serverDB);
    const aiInfraRepos = new AiInfraRepos(ctx.serverDB, ctx.userId, aiProvider as any);
    const [state, planRules] = await Promise.all([
      aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults),
      resolvePlanModelRules({ db: ctx.serverDB, userId: ctx.userId }),
    ]);

    return getModelCatalogDiagnostics({ planRules, state });
  }),

  refreshRuntimeCache: modelOpsWriteProcedure.mutation(async ({ ctx }) => {
    invalidateNewapiInstancesCache();

    await recordAdminAudit(ctx, {
      action: 'newapiInstanceModels.refreshRuntimeCache',
      payload: { source: 'admin' },
      resourceType: 'admin_newapi_instance_models',
    });

    return { refreshedAt: new Date().toISOString() };
  }),

  addModels: modelOpsWriteProcedure
    .input(
      z.object({
        instanceId: z.string().uuid(),
        models: z.array(ModelInputSchema).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = input.models.map((m) => ({
        ...m,
        instanceId: input.instanceId,
      }));

      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'newapiInstanceModels.add',
          payload: { count: input.models.length },
          resourceId: input.instanceId,
          resourceType: 'admin_newapi_instance_models',
        }),
        mutation: async (tx) => {
          await tx
            .insert(adminNewapiInstanceModels)
            .values(rows)
            .onConflictDoUpdate({
              set: {
                displayName: sql`excluded.display_name`,
                enabled: sql`excluded.enabled`,
                sortOrder: sql`excluded.sort_order`,
                updatedAt: new Date(),
              },
              target: [
                adminNewapiInstanceModels.instanceId,
                adminNewapiInstanceModels.modelId,
                adminNewapiInstanceModels.modelType,
              ],
            });
        },
      });
      invalidateNewapiInstancesCache();
      return { ok: true };
    }),

  listModels: modelOpsReadProcedure
    .input(
      z.object({
        instanceId: z.string().uuid(),
        modelType: z.enum(NEWAPI_MODEL_TYPES).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(adminNewapiInstanceModels.instanceId, input.instanceId)];
      if (input.modelType) {
        conditions.push(eq(adminNewapiInstanceModels.modelType, input.modelType));
      }

      const items = await ctx.serverDB
        .select()
        .from(adminNewapiInstanceModels)
        .where(and(...conditions))
        .orderBy(
          asc(adminNewapiInstanceModels.modelType),
          asc(adminNewapiInstanceModels.sortOrder),
        );

      return { items };
    }),

  removeModel: modelOpsWriteProcedure
    .input(
      z.object({
        instanceId: z.string().uuid(),
        modelId: z.string().min(1),
        modelType: z.enum(NEWAPI_MODEL_TYPES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'newapiInstanceModels.remove',
          payload: { modelId: input.modelId, modelType: input.modelType },
          resourceId: input.instanceId,
          resourceType: 'admin_newapi_instance_models',
        }),
        mutation: async (tx) => {
          const impact = await getModelDependencyImpact(tx, {
            instanceId: input.instanceId,
            kind: 'model',
            modelId: input.modelId,
            modelType: input.modelType,
          });
          if (!impact.targetExists) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Model route not found' });
          }
          if (!impact.canProceed) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'PROVIDER_MODEL_DELETE_BLOCKED',
            });
          }

          const result = await tx
            .delete(adminNewapiInstanceModels)
            .where(
              and(
                eq(adminNewapiInstanceModels.instanceId, input.instanceId),
                eq(adminNewapiInstanceModels.modelId, input.modelId),
                eq(adminNewapiInstanceModels.modelType, input.modelType),
              ),
            )
            .returning({ instanceId: adminNewapiInstanceModels.instanceId });

          if (result.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Model route not found' });
          }
        },
      });
      invalidateNewapiInstancesCache();
      return { ok: true };
    }),

  getRemoveModelImpact: modelOpsReadProcedure
    .input(
      z.object({
        instanceId: z.string().uuid(),
        modelId: z.string().min(1),
        modelType: z.enum(NEWAPI_MODEL_TYPES),
      }),
    )
    .query(({ ctx, input }) =>
      getModelDependencyImpact(ctx.serverDB, {
        instanceId: input.instanceId,
        kind: 'model',
        modelId: input.modelId,
        modelType: input.modelType,
      }),
    ),

  updateModel: modelOpsWriteProcedure
    .input(
      z.object({
        instanceId: z.string().uuid(),
        modelId: z.string().min(1),
        modelType: z.enum(NEWAPI_MODEL_TYPES),
        data: z.object({
          displayName: z.string().optional(),
          enabled: z.boolean().optional(),
          metadata: ModelMetadataSchema.nullish(),
          sortOrder: z.number().int().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'newapiInstanceModels.update',
          payload: {
            fields: Object.keys(input.data),
            modelId: input.modelId,
            modelType: input.modelType,
          },
          resourceId: input.instanceId,
          resourceType: 'admin_newapi_instance_models',
        }),
        mutation: async (tx) => {
          await tx
            .update(adminNewapiInstanceModels)
            .set({ ...input.data, updatedAt: new Date() })
            .where(
              and(
                eq(adminNewapiInstanceModels.instanceId, input.instanceId),
                eq(adminNewapiInstanceModels.modelId, input.modelId),
                eq(adminNewapiInstanceModels.modelType, input.modelType),
              ),
            );
        },
      });
      invalidateNewapiInstancesCache();
      return { ok: true };
    }),

  setModelsEnabled: modelOpsWriteProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        instanceId: z.string().uuid(),
        models: z
          .array(
            z.object({
              modelId: z.string().min(1),
              modelType: z.enum(NEWAPI_MODEL_TYPES),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'newapiInstanceModels.setEnabledBatch',
          payload: { count: input.models.length, enabled: input.enabled, models: input.models },
          resourceId: input.instanceId,
          resourceType: 'admin_newapi_instance_models',
        }),
        mutation: async (tx) => {
          for (const model of input.models) {
            const updated = await tx
              .update(adminNewapiInstanceModels)
              .set({ enabled: input.enabled, updatedAt: new Date() })
              .where(
                and(
                  eq(adminNewapiInstanceModels.instanceId, input.instanceId),
                  eq(adminNewapiInstanceModels.modelId, model.modelId),
                  eq(adminNewapiInstanceModels.modelType, model.modelType),
                ),
              )
              .returning({ modelId: adminNewapiInstanceModels.modelId });
            if (updated.length === 0) {
              throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found' });
            }
          }
        },
      });
      invalidateNewapiInstancesCache();
      return { count: input.models.length, ok: true };
    }),

  // ─── Aggregated view for runtime usage ─────────────────────────────────────

  getAllEnabledModels: sharedModelReadProcedure
    .input(
      z
        .object({
          modelType: z.enum(NEWAPI_MODEL_TYPES).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(adminNewapiInstances.enabled, true),
        eq(adminNewapiInstanceModels.enabled, true),
      ];
      if (input?.modelType) {
        conditions.push(eq(adminNewapiInstanceModels.modelType, input.modelType));
      }

      const rows = await ctx.serverDB
        .select({
          displayName: adminNewapiInstanceModels.displayName,
          groupKey: adminNewapiInstances.groupKey,
          groupName: adminNewapiInstances.groupName,
          instanceId: adminNewapiInstances.id,
          instanceMetadata: adminNewapiInstances.metadata,
          instanceName: adminNewapiInstances.name,
          metadata: adminNewapiInstanceModels.metadata,
          modelId: adminNewapiInstanceModels.modelId,
          modelType: adminNewapiInstanceModels.modelType,
          priority: adminNewapiInstances.priority,
          providerType: adminNewapiInstances.providerType,
        })
        .from(adminNewapiInstanceModels)
        .innerJoin(
          adminNewapiInstances,
          eq(adminNewapiInstanceModels.instanceId, adminNewapiInstances.id),
        )
        .where(and(...conditions))
        .orderBy(asc(adminNewapiInstances.priority), asc(adminNewapiInstanceModels.sortOrder));

      const items = await Promise.all(
        rows.map(async (row: AdminEnabledProviderModelRow) => {
          const {
            displayName,
            groupKey,
            groupName,
            instanceId,
            instanceMetadata,
            instanceName,
            metadata,
            modelId,
            modelType,
            priority,
            providerType,
          } = row;
          const pricingPolicy = resolveAdminProviderPricingPolicy(instanceMetadata, providerType);

          return {
            displayName,
            groupKey,
            groupName,
            hasModelAbilities: resolveModelAbilityCompleteness(metadata, modelType),
            hasModelPricing: resolveModelPricingCompleteness(
              metadata,
              pricingPolicy.upstreamSyncEnabled,
            ),
            instanceId,
            instanceName,
            modelId,
            modelType,
            pricingSource: await resolveModelPricingSource({
              instanceMetadata,
              metadata,
              modelId,
              providerType,
            }),
            priority,
            providerType,
          };
        }),
      );

      return {
        items,
      };
    }),
});
