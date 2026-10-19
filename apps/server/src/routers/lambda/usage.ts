import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { UsageRecordService } from '@/server/services/usage';

const MAX_USAGE_DATE_RANGE_DAYS = 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const validateUsageDateRange = (
  { endAt, startAt }: { endAt: string; startAt: string },
  ctx: z.RefinementCtx,
) => {
  const startTime = Date.parse(`${startAt}T00:00:00.000Z`);
  const endTime = Date.parse(`${endAt}T00:00:00.000Z`);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return;

  if (endTime < startTime) {
    ctx.addIssue({
      code: 'custom',
      message: 'endAt must be on or after startAt',
      path: ['endAt'],
    });
    return;
  }

  if ((endTime - startTime) / MILLISECONDS_PER_DAY > MAX_USAGE_DATE_RANGE_DAYS) {
    ctx.addIssue({
      code: 'custom',
      message: `Date range cannot exceed ${MAX_USAGE_DATE_RANGE_DAYS} days`,
      path: ['endAt'],
    });
  }
};

const usageDateRangeInput = z
  .object({
    agentId: z.string().optional(),
    endAt: z.iso.date(),
    startAt: z.iso.date(),
  })
  .superRefine(validateUsageDateRange);

const agentUsageStatsInput = z
  .object({
    agentId: z.string(),
    endAt: z.iso.date(),
    granularity: z.enum(['day', 'week']).default('day'),
    startAt: z.iso.date(),
  })
  .superRefine(validateUsageDateRange);

const usageProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      usageRecordService: new UsageRecordService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const usageRouter = router({
  getAgentUsageStats: usageProcedure.input(agentUsageStatsInput).query(async ({ ctx, input }) => {
    return await ctx.usageRecordService.getAgentUsageStats(
      input.agentId,
      input.startAt,
      input.endAt,
      input.granularity,
    );
  }),

  findAndGroupByDateRange: usageProcedure
    .input(usageDateRangeInput)
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDateRange(
        input.startAt,
        input.endAt,
        input.agentId,
      );
    }),

  findAndGroupByDay: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDay(input.mo, input.agentId);
    }),

  findByDateRange: usageProcedure.input(usageDateRangeInput).query(async ({ ctx, input }) => {
    return await ctx.usageRecordService.findByDateRange(input.startAt, input.endAt, input.agentId);
  }),

  findByMonth: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findByMonth(input.mo, input.agentId);
    }),
});
