import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { assertInstallationAccess, moduleAppProcedure } from './data';

const ModuleAppHistoryInputSchema = z.object({
  cursor: z.string().max(512).optional(),
  installationId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional(),
  workspaceId: z.string().min(1).optional(),
});

const ModuleAppWorkflowRunInputSchema = ModuleAppHistoryInputSchema.pick({
  installationId: true,
  workspaceId: true,
}).extend({
  runId: z.string().uuid(),
});

const getErrorIdentifier = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return error instanceof Error ? error.message : 'module_app_workflow_failed';
};

const assertWorkflowRunAccess = async (params: {
  db: Parameters<typeof assertInstallationAccess>[0]['db'];
  installationId: string;
  model: Parameters<typeof assertInstallationAccess>[0]['model'];
  runId: string;
  userId: string;
  workflowModel: {
    getRun: (input: { installationId: string; runId: string }) => Promise<unknown>;
  };
  workspaceId?: string;
}) => {
  await assertInstallationAccess(params);
  const run = await params.workflowModel.getRun({
    installationId: params.installationId,
    runId: params.runId,
  });
  if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_workflow_run_not_found' });
  return run;
};

export const moduleAppWorkflowProcedures = {
  cancelWorkflowRun: moduleAppProcedure
    .input(ModuleAppWorkflowRunInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertWorkflowRunAccess({
        db: ctx.serverDB,
        ...input,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workflowModel: ctx.moduleAppWorkflowModel,
      });
      try {
        return await ctx.moduleAppWorkflowModel.cancelRun({
          installationId: input.installationId,
          runId: input.runId,
        });
      } catch (error) {
        const identifier = getErrorIdentifier(error);
        throw new TRPCError({
          cause: error,
          code:
            identifier === 'MODULE_APP_WORKFLOW_RUN_NOT_CANCELLABLE'
              ? 'CONFLICT'
              : 'INTERNAL_SERVER_ERROR',
          message:
            identifier === 'MODULE_APP_WORKFLOW_RUN_NOT_CANCELLABLE'
              ? 'module_app_workflow_run_not_cancellable'
              : 'module_app_workflow_cancel_failed',
        });
      }
    }),

  getWorkflowRun: moduleAppProcedure
    .input(ModuleAppWorkflowRunInputSchema)
    .query(async ({ ctx, input }) => {
      return assertWorkflowRunAccess({
        db: ctx.serverDB,
        ...input,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workflowModel: ctx.moduleAppWorkflowModel,
      });
    }),

  listArtifacts: moduleAppProcedure
    .input(ModuleAppHistoryInputSchema)
    .query(async ({ ctx, input }) => {
      await assertInstallationAccess({
        db: ctx.serverDB,
        ...input,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
      });
      return ctx.moduleAppModel.listArtifacts({ ...input, userId: ctx.userId });
    }),

  listRuns: moduleAppProcedure.input(ModuleAppHistoryInputSchema).query(async ({ ctx, input }) => {
    await assertInstallationAccess({
      db: ctx.serverDB,
      ...input,
      model: ctx.moduleAppModel,
      userId: ctx.userId,
    });
    return ctx.moduleAppModel.listRuns({ ...input, userId: ctx.userId });
  }),

  listWorkflowNodes: moduleAppProcedure
    .input(ModuleAppWorkflowRunInputSchema)
    .query(async ({ ctx, input }) => {
      await assertWorkflowRunAccess({
        db: ctx.serverDB,
        ...input,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workflowModel: ctx.moduleAppWorkflowModel,
      });
      return ctx.moduleAppWorkflowModel.listNodes({
        installationId: input.installationId,
        runId: input.runId,
      });
    }),
};
