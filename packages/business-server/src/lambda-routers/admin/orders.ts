import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { CommercialModel } from '@/database/models/commercial';
import { redemptionCodes, topUpOrders, users } from '@/database/schemas';
import type { Transaction } from '@/database/type';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';

import { createAdminCommand } from './adminCommand';
import { recordAdminAudit, runRequiredAdminAuditMutation } from './audit';

const OrderStatusSchema = z.enum(['pending', 'paid', 'canceled', 'expired', 'failed', 'refunded']);
const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);
const financeWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeWrite);
const cancelCommand = createAdminCommand('order.cancel');
const expireCommand = createAdminCommand('order.expire');
const settleCommand = createAdminCommand('order.settle');
const redemptionOrderCondition = or(
  eq(topUpOrders.source, 'redemption'),
  eq(topUpOrders.provider, 'redemption'),
  isNotNull(topUpOrders.redemptionCodeId),
);

const getPendingRedemptionOrder = async (
  tx: Transaction,
  orderId: string,
  unavailableMessage: 'ORDER_NOT_CANCELABLE' | 'ORDER_NOT_EXPIRABLE',
) => {
  const [order] = await tx
    .select({
      id: topUpOrders.id,
      provider: topUpOrders.provider,
      redemptionCodeId: topUpOrders.redemptionCodeId,
      source: topUpOrders.source,
      status: topUpOrders.status,
      userId: topUpOrders.userId,
    })
    .from(topUpOrders)
    .where(eq(topUpOrders.id, orderId))
    .limit(1);

  if (!order || order.status !== 'pending') throw new Error(unavailableMessage);
  if (order.source !== 'redemption' && order.provider !== 'redemption' && !order.redemptionCodeId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'ONLINE_PAYMENT_ORDER_REQUIRES_RECONCILIATION',
    });
  }

  return order;
};

