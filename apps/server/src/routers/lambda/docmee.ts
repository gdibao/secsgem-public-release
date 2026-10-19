import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocmeePptError, DocmeePptService } from '@/server/services/docmee';

const docmeeProcedure = authedProcedure.use(serverDatabase);

const eventTypeSchema = z.enum([
  'afterGenerate',
  'beforeDownload',
  'charge',
  'error',
  'pageChange',
]);

const toTrpcError = (error: unknown): never => {
  if (error instanceof DocmeePptError) {
    throw new TRPCError({
      code:
        error.code === 'PPT_FORBIDDEN_BY_PLAN'
          ? 'FORBIDDEN'
          : error.code === 'PPT_UPSTREAM_TOKEN_FAILED'
            ? 'BAD_GATEWAY'
            : 'BAD_REQUEST',
      message: error.code,
    });
  }

  throw error;
};

export const docmeeRouter = router({
  createPptToken: docmeeProcedure
    .input(z.object({ recordId: z.string().uuid().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      try {
        return await new DocmeePptService({ db: ctx.serverDB, userId: ctx.userId }).createToken(
          input?.recordId,
        );
      } catch (error) {
        toTrpcError(error);
      }
    }),

  getPptRuntime: docmeeProcedure.query(async ({ ctx }) => {
    return new DocmeePptService({ db: ctx.serverDB, userId: ctx.userId }).getRuntime();
  }),

  reportPptEvent: docmeeProcedure
    .input(
      z.object({
        data: z.unknown().optional(),
        sessionId: z.string().min(1).max(64),
        type: eventTypeSchema,
        upstreamTaskId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await new DocmeePptService({ db: ctx.serverDB, userId: ctx.userId }).reportEvent(
          input,
        );
      } catch (error) {
        toTrpcError(error);
      }
    }),
});

export type DocmeeRouter = typeof docmeeRouter;
