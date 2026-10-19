import { CommercialModel } from '@/database/models/commercial';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  BindReferralCodeSchema,
  type QueryCommercialListParams,
  QueryCommercialListSchema,
  type ReferralHistoryItem,
  type ReferralOverview,
  UpdateReferralCodeSchema,
} from '@/types/business';
import { TRPCError } from '@trpc/server';

const commercialProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      commercialModel: new CommercialModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const referralRouter = router({
  getOverview: commercialProcedure.query(async ({ ctx }): Promise<ReferralOverview> => {
    return ctx.commercialModel.getReferralOverview();
  }),

  activateReward: commercialProcedure.mutation(async ({ ctx }): Promise<ReferralOverview> => {
    try {
      await ctx.commercialModel.activateReferralReward();
      return ctx.commercialModel.getReferralOverview();
    } catch (error) {
      throw toReferralTRPCError(error);
    }
  }),

  updateCode: commercialProcedure
    .input(UpdateReferralCodeSchema)
    .mutation(async ({ ctx, input }): Promise<ReferralOverview> => {
      try {
        await ctx.commercialModel.updateReferralCode(input.code);
        return ctx.commercialModel.getReferralOverview();
      } catch (error) {
        throw toReferralTRPCError(error);
      }
    }),

  bindCode: commercialProcedure
    .input(BindReferralCodeSchema)
    .mutation(async ({ ctx, input }): Promise<ReferralOverview> => {
      try {
        await ctx.commercialModel.bindReferralCode(input.code);
        return ctx.commercialModel.getReferralOverview();
      } catch (error) {
        throw toReferralTRPCError(error);
      }
    }),

  listHistory: commercialProcedure
    .input(QueryCommercialListSchema.default({}))
    .query(async ({ ctx, input }): Promise<ReferralHistoryItem[]> => {
      return ctx.commercialModel.listReferralHistory(input satisfies QueryCommercialListParams);
    }),
});

const toReferralTRPCError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'REFERRAL_UNKNOWN_ERROR';

  switch (message) {
    case 'INVALID_REFERRAL_CODE_FORMAT':
      return new TRPCError({ code: 'BAD_REQUEST', message });
    case 'REFERRAL_CODE_TAKEN':
      return new TRPCError({ code: 'CONFLICT', message });
    case 'REFERRAL_CODE_NOT_FOUND':
      return new TRPCError({ code: 'NOT_FOUND', message });
    case 'REFERRAL_ALREADY_BOUND':
    case 'REFERRAL_BACKFILL_EXPIRED':
    case 'SELF_REFERRAL':
    case 'REFERRAL_REWARD_NOT_ACTIVATABLE':
      return new TRPCError({ code: 'BAD_REQUEST', message });
    case 'REFERRAL_REWARD_NOT_FOUND':
      return new TRPCError({ code: 'NOT_FOUND', message });
    default:
      return new TRPCError({ cause: error, code: 'INTERNAL_SERVER_ERROR', message });
  }
};
