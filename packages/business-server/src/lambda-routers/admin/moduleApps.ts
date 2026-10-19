import { recordModuleAppPayoutState } from '@lobechat/observability-otel/modules/module-app';
import {
  moduleAppAdminUpsertSchema,
  moduleAppBillingConfigSchema,
  moduleAppCurrencySchema,
  moduleAppDecimalStringSchema,
  moduleAppLicenseScopeSchema,
  moduleAppOutboundHostPoliciesSchema,
  moduleAppPackageReviewStatusSchema,
  moduleAppPayoutStatusSchema,
  moduleAppPlanEntitlementSchema,
  moduleAppProductSchema,
  moduleAppProductTypeSchema,
  moduleAppPromotionSnapshotSchema,
  moduleAppPublisherStatusSchema,
  moduleAppRateStringSchema,
  moduleAppStatusSchema,
  paymentProviderSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ModuleAppModel } from '@/database/models/moduleApp';
import { ModuleAppCommerceModel } from '@/database/models/moduleAppCommerce';
import { ModuleAppPaymentModel } from '@/database/models/moduleAppPayment';
import { ModuleAppPayoutModel } from '@/database/models/moduleAppPayout';
import { ModuleAppPublisherModel } from '@/database/models/moduleAppPublisher';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { appEnv } from '@/envs/app';
import {
  ADMIN_CAPABILITIES,
  adminAnyCapabilityProcedure,
  adminCapabilityProcedure,
  router,
} from '@/libs/trpc/lambda';
import { ModuleAppBuildService } from '@/server/services/moduleAppBuild/service';
import { ModuleAppPackageLifecycleService } from '@/server/services/moduleAppPackage/lifecycle';
import { ModuleAppRuntimeClient } from '@/server/services/moduleAppRuntime/client';
import { getServerModuleAppRuntimeConfig } from '@/server/services/moduleAppRuntime/config';
import { getAllEnabledModels } from '@/server/services/newapiInstance';
import {
  createOperationalPaymentConfig,
  getServerPaymentConfig,
  listEnabledPaymentMethods,
} from '@/server/services/payments/config';
import { createPaymentAdapter } from '@/server/services/payments/factory';
import { dispatchDueModuleAppSchedules } from '@/server/workflows/moduleApp/scheduleDispatcher';

import { writeModuleAppAuditLog } from '../../module-apps/audit';
import { ModuleAppPaymentService } from '../../module-apps/payments/service';
import {
  assertModuleAppMutationEnabled,
  assertModuleAppRolloutAllowed,
} from '../../module-apps/productionControls';
import { ModuleAppOrderRevenueService, ModuleAppRevenueService } from '../../module-apps/revenue';
import { runRequiredAdminAuditExternalEffect } from './audit';
import { ModuleAppAdminReadModel } from './moduleApps.readModels';

const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);
const financeWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeWrite);
const moduleAppReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.moduleAppRead);
const moduleAppWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.moduleAppWrite);
const publisherReadProcedure = adminAnyCapabilityProcedure([
  ADMIN_CAPABILITIES.moduleAppRead,
  ADMIN_CAPABILITIES.financeRead,
]);
const moduleAuditReadProcedure = adminAnyCapabilityProcedure([
  ADMIN_CAPABILITIES.moduleAppRead,
  ADMIN_CAPABILITIES.financeRead,
]);

const unavailableScheduleDiagnostics = {
  activeClaims: null,
  claimableSchedules: null,
  enabledSchedules: null,
  failedScheduledRuns24h: null,
  lastScheduledRunAt: null,
  oldestClaimableAt: null,
  staleClaims: null,
  status: 'unavailable' as const,
};
const ADMIN_SCHEDULE_DISPATCH_BATCH_SIZE = 25;

const assertPayoutRecordingEnabled = () =>
  assertModuleAppMutationEnabled(
    appEnv.MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED,
    'MODULE_APP_PUBLISHER_PAYOUT_RECORDING_DISABLED',
  );

const assertPayoutPublisherAllowed = (publisherId: string) =>
  assertModuleAppRolloutAllowed(
    { publisherId },
    { appIds: [], publisherIds: appEnv.MODULE_APP_PUBLISHER_ALLOWLIST },
  );

const requirePayoutBatchForMutation = async (db: LobeChatDatabase, batchId: string) => {
  assertPayoutRecordingEnabled();
  const batch = await new ModuleAppPayoutModel(db).getBatch(batchId);
  if (!batch) throw new Error('MODULE_APP_PAYOUT_BATCH_NOT_FOUND');
  assertPayoutPublisherAllowed(batch.publisherId);
  return batch;
};

const createConfiguredModulePaymentService = async (db: LobeChatDatabase) => {
  const config = await getServerPaymentConfig(db);
  const operationalConfig = createOperationalPaymentConfig(config);
  const methods = listEnabledPaymentMethods(operationalConfig, 'module_app');
  if (methods.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'module_app_payment_provider_not_configured',
    });
  }
  return new ModuleAppPaymentService(
    db,
    createPaymentAdapter(operationalConfig, methods[0].id),
    undefined,
    undefined,
    (_provider, method) => createPaymentAdapter(operationalConfig, method),
  );
};

