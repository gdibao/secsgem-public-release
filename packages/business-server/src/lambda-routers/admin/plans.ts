import { Plans } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import { normalizePlanCatalogPresentation } from '@/const/billingPresentation';
import { getPlanDeleteImpact } from '@/database/models/commercial';
import {
  appSettings,
  creditAccounts,
  NEWAPI_MODEL_TYPES,
  planCatalog,
  type PlanModelRules,
  userPlanSnapshots,
} from '@/database/schemas';
import { type Transaction } from '@/database/type';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';
import { getAllEnabledModels } from '@/server/services/newapiInstance';

import { isModelAllowedByPlanRules } from '../../planModelRules';
import { runRequiredAdminAuditMutation } from './audit';

const ModelTypeEnum = z.enum(NEWAPI_MODEL_TYPES);

const PlanModelRuleSchema = z.object({
  allowlist: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
  mode: z.enum(['allowlist', 'blocklist']),
});

const PlanModelRulesSchema = z.partialRecord(ModelTypeEnum, PlanModelRuleSchema).optional();
const PlanModelRulesUpdateSchema = z.object({
  modelRules: PlanModelRulesSchema,
  plan: z.string().min(1),
});
const PlanModelRulesBatchSchema = z
  .object({ updates: z.array(PlanModelRulesUpdateSchema).min(1).max(20) })
  .superRefine(({ updates }, ctx) => {
    const plans = new Set<string>();
    updates.forEach((update, index) => {
      if (plans.has(update.plan)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Duplicate plan in batch',
          path: ['updates', index, 'plan'],
        });
      }
      plans.add(update.plan);
    });
  });

const normalizePurchaseUrl = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  try {
    const url = new URL(raw);

    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
};

const syncSnapshotResourceQuotaMetadata = (
  storageQuotaBytes: number | null,
  vectorQuota: number | null,
) => {
  const quotaMetadata = JSON.stringify({ storageQuotaBytes, vectorQuota });
  const storageQuota = JSON.stringify(storageQuotaBytes);
  const vectorQuotaValue = JSON.stringify(vectorQuota);
  const entitlement = sql`${userPlanSnapshots.metadata}->'entitlementSnapshot'`;
  const updatedPlanMetadata = sql`(
    COALESCE(${userPlanSnapshots.metadata} #> '{entitlementSnapshot,planMetadata}', '{}'::jsonb)
    - 'storageQuotaBytes'
    - 'storageQuotaMb'
    - 'vectorQuota'
  ) || ${quotaMetadata}::jsonb`;

  return sql<Record<string, unknown> | null>`CASE
    WHEN ${entitlement}->>'version' = '2' THEN
      jsonb_set(
        COALESCE(${userPlanSnapshots.metadata}, '{}'::jsonb),
        '{entitlementSnapshot}',
        jsonb_set(
          jsonb_set(
            jsonb_set(${entitlement}, '{planMetadata}', ${updatedPlanMetadata}, true),
            '{storageQuotaBytes}',
            ${storageQuota}::jsonb,
            true
          ),
          '{vectorQuota}',
          ${vectorQuotaValue}::jsonb,
          true
        ),
        true
      )
    WHEN ${entitlement}->>'version' = '1' THEN
      jsonb_set(
        COALESCE(${userPlanSnapshots.metadata}, '{}'::jsonb),
        '{entitlementSnapshot}',
        jsonb_set(${entitlement}, '{planMetadata}', ${updatedPlanMetadata}, true),
        true
      )
    ELSE ${userPlanSnapshots.metadata}
  END`;
};

const PlanInputSchema = z.object({
  currency: z.string().max(16).default('USD'),
  badge: z.string().max(80).optional(),
  comparisonNote: z.string().max(240).optional(),
  displayName: z.string().min(1).max(200),
  features: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  modelRules: PlanModelRulesSchema,
  lifetimePrice: z.number().min(0).nullable().optional(),
  monthlyCredits: z.number().min(0),
  monthlyPrice: z.number().min(0),
  oneTimePrice: z.number().min(0).nullable().optional(),
  plan: z.nativeEnum(Plans),
  pptCreditCost: z.number().min(0).optional(),
  pptEnabled: z.boolean().optional(),
  pptMonthlyQuota: z.number().min(0).nullable().optional(),
  purchaseUrl: z.string().max(2048).optional(),
  sortOrder: z.number().default(0),
  storageQuotaMb: z.number().min(0).nullable().optional(),
  vectorQuota: z.number().min(0).nullable().optional(),
  yearlyDiscountLabel: z.string().max(80).optional(),
  yearlyPrice: z.number().min(0),
});

const toStorageQuotaBytes = (storageQuotaMb?: null | number) =>
  storageQuotaMb === null || storageQuotaMb === undefined
    ? null
    : Math.floor(storageQuotaMb * 1024 * 1024);

