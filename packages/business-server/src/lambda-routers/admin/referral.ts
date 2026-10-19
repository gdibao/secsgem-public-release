import { count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { referralRelations, referralRewards, users } from '@/database/schemas';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';

import { recordAdminAudit } from './audit';

const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);

export const adminReferralRouter = router({
  getReferralStats: financeReadProcedure.query(async ({ ctx }) => {
    const db = ctx.serverDB;

    const [totalResult] = await db.select({ count: count() }).from(referralRelations);

    const [activatedResult] = await db
      .select({ count: count() })
      .from(referralRelations)
      .where(eq(referralRelations.status, 'rewarded'));

    const [rewardResult] = await db
      .select({ total: sql<number>`coalesce(sum(${referralRewards.amount}), 0)` })
      .from(referralRewards);

    await recordAdminAudit(ctx, {
      action: 'referral.getStats',
      resourceType: 'referral',
    });

    return {
      activatedInvites: Number(activatedResult?.count ?? 0),
      totalInvites: Number(totalResult?.count ?? 0),
      totalRewardCredits: Number(rewardResult?.total ?? 0),
    };
  }),

  listReferralRelations: financeReadProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.serverDB
        .select({
          createdAt: referralRelations.createdAt,
          inviteeUserId: referralRelations.inviteeUserId,
          inviterUserId: referralRelations.inviterUserId,
          rewardCredits: referralRelations.rewardCredits,
          status: referralRelations.status,
          inviteeEmail: users.email,
        })
        .from(referralRelations)
        .leftJoin(users, eq(users.id, referralRelations.inviteeUserId))
        .orderBy(desc(referralRelations.createdAt))
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