const AppIdInputSchema = z.object({ appId: z.string().uuid() });
const PackageIdInputSchema = z.object({ packageId: z.string().uuid() });
const ApprovePackageInputSchema = PackageIdInputSchema.extend({
  outboundHostPolicies: moduleAppOutboundHostPoliciesSchema,
});
const AdminCursorSchema = z.union([z.number().int().min(0), z.string().min(1).max(512)]).default(0);
const normalizeAdminSearchQuery = (value: string) => {
  const normalized = value.trim().replaceAll(/\s+/g, ' ');
  if (normalized.length <= 80) return normalized;

  const truncated = normalized.slice(0, 80);
  const lastWordBoundary = truncated.lastIndexOf(' ');
  return lastWordBoundary > 0 ? truncated.slice(0, lastWordBoundary) : truncated;
};
const ListInputSchema = z
  .object({
    appId: z.string().uuid().optional(),
    category: z.string().min(1).max(80).optional(),
    cursor: AdminCursorSchema,
    limit: z.number().int().min(1).max(200).default(50),
    publisherId: z.string().uuid().optional(),
    query: z.string().transform(normalizeAdminSearchQuery).optional(),
    sort: z.enum(['catalog', 'name_asc', 'updated_desc']).optional(),
    status: moduleAppStatusSchema.optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });
const ListByAppInputSchema = AppIdInputSchema.extend({
  cursor: AdminCursorSchema,
  limit: z.number().int().min(1).max(200).default(50),
});
const ListPackagesInputSchema = z
  .object({
    appId: z.string().uuid().optional(),
    buildStatus: z.enum(['building', 'failed', 'queued', 'ready']).optional(),
    cursor: AdminCursorSchema,
    limit: z.number().int().min(1).max(200).default(50),
    publisherId: z.string().uuid().optional(),
    reviewStatus: moduleAppPackageReviewStatusSchema.optional(),
    submittedByUserId: z.string().min(1).max(255).optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });
const RejectPackageInputSchema = PackageIdInputSchema.extend({
  reason: z.string().min(1).max(1000).optional(),
});
const OrderIdInputSchema = z.object({ orderId: z.string().uuid() });
const SettleOrderInputSchema = OrderIdInputSchema.extend({
  paymentReference: z.string().min(1).max(240),
});
const RefundOrderInputSchema = OrderIdInputSchema.extend({
  reason: z.string().min(1).max(1000),
});
const ResolvePendingRefundInputSchema = OrderIdInputSchema.extend({
  note: z.string().trim().min(1).max(500),
  resolution: z.enum(['failed', 'succeeded']),
});
const OfflineRefundOrderInputSchema = RefundOrderInputSchema.extend({
  offlineRefundReference: z.string().trim().min(1).max(240),
});
const PaymentQueryInputSchema = z.object({
  outTradeNo: z.string().min(1).max(240),
  provider: paymentProviderSchema.optional(),
});
const ReconcilePendingInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(100),
});
const PaymentDiscrepancyListInputSchema = z
  .object({
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(500).default(50),
    status: z.enum(['open', 'resolved']).optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });
const PaymentDiscrepancyIdInputSchema = z.object({ discrepancyId: z.string().uuid() });
const ListRevenueInputSchema = z
  .object({
    appId: z.string().uuid().optional(),
    cursor: AdminCursorSchema,
    limit: z.number().int().min(1).max(200).default(50),
    publisherId: z.string().uuid().optional(),
    publisherUserId: z.string().min(1).max(255).optional(),
    status: z.enum(['pending', 'reversed', 'settled']).optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });
const SettleRevenueBatchInputSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(500),
});
const PublisherIdInputSchema = z.object({ publisherId: z.string().uuid() });
const CreatePublisherInputSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  recipientMask: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .refine((value) => value.includes('*'))
    .optional(),
  userId: z.string().trim().min(1).max(255),
});
const VerifyPublisherInputSchema = PublisherIdInputSchema.extend({
  verificationMetadata: z
    .record(z.string().max(80), z.unknown())
    .refine((value) => Object.keys(value).length <= 50)
    .optional(),
});
const AssignPublisherInputSchema = AppIdInputSchema.extend({
  publisherId: z.string().uuid(),
});
const ListPublishersInputSchema = z
  .object({
    cursor: AdminCursorSchema,
    limit: z.number().int().min(1).max(200).default(50),
    status: moduleAppPublisherStatusSchema.optional(),
    userId: z.string().trim().min(1).max(255).optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });
const CreatePayoutBatchInputSchema = PublisherIdInputSchema.extend({
  requestedAmount: z.number().finite().positive().max(1_000_000_000_000),
  revenueEntryIds: z.array(z.string().uuid()).min(1).max(500),
});
const PayoutBatchIdInputSchema = z.object({ batchId: z.string().uuid() });
const TransitionPayoutBatchInputSchema = PayoutBatchIdInputSchema.extend({
  failureReason: z.string().trim().min(1).max(1000).optional(),
  status: moduleAppPayoutStatusSchema.exclude(['paid']),
});
const RecordManualAlipayPayoutInputSchema = PayoutBatchIdInputSchema.extend({
  evidenceReference: z.string().trim().min(1).max(1000),
  recipientMask: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .refine((value) => value.includes('*')),
  transactionNo: z.string().trim().min(1).max(240),
});
const ListPayoutsInputSchema = z
  .object({
    cursor: AdminCursorSchema,
    limit: z.number().int().min(1).max(200).default(50),
    publisherId: z.string().uuid().optional(),
    status: moduleAppPayoutStatusSchema.optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });
const ListPaymentDiagnosticsInputSchema = z
  .object({
    appId: z.string().uuid().optional(),
    cursor: AdminCursorSchema,
    discrepancyStatus: z.enum(['open', 'resolved']).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    orderId: z.string().uuid().optional(),
    paymentStatus: z.enum(['created', 'failed', 'paid', 'pending', 'refunded']).optional(),
    refundStatus: z.enum(['failed', 'requested', 'succeeded']).optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });

const ActionsInputSchema = z.object({
  actions: moduleAppAdminUpsertSchema.shape.actions,
  appId: z.string().uuid(),
});

const ConfigurationInputSchema = ActionsInputSchema.extend({
  expectedVersionId: z.string().uuid(),
  pages: moduleAppAdminUpsertSchema.shape.pages,
});

const BillingInputSchema = z.object({
  appId: z.string().uuid(),
  billing: moduleAppBillingConfigSchema,
});

const EntitlementsInputSchema = z.object({
  appId: z.string().uuid(),
  entitlements: z.array(moduleAppPlanEntitlementSchema).max(100),
});

const ModuleAppProductPriceSchema = z.object({
  amount: z.number().int().nonnegative().max(1_000_000_000),
  billingPeriod: z.enum(['monthly', 'yearly']).optional(),
  currency: moduleAppCurrencySchema,
  promotion: moduleAppPromotionSnapshotSchema.optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
});
const ModuleAppProductFieldsSchema = z.object({
  licenseScope: moduleAppLicenseScopeSchema,
  moduleMultiplier: moduleAppDecimalStringSchema.optional(),
  price: ModuleAppProductPriceSchema,
  productType: moduleAppProductTypeSchema,
  revenueShareRate: moduleAppRateStringSchema.optional(),
  seatCount: z.number().int().positive().max(100_000).optional(),
  termsVersion: z.string().trim().min(1).max(80).optional(),
});
const validateProductFields = (
  input: z.infer<typeof ModuleAppProductFieldsSchema>,
  ctx: z.RefinementCtx,
) => {
  const result = moduleAppProductSchema.safeParse({
    billingPeriod: input.price.billingPeriod,
    currency: input.price.currency,
    licenseScope: input.licenseScope,
    price: input.price.amount,
    productType: input.productType,
    seatCount: input.seatCount,
    trialDays: input.price.trialDays,
  });
  if (result.success) return;

  for (const issue of result.error.issues) {
    const [field, ...rest] = issue.path;
    const path =
      field === 'price'
        ? ['price', 'amount', ...rest]
        : field === 'billingPeriod' || field === 'trialDays'
          ? ['price', field, ...rest]
          : issue.path;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path });
  }
};
const CreateProductInputSchema = AppIdInputSchema.extend({
  ...ModuleAppProductFieldsSchema.shape,
  productKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
}).superRefine(validateProductFields);
const UpdateProductInputSchema = ModuleAppProductFieldsSchema.extend({
  productId: z.string().uuid(),
  status: z.enum(['active', 'inactive']),
}).superRefine(validateProductFields);

const writeAudit = async (
  ctx: { clientIp?: null | string; serverDB: LobeChatDatabase | Transaction; userId: string },
  input: {
    eventType: string;
    metadata?: null | Record<string, unknown>;
    resourceId: string;
    resourceType?: string;
    targetUserId?: null | string;
  },
) => {
  await writeModuleAppAuditLog({
    actorUserId: ctx.userId,
    clientIp: ctx.clientIp ?? null,
    db: ctx.serverDB,
    eventType: input.eventType,
    metadata: input.metadata,
    resourceId: input.resourceId,
    resourceType: input.resourceType ?? 'moduleApp',
    targetUserId: input.targetUserId ?? null,
  });
};

const runRequiredModuleAppAuditMutation = async <T>(
  ctx: { clientIp?: null | string; serverDB: LobeChatDatabase; userId: string },
  options: {
    audit: (
      result: T,
    ) => Parameters<typeof writeAudit>[1] | Promise<Parameters<typeof writeAudit>[1]>;
    mutation: (tx: Transaction) => Promise<T>;
  },
): Promise<T> =>
  ctx.serverDB.transaction(async (tx) => {
    const result = await options.mutation(tx);
    await writeAudit({ ...ctx, serverDB: tx }, await options.audit(result));
    return result;
  });