const DEFAULT_MODEL_SETTING_KEYS = [
  APP_SETTING_KEYS.defaultAgentModel,
  APP_SETTING_KEYS.defaultAgentProvider,
  APP_SETTING_KEYS.defaultImageModel,
  APP_SETTING_KEYS.defaultImageProvider,
  APP_SETTING_KEYS.defaultVideoModel,
  APP_SETTING_KEYS.defaultVideoProvider,
] as const;

const normalizeSettingString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const normalizeFreePlanModelRules = async (
  db: Transaction,
  modelRules: PlanModelRules | null | undefined,
): Promise<PlanModelRules | null | undefined> => {
  const [settingRows, enabledModels] = await Promise.all([
    db.query.appSettings.findMany({
      columns: { key: true, value: true },
      where: inArray(appSettings.key, DEFAULT_MODEL_SETTING_KEYS),
    }),
    getAllEnabledModels(db),
  ]);
  const settings = new Map(settingRows.map((row) => [row.key, row.value]));
  const defaultAgentConfig = getServerDefaultAgentConfig();
  const defaults = [
    {
      model:
        normalizeSettingString(settings.get(APP_SETTING_KEYS.defaultAgentModel)) ||
        normalizeSettingString(
          'model' in defaultAgentConfig ? defaultAgentConfig.model : undefined,
        ),
      modelType: 'chat' as const,
      provider:
        normalizeSettingString(settings.get(APP_SETTING_KEYS.defaultAgentProvider)) ||
        normalizeSettingString(
          'provider' in defaultAgentConfig ? defaultAgentConfig.provider : undefined,
        ),
    },
    {
      model: normalizeSettingString(settings.get(APP_SETTING_KEYS.defaultImageModel)),
      modelType: 'image' as const,
      provider: normalizeSettingString(settings.get(APP_SETTING_KEYS.defaultImageProvider)),
    },
    {
      model: normalizeSettingString(settings.get(APP_SETTING_KEYS.defaultVideoModel)),
      modelType: 'video' as const,
      provider: normalizeSettingString(settings.get(APP_SETTING_KEYS.defaultVideoProvider)),
    },
  ];

  let normalizedRules: PlanModelRules | null | undefined = modelRules
    ? Object.fromEntries(
        Object.entries(modelRules).map(([modelType, rule]) => [
          modelType,
          {
            ...rule,
            ...(rule.allowlist ? { allowlist: [...rule.allowlist] } : {}),
            ...(rule.blocklist ? { blocklist: [...rule.blocklist] } : {}),
          },
        ]),
      )
    : modelRules;

  for (const { model, modelType, provider } of defaults) {
    if (!model) continue;

    const matchingRoutes = enabledModels.filter(
      (item) =>
        item.id === model &&
        item.type === modelType &&
        (!provider ||
          item.providerId === provider ||
          item.instanceId === provider ||
          item.providerType === provider ||
          (provider === 'newapi' && !item.providerId)),
    );
    // A stale default may temporarily disappear while the provider catalog is
    // being synchronized. Keep it in an allowlist generated from the visible
    // rows so saving the matrix does not make the configured default invalid.
    if (matchingRoutes.length === 0) {
      const rule = normalizedRules?.[modelType];
      if (
        rule?.mode === 'allowlist' &&
        !isModelAllowedByPlanRules(normalizedRules, model, modelType)
      ) {
        normalizedRules = {
          ...normalizedRules,
          [modelType]: {
            ...rule,
            allowlist: [...(rule.allowlist ?? []), model],
          },
        };
      }
    }

    const allowed =
      matchingRoutes.length > 0
        ? matchingRoutes.some((item) =>
            isModelAllowedByPlanRules(normalizedRules, model, modelType, item.groupKey),
          )
        : isModelAllowedByPlanRules(normalizedRules, model, modelType);

    if (!allowed) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'DEFAULT_MODEL_DENIED_BY_FREE_PLAN',
      });
    }
  }

  return normalizedRules;
};

const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);
const financeWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeWrite);

type PlanCatalogAuditRow = Partial<typeof planCatalog.$inferSelect>;

const toPlanCatalogAuditSnapshot = (row?: PlanCatalogAuditRow | null) => {
  if (!row) return null;

  return Object.fromEntries(
    Object.entries({
      currency: row.currency,
      displayName: row.displayName,
      features: row.features,
      isActive: row.isActive,
      metadata: row.metadata ?? null,
      modelRules: row.modelRules ?? null,
      monthlyCredits: row.monthlyCredits,
      monthlyPrice: row.monthlyPrice,
      plan: row.plan,
      sortOrder: row.sortOrder,
      yearlyPrice: row.yearlyPrice,
    }).filter(([, value]) => value !== undefined),
  );
};

