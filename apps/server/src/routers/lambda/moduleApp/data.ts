import { moduleAppRecordInputSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  assertModuleAppEntitlement,
  ModuleAppEntitlementError,
} from '@/business/server/module-apps/entitlement';
import {
  assertModuleAppRecordPermission,
  assertModuleAppWorkspaceManagementPermission,
  type ModuleAppRecordOperation,
  type ModuleAppWorkspaceMembership,
} from '@/business/server/module-apps/permission';
import { getSubscriptionPlan } from '@/business/server/user';
import { ModuleAppModel } from '@/database/models/moduleApp';
import { ModuleAppCommerceModel } from '@/database/models/moduleAppCommerce';
import { ModuleAppDeveloperModel } from '@/database/models/moduleAppDeveloper';
import { ModuleAppWorkflowModel } from '@/database/models/moduleAppWorkflow';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { ModuleAppRecordItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const RecordIdInputSchema = z.object({
  appId: z.string().uuid(),
  recordId: z.string().uuid(),
  workspaceId: z.string().optional(),
});

export const moduleAppProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const currentPlan = await getSubscriptionPlan(opts.ctx.serverDB, opts.ctx.userId);

  return opts.next({
    ctx: {
      currentPlan,
      moduleAppDeveloperModel: new ModuleAppDeveloperModel(opts.ctx.serverDB),
      moduleAppModel: new ModuleAppModel(opts.ctx.serverDB),
      moduleAppWorkflowModel: new ModuleAppWorkflowModel(opts.ctx.serverDB),
    },
  });
});

export const getWorkspaceMembership = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: null | string,
): Promise<ModuleAppWorkspaceMembership> => {
  if (!workspaceId) return null;

  const member = await new WorkspaceMemberModel(db, userId).getMember(workspaceId, userId);
  if (!member) return null;

  return {
    role: member.role === 'owner' ? 'owner' : member.role === 'admin' ? 'admin' : 'member',
    workspaceId: member.workspaceId,
  };
};

export const assertWorkspaceManagementPermission = async (params: {
  db: LobeChatDatabase;
  userId: string;
  workspaceId: string;
}) => {
  const workspaceMembership = await getWorkspaceMembership(
    params.db,
    params.userId,
    params.workspaceId,
  );
  if (!workspaceMembership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'module_app_workspace_denied' });
  }

  try {
    assertModuleAppWorkspaceManagementPermission({
      workspaceId: params.workspaceId,
      workspaceMembership,
    });
  } catch (error) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: error instanceof Error ? error.message : 'module_app_workspace_denied',
    });
  }
};

export const assertScopePermission = async (params: {
  db: LobeChatDatabase;
  operation: ModuleAppRecordOperation;
  scopeType: 'personal' | 'workspace';
  userId: string;
  workspaceId?: null | string;
}) => {
  try {
    assertModuleAppRecordPermission({
      actorUserId: params.userId,
      createdBy: params.userId,
      operation: params.operation,
      ownerUserId: params.scopeType === 'personal' ? params.userId : null,
      scopeType: params.scopeType,
      workspaceId: params.workspaceId,
      workspaceMembership:
        params.scopeType === 'workspace'
          ? await getWorkspaceMembership(params.db, params.userId, params.workspaceId)
          : null,
    });
  } catch (error) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: error instanceof Error ? error.message : 'module_app_permission_denied',
    });
  }
};

export const assertInstallationAccess = async (params: {
  db: LobeChatDatabase;
  installationId: string;
  model: ModuleAppModel;
  userId: string;
  workspaceId?: string;
}) => {
  if (params.workspaceId) {
    const membership = await getWorkspaceMembership(params.db, params.userId, params.workspaceId);
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module_app_workspace_denied' });
    }
  }

  try {
    await params.model.assertInstallationAccess({
      installationId: params.installationId,
      userId: params.userId,
      workspaceId: params.workspaceId,
    });
  } catch (error) {
    throw new TRPCError({
      cause: error,
      code: 'FORBIDDEN',
      message: 'module_app_installation_access_denied',
    });
  }
};