const requireAdminApp = async (db: LobeChatDatabase, appId: string) => {
  const app = await new ModuleAppModel(db).getAdminApp({ appId });

  if (!app) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_not_found' });
  }

  return app;
};

const getPackageErrorIdentifier = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return error instanceof Error ? error.message : '';
};

const mapPackageReviewError = (error: unknown) => {
  if (error instanceof TRPCError) return error;

  const identifier = getPackageErrorIdentifier(error);
  if (identifier === 'MODULE_APP_PACKAGE_SCAN_NOT_CLEAN') {
    return new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_PACKAGE_SUBMITTER_REQUIRED' ||
    identifier === 'MODULE_APP_PACKAGE_PUBLISHER_NOT_VERIFIED'
  ) {
    return new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: identifier });
  }
  if (identifier === 'MODULE_APP_PACKAGE_APP_OWNERSHIP_MISMATCH') {
    return new TRPCError({ cause: error, code: 'CONFLICT', message: identifier });
  }
  if (identifier === 'MODULE_APP_PACKAGE_NOT_FOUND') {
    return new TRPCError({ cause: error, code: 'NOT_FOUND', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_PACKAGE_NOT_PENDING_REVIEW' ||
    identifier === 'MODULE_APP_OUTBOUND_HOST_CLASSIFICATION_REQUIRED' ||
    identifier.startsWith('MODULE_APP_PACKAGE_RESCAN_')
  ) {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: identifier });
  }

  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'module_app_package_review_failed',
  });
};

const mapPublishError = (error: unknown) => {
  const identifier = getPackageErrorIdentifier(error);
  if (identifier === 'MODULE_APP_BUILD_NOT_READY') {
    return new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: identifier });
  }

  return error;
};

