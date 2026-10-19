import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { ModuleAppModel } from '@/database/models/moduleApp';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import {
  assertInstallationAccess,
  assertWorkspaceManagementPermission,
  moduleAppProcedure,
} from './data';

const InstallationSecretScopeInputSchema = z.object({
  installationId: z.string().uuid(),
  workspaceId: z.string().min(1).optional(),
});

const InstallationSecretKeyInputSchema = InstallationSecretScopeInputSchema.extend({
  secretKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
});

const InstallationSecretValueInputSchema = InstallationSecretKeyInputSchema.extend({
  value: z
    .string()
    .min(1)
    .max(16 * 1024),
});

const assertInstallationSecretManagementAccess = async (params: {
  db: LobeChatDatabase;
  installationId: string;
  model: ModuleAppModel;
  userId: string;
  workspaceId?: string;
}) => {
  if (params.workspaceId) {
    await assertWorkspaceManagementPermission({
      db: params.db,
      userId: params.userId,
      workspaceId: params.workspaceId,
    });
  }

  await assertInstallationAccess(params);
};

const mapInstallationSecretError = (error: unknown) => {
  const identifier = error instanceof Error ? error.message : '';
  if (identifier === 'MODULE_APP_SECRET_NOT_DECLARED') {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: identifier });
  }

  return error;
};

export const moduleAppInstallationSecretProcedures = {
  deleteInstallationSecret: moduleAppProcedure
    .input(InstallationSecretKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertInstallationSecretManagementAccess({
        db: ctx.serverDB,
        installationId: input.installationId,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      return ctx.moduleAppModel.deleteInstallationSecret({
        installationId: input.installationId,
        secretKey: input.secretKey,
      });
    }),

  listInstallationSecrets: moduleAppProcedure
    .input(InstallationSecretScopeInputSchema)
    .query(async ({ ctx, input }) => {
      await assertInstallationSecretManagementAccess({
        db: ctx.serverDB,
        installationId: input.installationId,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      return ctx.moduleAppModel.getInstallationSecretState({
        installationId: input.installationId,
      });
    }),

  upsertInstallationSecret: moduleAppProcedure
    .input(InstallationSecretValueInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertInstallationSecretManagementAccess({
        db: ctx.serverDB,
        installationId: input.installationId,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      const encryptedValue = await gateKeeper.encrypt(input.value);

      try {
        return await ctx.moduleAppModel.upsertInstallationSecret({
          createdBy: ctx.userId,
          encryptedValue,
          installationId: input.installationId,
          secretKey: input.secretKey,
        });
      } catch (error) {
        throw mapInstallationSecretError(error);
      }
    }),
};