export const assertDetailEntitlement = async (params: {
  commerceModel?: Pick<ModuleAppCommerceModel, 'resolveEntitlementContext'>;
  db: LobeChatDatabase;
  detail: NonNullable<Awaited<ReturnType<ModuleAppModel['getAppDetail']>>>;
  operation: 'install' | 'job' | 'launch' | 'run' | 'schedule' | 'webhook';
  userId: string;
  workspaceId?: string;
}) => {
  const membership = params.workspaceId
    ? await getWorkspaceMembership(params.db, params.userId, params.workspaceId)
    : undefined;
  const planIncluded =
    params.operation === 'install'
      ? params.detail.planState.installable
      : params.detail.planState.runnable;
  const commerce = params.commerceModel ?? new ModuleAppCommerceModel(params.db);
  const commerceContext = await commerce.resolveEntitlementContext(
    params.workspaceId
      ? { appId: params.detail.id, workspaceId: params.workspaceId }
      : { appId: params.detail.id, userId: params.userId },
  );

  try {
    return assertModuleAppEntitlement({
      appStatus: params.detail.status,
      installation:
        typeof params.detail.installed === 'boolean'
          ? { active: params.detail.installed }
          : undefined,
      license: commerceContext.license,
      operation: params.operation,
      planIncluded,
      productType: commerceContext.productType,
      teamMembership: params.workspaceId ? { active: Boolean(membership) } : undefined,
      workspaceScoped: Boolean(params.workspaceId),
    });
  } catch (error) {
    if (!(error instanceof ModuleAppEntitlementError)) throw error;

    if (error.reason === 'hidden') {
      throw new TRPCError({ cause: error, code: 'NOT_FOUND', message: 'module_app_not_found' });
    }
    if (error.reason === 'purchase_required') {
      throw new TRPCError({
        cause: error,
        code: 'FORBIDDEN',
        message: 'module_app_purchase_required',
      });
    }
    if (error.reason === 'license_expired') {
      throw new TRPCError({
        cause: error,
        code: 'FORBIDDEN',
        message: 'module_app_license_expired',
      });
    }
    if (error.reason === 'suspended') {
      throw new TRPCError({ cause: error, code: 'FORBIDDEN', message: 'module_app_suspended' });
    }

    const message =
      params.operation === 'install'
        ? 'plan_install_denied'
        : planIncluded && params.detail.installed === false
          ? 'module_app_installation_required'
          : 'plan_run_denied';
    throw new TRPCError({ cause: error, code: 'FORBIDDEN', message });
  }
};

export const assertRunnableApp = async (params: {
  appId: string;
  currentPlan: string;
  model: ModuleAppModel;
  db: LobeChatDatabase;
  operation?: 'launch' | 'run';
  userId: string;
  workspaceId?: string;
}) => {
  const detail = await params.model.getAppDetail({
    appIdOrSlug: params.appId,
    includeHidden: true,
    plan: params.currentPlan,
    userId: params.userId,
    workspaceId: params.workspaceId,
  });

  if (!detail) throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_not_found' });

  await assertDetailEntitlement({
    db: params.db,
    detail,
    operation: params.operation ?? 'run',
    userId: params.userId,
    workspaceId: params.workspaceId,
  });

  return detail;
};

export const assertRecordPermission = async (params: {
  db: LobeChatDatabase;
  operation: ModuleAppRecordOperation;
  record: ModuleAppRecordItem;
  userId: string;
}) => {
  try {
    assertModuleAppRecordPermission({
      actorUserId: params.userId,
      createdBy: params.record.createdBy,
      operation: params.operation,
      ownerUserId: params.record.ownerUserId,
      scopeType: params.record.scopeType,
      workspaceId: params.record.workspaceId,
      workspaceMembership:
        params.record.scopeType === 'workspace'
          ? await getWorkspaceMembership(params.db, params.userId, params.record.workspaceId)
          : null,
    });
  } catch (error) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: error instanceof Error ? error.message : 'module_app_permission_denied',
    });
  }
};

export const moduleAppDataProcedures = {
  archiveRecord: moduleAppProcedure.input(RecordIdInputSchema).mutation(async ({ ctx, input }) => {
    const record = await ctx.moduleAppModel.getRecord({ ...input, userId: ctx.userId });
    if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_record_not_found' });

    await assertRecordPermission({
      db: ctx.serverDB,
      operation: 'archive',
      record,
      userId: ctx.userId,
    });

    return ctx.moduleAppModel.archiveRecord({ ...input, userId: ctx.userId });
  }),

  createRecord: moduleAppProcedure
    .input(moduleAppRecordInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertRunnableApp({
        appId: input.appId,
        currentPlan: ctx.currentPlan,
        db: ctx.serverDB,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      await assertScopePermission({
        db: ctx.serverDB,
        operation: 'create',
        scopeType: input.scopeType,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      return ctx.moduleAppModel.createRecord({ ...input, userId: ctx.userId });
    }),

  getRecord: moduleAppProcedure.input(RecordIdInputSchema).query(async ({ ctx, input }) => {
    const record = await ctx.moduleAppModel.getRecord({ ...input, userId: ctx.userId });
    if (!record) return null;

    await assertRecordPermission({
      db: ctx.serverDB,
      operation: 'view',
      record,
      userId: ctx.userId,
    });

    return record;
  }),

  listRecords: moduleAppProcedure
    .input(
      moduleAppRecordInputSchema
        .pick({
          appId: true,
          collectionKey: true,
          scopeType: true,
          workspaceId: true,
        })
        .extend({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).max(1_000_000).default(0),
        }),
    )
    .query(async ({ ctx, input }) => {
      await assertScopePermission({
        db: ctx.serverDB,
        operation: 'view',
        scopeType: input.scopeType,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      return ctx.moduleAppModel.listRecords({ ...input, userId: ctx.userId });
    }),

  updateRecord: moduleAppProcedure
    .input(moduleAppRecordInputSchema.required({ recordId: true }))
    .mutation(async ({ ctx, input }) => {
      await assertRunnableApp({
        appId: input.appId,
        currentPlan: ctx.currentPlan,
        db: ctx.serverDB,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      const record = await ctx.moduleAppModel.getRecord({
        appId: input.appId,
        recordId: input.recordId,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
      if (!record)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_record_not_found' });

      await assertRecordPermission({
        db: ctx.serverDB,
        operation: 'update',
        record,
        userId: ctx.userId,
      });

      return ctx.moduleAppModel.updateRecord({ ...input, userId: ctx.userId });
    }),
};
