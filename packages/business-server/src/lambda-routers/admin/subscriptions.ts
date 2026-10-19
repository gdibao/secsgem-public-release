import { randomUUID } from 'node:crypto';

import type { Plans } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { CommercialModel } from '@/database/models/commercial';
import { subscriptionChangeRequests, userPlanSnapshots } from '@/database/schemas';
import { type Transaction } from '@/database/type';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';

import { createAdminCommand } from './adminCommand';
import { recordAdminAuditStrict, runRequiredAdminAuditMutation } from './audit';

const CHANGE_REQUEST_STATUSES = ['pending', 'completed', 'canceled', 'rejected'] as const;
const SUBSCRIPTION_CYCLES = ['monthly', 'yearly', 'one_time', 'lifetime'] as const;
const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);
const financeWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeWrite);
const bulkApproveCommand = createAdminCommand('subscription.changeRequest.bulkApprove');
const bulkRejectCommand = createAdminCommand('subscription.changeRequest.bulkReject');
type BulkChangeRequestResult = { error?: string; ok: boolean; requestId: string };

const recordBulkChangeRequestItemAudit = async ({
  action,
  batchCorrelationId,
  ctx,
  error,
  request,
  requestId,
  tx,
}: {
  action: 'approve' | 'reject';
  batchCorrelationId: string;
  ctx: { clientIp?: null | string; userId: string };
  error?: string;
  request?: typeof subscriptionChangeRequests.$inferSelect;
  requestId: string;
  tx: Transaction;
}) =>
  recordAdminAuditStrict(
    { ...ctx, serverDB: tx },
    {
      action: `subscription.changeRequest.bulk${action === 'approve' ? 'Approve' : 'Reject'}.item`,
      payload: {
        ...(request
          ? { cycle: request.cycle, fromPlan: request.fromPlan, toPlan: request.toPlan }
          : {}),
        error: error ?? null,
        batchCorrelationId,
        result: error ? 'failed' : 'succeeded',
      },
      resourceId: requestId,
      resourceType: 'subscription_change_request',
      targetUserId: request?.userId,
    },
    { correlationId: batchCorrelationId, status: error ? 'failed' : 'succeeded' },
  );