export const adminModuleAppsRouter = router({
  assignPublisher: moduleAppWriteProcedure
    .input(AssignPublisherInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await new ModuleAppPublisherModel(ctx.serverDB).assignApplication(input);
      await writeAudit(ctx, {
        eventType: 'module_app.publisher_assigned',
        metadata: { appId: input.appId },
        resourceId: input.publisherId,
        resourceType: 'moduleAppPublisher',
      });
      return result;
    }),

  acknowledgePaymentDiscrepancy: financeWriteProcedure
    .input(PaymentDiscrepancyIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await runRequiredModuleAppAuditMutation<any>(ctx, {
        audit: () => ({
          eventType: 'module_app.payment_discrepancy_acknowledged',
          resourceId: input.discrepancyId,
          resourceType: 'moduleAppPaymentDiscrepancy',
        }),
        mutation: (tx) =>
          new ModuleAppPaymentModel(tx as LobeChatDatabase).acknowledgeDiscrepancy(input),
      });
      return result;
    }),

  createPayoutBatch: financeWriteProcedure
    .input(CreatePayoutBatchInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertPayoutRecordingEnabled();
      assertPayoutPublisherAllowed(input.publisherId);
      const result = await runRequiredModuleAppAuditMutation<any>(ctx, {
        audit: (result) => ({
          eventType: 'module_app.payout_created',
          metadata: {
            publisherId: input.publisherId,
            requestedAmount: input.requestedAmount,
            revenueEntryIds: input.revenueEntryIds,
          },
          resourceId: result.id,
          resourceType: 'moduleAppPayout',
        }),
        mutation: (tx) =>
          new ModuleAppPayoutModel(tx as LobeChatDatabase).createEligibleBatch(input),
      });
      recordModuleAppPayoutState(result.status);
      return result;
    }),

  createPublisher: moduleAppWriteProcedure
    .input(CreatePublisherInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await new ModuleAppPublisherModel(ctx.serverDB).createPublisher(input);
      await writeAudit(ctx, {
        eventType: 'module_app.publisher_created',
        metadata: { userId: input.userId },
        resourceId: result.id,
        resourceType: 'moduleAppPublisher',
      });
      return result;
    }),

  exportPaymentReconciliation: financeReadProcedure
    .input(PaymentDiscrepancyListInputSchema)
    .query(async ({ ctx, input }) => {
      const filters = {
        ...input,
        limit: Math.min(500, input.limit),
      };
      const result = await new ModuleAppPaymentModel(ctx.serverDB).listDiscrepancies(filters);
      await writeAudit(ctx, {
        eventType: 'module_app.payment_reconciliation_exported',
        metadata: {
          count: result.items.length,
          filters,
        },
        resourceId: 'payment-reconciliation',
        resourceType: 'moduleAppPaymentReconciliation',
      });
      return result;
    }),

  createProduct: moduleAppWriteProcedure
    .input(CreateProductInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireAdminApp(ctx.serverDB, input.appId);
      return ctx.serverDB.transaction(async (tx: Transaction) => {
        const result = await new ModuleAppCommerceModel(tx as LobeChatDatabase).createProduct(
          input,
        );
        await writeAudit(
          { clientIp: ctx.clientIp ?? null, serverDB: tx, userId: ctx.userId },
          {
            eventType: 'module_app.product_created',
            metadata: { appId: input.appId, productKey: input.productKey },
            resourceId: result.id,
            resourceType: 'moduleAppProduct',
          },
        );
        return result;
      });
    }),

  get: moduleAppReadProcedure.input(AppIdInputSchema).query(async ({ ctx, input }) => {
    return requireAdminApp(ctx.serverDB, input.appId);
  }),

  getRuntimeDiagnostics: moduleAppReadProcedure.query(async ({ ctx }) => {
    const runtimeConfig = await getServerModuleAppRuntimeConfig(ctx.serverDB);
    const runtimeClient = new ModuleAppRuntimeClient({
      baseUrl: runtimeConfig.connections.internalUrl,
      enabled: runtimeConfig.switches.executionEnabled,
      internalToken: runtimeConfig.connections.internalToken,
      invocationEnabled: runtimeConfig.switches.invocationEnabled,
    });
    const scheduleDiagnostics = new ModuleAppAdminReadModel(ctx.serverDB)
      .getRuntimeScheduleDiagnostics()
      .then((result) => ({ ...result, status: 'available' as const }))
      .catch((error) => {
        console.error('[admin/module-apps] Failed to load schedule diagnostics:', error);
        return unavailableScheduleDiagnostics;
      });
    const [probe, enabledModels, paymentConfig, scheduler] = await Promise.all([
      runtimeClient.healthCheck(),
      getAllEnabledModels(ctx.serverDB),
      getServerPaymentConfig(ctx.serverDB),
      scheduleDiagnostics,
    ]);
    const enabledChatModelCount = enabledModels.filter((model) => model.type === 'chat').length;
    const paymentMethods = listEnabledPaymentMethods(paymentConfig, 'module_app');

    return {
      configuration: {
        ...runtimeClient.getConfigurationStatus(),
        publicOriginConfigured: runtimeConfig.configuration.publicOriginConfigured,
      },
      platformGateways: {
        ai: {
          configured: enabledChatModelCount > 0,
          enabledChatModelCount,
        },
        payments: {
          configured:
            paymentConfig.enabled &&
            paymentConfig.moduleAppEnabled &&
            paymentMethods.length > 0 &&
            Boolean(paymentConfig.publicBaseUrl),
          enabled: paymentConfig.enabled,
          methods: paymentMethods.map((method) => method.id),
          moduleAppEnabled: paymentConfig.moduleAppEnabled,
          publicOriginConfigured: Boolean(paymentConfig.publicBaseUrl),
          source: {
            backendManaged: paymentConfig.source.backendManaged,
            legacyEnvironmentKeyCount: paymentConfig.source.legacyEnvironmentKeys.length,
          },
        },
      },
      probe,
      requestedSwitches: runtimeConfig.requestedSwitches,
      scheduler,
      switches: runtimeConfig.switches,
    };
  }),

  dispatchSchedulesNow: moduleAppWriteProcedure.mutation(async ({ ctx }) => {
    return runRequiredAdminAuditExternalEffect(ctx, {
      audit: (status, result) => ({
        action: 'module_app.schedule_dispatch_executed',
        payload: {
          batchSize: ADMIN_SCHEDULE_DISPATCH_BATCH_SIZE,
          bookkeepingFailed: result?.bookkeepingFailed ?? null,
          claimed: result?.claimed ?? null,
          dispatched: result?.dispatched ?? null,
          failed: result?.failed ?? null,
          terminalStatus: status,
        },
        resourceId: 'module-app-scheduler',
        resourceType: 'moduleAppScheduleDispatcher',
      }),
      effect: () =>
        dispatchDueModuleAppSchedules({
          batchSize: ADMIN_SCHEDULE_DISPATCH_BATCH_SIZE,
          db: ctx.serverDB,
        }),
      terminalStatus: (result) =>
        result.failed > 0 || result.bookkeepingFailed > 0 ? 'failed' : 'succeeded',
    });
  }),

  list: moduleAppReadProcedure.input(ListInputSchema).query(async ({ ctx, input }) => {
    return new ModuleAppAdminReadModel(ctx.serverDB).listApplications(input);
  }),

  listProducts: moduleAppReadProcedure.input(AppIdInputSchema).query(async ({ ctx, input }) => {
    await requireAdminApp(ctx.serverDB, input.appId);
    return new ModuleAppCommerceModel(ctx.serverDB).listProducts(input);
  }),

  listPayouts: financeReadProcedure.input(ListPayoutsInputSchema).query(async ({ ctx, input }) => {
    return new ModuleAppAdminReadModel(ctx.serverDB).listPayouts(input);
  }),

  listPaymentDiagnostics: financeReadProcedure
    .input(ListPaymentDiagnosticsInputSchema)
    .query(async ({ ctx, input }) => {
      return new ModuleAppAdminReadModel(ctx.serverDB).listPaymentDiagnostics(input);
    }),

  listPublishers: publisherReadProcedure
    .input(ListPublishersInputSchema)
    .query(async ({ ctx, input }) => {
      return new ModuleAppAdminReadModel(ctx.serverDB).listPublishers(input);
    }),

  listRevenue: financeReadProcedure.input(ListRevenueInputSchema).query(async ({ ctx, input }) => {
    return new ModuleAppAdminReadModel(ctx.serverDB).listRevenue(input);
  }),

  reconcilePendingPayments: financeWriteProcedure
    .input(ReconcilePendingInputSchema)
    .mutation(async ({ ctx, input }) => {
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'module_app.pending_payments_reconciled',
          payload: {
            count: result?.count ?? 0,
            limit: input.limit,
            terminalStatus: status,
          },
          resourceId: 'pending-payments',
          resourceType: 'moduleAppPaymentReconciliation',
        }),
        effect: async () =>
          (await createConfiguredModulePaymentService(ctx.serverDB)).reconcilePendingPayments(
            input,
          ),
        terminalStatus: (result) =>
          result.results.some((item) => 'error' in item) ? 'failed' : 'succeeded',
      });
    }),

  recordManualAlipayPayout: financeWriteProcedure
    .input(RecordManualAlipayPayoutInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requirePayoutBatchForMutation(ctx.serverDB, input.batchId);
      const result = await runRequiredModuleAppAuditMutation<any>(ctx, {
        audit: (result) => ({
          eventType: 'module_app.payout_paid',
          metadata: {
            evidenceReference: input.evidenceReference,
            recipientMask: input.recipientMask,
            totalAmount: result.totalAmount,
            transactionNo: input.transactionNo,
          },
          resourceId: input.batchId,
          resourceType: 'moduleAppPayout',
        }),
        mutation: (tx) =>
          new ModuleAppPayoutModel(tx as LobeChatDatabase).recordManualAlipayPayout({
            actorUserId: ctx.userId,
            ...input,
          }),
      });
      recordModuleAppPayoutState(result.status);
      return result;
    }),

  refundOrder: financeWriteProcedure
    .input(OfflineRefundOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      return new ModuleAppOrderRevenueService(ctx.serverDB).refundOrder({
        actorUserId: ctx.userId,
        orderId: input.orderId,
        reason: input.reason,
        refundReference: `offline:${input.offlineRefundReference}`,
      });
    }),

  refundPaymentOrder: financeWriteProcedure
    .input(RefundOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status) => ({
          action: 'module_app.payment_refund_requested',
          payload: { reasonProvided: true, terminalStatus: status },
          resourceId: input.orderId,
          resourceType: 'moduleAppOrder',
        }),
        effect: async () =>
          (await createConfiguredModulePaymentService(ctx.serverDB)).refundOrder({
            actorUserId: ctx.userId,
            orderId: input.orderId,
            reason: input.reason,
          }),
      });
    }),

  resolvePaymentRefund: financeWriteProcedure
    .input(ResolvePendingRefundInputSchema)
    .mutation(async ({ ctx, input }) => {
      const paymentModel = new ModuleAppPaymentModel(ctx.serverDB);
      const [attempt, refund] = await Promise.all([
        paymentModel.getPaymentAttemptByOrderId(input.orderId),
        paymentModel.getRefundByOrderId(input.orderId),
      ]);
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'module_app.payment_refund_manually_resolved',
          payload: {
            note: input.note,
            provider: attempt?.provider ?? null,
            refundReference: refund?.providerRefundId ?? null,
            resolution: input.resolution,
            resultStatus: result?.status ?? null,
            terminalStatus: status,
          },
          resourceId: input.orderId,
          resourceType: 'moduleAppOrder',
        }),
        effect: async () =>
          new ModuleAppPaymentService(ctx.serverDB, undefined).resolvePendingRefund({
            actorUserId: ctx.userId,
            orderId: input.orderId,
            resolution: input.resolution,
          }),
      });
    }),

  retryPaymentQuery: financeWriteProcedure
    .input(PaymentQueryInputSchema)
    .mutation(async ({ ctx, input }) => {
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status) => ({
          action: 'module_app.payment_query_retried',
          payload: { hasOutTradeNo: true, terminalStatus: status },
          resourceId: 'payment-query',
          resourceType: 'moduleAppPaymentAttempt',
        }),
        effect: async () =>
          (await createConfiguredModulePaymentService(ctx.serverDB)).reconcilePayment(input),
      });
    }),

  retryRefundStatus: financeWriteProcedure
    .input(OrderIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status) => ({
          action: 'module_app.refund_status_retried',
          payload: { terminalStatus: status },
          resourceId: input.orderId,
          resourceType: 'moduleAppOrder',
        }),
        effect: async () =>
          (await createConfiguredModulePaymentService(ctx.serverDB)).reconcileRefund({
            actorUserId: ctx.userId,
            orderId: input.orderId,
          }),
        terminalStatus: (result) => (result.status === 'succeeded' ? 'succeeded' : 'failed'),
      });
    }),

  settleOrder: financeWriteProcedure
    .input(SettleOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      return new ModuleAppOrderRevenueService(ctx.serverDB).settleOrder({
        actorUserId: ctx.userId,
        ...input,
      });
    }),

  settleRevenueBatch: financeWriteProcedure
    .input(SettleRevenueBatchInputSchema)
    .mutation(async ({ ctx, input }) => {
      return new ModuleAppRevenueService(ctx.serverDB).settleBatchWithAudit({
        actorUserId: ctx.userId,
        entryIds: input.entryIds,
      });
    }),

  suspendPublisher: moduleAppWriteProcedure
    .input(PublisherIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await new ModuleAppPublisherModel(ctx.serverDB).suspendPublisher(input);
      await writeAudit(ctx, {
        eventType: 'module_app.publisher_suspended',
        resourceId: input.publisherId,
        resourceType: 'moduleAppPublisher',
      });
      return result;
    }),

  transitionPayoutBatch: financeWriteProcedure
    .input(TransitionPayoutBatchInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requirePayoutBatchForMutation(ctx.serverDB, input.batchId);
      const result = await runRequiredModuleAppAuditMutation<any>(ctx, {
        audit: () => ({
          eventType: `module_app.payout_${input.status}`,
          metadata: { failureReason: input.failureReason },
          resourceId: input.batchId,
          resourceType: 'moduleAppPayout',
        }),
        mutation: (tx) => new ModuleAppPayoutModel(tx as LobeChatDatabase).transitionBatch(input),
      });
      recordModuleAppPayoutState(result.status);
      return result;
    }),

  updateProduct: moduleAppWriteProcedure
    .input(UpdateProductInputSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.serverDB.transaction(async (tx: Transaction) => {
        const result = await new ModuleAppCommerceModel(tx as LobeChatDatabase).updateProduct(
          input,
        );
        await writeAudit(
          { clientIp: ctx.clientIp ?? null, serverDB: tx, userId: ctx.userId },
          {
            eventType: 'module_app.product_updated',
            metadata: { status: input.status },
            resourceId: input.productId,
            resourceType: 'moduleAppProduct',
          },
        );
        return result;
      });
    }),

  getPackage: moduleAppReadProcedure.input(PackageIdInputSchema).query(async ({ ctx, input }) => {
    const submission = await new ModuleAppModel(ctx.serverDB).getAdminPackageSubmission(input);

    if (!submission) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_package_not_found' });
    }

    return submission;
  }),

  listArtifacts: moduleAppReadProcedure
    .input(ListByAppInputSchema)
    .query(async ({ ctx, input }) => {
      await requireAdminApp(ctx.serverDB, input.appId);

      return new ModuleAppAdminReadModel(ctx.serverDB).listArtifacts(input);
    }),

  listAuditEvents: moduleAuditReadProcedure
    .input(ListByAppInputSchema)
    .query(async ({ ctx, input }) => {
      await requireAdminApp(ctx.serverDB, input.appId);

      return new ModuleAppAdminReadModel(ctx.serverDB).listAuditEvents(input);
    }),

  listPackages: moduleAppReadProcedure
    .input(ListPackagesInputSchema)
    .query(async ({ ctx, input }) => {
      return new ModuleAppAdminReadModel(ctx.serverDB).listPackages(input);
    }),

  listInstalls: moduleAppReadProcedure.input(ListByAppInputSchema).query(async ({ ctx, input }) => {
    await requireAdminApp(ctx.serverDB, input.appId);

    return new ModuleAppAdminReadModel(ctx.serverDB).listInstalls(input);
  }),

  listRecords: moduleAppReadProcedure.input(ListByAppInputSchema).query(async ({ ctx, input }) => {
    await requireAdminApp(ctx.serverDB, input.appId);

    return new ModuleAppAdminReadModel(ctx.serverDB).listRecords(input);
  }),

  listRuns: moduleAppReadProcedure.input(ListByAppInputSchema).query(async ({ ctx, input }) => {
    await requireAdminApp(ctx.serverDB, input.appId);

    return new ModuleAppAdminReadModel(ctx.serverDB).listRuns(input);
  }),

  publish: moduleAppWriteProcedure.input(AppIdInputSchema).mutation(async ({ ctx, input }) => {
    await requireAdminApp(ctx.serverDB, input.appId);

    try {
      await new ModuleAppModel(ctx.serverDB).setStatus({ appId: input.appId, status: 'published' });
    } catch (error) {
      throw mapPublishError(error);
    }
    await writeAudit(ctx, { eventType: 'module_app.published', resourceId: input.appId });

    return { ok: true };
  }),

  approvePackage: moduleAppWriteProcedure
    .input(ApprovePackageInputSchema)
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await new ModuleAppBuildService({ db: ctx.serverDB }).approvePackage({
          ...input,
          reviewedByUserId: ctx.userId,
        });
      } catch (error) {
        throw mapPackageReviewError(error);
      }

      await writeAudit(ctx, {
        eventType: 'module_app.package_approved',
        metadata: {
          buildId: result.build?.id,
          buildStatus: result.build?.status,
          outboundHostPolicies: result.outboundHostPolicies,
          outboundHostPurposes: result.outboundHostPolicies.map(({ purpose }) => purpose),
          packageId: input.packageId,
          slug: result.slug,
          versionId: result.versionId,
        },
        resourceId: result.appId,
      });

      return result;
    }),

  rescanPackage: moduleAppWriteProcedure
    .input(PackageIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await new ModuleAppPackageLifecycleService({
          db: ctx.serverDB,
        }).rescanLegacyPackage({
          ...input,
          reviewedByUserId: ctx.userId,
        });
      } catch (error) {
        throw mapPackageReviewError(error);
      }

      await writeAudit(ctx, {
        eventType: 'module_app.package_rescanned',
        metadata: {
          cleanupQueued: result.cleanupQueued,
          issueCodes: result.issueCodes,
          scanStatus: result.scanStatus,
        },
        resourceId: input.packageId,
        resourceType: 'moduleAppPackage',
      });

      return result;
    }),

  rejectPackage: moduleAppWriteProcedure
    .input(RejectPackageInputSchema)
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await new ModuleAppPackageLifecycleService({
          db: ctx.serverDB,
        }).releaseRejectedPackage({
          ...input,
          reviewedByUserId: ctx.userId,
        });
      } catch (error) {
        throw mapPackageReviewError(error);
      }

      await writeAudit(ctx, {
        eventType: 'module_app.package_rejected',
        metadata: {
          cleanupQueued: result.cleanupQueued,
          cleanupSkipped: 'cleanupSkipped' in result ? result.cleanupSkipped : false,
          reason: input.reason,
        },
        resourceId: input.packageId,
        resourceType: 'moduleAppPackage',
      });

      return result;
    }),

  unpublish: moduleAppWriteProcedure.input(AppIdInputSchema).mutation(async ({ ctx, input }) => {
    await requireAdminApp(ctx.serverDB, input.appId);

    await new ModuleAppModel(ctx.serverDB).setStatus({ appId: input.appId, status: 'unpublished' });
    await writeAudit(ctx, { eventType: 'module_app.unpublished', resourceId: input.appId });

    return { ok: true };
  }),

  upsert: moduleAppWriteProcedure
    .input(moduleAppAdminUpsertSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await new ModuleAppModel(ctx.serverDB).upsertAppForAdmin(input);

      await writeAudit(ctx, {
        eventType: 'module_app.upserted',
        metadata: { slug: input.slug, status: input.status },
        resourceId: result.id,
      });

      return result;
    }),

  upsertBilling: financeWriteProcedure
    .input(BillingInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireAdminApp(ctx.serverDB, input.appId);

      return runRequiredModuleAppAuditMutation(ctx, {
        audit: () => ({
          eventType: 'module_app.billing_upserted',
          metadata: { chargeMode: input.billing.chargeMode },
          resourceId: input.appId,
        }),
        mutation: (tx) => new ModuleAppModel(tx as LobeChatDatabase).upsertBillingForAdmin(input),
      });
    }),

  upsertEntitlements: financeWriteProcedure
    .input(EntitlementsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireAdminApp(ctx.serverDB, input.appId);

      return runRequiredModuleAppAuditMutation(ctx, {
        audit: () => ({
          eventType: 'module_app.entitlements_upserted',
          metadata: { count: input.entitlements.length },
          resourceId: input.appId,
        }),
        mutation: (tx) =>
          new ModuleAppModel(tx as LobeChatDatabase).upsertEntitlementsForAdmin(input, tx),
      });
    }),

  upsertConfiguration: moduleAppWriteProcedure
    .input(ConfigurationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireAdminApp(ctx.serverDB, input.appId);

      try {
        return await runRequiredModuleAppAuditMutation(ctx, {
          audit: () => ({
            eventType: 'module_app.configuration_upserted',
            metadata: { actions: input.actions.length, pages: input.pages.length },
            resourceId: input.appId,
          }),
          mutation: (tx) =>
            new ModuleAppModel(tx as LobeChatDatabase).upsertConfigurationForAdmin(input, tx),
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'MODULE_APP_CONFIGURATION_CONFLICT') {
          throw new TRPCError({ cause: error, code: 'CONFLICT', message: error.message });
        }
        throw error;
      }
    }),

  verifyPublisher: moduleAppWriteProcedure
    .input(VerifyPublisherInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await new ModuleAppPublisherModel(ctx.serverDB).verifyPublisher(input);
      await writeAudit(ctx, {
        eventType: 'module_app.publisher_verified',
        resourceId: input.publisherId,
        resourceType: 'moduleAppPublisher',
      });
      return result;
    }),
});
