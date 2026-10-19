import { asc, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { creditAccounts, creditLedgerEntries } from '@/database/schemas';
import type { Transaction } from '@/database/type';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';

import { createAdminCommand } from './adminCommand';
import { recordAdminAudit, runRequiredAdminAuditMutation } from './audit';

const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);
const financeWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeWrite);
const adjustCommand = createAdminCommand('credits.adjust');

const creditAccountAuditSnapshot = {
  balance: creditAccounts.balance,
  totalCredited: creditAccounts.totalCredited,
  totalDebited: creditAccounts.totalDebited,
};

export const adminCreditsRouter = router({
  adjust: financeWriteProcedure
    .input(
      z.object({
        amount: z.number().int(),
        command: adjustCommand.schema,
        reason: z.string().min(1).max(500).optional(),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = adjustCommand.validate(input.command, input.reason);
      const { amount, userId } = input;
      const reason = command.reason!;

      await runRequiredAdminAuditMutation(ctx, {
        audit: (snapshots) => ({
          action: command.auditAction,
          payload: { amount, reason, ...snapshots },
          resourceType: 'credit_account',
          targetUserId: userId,
        }),
        mutation: async (tx: Transaction) => {
          await tx
            .insert(creditAccounts)
            .values({ balance: 0, totalCredited: 0, totalDebited: 0, userId })
            .onConflictDoNothing({ target: creditAccounts.userId });

          const [before] = await tx
            .select(creditAccountAuditSnapshot)
            .from(creditAccounts)
            .where(eq(creditAccounts.userId, userId));

          if (amount > 0) {
            await tx
              .update(creditAccounts)
              .set({
                balance: sql`${creditAccounts.balance} + ${amount}`,
                totalCredited: sql`${creditAccounts.totalCredited} + ${amount}`,
                updatedAt: new Date(),
              })
              .where(eq(creditAccounts.userId, userId));
          } else {
            // Pre-check: ensure sufficient balance for negative adjustment
            if (before && Number(before.balance) + amount < 0) {
              throw new Error(
                `Insufficient balance: current ${before.balance}, adjustment ${amount}`,
              );
            }

            await tx
              .update(creditAccounts)
              .set({
                balance: sql`${creditAccounts.balance} + ${amount}`,
                totalDebited: sql`${creditAccounts.totalDebited} + ${Math.abs(amount)}`,
                updatedAt: new Date(),
              })
              .where(eq(creditAccounts.userId, userId));
          }

          const [after] = await tx
            .select(creditAccountAuditSnapshot)
            .from(creditAccounts)
            .where(eq(creditAccounts.userId, userId));

          if (!after) {
            throw new Error(`Credit account not found after adjustment: ${userId}`);
          }

          await tx.insert(creditLedgerEntries).values({
            amount,
            balanceAfter: after.balance,
            description: reason,
            referenceType: 'admin_adjustment',
            title: 'Admin Adjustment',
            type: 'adjustment',
            userId,
          });

          return { after, before: before ?? null };
        },
      });

      return { ok: true };
    }),

  exportAccounts: financeReadProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(10_000).default(5000),
        negativeOnly: z.boolean().optional(),
        order: z.enum(['asc', 'desc']).default('desc'),
        sort: z.enum(['balance', 'totalCredited', 'totalDebited', 'updatedAt']).default('balance'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const col =
        input.sort === 'totalCredited'
          ? creditAccounts.totalCredited
          : input.sort === 'totalDebited'
            ? creditAccounts.totalDebited
            : input.sort === 'updatedAt'
              ? creditAccounts.updatedAt
              : creditAccounts.balance;
      const orderBy = input.order === 'asc' ? asc(col) : desc(col);
      const where = input.negativeOnly ? lt(creditAccounts.balance, 0) : undefined;
      const items = await ctx.serverDB.query.creditAccounts.findMany({
        limit: input.limit,
        orderBy,
        where,
      });

      await recordAdminAudit(ctx, {
        action: 'credits.export',
        payload: {
          count: items.length,
          filters: {
            negativeOnly: Boolean(input.negativeOnly),
            order: input.order,
            sort: input.sort,
          },
          limit: input.limit,
        },
        resourceType: 'credit_account',
      });

      return { items };
    }),

  getBalance: financeReadProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.serverDB.query.creditAccounts.findFirst({
        where: eq(creditAccounts.userId, input.userId),
      });

      return { balance: row?.balance ?? 0, currency: row?.currency ?? 'credits' };
    }),

  ledger: financeReadProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        userId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, userId } = input;

      const items = await ctx.serverDB.query.creditLedgerEntries.findMany({
        limit,
        offset: cursor,
        orderBy: desc(creditLedgerEntries.createdAt),
        where: eq(creditLedgerEntries.userId, userId),
      });

      return {
        items,
        nextCursor: items.length === limit ? cursor + limit : null,
      };
    }),

  /**
   * Global credit-account list, ordered by selected metric. Supports a
   * `negativeOnly` filter to surface anomalous accounts.
   */
  listAccounts: financeReadProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(50),
        negativeOnly: z.boolean().optional(),
        order: z.enum(['asc', 'desc']).default('desc'),
        sort: z.enum(['balance', 'totalCredited', 'totalDebited', 'updatedAt']).default('balance'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const col =
        input.sort === 'totalCredited'
          ? creditAccounts.totalCredited
          : input.sort === 'totalDebited'
            ? creditAccounts.totalDebited
            : input.sort === 'updatedAt'
              ? creditAccounts.updatedAt
              : creditAccounts.balance;
      const orderBy = input.order === 'asc' ? asc(col) : desc(col);
      const where = input.negativeOnly ? lt(creditAccounts.balance, 0) : undefined;

      const items = await ctx.serverDB.query.creditAccounts.findMany({
        limit: input.limit,
        offset: input.cursor,
        orderBy,
        where,
      });

      await recordAdminAudit(ctx, {
        action: 'credits.list',
        payload: {
          count: items.length,
          cursor: Math.min(input.cursor, 1_000_000_000),
          filters: {
            limit: input.limit,
            negativeOnly: input.negativeOnly === true,
            order: input.order,
            sort: input.sort,
          },
        },
        resourceType: 'credit_account',
      });

      return {
        items,
        nextCursor: items.length === input.limit ? input.cursor + input.limit : null,
      };
    }),
});