const updatePlanModelRules = async (
  tx: Transaction,
  input: z.infer<typeof PlanModelRulesUpdateSchema>,
) => {
  const existing = await tx.query.planCatalog.findFirst({
    where: eq(planCatalog.plan, input.plan),
  });
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found' });

  const modelRules =
    input.plan === Plans.Free
      ? await normalizeFreePlanModelRules(tx, input.modelRules as PlanModelRules | null)
      : (input.modelRules as PlanModelRules | null | undefined);

  const nextPlanCatalog = { ...existing, modelRules: modelRules ?? null };
  const result = await tx
    .update(planCatalog)
    .set({ modelRules: modelRules ?? null, updatedAt: new Date() })
    .where(eq(planCatalog.plan, input.plan))
    .returning({ plan: planCatalog.plan });
  if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found' });

  return { existing, nextPlanCatalog };
};

export const adminPlansRouter = router({
  delete: financeWriteProcedure
    .input(z.object({ plan: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<any>(ctx, {
        audit: (existing) => ({
          action: 'plan.delete',
          payload: {
            after: null,
            before: toPlanCatalogAuditSnapshot(existing),
          },
          resourceId: input.plan,
          resourceType: 'plan_catalog',
        }),
        mutation: async (tx) => {
          const impact = await getPlanDeleteImpact(tx, input.plan);
          if (!impact.targetExists) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found' });
          }
          if (!impact.canProceed) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'PLAN_DELETE_BLOCKED',
            });
          }

          const existing = await tx.query.planCatalog.findFirst({
            where: eq(planCatalog.plan, input.plan),
          });
          await tx.delete(planCatalog).where(eq(planCatalog.plan, input.plan));
          return existing;
        },
      });
      return { ok: true };
    }),

  getDeleteImpact: financeReadProcedure
    .input(z.object({ plan: z.string().min(1) }))
    .query(({ ctx, input }) => getPlanDeleteImpact(ctx.serverDB, input.plan)),

  list: financeReadProcedure.query(async ({ ctx }) => {
    const items = await ctx.serverDB.query.planCatalog.findMany({
      orderBy: asc(planCatalog.sortOrder),
    });
    return { items };
  }),

  setModelRules: financeWriteProcedure
    .input(PlanModelRulesUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<any>(ctx, {
        audit: ({ existing, nextPlanCatalog }) => ({
          action: 'plan.setModelRules',
          payload: {
            after: toPlanCatalogAuditSnapshot(nextPlanCatalog),
            before: toPlanCatalogAuditSnapshot(existing),
            modelRules: nextPlanCatalog.modelRules,
          },
          resourceId: input.plan,
          resourceType: 'plan_catalog',
        }),
        mutation: (tx) => updatePlanModelRules(tx, input),
      });
      return { ok: true };
    }),

  setModelRulesBatch: financeWriteProcedure
    .input(PlanModelRulesBatchSchema)
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<any>(ctx, {
        audit: (changes) => ({
          action: 'plan.setModelRulesBatch',
          payload: {
            changes: changes.map(
              ({
                existing,
                nextPlanCatalog,
              }: Awaited<ReturnType<typeof updatePlanModelRules>>) => ({
                after: toPlanCatalogAuditSnapshot(nextPlanCatalog),
                before: toPlanCatalogAuditSnapshot(existing),
              }),
            ),
            count: changes.length,
          },
          resourceType: 'plan_catalog',
        }),
        mutation: async (tx) => {
          const changes = [];
          for (const update of input.updates) {
            changes.push(await updatePlanModelRules(tx, update));
          }
          return changes;
        },
      });
      return { count: input.updates.length, ok: true };
    }),

  upsert: financeWriteProcedure.input(PlanInputSchema).mutation(async ({ ctx, input }) => {
    const {
      badge,
      comparisonNote,
      lifetimePrice,
      pptCreditCost,
      pptEnabled,
      pptMonthlyQuota,
      oneTimePrice,
      purchaseUrl,
      storageQuotaMb,
      vectorQuota,
      yearlyDiscountLabel,
      ...planInput
    } = input;
    await runRequiredAdminAuditMutation<any>(ctx, {
      audit: (result) => ({
        action: result.existing ? 'plan.update' : 'plan.create',
        payload: {
          ...planInput,
          activeUserCount: result.activeUserIds.length,
          after: toPlanCatalogAuditSnapshot(result.nextPlanCatalog),
          before: toPlanCatalogAuditSnapshot(result.existing),
          ...(lifetimePrice === undefined ? {} : { lifetimePrice }),
          ...(oneTimePrice === undefined ? {} : { oneTimePrice }),
          pptCreditCost: pptCreditCost ?? 0,
          pptEnabled: pptEnabled === true,
          pptMonthlyQuota: pptMonthlyQuota ?? null,
          purchaseUrl: result.normalizedPurchaseUrl,
          quotaUpdate: result.quotaAudit,
          storageQuotaMb: storageQuotaMb ?? null,
          vectorQuota: vectorQuota ?? null,
        },
        resourceId: planInput.plan,
        resourceType: 'plan_catalog',
      }),
      mutation: async (tx) => {
        const existing = await tx.query.planCatalog.findFirst({
          where: eq(planCatalog.plan, planInput.plan),
        });

        const modelRules =
          planInput.plan === Plans.Free
            ? await normalizeFreePlanModelRules(
                tx,
                (planInput.modelRules ?? existing?.modelRules) as PlanModelRules | null | undefined,
              )
            : (planInput.modelRules as PlanModelRules | null | undefined);

        const normalizedPurchaseUrl = normalizePurchaseUrl(purchaseUrl);
        const previousMetadata =
          existing?.metadata &&
          typeof existing.metadata === 'object' &&
          !Array.isArray(existing.metadata)
            ? existing.metadata
            : {};
        const presentation = normalizePlanCatalogPresentation({
          ...previousMetadata,
          badge,
          comparisonNote,
          pptCreditCost,
          pptEnabled,
          pptMonthlyQuota,
          storageQuotaMb,
          vectorQuota,
          yearlyDiscountLabel,
        });
        const metadata = {
          ...previousMetadata,
          ...presentation,
          ...(lifetimePrice === undefined ? {} : { lifetimePrice }),
          ...(oneTimePrice === undefined ? {} : { oneTimePrice }),
          ...(normalizedPurchaseUrl ? { purchaseUrl: normalizedPurchaseUrl } : {}),
        };
        if (!normalizedPurchaseUrl) delete metadata.purchaseUrl;

        const nextPlanCatalog = { ...planInput, metadata, modelRules };
        if (existing) {
          await tx
            .update(planCatalog)
            .set({ ...nextPlanCatalog, updatedAt: new Date() })
            .where(eq(planCatalog.plan, planInput.plan));
        } else {
          await tx.insert(planCatalog).values(nextPlanCatalog);
        }

        const activeSnapshots = await tx.query.userPlanSnapshots.findMany({
          columns: { userId: true },
          where: and(
            eq(userPlanSnapshots.plan, planInput.plan),
            eq(userPlanSnapshots.status, 'active'),
          ),
        });
        const activeUserIds = Array.from(
          new Set(activeSnapshots.map((snapshot: { userId: string }) => snapshot.userId)),
        );
        const quotaAudit = {
          storageQuota: toStorageQuotaBytes(storageQuotaMb),
          vectorQuota: vectorQuota ?? null,
        };
        if (activeUserIds.length > 0) {
          const quotaUpdatedAt = new Date();
          const quotaUpdate = { ...quotaAudit, updatedAt: quotaUpdatedAt };
          await tx
            .update(userPlanSnapshots)
            .set({
              metadata: syncSnapshotResourceQuotaMetadata(
                quotaAudit.storageQuota,
                quotaAudit.vectorQuota,
              ),
              updatedAt: quotaUpdatedAt,
            })
            .where(
              and(
                eq(userPlanSnapshots.plan, planInput.plan),
                eq(userPlanSnapshots.status, 'active'),
              ),
            );
          await tx
            .insert(creditAccounts)
            .values(activeUserIds.map((userId) => ({ ...quotaUpdate, userId })))
            .onConflictDoUpdate({ set: quotaUpdate, target: creditAccounts.userId });
        }

        return { activeUserIds, existing, nextPlanCatalog, normalizedPurchaseUrl, quotaAudit };
      },
    });
    return { ok: true };
  }),

  setActive: financeWriteProcedure
    .input(z.object({ isActive: z.boolean(), plan: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<any>(ctx, {
        audit: ({ existing, nextPlanCatalog }) => ({
          action: 'plan.setActive',
          payload: {
            after: toPlanCatalogAuditSnapshot(nextPlanCatalog),
            before: toPlanCatalogAuditSnapshot(existing),
            isActive: input.isActive,
          },
          resourceId: input.plan,
          resourceType: 'plan_catalog',
        }),
        mutation: async (tx) => {
          const existing = await tx.query.planCatalog.findFirst({
            where: eq(planCatalog.plan, input.plan),
          });

          if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found' });

          const nextPlanCatalog = { ...existing, isActive: input.isActive };
          const result = await tx
            .update(planCatalog)
            .set({ isActive: input.isActive, updatedAt: new Date() })
            .where(eq(planCatalog.plan, input.plan))
            .returning({ plan: planCatalog.plan });

          if (result.length === 0)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found' });

          return { existing, nextPlanCatalog };
        },
      });
      return { ok: true };
    }),
});
