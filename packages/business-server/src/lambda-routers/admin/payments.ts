import {
  type PaymentMethodId,
  paymentMethodIdSchema,
  type PaymentProvider,
  paymentProviderSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';

import { ModuleAppCreditModel } from '@/database/models/moduleAppCredit';
import {
  creditReservations,
  creditSettlementFailures,
  type SubscriptionPaymentOrderItem,
  subscriptionPaymentOrders,
  topUpOrders,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';
import {
  createOperationalPaymentConfig,
  getServerPaymentConfig,
} from '@/server/services/payments/config';
import { createPaymentAdapter } from '@/server/services/payments/factory';
import { SubscriptionPaymentService } from '@/server/services/payments/subscriptionPayment';
import { TopUpPaymentService } from '@/server/services/payments/topUpPayment';

import { runRequiredAdminAuditExternalEffect } from './audit';

const ONLINE_PAYMENT_PROVIDERS = ['alipay', 'wechat_pay', 'zpay'] as const;
const TopUpPaymentStatusSchema = z.enum([
  'pending',
  'paid',
  'canceled',
  'expired',
  'failed',
  'refunded',
]);
const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);
const financeWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeWrite);

const ListTopUpPaymentsInputSchema = z
  .object({
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(200).default(50),
    orderId: z.string().uuid().optional(),
    provider: paymentProviderSchema.optional(),
    status: TopUpPaymentStatusSchema.optional(),
    userId: z.string().trim().min(1).max(255).optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });

const ReconcileTopUpPaymentInputSchema = z.object({ orderId: z.string().uuid() });
const ReconcilePendingTopUpPaymentsInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(100),
});
const PaymentRefundInputSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
const ResolvePendingRefundInputSchema = z.object({
  note: z.string().trim().min(1).max(500),
  orderId: z.string().uuid(),
  resolution: z.enum(['failed', 'succeeded']),
});
const ListSubscriptionPaymentsInputSchema = ListTopUpPaymentsInputSchema;
const ReconcileSubscriptionPaymentInputSchema = ReconcileTopUpPaymentInputSchema;
const ReconcilePendingSubscriptionPaymentsInputSchema = ReconcilePendingTopUpPaymentsInputSchema;
const ListCreditSettlementFailuresInputSchema = z
  .object({
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(200).default(50),
    status: z.enum(['pending', 'resolved']).optional(),
  })
  .optional()
  .default({ cursor: 0, limit: 50 });
const RetryCreditSettlementFailureInputSchema = z.object({ failureId: z.string().uuid() });
const CreditSettlementPayloadSchema = z
  .object({
    actualAmount: z.number().finite().nonnegative().max(1_000_000_000_000),
    ledger: z
      .object({
        description: z.string().max(500).optional(),
        referenceType: z.string().max(240).optional(),
        title: z.string().max(240).optional(),
      })
      .strict()
      .optional(),
    metadata: z.record(z.string(), z.unknown()),
    reservationId: z.string().uuid(),
  })
  .strict();

type OnlineTopUpOrder = {
  externalOrderId: null | string;
  id: string;
  idempotencyKey: null | string;
  metadata: null | Record<string, unknown>;
  provider: null | string;
  status: string;
  userId: string;
};

type OnlineSubscriptionOrder = {
  id: string;
  idempotencyKey: string;
  method: PaymentMethodId;
  provider: PaymentProvider;
  status: string;
  userId: string;
};

type SubscriptionPaymentListRow = Pick<
  SubscriptionPaymentOrderItem,
  | 'amount'
  | 'createdAt'
  | 'currency'
  | 'cycle'
  | 'externalOrderId'
  | 'id'
  | 'idempotencyKey'
  | 'method'
  | 'paidAt'
  | 'plan'
  | 'provider'
  | 'refundReference'
  | 'refundStatus'
  | 'snapshot'
  | 'status'
  | 'updatedAt'
  | 'userId'
> & {
  userEmail: null | string;
  userName: null | string;
};

