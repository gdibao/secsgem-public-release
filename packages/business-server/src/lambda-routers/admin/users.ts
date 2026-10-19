import { ADMIN_ROLE_IDS, type AdminCompactUser, Plans } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, gte, isNull, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  adminAuditLogs,
  creditAccounts,
  creditLedgerEntries,
  topUpOrders,
  userPlanSnapshots,
  users,
} from '@/database/schemas';
import type { Transaction } from '@/database/type';
import {
  ADMIN_CAPABILITIES,
  adminAnyCapabilityProcedure,
  adminCapabilityProcedure,
  adminProcedure,
  router,
} from '@/libs/trpc/lambda';

import { createAdminCommand } from './adminCommand';
import { recordAdminAudit, runRequiredAdminAuditMutation } from './audit';

type ResetAllUsersToFreePlanResult = {
  canceledPaid: number;
  insertedFree: number;
  normalizedFree: number;
};

const buildResetAllUsersToFreePlanFilters = (userIds?: string[]) => {
  const targetUserIds = userIds?.filter(Boolean) ?? [];
  const targetUserIdList =
    targetUserIds.length > 0
      ? sql.join(
          targetUserIds.map((id) => sql`${id}`),
          sql`, `,
        )
      : null;

  return {
    planSnapshotUserFilter: targetUserIdList
      ? sql`AND "user_plan_snapshots"."user_id" IN (${targetUserIdList})`
      : sql``,
    usersFilter: targetUserIdList ? sql`AND "users"."id" IN (${targetUserIdList})` : sql``,
  };
};

export const getResetAllUsersToFreePlanPreview = async (
  db: { execute: (query: ReturnType<typeof sql>) => Promise<{ rows?: unknown[] }> },
  options: { userIds?: string[] } = {},
): Promise<ResetAllUsersToFreePlanResult> => {
  const { planSnapshotUserFilter, usersFilter } = buildResetAllUsersToFreePlanFilters(
    options.userIds,
  );

  const previewResult = await db.execute(sql`
    WITH active_paid AS (
      SELECT "user_id"
      FROM "user_plan_snapshots"
      WHERE
        "status" = 'active'
        AND "plan" <> ${Plans.Free}::text
        ${planSnapshotUserFilter}
    ),
    active_free AS (
      SELECT "id"
      FROM "user_plan_snapshots"
      WHERE
        "status" = 'active'
        AND "plan" = ${Plans.Free}::text
        ${planSnapshotUserFilter}
    ),
    target_users AS (
      SELECT "id"
      FROM "users"
      WHERE TRUE ${usersFilter}
    ),
    users_needing_free AS (
      SELECT "target_users"."id"
      FROM target_users
      WHERE
        "target_users"."id" IN (SELECT "user_id" FROM active_paid)
        OR NOT EXISTS (
          SELECT 1
          FROM "user_plan_snapshots"
          WHERE
            "user_plan_snapshots"."user_id" = "target_users"."id"
            AND "user_plan_snapshots"."status" = 'active'
        )
    )
    SELECT
      (SELECT COUNT(*)::int FROM active_paid) AS "canceledPaid",
      (SELECT COUNT(*)::int FROM active_free) AS "normalizedFree",
      (SELECT COUNT(*)::int FROM users_needing_free) AS "insertedFree"
  `);

  return (previewResult.rows?.[0] ?? {
    canceledPaid: 0,
    insertedFree: 0,
    normalizedFree: 0,
  }) as ResetAllUsersToFreePlanResult;
};

