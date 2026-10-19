import {
  moduleAppDeveloperAppInputSchema,
  moduleAppDeveloperListInputSchema,
  moduleAppDeveloperVersionInputSchema,
  moduleAppPublisherProfileInputSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { moduleAppProcedure } from './data';

const mapDeveloperError = (error: unknown) => {
  const identifier = error instanceof Error ? error.message : 'module_app_developer_failed';
  if (identifier === 'MODULE_APP_DEVELOPER_APP_NOT_FOUND') {
    return new TRPCError({ cause: error, code: 'NOT_FOUND', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_PACKAGE_PUBLISHER_NOT_VERIFIED' ||
    identifier === 'MODULE_APP_PUBLISHER_SUSPENDED'
  ) {
    return new TRPCError({ cause: error, code: 'FORBIDDEN', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_BUILD_NOT_READY' ||
    identifier === 'MODULE_APP_VERSION_NOT_FOUND' ||
    identifier === 'MODULE_APP_DEVELOPER_VERSION_NOT_ROLLBACKABLE'
  ) {
    return new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: identifier });
  }

  return new TRPCError({ cause: error, code: 'INTERNAL_SERVER_ERROR', message: identifier });
};

export const moduleAppDeveloperProcedures = {
  getMyDeveloperFinance: moduleAppProcedure.query(async ({ ctx }) => {
    return ctx.moduleAppDeveloperModel.getFinance(ctx.userId);
  }),

  getMyDeveloperFinanceSummary: moduleAppProcedure.query(async ({ ctx }) => {
    return ctx.moduleAppDeveloperModel.getFinanceSummary(ctx.userId);
  }),

  getMyPublisherProfile: moduleAppProcedure.query(async ({ ctx }) => {
    return ctx.moduleAppDeveloperModel.getPublisherProfile(ctx.userId);
  }),

  listMyDeveloperApps: moduleAppProcedure
    .input(moduleAppDeveloperListInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.moduleAppDeveloperModel.listApplications({ ...input, userId: ctx.userId });
    }),

  listMyDeveloperSubmissions: moduleAppProcedure
    .input(moduleAppDeveloperListInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.moduleAppDeveloperModel.listSubmissions({ ...input, userId: ctx.userId });
    }),

  listMyDeveloperPayouts: moduleAppProcedure
    .input(moduleAppDeveloperListInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.moduleAppDeveloperModel.listPayouts({ ...input, userId: ctx.userId });
    }),

  listMyDeveloperRevenue: moduleAppProcedure
    .input(moduleAppDeveloperListInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.moduleAppDeveloperModel.listRevenue({ ...input, userId: ctx.userId });
    }),

  listMyDeveloperVersions: moduleAppProcedure
    .input(moduleAppDeveloperAppInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.moduleAppDeveloperModel.listVersions({ ...input, userId: ctx.userId });
      } catch (error) {
        throw mapDeveloperError(error);
      }
    }),

  publishMyDeveloperApp: moduleAppProcedure
    .input(moduleAppDeveloperAppInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.moduleAppDeveloperModel.setPublication({
          ...input,
          published: true,
          userId: ctx.userId,
        });
      } catch (error) {
        throw mapDeveloperError(error);
      }
    }),

  rollbackMyDeveloperApp: moduleAppProcedure
    .input(moduleAppDeveloperVersionInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.moduleAppDeveloperModel.rollbackVersion({ ...input, userId: ctx.userId });
      } catch (error) {
        throw mapDeveloperError(error);
      }
    }),

  unpublishMyDeveloperApp: moduleAppProcedure
    .input(moduleAppDeveloperAppInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.moduleAppDeveloperModel.setPublication({
          ...input,
          published: false,
          userId: ctx.userId,
        });
      } catch (error) {
        throw mapDeveloperError(error);
      }
    }),

  upsertMyPublisherProfile: moduleAppProcedure
    .input(moduleAppPublisherProfileInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.moduleAppDeveloperModel.upsertPublisherProfile(ctx.userId, input);
      } catch (error) {
        throw mapDeveloperError(error);
      }
    }),
};