type TopUpPaymentListRow = {
  amount: string;
  createdAt: Date;
  credits: string;
  currency: string;
  externalOrderId: null | string;
  id: string;
  idempotencyKey: null | string;
  metadata: null | Record<string, unknown>;
  paidAt: Date | null;
  provider: null | string;
  refundReference: null | string;
  refundStatus: 'failed' | 'pending' | 'succeeded' | null;
  status: z.infer<typeof TopUpPaymentStatusSchema>;
  updatedAt: Date;
  userEmail: null | string;
  userId: string;
  userName: null | string;
};

const parseOnlineTopUpOrder = (order: OnlineTopUpOrder) => {
  const provider = paymentProviderSchema.safeParse(order.provider);
  const method = paymentMethodIdSchema.safeParse(order.metadata?.method);
  const providerMatchesMethod =
    provider.success &&
    method.success &&
    ((provider.data === 'alipay' && method.data === 'alipay') ||
      (provider.data === 'wechat_pay' && method.data === 'wechat_pay') ||
      (provider.data === 'zpay' &&
        (method.data === 'zpay_alipay' || method.data === 'zpay_wechat')));

  if (!providerMatchesMethod || !order.idempotencyKey?.trim()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'TOP_UP_PAYMENT_ORDER_INVALID' });
  }

  return {
    idempotencyKey: order.idempotencyKey,
    method: method.data,
    provider: provider.data,
    userId: order.userId,
  };
};

const parseOnlineSubscriptionOrder = (order: OnlineSubscriptionOrder) => ({
  ...order,
  method: paymentMethodIdSchema.parse(order.method),
  provider: paymentProviderSchema.parse(order.provider),
});

const createTopUpPaymentService = async (db: LobeChatDatabase) => {
  const config = createOperationalPaymentConfig(await getServerPaymentConfig(db));

  return new TopUpPaymentService(db, (provider: PaymentProvider, method: PaymentMethodId) => {
    const adapter = createPaymentAdapter(config, method);
    if (adapter.provider !== provider) throw new Error('TOP_UP_PAYMENT_ADAPTER_MISMATCH');
    return adapter;
  });
};

const createSubscriptionPaymentService = async (db: LobeChatDatabase) => {
  const config = createOperationalPaymentConfig(await getServerPaymentConfig(db));

  return new SubscriptionPaymentService(
    db,
    (provider: PaymentProvider, method: PaymentMethodId) => {
      const adapter = createPaymentAdapter(config, method);
      if (adapter.provider !== provider) {
        throw new Error('SUBSCRIPTION_PAYMENT_ADAPTER_MISMATCH');
      }
      return adapter;
    },
  );
};

const reconcileOrder = async (service: TopUpPaymentService, order: OnlineTopUpOrder) => {
  const validated = parseOnlineTopUpOrder(order);
  return service.reconcilePayment({
    idempotencyKey: validated.idempotencyKey,
    userId: validated.userId,
  });
};

const reconcileSubscriptionOrder = (
  service: SubscriptionPaymentService,
  order: OnlineSubscriptionOrder,
) =>
  service.reconcilePayment({
    idempotencyKey: order.idempotencyKey,
    userId: order.userId,
  });

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'PAYMENT_RECONCILIATION_FAILED';