export const resetAllUsersToFreePlanInTransaction = async (
  tx: Transaction,
  reason = 'admin_reset_to_unlimited_free_plan',
  options: { userIds?: string[] } = {},
): Promise<ResetAllUsersToFreePlanResult> => {
  const { planSnapshotUserFilter, usersFilter } = buildResetAllUsersToFreePlanFilters(
    options.userIds,
  );

  const resetResult = await tx.execute(sql`
      WITH canceled_paid AS (
        UPDATE "user_plan_snapshots"
        SET
          "status" = 'canceled',
          "ends_at" = COALESCE("ends_at", NOW()),
          "renews_at" = COALESCE("renews_at", NOW()),
          "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
            'resetToFreeAt',
            NOW(),
            'resetReason',
            ${reason}::text
          ),
          "updated_at" = NOW()
        WHERE
          "status" = 'active'
          AND "plan" <> ${Plans.Free}::text
          ${planSnapshotUserFilter}
        RETURNING "id", "user_id"
      ),
      normalized_free AS (
        UPDATE "user_plan_snapshots"
        SET
          "cycle" = 'monthly',
          "currency" = 'CNY',
          "monthly_credits" = 0,
          "monthly_price" = 0,
          "provider" = COALESCE("provider", 'system_default'),
          "renews_at" = NULL,
          "ends_at" = NULL,
          "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
            'resetToFreeAt',
            NOW(),
            'resetReason',
            ${reason}::text,
            'unlimited',
            true
          ),
          "updated_at" = NOW()
        WHERE
          "status" = 'active'
          AND "plan" = ${Plans.Free}::text
          ${planSnapshotUserFilter}
        RETURNING "id"
      ),
      inserted_free AS (
        INSERT INTO "user_plan_snapshots" (
          "user_id",
          "plan",
          "status",
          "cycle",
          "monthly_credits",
          "monthly_price",
          "currency",
          "provider",
          "external_subscription_id",
          "metadata",
          "started_at",
          "renews_at",
          "ends_at"
        )
        SELECT
          "users"."id",
          ${Plans.Free}::text,
          'active',
          'monthly',
          0,
          0,
          'CNY',
          'system_default',
          CONCAT('default-free-', "users"."id"),
          jsonb_build_object('source', ${reason}::text, 'unlimited', true),
          NOW(),
          NULL,
          NULL
        FROM "users"
        WHERE
          (
            "users"."id" IN (SELECT "user_id" FROM canceled_paid)
            OR NOT EXISTS (
              SELECT 1
              FROM "user_plan_snapshots"
              WHERE
                "user_plan_snapshots"."user_id" = "users"."id"
                AND "user_plan_snapshots"."status" = 'active'
            )
          )
          ${usersFilter}
        RETURNING "id"
      )
      SELECT
        (SELECT COUNT(*)::int FROM canceled_paid) AS "canceledPaid",
        (SELECT COUNT(*)::int FROM normalized_free) AS "normalizedFree",
        (SELECT COUNT(*)::int FROM inserted_free) AS "insertedFree"
    `);

  return (resetResult.rows?.[0] ?? {
    canceledPaid: 0,
    insertedFree: 0,
    normalizedFree: 0,
  }) as ResetAllUsersToFreePlanResult;
};

export const resetAllUsersToFreePlan = async (
  db: { transaction: <T>(cb: (tx: Transaction) => Promise<T>) => Promise<T> },
  reason = 'admin_reset_to_unlimited_free_plan',
  options: { userIds?: string[] } = {},
): Promise<ResetAllUsersToFreePlanResult> =>
  db.transaction((tx) => resetAllUsersToFreePlanInTransaction(tx, reason, options));

const supportWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.supportWrite);
const userReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.userRead);
const compactUserReadProcedure = adminAnyCapabilityProcedure([
  ADMIN_CAPABILITIES.auditRead,
  ADMIN_CAPABILITIES.financeRead,
  ADMIN_CAPABILITIES.userRead,
]);
const recordImpersonationAttemptCommand = createAdminCommand('user.impersonate.attempt');
const resetAllToFreePlanCommand = createAdminCommand('user.resetAllToFreePlan');
const setRoleCommand = createAdminCommand('user.setRole');