export const adminSubscriptionsRouter = router({
  assignPlan: financeWriteProcedure
    .input(
      z.object({
        cycle: z.enum(SUBSCRIPTION_CYCLES),
        durationMonths: z.number().int().min(1).max(120),
        plan: z.string().min(1),
        reason: z.string().min(1).max(500),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assignedAt = Date.now();
      const adminSubscriptionId = `admin-${ctx.userId}-${assignedAt}`;
      const request = await runRequiredAdminAuditMutation<{ id: string }>(ctx, {
        audit: (request) => ({
          action: 'subscription.assignPlan',
          payload: {
            cycle: input.cycle,
            durationMonths: input.durationMonths,
            plan: input.plan,
            reason: input.reason,
            requestId: request.id,
          },
          resourceType: 'subscription',
          targetUserId: input.userId,
        }),
        mutation: async (tx) =>
          new CommercialModel(tx, input.userId).grantPlanManually({
            assignedByUserId: ctx.userId,
            cycle: input.cycle,
            durationMonths: input.durationMonths,
            manualGrantId: adminSubscriptionId,
            reason: input.reason,
            targetPlan: input.plan as Plans,
            tx,
          }),
      });

      return { ok: true, requestId: request.id };
    }),

  forceChange: financeWriteProcedure
    .input(
      z.object({
        cycle: z.enum(SUBSCRIPTION_CYCLES),
        plan: z.string().min(1),
        reason: z.string().trim().min(1).max(500),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<void>(ctx, {
        audit: () => ({
          action: 'subscription.forceChange',
          payload: { cycle: input.cycle, plan: input.plan, reason: input.reason },
          resourceType: 'subscription',
          targetUserId: input.userId,
        }),
        mutation: async (tx) => {
          const model = new CommercialModel(ctx.serverDB, input.userId);
          const request = await model.createSubscriptionChangeRequest(
            {
              cycle: input.cycle,
              targetPlan: input.plan as Plans,
            },
            { tx },
          );
          await model.activateSubscriptionChangeRequest(request.id, { tx });
        },
      });
      return { ok: true };
    }),

  getUserSubscription: financeReadProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const snapshot = await ctx.serverDB.query.userPlanSnapshots.findFirst({
        orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
        where: and(
          eq(userPlanSnapshots.userId, input.userId),
          eq(userPlanSnapshots.status, 'active'),
          or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
        ),
      });
      return snapshot ?? null;
    }),

  list: financeReadProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
        plan: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, plan } = input;
      const now = new Date();
      const where = and(
        eq(userPlanSnapshots.status, 'active'),
        or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
        plan ? eq(userPlanSnapshots.plan, plan as Plans) : undefined,
      );

      const [items, [{ value: total }]] = await Promise.all([
        ctx.serverDB.query.userPlanSnapshots.findMany({
          limit,
          offset: cursor,
          orderBy: desc(userPlanSnapshots.createdAt),
          where,
        }),
        ctx.serverDB.select({ value: count() }).from(userPlanSnapshots).where(where),
      ]);

      const nextCursor = items.length === limit ? cursor + limit : null;
      return { items, nextCursor, total };
    }),

  // ---- Subscription Change Requests ----
  listChangeRequests: financeReadProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
        userId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, status, userId } = input;
      const conds = [
        status ? eq(subscriptionChangeRequests.status, status) : undefined,
        userId ? eq(subscriptionChangeRequests.userId, userId) : undefined,
      ].filter(Boolean) as Array<Exclude<ReturnType<typeof eq>, undefined>>;
      const where = conds.length > 0 ? and(...conds) : undefined;

      const [items, [{ value: total }]] = await Promise.all([
        ctx.serverDB.query.subscriptionChangeRequests.findMany({
          limit,
          offset: cursor,
          orderBy: desc(subscriptionChangeRequests.createdAt),
          where,
        }),
        ctx.serverDB.select({ value: count() }).from(subscriptionChangeRequests).where(where),
      ]);

      return {
        items,
        nextCursor: items.length === limit ? cursor + limit : null,
        total,
      };
    }),

  approveChangeRequest: financeWriteProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<any>(ctx, {
        audit: (request) => ({
          action: 'subscription.changeRequest.approve',
          payload: { cycle: request.cycle, fromPlan: request.fromPlan, toPlan: request.toPlan },
          resourceId: request.id,
          resourceType: 'subscription_change_request',
          targetUserId: request.userId,
        }),
        mutation: async (tx) => {
          const request = await tx.query.subscriptionChangeRequests.findFirst({
            where: eq(subscriptionChangeRequests.id, input.requestId),
          });
          if (!request)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Change request not found' });
          if (request.status !== 'pending')
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' });

          await new CommercialModel(ctx.serverDB, request.userId).activateSubscriptionChangeRequest(
            request.id,
            { tx },
          );
          return request;
        },
      });
      return { ok: true };
    }),

  rejectChangeRequest: financeWriteProcedure
    .input(
      z.object({
        reason: z.string().max(500).optional(),
        requestId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<any>(ctx, {
        audit: (request) => ({
          action: 'subscription.changeRequest.reject',
          payload: { cycle: request.cycle, reason: input.reason, toPlan: request.toPlan },
          resourceId: request.id,
          resourceType: 'subscription_change_request',
          targetUserId: request.userId,
        }),
        mutation: async (tx) => {
          const request = await tx.query.subscriptionChangeRequests.findFirst({
            where: eq(subscriptionChangeRequests.id, input.requestId),
          });
          if (!request)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Change request not found' });
          if (request.status !== 'pending')
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' });

          await tx
            .update(subscriptionChangeRequests)
            .set({ status: 'rejected', updatedAt: new Date() })
            .where(eq(subscriptionChangeRequests.id, request.id));
          return request;
        },
      });
      return { ok: true };
    }),

  bulkApproveChangeRequests: financeWriteProcedure
    .input(
      z.object({
        command: bulkApproveCommand.schema,
        requestIds: z.array(z.string().min(1)).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = bulkApproveCommand.validate(input.command);
      const batchCorrelationId = randomUUID();
      const results = await runRequiredAdminAuditMutation<BulkChangeRequestResult[]>(ctx, {
        audit: (results) => ({
          action: command.auditAction,
          payload: {
            failed: results.filter((result) => !result.ok).length,
            succeeded: results.filter((result) => result.ok).length,
            total: results.length,
          },
          resourceType: 'subscription_change_request',
        }),
        mutation: async (tx) => {
          const requestIds = [...new Set(input.requestIds)];
          if (requestIds.length !== input.requestIds.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'DUPLICATE_REQUEST_IDS' });
          }
          const requests = await tx
            .select()
            .from(subscriptionChangeRequests)
            .where(inArray(subscriptionChangeRequests.id, requestIds))
            .for('update');
          const requestsById = new Map(requests.map((request) => [request.id, request]));
          for (const requestId of requestIds) {
            const request = requestsById.get(requestId);
            if (!request) {
              throw new TRPCError({ code: 'NOT_FOUND', message: 'CHANGE_REQUEST_NOT_FOUND' });
            }
            if (request.status !== 'pending') {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'CHANGE_REQUEST_NOT_PENDING' });
            }
          }

          const results: BulkChangeRequestResult[] = [];
          for (const requestId of requestIds) {
            const request = requestsById.get(requestId)!;
            await new CommercialModel(
              ctx.serverDB,
              request.userId,
            ).activateSubscriptionChangeRequest(request.id, { tx });
            await recordBulkChangeRequestItemAudit({
              action: 'approve',
              batchCorrelationId,
              ctx,
              request,
              requestId,
              tx,
            });
            results.push({ ok: true, requestId });
          }
          return results;
        },
        correlationId: batchCorrelationId,
      });
      return { results };
    }),

  bulkRejectChangeRequests: financeWriteProcedure
    .input(
      z.object({
        command: bulkRejectCommand.schema,
        reason: z.string().max(500).optional(),
        requestIds: z.array(z.string().min(1)).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = bulkRejectCommand.validate(input.command, input.reason);
      const batchCorrelationId = randomUUID();
      const results = await runRequiredAdminAuditMutation<BulkChangeRequestResult[]>(ctx, {
        audit: (results) => ({
          action: command.auditAction,
          payload: {
            failed: results.filter((result) => !result.ok).length,
            reason: command.reason,
            succeeded: results.filter((result) => result.ok).length,
            total: results.length,
          },
          resourceType: 'subscription_change_request',
        }),
        mutation: async (tx) => {
          const requestIds = [...new Set(input.requestIds)];
          if (requestIds.length !== input.requestIds.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'DUPLICATE_REQUEST_IDS' });
          }
          const requests = await tx
            .select()
            .from(subscriptionChangeRequests)
            .where(inArray(subscriptionChangeRequests.id, requestIds))
            .for('update');
          const requestsById = new Map(requests.map((request) => [request.id, request]));
          for (const requestId of requestIds) {
            const request = requestsById.get(requestId);
            if (!request) {
              throw new TRPCError({ code: 'NOT_FOUND', message: 'CHANGE_REQUEST_NOT_FOUND' });
            }
            if (request.status !== 'pending') {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'CHANGE_REQUEST_NOT_PENDING' });
            }
          }

          await tx
            .update(subscriptionChangeRequests)
            .set({ status: 'rejected', updatedAt: new Date() })
            .where(
              and(
                inArray(subscriptionChangeRequests.id, requestIds),
                eq(subscriptionChangeRequests.status, 'pending'),
              ),
            );

          const results: BulkChangeRequestResult[] = [];
          for (const requestId of requestIds) {
            const request = requestsById.get(requestId)!;
            await recordBulkChangeRequestItemAudit({
              action: 'reject',
              batchCorrelationId,
              ctx,
              request,
              requestId,
              tx,
            });
            results.push({ ok: true, requestId });
          }
          return results;
        },
        correlationId: batchCorrelationId,
      });
      return { results };
    }),
});