export const adminPaymentsRouter = router({
  listCreditSettlementFailures: financeReadProcedure
    .input(ListCreditSettlementFailuresInputSchema)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.serverDB
        .select({
          actualAmount: creditSettlementFailures.actualAmount,
          attempts: creditSettlementFailures.attempts,
          createdAt: creditSettlementFailures.createdAt,
          errorCode: creditSettlementFailures.errorCode,
          errorMessage: creditSettlementFailures.errorMessage,
          id: creditSettlementFailures.id,
          lastAttemptAt: creditSettlementFailures.lastAttemptAt,
          payerScopeType: creditReservations.payerScopeType,
          payerUserId: creditReservations.payerUserId,
          payerWorkspaceId: creditReservations.payerWorkspaceId,
          reservationId: creditSettlementFailures.reservationId,
          reservationStatus: creditReservations.status,
          resolvedAt: creditSettlementFailures.resolvedAt,
          status: creditSettlementFailures.status,
          updatedAt: creditSettlementFailures.updatedAt,
        })
        .from(creditSettlementFailures)
        .innerJoin(
          creditReservations,
          eq(creditReservations.id, creditSettlementFailures.reservationId),
        )
        .where(input.status ? eq(creditSettlementFailures.status, input.status) : undefined)
        .orderBy(desc(creditSettlementFailures.updatedAt), desc(creditSettlementFailures.id))
        .limit(input.limit + 1)
        .offset(input.cursor);
      const hasMore = rows.length > input.limit;
      return {
        items: hasMore ? rows.slice(0, input.limit) : rows,
        nextCursor: hasMore ? input.cursor + input.limit : null,
      };
    }),

  listTopUpPayments: financeReadProcedure
    .input(ListTopUpPaymentsInputSchema)
    .query(async ({ ctx, input }) => {
      const conditions = [
        inArray(topUpOrders.provider, [...ONLINE_PAYMENT_PROVIDERS]),
        input.orderId ? eq(topUpOrders.id, input.orderId) : undefined,
        input.provider ? eq(topUpOrders.provider, input.provider) : undefined,
        input.status ? eq(topUpOrders.status, input.status) : undefined,
        input.userId ? eq(topUpOrders.userId, input.userId) : undefined,
      ].filter(Boolean);

      const rows = await ctx.serverDB
        .select({
          amount: topUpOrders.amount,
          createdAt: topUpOrders.createdAt,
          credits: topUpOrders.credits,
          currency: topUpOrders.currency,
          externalOrderId: topUpOrders.externalOrderId,
          id: topUpOrders.id,
          idempotencyKey: topUpOrders.idempotencyKey,
          metadata: topUpOrders.metadata,
          paidAt: topUpOrders.paidAt,
          provider: topUpOrders.provider,
          refundReference: topUpOrders.refundReference,
          refundStatus: topUpOrders.refundStatus,
          status: topUpOrders.status,
          updatedAt: topUpOrders.updatedAt,
          userEmail: users.email,
          userId: topUpOrders.userId,
          userName: users.username,
        })
        .from(topUpOrders)
        .leftJoin(users, eq(users.id, topUpOrders.userId))
        .where(and(...conditions))
        .orderBy(desc(topUpOrders.createdAt), desc(topUpOrders.id))
        .limit(input.limit + 1)
        .offset(input.cursor);

      const hasMore = rows.length > input.limit;
      const pageRows = (hasMore ? rows.slice(0, input.limit) : rows) as TopUpPaymentListRow[];
      const items = pageRows.map(({ metadata, provider: rawProvider, ...row }) => {
        const method = paymentMethodIdSchema.safeParse(metadata?.method);
        const provider = paymentProviderSchema.parse(rawProvider);
        return {
          ...row,
          method: method.success ? method.data : null,
          packageId: typeof metadata?.packageId === 'string' ? metadata.packageId : null,
          paymentReference:
            typeof metadata?.paymentReference === 'string' ? metadata.paymentReference : null,
          provider,
        };
      });

      return { items, nextCursor: hasMore ? input.cursor + input.limit : null };
    }),

  refundTopUpPayment: financeWriteProcedure
    .input(PaymentRefundInputSchema)
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.serverDB.query.topUpOrders.findFirst({
        where: eq(topUpOrders.id, input.orderId),
      });
      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'TOP_UP_ORDER_NOT_FOUND' });
      const validated = parseOnlineTopUpOrder(order);

      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'top_up.payment_refund_requested',
          payload: {
            debtAmount: result && 'debtAmount' in result ? result.debtAmount : 0,
            provider: validated.provider,
            reason: input.reason,
            resultStatus: result?.status ?? order.status,
            terminalStatus: status,
          },
          resourceId: order.id,
          resourceType: 'topUpPayment',
          targetUserId: order.userId,
        }),
        effect: async () =>
          (await createTopUpPaymentService(ctx.serverDB)).refundOrder({
            orderId: order.id,
            reason: input.reason,
            userId: order.userId,
          }),
      });
    }),

  resolveTopUpPaymentRefund: financeWriteProcedure
    .input(ResolvePendingRefundInputSchema)
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.serverDB.query.topUpOrders.findFirst({
        where: eq(topUpOrders.id, input.orderId),
      });
      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'TOP_UP_ORDER_NOT_FOUND' });
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'top_up.payment_refund_manually_resolved',
          payload: {
            note: input.note,
            provider: order.provider,
            refundReference: order.refundReference,
            resolution: input.resolution,
            resultStatus: result?.status ?? order.refundStatus,
            terminalStatus: status,
          },
          resourceId: order.id,
          resourceType: 'topUpPayment',
          targetUserId: order.userId,
        }),
        effect: async () =>
          (await createTopUpPaymentService(ctx.serverDB)).resolvePendingRefund({
            orderId: order.id,
            resolution: input.resolution,
            userId: order.userId,
          }),
      });
    }),

  reconcilePendingTopUpPayments: financeWriteProcedure
    .input(ReconcilePendingTopUpPaymentsInputSchema)
    .mutation(async ({ ctx, input }) => {
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'top_up.pending_payments_reconciled',
          payload: {
            count: result?.count ?? 0,
            failedCount: result?.failedCount ?? 0,
            limit: input.limit,
            terminalStatus: status,
          },
          resourceId: 'pending-top-up-payments',
          resourceType: 'topUpPaymentReconciliation',
        }),
        effect: async () => {
          const orders = await ctx.serverDB
            .select({
              externalOrderId: topUpOrders.externalOrderId,
              id: topUpOrders.id,
              idempotencyKey: topUpOrders.idempotencyKey,
              metadata: topUpOrders.metadata,
              provider: topUpOrders.provider,
              status: topUpOrders.status,
              userId: topUpOrders.userId,
            })
            .from(topUpOrders)
            .where(
              and(
                inArray(topUpOrders.provider, [...ONLINE_PAYMENT_PROVIDERS]),
                or(
                  eq(topUpOrders.status, 'pending'),
                  and(
                    eq(topUpOrders.status, 'canceled'),
                    inArray(topUpOrders.refundStatus, ['pending', 'failed']),
                  ),
                ),
              ),
            )
            .orderBy(asc(topUpOrders.createdAt), asc(topUpOrders.id))
            .limit(input.limit);
          if (orders.length === 0) return { count: 0, failedCount: 0, results: [] };

          const service = await createTopUpPaymentService(ctx.serverDB);
          const results = [];
          for (const order of orders) {
            try {
              results.push({
                ok: true as const,
                orderId: order.id,
                result: await reconcileOrder(service, order),
              });
            } catch (error) {
              results.push({ error: errorMessage(error), ok: false as const, orderId: order.id });
            }
          }

          const failedCount = results.filter((item) => !item.ok).length;
          return { count: results.length, failedCount, results };
        },
        terminalStatus: (result) => (result.failedCount > 0 ? 'failed' : 'succeeded'),
      });
    }),

  reconcileTopUpPayment: financeWriteProcedure
    .input(ReconcileTopUpPaymentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.serverDB.query.topUpOrders.findFirst({
        where: eq(topUpOrders.id, input.orderId),
      });
      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'TOP_UP_ORDER_NOT_FOUND' });

      const validated = parseOnlineTopUpOrder(order);
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'top_up.payment_reconciled',
          payload: {
            provider: validated.provider,
            providerStatus: result?.providerStatus ?? null,
            status: result?.status ?? order.status,
            terminalStatus: status,
          },
          resourceId: order.id,
          resourceType: 'topUpPayment',
          targetUserId: order.userId,
        }),
        effect: async () => reconcileOrder(await createTopUpPaymentService(ctx.serverDB), order),
      });
    }),

  listSubscriptionPayments: financeReadProcedure
    .input(ListSubscriptionPaymentsInputSchema)
    .query(async ({ ctx, input }) => {
      const conditions = [
        input.orderId ? eq(subscriptionPaymentOrders.id, input.orderId) : undefined,
        input.provider ? eq(subscriptionPaymentOrders.provider, input.provider) : undefined,
        input.status ? eq(subscriptionPaymentOrders.status, input.status) : undefined,
        input.userId ? eq(subscriptionPaymentOrders.userId, input.userId) : undefined,
      ].filter(Boolean);
      const rows = await ctx.serverDB
        .select({
          amount: subscriptionPaymentOrders.amount,
          createdAt: subscriptionPaymentOrders.createdAt,
          currency: subscriptionPaymentOrders.currency,
          cycle: subscriptionPaymentOrders.cycle,
          externalOrderId: subscriptionPaymentOrders.externalOrderId,
          id: subscriptionPaymentOrders.id,
          idempotencyKey: subscriptionPaymentOrders.idempotencyKey,
          method: subscriptionPaymentOrders.method,
          paidAt: subscriptionPaymentOrders.paidAt,
          plan: subscriptionPaymentOrders.plan,
          provider: subscriptionPaymentOrders.provider,
          refundReference: subscriptionPaymentOrders.refundReference,
          refundStatus: subscriptionPaymentOrders.refundStatus,
          snapshot: subscriptionPaymentOrders.snapshot,
          status: subscriptionPaymentOrders.status,
          updatedAt: subscriptionPaymentOrders.updatedAt,
          userEmail: users.email,
          userId: subscriptionPaymentOrders.userId,
          userName: users.username,
        })
        .from(subscriptionPaymentOrders)
        .leftJoin(users, eq(users.id, subscriptionPaymentOrders.userId))
        .where(and(...conditions))
        .orderBy(desc(subscriptionPaymentOrders.createdAt), desc(subscriptionPaymentOrders.id))
        .limit(input.limit + 1)
        .offset(input.cursor);
      const hasMore = rows.length > input.limit;
      const pageRows = (
        hasMore ? rows.slice(0, input.limit) : rows
      ) as SubscriptionPaymentListRow[];

      return {
        items: pageRows.map((item) => {
          const { snapshot, ...row } = item;
          return {
            ...row,
            displayName: snapshot.displayName,
            monthlyCredits: snapshot.monthlyCredits,
          };
        }),
        nextCursor: hasMore ? input.cursor + input.limit : null,
      };
    }),

  reconcilePendingSubscriptionPayments: financeWriteProcedure
    .input(ReconcilePendingSubscriptionPaymentsInputSchema)
    .mutation(async ({ ctx, input }) =>
      runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'subscription.pending_payments_reconciled',
          payload: {
            count: result?.count ?? 0,
            failedCount: result?.failedCount ?? 0,
            limit: input.limit,
            terminalStatus: status,
          },
          resourceId: 'pending-subscription-payments',
          resourceType: 'subscriptionPaymentReconciliation',
        }),
        effect: async () => {
          const orders = await ctx.serverDB
            .select({
              id: subscriptionPaymentOrders.id,
              idempotencyKey: subscriptionPaymentOrders.idempotencyKey,
              method: subscriptionPaymentOrders.method,
              provider: subscriptionPaymentOrders.provider,
              status: subscriptionPaymentOrders.status,
              userId: subscriptionPaymentOrders.userId,
            })
            .from(subscriptionPaymentOrders)
            .where(
              or(
                eq(subscriptionPaymentOrders.status, 'pending'),
                and(
                  eq(subscriptionPaymentOrders.status, 'canceled'),
                  inArray(subscriptionPaymentOrders.refundStatus, ['pending', 'failed']),
                ),
              ),
            )
            .orderBy(asc(subscriptionPaymentOrders.createdAt), asc(subscriptionPaymentOrders.id))
            .limit(input.limit);
          if (orders.length === 0) return { count: 0, failedCount: 0, results: [] };

          const service = await createSubscriptionPaymentService(ctx.serverDB);
          const results = [];
          for (const rawOrder of orders) {
            const order = parseOnlineSubscriptionOrder(rawOrder);
            try {
              results.push({
                ok: true as const,
                orderId: order.id,
                result: await reconcileSubscriptionOrder(service, order),
              });
            } catch (error) {
              results.push({ error: errorMessage(error), ok: false as const, orderId: order.id });
            }
          }
          const failedCount = results.filter((item) => !item.ok).length;
          return { count: results.length, failedCount, results };
        },
        terminalStatus: (result) => (result.failedCount > 0 ? 'failed' : 'succeeded'),
      }),
    ),

  reconcileSubscriptionPayment: financeWriteProcedure
    .input(ReconcileSubscriptionPaymentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const rawOrder = await ctx.serverDB.query.subscriptionPaymentOrders.findFirst({
        where: eq(subscriptionPaymentOrders.id, input.orderId),
      });
      if (!rawOrder) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND' });
      }
      const order = parseOnlineSubscriptionOrder(rawOrder);
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'subscription.payment_reconciled',
          payload: {
            provider: order.provider,
            providerStatus: result?.providerStatus ?? null,
            status: result?.status ?? order.status,
            terminalStatus: status,
          },
          resourceId: order.id,
          resourceType: 'subscriptionPayment',
          targetUserId: order.userId,
        }),
        effect: async () =>
          reconcileSubscriptionOrder(await createSubscriptionPaymentService(ctx.serverDB), order),
      });
    }),

  refundSubscriptionPayment: financeWriteProcedure
    .input(PaymentRefundInputSchema)
    .mutation(async ({ ctx, input }) => {
      const rawOrder = await ctx.serverDB.query.subscriptionPaymentOrders.findFirst({
        where: eq(subscriptionPaymentOrders.id, input.orderId),
      });
      if (!rawOrder) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND' });
      }
      const order = parseOnlineSubscriptionOrder(rawOrder);
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'subscription.payment_refund_requested',
          payload: {
            debtAmount: result && 'debtAmount' in result ? result.debtAmount : 0,
            provider: order.provider,
            reason: input.reason,
            resultStatus: result?.status ?? order.status,
            terminalStatus: status,
          },
          resourceId: order.id,
          resourceType: 'subscriptionPayment',
          targetUserId: order.userId,
        }),
        effect: async () =>
          (await createSubscriptionPaymentService(ctx.serverDB)).refundOrder({
            orderId: order.id,
            reason: input.reason,
            userId: order.userId,
          }),
      });
    }),

  resolveSubscriptionPaymentRefund: financeWriteProcedure
    .input(ResolvePendingRefundInputSchema)
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.serverDB.query.subscriptionPaymentOrders.findFirst({
        where: eq(subscriptionPaymentOrders.id, input.orderId),
      });
      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND' });
      }
      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'subscription.payment_refund_manually_resolved',
          payload: {
            note: input.note,
            provider: order.provider,
            refundReference: order.refundReference,
            resolution: input.resolution,
            resultStatus: result?.status ?? order.refundStatus,
            terminalStatus: status,
          },
          resourceId: order.id,
          resourceType: 'subscriptionPayment',
          targetUserId: order.userId,
        }),
        effect: async () =>
          (await createSubscriptionPaymentService(ctx.serverDB)).resolvePendingRefund({
            orderId: order.id,
            resolution: input.resolution,
            userId: order.userId,
          }),
      });
    }),

  retryCreditSettlementFailure: financeWriteProcedure
    .input(RetryCreditSettlementFailureInputSchema)
    .mutation(async ({ ctx, input }) => {
      const failure = await ctx.serverDB.query.creditSettlementFailures.findFirst({
        where: eq(creditSettlementFailures.id, input.failureId),
      });
      if (!failure) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'CREDIT_SETTLEMENT_FAILURE_NOT_FOUND' });
      }

      return runRequiredAdminAuditExternalEffect(ctx, {
        audit: (status, result) => ({
          action: 'credit.settlement_failure_retried',
          payload: {
            attempts: failure.attempts,
            resultStatus: result?.status ?? failure.status,
            terminalStatus: status,
          },
          resourceId: failure.id,
          resourceType: 'creditSettlementFailure',
        }),
        effect: async () => {
          if (failure.status === 'resolved') {
            return {
              duplicate: true,
              reservationId: failure.reservationId,
              status: 'resolved' as const,
            };
          }
          const payload = CreditSettlementPayloadSchema.parse(failure.payload);
          if (payload.reservationId !== failure.reservationId) {
            throw new Error('CREDIT_SETTLEMENT_FAILURE_PAYLOAD_MISMATCH');
          }
          const creditModel = new ModuleAppCreditModel(ctx.serverDB);
          try {
            await creditModel.settle(payload);
            await creditModel.resolveSettlementFailure(failure.reservationId);
          } catch (error) {
            try {
              await creditModel.recordSettlementFailure({
                actualAmount: payload.actualAmount,
                error,
                payload,
                reservationId: failure.reservationId,
              });
            } catch (persistenceError) {
              console.error('[billing] failed to persist admin settlement retry', persistenceError);
            }
            throw error;
          }
          return {
            duplicate: false,
            reservationId: failure.reservationId,
            status: 'resolved' as const,
          };
        },
      });
    }),
});
