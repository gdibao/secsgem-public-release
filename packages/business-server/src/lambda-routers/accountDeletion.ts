import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { CommercialModel } from '@/database/models/commercial';
import {
  creditAccounts,
  creditLedgerEntries,
  redemptionCodes,
  userPlanSnapshots,
} from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

const deletionProcedure = authedProcedure.use(serverDatabase);

export const accountDeletionRouter = router({
  request: deletionProcedure.mutation(async ({ ctx }) => {
    const db = ctx.serverDB;
    const userId = ctx.userId;

    const commercial = new CommercialModel(db, userId);
    const pendingOrders = await commercial.listTopUpOrders({ limit: 100 });
    const hasPending = pendingOrders.some((o) => o.status === 'pending');

    if (hasPending) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'PENDING_ORDERS_EXIST',
      });
    }

    await db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, userId))
        .limit(1);

      if (account && Number(account.balance) > 0) {
        const balance = Number(account.balance);
        await tx
          .update(creditAccounts)
          .set({
            balance: 0,
            totalDebited: Number(account.totalDebited) + balance,
          })
          .where(eq(creditAccounts.userId, userId));

        await tx.insert(creditLedgerEntries).values({
          amount: -balance,
          balanceAfter: 0,
          description: 'Account closure - balance cleared',
          referenceType: 'account_deletion',
          title: 'Account Closure',
          type: 'consume',
          userId,
        });
      }

      await tx
        .update(redemptionCodes)
        .set({ status: 'disabled' })
        .where(eq(redemptionCodes.createdByUserId, userId));

      await tx
        .update(userPlanSnapshots)
        .set({ status: 'canceled' })
        .where(eq(userPlanSnapshots.userId, userId));
    });

    return { success: true };
  }),
});