export const adminUsersRouter = router({
  ban: supportWriteProcedure
    .input(
      z.object({
        banReason: z.string().max(500).optional(),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'user.ban',
          payload: { banReason: input.banReason ?? null },
          resourceType: 'user',
          targetUserId: input.userId,
        }),
        mutation: async (tx) => {
          await tx
            .update(users)
            .set({ banReason: input.banReason ?? null, banned: true })
            .where(eq(users.id, input.userId));
        },
      });
      return { ok: true };
    }),

  detail: userReadProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const u = await ctx.serverDB.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      return u;
    }),

  compactDetail: compactUserReadProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const user: AdminCompactUser | undefined = await ctx.serverDB.query.users.findFirst({
        columns: { banned: true, createdAt: true, id: true, lastActiveAt: true, role: true },
        where: eq(users.id, input.userId),
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
      return user;
    }),

  fullDetail: supportWriteProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { userId } = input;
      const now = new Date();
      const [user, creditAccount, latestSnapshot, recentLedger, recentOrders, recentAudit] =
        await Promise.all([
          ctx.serverDB.query.users.findFirst({ where: eq(users.id, userId) }),
          ctx.serverDB.query.creditAccounts.findFirst({
            where: eq(creditAccounts.userId, userId),
          }),
          ctx.serverDB.query.userPlanSnapshots.findFirst({
            orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
            where: and(
              eq(userPlanSnapshots.userId, userId),
              eq(userPlanSnapshots.status, 'active'),
              or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
            ),
          }),
          ctx.serverDB.query.creditLedgerEntries.findMany({
            limit: 20,
            orderBy: desc(creditLedgerEntries.createdAt),
            where: eq(creditLedgerEntries.userId, userId),
          }),
          ctx.serverDB.query.topUpOrders.findMany({
            limit: 20,
            orderBy: desc(topUpOrders.createdAt),
            where: eq(topUpOrders.userId, userId),
          }),
          ctx.serverDB.query.adminAuditLogs.findMany({
            limit: 20,
            orderBy: desc(adminAuditLogs.createdAt),
            where: eq(adminAuditLogs.targetUserId, userId),
          }),
        ]);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

      return {
        creditAccount: creditAccount ?? null,
        recentAudit,
        recentLedger,
        recentOrders,
        subscription: latestSnapshot ?? null,
        user,
      };
    }),

  list: supportWriteProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
        plan: z.string().optional(),
        query: z.string().optional(),
        subscriptionStartedOrder: z.enum(['asc', 'desc']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const escapeLike = (s: string) => s.replaceAll(/[%_\\]/g, '\\$&');
      const searchWhere = input.query
        ? or(
            like(users.email, `%${escapeLike(input.query)}%`),
            like(users.username, `%${escapeLike(input.query)}%`),
            like(users.fullName, `%${escapeLike(input.query)}%`),
            like(users.phone, `%${escapeLike(input.query)}%`),
          )
        : undefined;

      const latestSnapshots = ctx.serverDB
        .select({
          createdAt: userPlanSnapshots.createdAt,
          currency: userPlanSnapshots.currency,
          cycle: userPlanSnapshots.cycle,
          endsAt: userPlanSnapshots.endsAt,
          id: userPlanSnapshots.id,
          monthlyCredits: userPlanSnapshots.monthlyCredits,
          monthlyPrice: userPlanSnapshots.monthlyPrice,
          plan: userPlanSnapshots.plan,
          renewsAt: userPlanSnapshots.renewsAt,
          rn: sql<number>`row_number() over (partition by ${userPlanSnapshots.userId} order by ${userPlanSnapshots.startedAt} desc, ${userPlanSnapshots.createdAt} desc)`.as(
            'rn',
          ),
          startedAt: userPlanSnapshots.startedAt,
          status: userPlanSnapshots.status,
          updatedAt: userPlanSnapshots.updatedAt,
          userId: userPlanSnapshots.userId,
        })
        .from(userPlanSnapshots)
        .where(
          and(
            eq(userPlanSnapshots.status, 'active'),
            or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
          ),
        )
        .as('latest_plan_snapshot');

      const joinLatestSnapshot = and(
        eq(users.id, latestSnapshots.userId),
        eq(latestSnapshots.rn, 1),
      );
      const where = and(
        searchWhere,
        input.plan ? eq(latestSnapshots.plan, input.plan as Plans) : undefined,
      );
      const orderBy =
        input.subscriptionStartedOrder === 'asc'
          ? [asc(latestSnapshots.startedAt), desc(users.createdAt)]
          : input.subscriptionStartedOrder === 'desc'
            ? [desc(latestSnapshots.startedAt), desc(users.createdAt)]
            : [desc(users.createdAt)];

      const [rows, totalRow] = await Promise.all([
        ctx.serverDB
          .select({
            subscription: {
              createdAt: latestSnapshots.createdAt,
              currency: latestSnapshots.currency,
              cycle: latestSnapshots.cycle,
              endsAt: latestSnapshots.endsAt,
              id: latestSnapshots.id,
              monthlyCredits: latestSnapshots.monthlyCredits,
              monthlyPrice: latestSnapshots.monthlyPrice,
              plan: latestSnapshots.plan,
              renewsAt: latestSnapshots.renewsAt,
              startedAt: latestSnapshots.startedAt,
              status: latestSnapshots.status,
              updatedAt: latestSnapshots.updatedAt,
              userId: latestSnapshots.userId,
            },
            user: {
              avatar: users.avatar,
              banned: users.banned,
              createdAt: users.createdAt,
              email: users.email,
              fullName: users.fullName,
              id: users.id,
              lastActiveAt: users.lastActiveAt,
              phone: users.phone,
              role: users.role,
            },
          })
          .from(users)
          .leftJoin(latestSnapshots, joinLatestSnapshot)
          .where(where)
          .orderBy(...orderBy)
          .limit(input.limit)
          .offset(input.cursor),
        ctx.serverDB
          .select({ value: count() })
          .from(users)
          .leftJoin(latestSnapshots, joinLatestSnapshot)
          .where(where),
      ]);

      const items = (
        rows as Array<{
          subscription: ({ id?: string | null } & Record<string, unknown>) | null;
          user: Record<string, unknown>;
        }>
      ).map(({ user, subscription }) => ({
        ...user,
        subscription: subscription?.id ? subscription : null,
      }));

      return {
        items,
        nextCursor: items.length === input.limit ? input.cursor + input.limit : null,
        total: totalRow[0]?.value ?? 0,
      };
    }),

  setRole: adminProcedure
    .input(
      z.object({
        command: setRoleCommand.schema,
        role: z.enum([...ADMIN_ROLE_IDS, 'user']).nullable(),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = setRoleCommand.validate(input.command);
      if (input.userId === ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot change your own role' });
      }

      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: command.auditAction,
          payload: { role: input.role },
          resourceType: 'user',
          targetUserId: input.userId,
        }),
        mutation: async (tx) => {
          await tx.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
        },
      });
      return { ok: true };
    }),

  unban: supportWriteProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'user.unban',
          resourceType: 'user',
          targetUserId: input.userId,
        }),
        mutation: async (tx) => {
          await tx
            .update(users)
            .set({ banExpires: null, banReason: null, banned: false })
            .where(eq(users.id, input.userId));
        },
      });
      return { ok: true };
    }),

  exportAll: userReadProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50_000).default(10_000),
        query: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const escapeLike = (s: string) => s.replaceAll(/[%_\\]/g, '\\$&');
      const where = input.query
        ? or(
            like(users.email, `%${escapeLike(input.query)}%`),
            like(users.username, `%${escapeLike(input.query)}%`),
            like(users.fullName, `%${escapeLike(input.query)}%`),
            like(users.phone, `%${escapeLike(input.query)}%`),
          )
        : undefined;
      const items = await ctx.serverDB.query.users.findMany({
        columns: {
          banned: true,
          createdAt: true,
          email: true,
          fullName: true,
          id: true,
          lastActiveAt: true,
          phone: true,
          role: true,
          username: true,
        },
        limit: input.limit,
        orderBy: desc(users.createdAt),
        where,
      });

      await recordAdminAudit(ctx, {
        action: 'user.export',
        payload: {
          count: items.length,
          filters: { hasQuery: Boolean(input.query) },
          limit: input.limit,
        },
        resourceType: 'user_export',
      });

      return { items };
    }),

  getResetAllToFreePlanPreview: adminProcedure.query(async ({ ctx }) => {
    return getResetAllUsersToFreePlanPreview(ctx.serverDB);
  }),

  resetAllToFreePlan: adminProcedure
    .input(
      z.object({
        command: resetAllToFreePlanCommand.schema,
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = resetAllToFreePlanCommand.validate(input.command, input.reason);
      const reason = command.reason!;
      const result = await runRequiredAdminAuditMutation<ResetAllUsersToFreePlanResult>(ctx, {
        audit: (result) => ({
          action: command.auditAction,
          payload: { ...result, reason },
          resourceType: 'user',
        }),
        mutation: (tx) => resetAllUsersToFreePlanInTransaction(tx, reason),
      });

      return { ok: true, ...result };
    }),

  recordImpersonationAttempt: adminProcedure
    .input(
      z.object({ command: recordImpersonationAttemptCommand.schema, userId: z.string().min(1) }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = recordImpersonationAttemptCommand.validate(input.command);
      if (input.userId === ctx.userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'CANNOT_IMPERSONATE_SELF' });
      }

      const target = await ctx.serverDB.query.users.findFirst({
        columns: { email: true, fullName: true, id: true, username: true },
        where: eq(users.id, input.userId),
      });

      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });

      await recordAdminAudit(ctx, {
        action: command.auditAction,
        payload: {
          targetEmail: target.email,
          targetFullName: target.fullName,
          targetUsername: target.username,
        },
        resourceType: 'user',
        targetUserId: input.userId,
      });

      return { ok: true };
    }),
});

// avoid lint: unused imports retained for future bulk ops
void and;
