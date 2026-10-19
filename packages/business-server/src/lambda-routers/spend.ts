import { CommercialModel } from '@/database/models/commercial';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  type AutoTopUpSetting,
  type BillingOrderHistoryItem,
  type CommercialResourceUsage,
  type CreditAccountSummary,
  type CreditLedgerListResult,
  QueryCommercialListSchema,
  QueryCreditLedgerSchema,
  UpdateAutoTopUpSettingSchema,
} from '@/types/business';

const commercialProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      commercialModel: new CommercialModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const spendRouter = router({
  getAccountSummary: commercialProcedure.query(async ({ ctx }): Promise<CreditAccountSummary> => {
    return ctx.commercialModel.getCreditAccountSummary();
  }),

  getAutoTopUpSetting: commercialProcedure.query(async ({ ctx }): Promise<AutoTopUpSetting> => {
    return ctx.commercialModel.getAutoTopUpSetting();
  }),

  getResourceUsage: commercialProcedure.query(async ({ ctx }): Promise<CommercialResourceUsage> => {
    return ctx.commercialModel.getResourceUsage();
  }),

  listLedger: commercialProcedure
    .input(QueryCreditLedgerSchema)
    .query(async ({ ctx, input }): Promise<CreditLedgerListResult> => {
      return ctx.commercialModel.listCreditLedger(input);
    }),

  listCreditPackages: commercialProcedure
    .input(QueryCommercialListSchema.default({}))
    .query(async ({ ctx, input }) => {
      return ctx.commercialModel.listCreditPackages(input);
    }),

  listBillingOrders: commercialProcedure
    .input(QueryCommercialListSchema.default({}))
    .query(async ({ ctx, input }): Promise<BillingOrderHistoryItem[]> => {
      return ctx.commercialModel.listBillingOrders(input);
    }),

  listTopUpPackages: commercialProcedure.query(async ({ ctx }) => {
    return ctx.commercialModel.listTopUpPackages();
  }),

  listTopUpOrders: commercialProcedure
    .input(QueryCommercialListSchema.default({}))
    .query(async ({ ctx, input }) => {
      return ctx.commercialModel.listTopUpOrders(input);
    }),

  updateAutoTopUpSetting: commercialProcedure
    .input(UpdateAutoTopUpSettingSchema)
    .mutation(async ({ ctx, input }): Promise<AutoTopUpSetting> => {
      return ctx.commercialModel.updateAutoTopUpSetting(input);
    }),
});
