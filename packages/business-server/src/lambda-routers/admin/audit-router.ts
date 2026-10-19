import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';

import { adminAuditLogs } from '@/database/schemas';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';

import { recordAdminAudit } from './audit';

const auditFilterInput = z.object({
  action: z.string().max(200).optional(),
  actorUserId: z.string().max(255).optional(),
  from: z.coerce.date().optional(),
  resourceId: z.string().max(255).optional(),
  resourceType: z.string().max(120).optional(),
  targetUserId: z.string().max(255).optional(),
  to: z.coerce.date().optional(),
});

type AuditFilterInput = z.infer<typeof auditFilterInput>;

const buildAuditWhere = ({
  action,
  actorUserId,
  from,
  resourceId,
  resourceType,
  targetUserId,
  to,
}: AuditFilterInput) => {
  const conditions = [
    action ? eq(adminAuditLogs.action, action) : undefined,
    actorUserId ? eq(adminAuditLogs.actorUserId, actorUserId) : undefined,
    targetUserId ? eq(adminAuditLogs.targetUserId, targetUserId) : undefined,
    resourceType ? eq(adminAuditLogs.resourceType, resourceType) : undefined,
    resourceId ? eq(adminAuditLogs.resourceId, resourceId) : undefined,
    from ? gte(adminAuditLogs.createdAt, from) : undefined,
    to ? lte(adminAuditLogs.createdAt, to) : undefined,
  ].filter(Boolean);

  return conditions.length > 0 ? and(...conditions) : undefined;
};

const auditReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.auditRead);

export const adminAuditRouter = router({
  list: auditReadProcedure
    .input(
      auditFilterInput.extend({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit } = input;
      const where = buildAuditWhere(input);

      const [items, [{ value: total }]] = await Promise.all([
        ctx.serverDB.query.adminAuditLogs.findMany({
          limit,
          offset: cursor,
          orderBy: desc(adminAuditLogs.createdAt),
          where,
        }),
        ctx.serverDB.select({ value: count() }).from(adminAuditLogs).where(where),
      ]);

      return {
        items,
        nextCursor: items.length === limit ? cursor + limit : null,
        total,
      };
    }),

  exportAll: auditReadProcedure
    .input(
      auditFilterInput.extend({
        limit: z.number().int().min(1).max(10_000).default(5000),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { limit } = input;
      const where = buildAuditWhere(input);

      const items = await ctx.serverDB.query.adminAuditLogs.findMany({
        limit,
        orderBy: desc(adminAuditLogs.createdAt),
        where,
      });

      const filters = {
        ...(input.action ? { action: input.action } : {}),
        ...(input.resourceType ? { resourceType: input.resourceType } : {}),
        ...(input.from ? { from: input.from.toISOString() } : {}),
        ...(input.to ? { to: input.to.toISOString() } : {}),
        ...(input.actorUserId ? { hasActorUserId: true } : {}),
        ...(input.resourceId ? { hasResourceId: true } : {}),
        ...(input.targetUserId ? { hasTargetUserId: true } : {}),
      };
      await recordAdminAudit(ctx, {
        action: 'admin.audit.export',
        payload: { count: items.length, filters, limit },
        resourceType: 'admin_audit_log',
      });

      return { items };
    }),
});
