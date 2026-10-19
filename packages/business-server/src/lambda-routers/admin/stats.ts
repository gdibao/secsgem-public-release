import { and, count, eq, gte, isNull, or, sql } from 'drizzle-orm';

import { redemptionCodes, topUpOrders, userPlanSnapshots, users } from '@/database/schemas';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';

const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);

const effectiveActiveSubscription = (now: Date) =>
  and(
    eq(userPlanSnapshots.status, 'active'),
    or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
  );

export const adminStatsRouter = router({
  overview: financeReadProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      [{ value: totalUsers }],
      [{ value: dau }],
      [{ value: mau }],
      [{ value: activeSubscriptions }],
      [{ value: topUpRevenue }],
      [{ value: subscriptionSnapshotAmount }],
    ] = await Promise.all([
      ctx.serverDB.select({ value: count() }).from(users),
      ctx.serverDB.select({ value: count() }).from(users).where(gte(users.lastActiveAt, oneDayAgo)),
      ctx.serverDB
        .select({ value: count() })
        .from(users)
        .where(gte(users.lastActiveAt, thirtyDaysAgo)),
      ctx.serverDB
        .select({ value: count() })
        .from(userPlanSnapshots)
        .where(effectiveActiveSubscription(now)),
      ctx.serverDB
        .select({
          value: sql<number>`COALESCE(SUM(${topUpOrders.amount}), 0)`,
        })
        .from(topUpOrders)
        .where(and(eq(topUpOrders.status, 'paid'), gte(topUpOrders.paidAt, thirtyDaysAgo))),
      ctx.serverDB
        .select({
          value: sql<number>`COALESCE(SUM(${userPlanSnapshots.monthlyPrice}), 0)`,
        })
        .from(userPlanSnapshots)
        .where(
          and(effectiveActiveSubscription(now), gte(userPlanSnapshots.startedAt, thirtyDaysAgo)),
        ),
    ]);

    const revenueLast30dUsd = Number(topUpRevenue ?? 0);

    return {
      activeSubscriptions,
      dau,
      mau,
      revenueLast30dUsd,
      subscriptionSnapshotAmountLast30d: Number(subscriptionSnapshotAmount ?? 0),
      totalUsers,
    };
  }),

  dauTrend: financeReadProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Bucket users by day of last_active_at
    const rows = await ctx.serverDB
      .select({
        count: count(),
        day: sql<string>`to_char(date_trunc('day', ${users.lastActiveAt}), 'YYYY-MM-DD')`,
      })
      .from(users)
      .where(gte(users.lastActiveAt, thirtyDaysAgo))
      .groupBy(sql`date_trunc('day', ${users.lastActiveAt})`)
      .orderBy(sql`date_trunc('day', ${users.lastActiveAt})`);

    return rows.map((r: { count: number; day: unknown }) => ({
      count: Number(r.count),
      day: r.day,
    }));
  }),

  subscriptionsByPlan: financeReadProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const rows = await ctx.serverDB
      .select({ count: count(), plan: userPlanSnapshots.plan })
      .from(userPlanSnapshots)
      .where(effectiveActiveSubscription(now))
      .groupBy(userPlanSnapshots.plan);

    return rows.map((r: { count: number; plan: string }) => ({
      count: Number(r.count),
      plan: r.plan,
    }));
  }),

  revenueByMonth: financeReadProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const topUpRows = await ctx.serverDB
      .select({
        amount: sql<number>`COALESCE(SUM(${topUpOrders.amount}), 0)`,
        month: sql<string>`to_char(date_trunc('month', ${topUpOrders.paidAt}), 'YYYY-MM')`,
      })
      .from(topUpOrders)
      .where(and(eq(topUpOrders.status, 'paid'), gte(topUpOrders.paidAt, sixMonthsAgo)))
      .groupBy(sql`date_trunc('month', ${topUpOrders.paidAt})`)
      .orderBy(sql`date_trunc('month', ${topUpOrders.paidAt})`);

    const subRows = await ctx.serverDB
      .select({
        amount: sql<number>`COALESCE(SUM(${userPlanSnapshots.monthlyPrice}), 0)`,
        month: sql<string>`to_char(date_trunc('month', ${userPlanSnapshots.startedAt}), 'YYYY-MM')`,
      })
      .from(userPlanSnapshots)
      .where(and(effectiveActiveSubscription(now), gte(userPlanSnapshots.startedAt, sixMonthsAgo)))
      .groupBy(sql`date_trunc('month', ${userPlanSnapshots.startedAt})`)
      .orderBy(sql`date_trunc('month', ${userPlanSnapshots.startedAt})`);

    const map = new Map<
      string,
      { month: string; subscription: number; subscriptionSnapshotAmount: number; topup: number }
    >();
    for (const r of topUpRows)
      map.set(r.month, {
        month: r.month,
        subscription: 0,
        subscriptionSnapshotAmount: 0,
        topup: Number(r.amount),
      });
    for (const r of subRows) {
      const existing = map.get(r.month);
      const amount = Number(r.amount);
      if (existing) {
        existing.subscription = amount;
        existing.subscriptionSnapshotAmount = amount;
      } else
        map.set(r.month, {
          month: r.month,
          subscription: amount,
          subscriptionSnapshotAmount: amount,
          topup: 0,
        });
    }

    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }),

  /**
   * Redemption-code health snapshot: counts by status + last-30d activity +
   * total credits granted via redemption (rough — assumes creditsAmount is
   * authoritative on credits-type codes; topup_package values are excluded
   * because the underlying package credits live elsewhere).
   */
  redemptionOverview: financeReadProcedure.query(async ({ ctx }) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      [{ value: totalActive }],
      [{ value: totalRedeemed }],
      [{ value: totalDisabled }],
      [{ value: totalExpired }],
      [{ value: redeemed30d }],
      [{ value: creditsGranted30d }],
    ] = await Promise.all([
      ctx.serverDB
        .select({ value: count() })
        .from(redemptionCodes)
        .where(eq(redemptionCodes.status, 'active')),
      ctx.serverDB
        .select({ value: count() })
        .from(redemptionCodes)
        .where(eq(redemptionCodes.status, 'redeemed')),
      ctx.serverDB
        .select({ value: count() })
        .from(redemptionCodes)
        .where(eq(redemptionCodes.status, 'disabled')),
      ctx.serverDB
        .select({ value: count() })
        .from(redemptionCodes)
        .where(eq(redemptionCodes.status, 'expired')),
      ctx.serverDB
        .select({ value: count() })
        .from(redemptionCodes)
        .where(
          and(
            eq(redemptionCodes.status, 'redeemed'),
            gte(redemptionCodes.redeemedAt, thirtyDaysAgo),
          ),
        ),
      ctx.serverDB
        .select({
          value: sql<number>`COALESCE(SUM(${redemptionCodes.creditsAmount}), 0)`,
        })
        .from(redemptionCodes)
        .where(
          and(
            eq(redemptionCodes.status, 'redeemed'),
            eq(redemptionCodes.rewardType, 'credits'),
            gte(redemptionCodes.redeemedAt, thirtyDaysAgo),
          ),
        ),
    ]);

    const byTypeRows = await ctx.serverDB
      .select({
        rewardType: redemptionCodes.rewardType,
        total: count(),
      })
      .from(redemptionCodes)
      .where(eq(redemptionCodes.status, 'redeemed'))
      .groupBy(redemptionCodes.rewardType);

    return {
      byRewardType: byTypeRows.map((r: { rewardType: string; total: number }) => ({
        rewardType: r.rewardType,
        total: Number(r.total),
      })),
      creditsGranted30d: Number(creditsGranted30d),
      disabled: Number(totalDisabled),
      expired: Number(totalExpired),
      pending: Number(totalActive),
      redeemed: Number(totalRedeemed),
      redeemed30d: Number(redeemed30d),
    };
  }),
});