export const adminOrdersRouter = router({
  cancel: financeWriteProcedure
    .input(z.object({ command: cancelCommand.schema, orderId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const command = cancelCommand.validate(input.command);
      await runRequiredAdminAuditMutation<{ id: string; userId: string }>(ctx, {
        audit: (order) => ({
          action: command.auditAction,
          resourceId: input.orderId,
          resourceType: 'top_up_order',
          targetUserId: order.userId,
        }),
        mutation: async (tx) => {
          await getPendingRedemptionOrder(tx, input.orderId, 'ORDER_NOT_CANCELABLE');
          const [order] = await tx
            .update(topUpOrders)
            .set({ status: 'canceled', updatedAt: new Date() })
            .where(
              and(
                eq(topUpOrders.id, input.orderId),
                eq(topUpOrders.status, 'pending'),
                redemptionOrderCondition,
              ),
            )
            .returning({ id: topUpOrders.id, userId: topUpOrders.userId });

          if (!order) throw new Error('ORDER_NOT_CANCELABLE');
          return order;
        },
      });

      return { ok: true };
    }),

  expire: financeWriteProcedure
    .input(z.object({ command: expireCommand.schema, orderId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const command = expireCommand.validate(input.command);
      await runRequiredAdminAuditMutation<{ id: string; userId: string }>(ctx, {
        audit: (order) => ({
          action: command.auditAction,
          resourceId: input.orderId,
          resourceType: 'top_up_order',
          targetUserId: order.userId,
        }),
        mutation: async (tx) => {
          await getPendingRedemptionOrder(tx, input.orderId, 'ORDER_NOT_EXPIRABLE');
          const [order] = await tx
            .update(topUpOrders)
            .set({ status: 'expired', updatedAt: new Date() })
            .where(
              and(
                eq(topUpOrders.id, input.orderId),
                eq(topUpOrders.status, 'pending'),
                redemptionOrderCondition,
              ),
            )
            .returning({ id: topUpOrders.id, userId: topUpOrders.userId });

          if (!order) throw new Error('ORDER_NOT_EXPIRABLE');
          return order;
        },
      });

      return { ok: true };
    }),

  getDetail: financeReadProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = ctx.serverDB;

      const [order] = await db
        .select({
          amount: topUpOrders.amount,
          createdAt: topUpOrders.createdAt,
          credits: topUpOrders.credits,
          currency: topUpOrders.currency,
          externalOrderId: topUpOrders.externalOrderId,
          id: topUpOrders.id,
          paidAt: topUpOrders.paidAt,
          provider: topUpOrders.provider,
          redemptionCodeId: topUpOrders.redemptionCodeId,
          source: topUpOrders.source,
          status: topUpOrders.status,
          updatedAt: topUpOrders.updatedAt,
          userEmail: users.email,
          userId: topUpOrders.userId,
          userFullName: users.fullName,
          userName: users.username,
        })
        .from(topUpOrders)
        .leftJoin(users, eq(topUpOrders.userId, users.id))
        .where(eq(topUpOrders.id, input.orderId))
        .limit(1);

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'ORDER_NOT_FOUND' });
      }

      let redemptionCode = null;
      if (order.redemptionCodeId) {
        const [code] = await db
          .select()
          .from(redemptionCodes)
          .where(eq(redemptionCodes.id, order.redemptionCodeId))
          .limit(1);
        redemptionCode = code ?? null;
      }

      await recordAdminAudit(ctx, {
        action: 'order.getDetail',
        resourceId: input.orderId,
        resourceType: 'top_up_order',
      });

      return { ...order, redemptionCode };
    }),

  settle: financeWriteProcedure
    .input(
      z.object({
        command: settleCommand.schema,
        orderId: z.string().min(1),
        reason: z.string().trim().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = settleCommand.validate(input.command, input.reason);
      const [order] = await ctx.serverDB
        .select({
          amount: topUpOrders.amount,
          credits: topUpOrders.credits,
          currency: topUpOrders.currency,
          provider: topUpOrders.provider,
          redemptionCodeId: topUpOrders.redemptionCodeId,
          source: topUpOrders.source,
          userId: topUpOrders.userId,
        })
        .from(topUpOrders)
        .where(eq(topUpOrders.id, input.orderId))
        .limit(1);

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'ORDER_NOT_FOUND' });
      }
      if (
        order.source !== 'redemption' &&
        order.provider !== 'redemption' &&
        !order.redemptionCodeId
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'ONLINE_PAYMENT_ORDER_REQUIRES_RECONCILIATION',
        });
      }

      return runRequiredAdminAuditMutation<{ status: string }>(ctx, {
        audit: (result) => ({
          action: command.auditAction,
          payload: {
            amount: Number(order.amount),
            credits: Number(order.credits),
            currency: order.currency,
            provider: order.provider,
            reason: command.reason,
            source: order.source,
            status: result.status,
          },
          resourceId: input.orderId,
          resourceType: 'top_up_order',
          targetUserId: order.userId,
        }),
        mutation: async (tx) => {
          const commercial = new CommercialModel(tx, order.userId);
          return commercial.settleTopUpOrder(input.orderId);
        },
      });
    }),

  list: financeReadProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(50),
        status: OrderStatusSchema.optional(),
        userId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
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
          paidAt: topUpOrders.paidAt,
          provider: topUpOrders.provider,
          redemptionCodeId: topUpOrders.redemptionCodeId,
          source: topUpOrders.source,
          status: topUpOrders.status,
          updatedAt: topUpOrders.updatedAt,
          userEmail: users.email,
          userId: topUpOrders.userId,
          userName: users.username,
        })
        .from(topUpOrders)
        .leftJoin(users, eq(users.id, topUpOrders.userId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(topUpOrders.createdAt), desc(topUpOrders.id))
        .limit(input.limit + 1)
        .offset(input.cursor);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;

      return {
        items,
        nextCursor: hasMore ? input.cursor + input.limit : null,
      };
    }),
});
