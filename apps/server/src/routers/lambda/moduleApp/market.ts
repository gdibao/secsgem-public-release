import { recordModuleAppInstallationLifecycle } from '@lobechat/observability-otel/modules/module-app';
import {
  moduleAppGrantSnapshotSchema,
  moduleAppInstallationListInputSchema,
  moduleAppMarketplaceListInputSchema,
  moduleAppPackageArchiveMetadataSchema,
  moduleAppPackageManifestV1Schema,
  moduleAppPackageSubmissionListInputSchema,
  moduleAppPackageUploadedSubmitSchema,
  moduleAppPackageUploadRequestSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  assertModuleAppEntitlement,
  ModuleAppEntitlementError,
} from '@/business/server/module-apps/entitlement';
import { ModuleAppPackageIngestionService } from '@/server/services/moduleAppPackage/ingestion';

import {
  assertDetailEntitlement,
  assertRunnableApp,
  assertScopePermission,
  assertWorkspaceManagementPermission,
  getWorkspaceMembership,
  moduleAppProcedure,
} from './data';

const AppIdInputSchema = z.object({
  appId: z.string().uuid(),
});

const RuntimeManifestInputSchema = AppIdInputSchema.extend({
  workspaceId: z.string().min(1).optional(),
});

const AppIdOrSlugInputSchema = z.object({
  appIdOrSlug: z.string().min(1).max(160),
  workspaceId: z.string().min(1).optional(),
});

const WorkspaceAppInputSchema = AppIdInputSchema.extend({
  workspaceId: z.string().min(1),
});
const UninstallAppInputSchema = AppIdInputSchema.extend({
  dataPolicy: z.enum(['delete', 'retain']).default('retain'),
});
const UninstallWorkspaceAppInputSchema = WorkspaceAppInputSchema.extend({
  dataPolicy: z.enum(['delete', 'retain']).default('retain'),
});

const TeamInstallationListInputSchema = moduleAppInstallationListInputSchema.extend({
  workspaceId: z.string().min(1),
});

const InstallationVersionChangeInputSchema = z.discriminatedUnion('operation', [
  AppIdInputSchema.extend({
    acceptedGrantSnapshot: moduleAppGrantSnapshotSchema.optional(),
    expectedVersionId: z.string().uuid(),
    operation: z.literal('upgrade'),
    workspaceId: z.string().min(1).optional(),
  }),
  AppIdInputSchema.extend({
    acceptedGrantSnapshot: moduleAppGrantSnapshotSchema.optional(),
    expectedVersionId: z.string().uuid(),
    operation: z.literal('rollback'),
    targetVersionId: z.string().uuid(),
    workspaceId: z.string().min(1).optional(),
  }),
]);

const assertWorkspaceMembership = async (params: {
  db: Parameters<typeof getWorkspaceMembership>[0];
  userId: string;
  workspaceId: string;
}) => {
  const membership = await getWorkspaceMembership(params.db, params.userId, params.workspaceId);
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'module_app_workspace_denied' });
  }

  return membership;
};

const publicPackageArchiveSchema = moduleAppPackageArchiveMetadataSchema.pick({
  fileName: true,
  sizeBytes: true,
});

const publicPackageManifestSchema = moduleAppPackageManifestV1Schema
  .pick({ app: true, packageVersion: true })
  .extend({
    app: moduleAppPackageManifestV1Schema.shape.app.pick({ displayName: true, slug: true }),
  });

type PublicPackageSubmissionSource = {
  appId: string | null;
  archive: unknown;
  createdAt: Date;
  id: string;
  manifestSnapshot: unknown;
  publishedAt: Date | null;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  reviewStatus: string;
  updatedAt: Date;
};

const serializePublicPackageSubmission = (item: PublicPackageSubmissionSource) => {
  const archive = publicPackageArchiveSchema.safeParse(item.archive);
  const manifest = publicPackageManifestSchema.safeParse(item.manifestSnapshot);
  if (!archive.success || !manifest.success) return null;

  return {
    appDisplayName: manifest.data.app.displayName,
    appId: item.appId,
    appSlug: manifest.data.app.slug,
    createdAt: item.createdAt,
    fileName: archive.data.fileName,
    id: item.id,
    packageVersion: manifest.data.packageVersion,
    publishedAt: item.publishedAt,
    rejectionReason: item.rejectionReason,
    reviewedAt: item.reviewedAt,
    reviewStatus: item.reviewStatus,
    sizeBytes: archive.data.sizeBytes,
    updatedAt: item.updatedAt,
  };
};

const getPackageErrorIdentifier = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return error instanceof Error ? error.message : 'module_app_package_ingestion_failed';
};

const mapPackageError = (error: unknown) => {
  if (error instanceof TRPCError) return error;

  const identifier = getPackageErrorIdentifier(error);
  if (
    identifier === 'MODULE_APP_PACKAGE_OPEN_UPLOAD_LIMIT' ||
    identifier === 'MODULE_APP_PACKAGE_DAILY_UPLOAD_LIMIT'
  ) {
    return new TRPCError({ cause: error, code: 'TOO_MANY_REQUESTS', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_PACKAGE_STORAGE_QUOTA_EXCEEDED' ||
    identifier === 'MODULE_APP_PACKAGE_UPLOAD_FORBIDDEN' ||
    identifier === 'module_app_package_storage_key_forbidden'
  ) {
    return new TRPCError({ cause: error, code: 'FORBIDDEN', message: identifier });
  }
  if (identifier === 'MODULE_APP_PACKAGE_UPLOAD_CONFLICT') {
    return new TRPCError({ cause: error, code: 'CONFLICT', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_PACKAGE_UPLOAD_EXPIRED' ||
    (identifier.startsWith('module_app_package_') &&
      identifier !== 'module_app_package_ingestion_failed' &&
      identifier !== 'module_app_package_upload_signing_failed')
  ) {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: identifier });
  }

  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'module_app_package_ingestion_failed',
  });
};

const mapInstallationVersionError = (error: unknown) => {
  if (error instanceof TRPCError) return error;

  const identifier = error instanceof Error ? error.message : 'module_app_version_change_failed';
  if (identifier === 'MODULE_APP_INSTALLATION_VERSION_CONFLICT') {
    return new TRPCError({ cause: error, code: 'CONFLICT', message: identifier });
  }
  if (identifier === 'MODULE_APP_INSTALLATION_REQUIRED') {
    return new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: identifier });
  }
  if (identifier === 'MODULE_APP_GRANT_CONFIRMATION_REQUIRED') {
    return new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: identifier });
  }
  if (identifier === 'MODULE_APP_NOT_FOUND') {
    return new TRPCError({ cause: error, code: 'NOT_FOUND', message: identifier });
  }
  if (identifier === 'MODULE_APP_NOT_INSTALLABLE') {
    return new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_ROLLBACK_VERSION_NOT_RETAINED' ||
    identifier === 'MODULE_APP_VERSION_ARTIFACT_NOT_READY' ||
    identifier === 'MODULE_APP_VERSION_NOT_CURRENT' ||
    identifier === 'MODULE_APP_VERSION_NOT_FOUND'
  ) {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: identifier });
  }

  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'module_app_version_change_failed',
  });
};

export const moduleAppMarketProcedures = {
  createPackageUpload: moduleAppProcedure
    .input(moduleAppPackageUploadRequestSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await new ModuleAppPackageIngestionService({ db: ctx.serverDB }).issueUpload({
          input,
          userId: ctx.userId,
        });
      } catch (error) {
        throw mapPackageError(error);
      }
    }),

  getDetail: moduleAppProcedure.input(AppIdOrSlugInputSchema).query(async ({ ctx, input }) => {
    const membership = input.workspaceId
      ? await assertWorkspaceMembership({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.workspaceId,
        })
      : undefined;

    const detail = await ctx.moduleAppModel.getAppDetail({
      appIdOrSlug: input.appIdOrSlug,
      plan: ctx.currentPlan,
      userId: ctx.userId,
      workspaceId: input.workspaceId,
    });

    if (!detail) return null;

    const installationVersionState = detail.installed
      ? await ctx.moduleAppModel.getInstallationVersionState({
          appId: detail.id,
          userId: ctx.userId,
          workspaceId: input.workspaceId,
        })
      : null;

    return {
      ...detail,
      ...installationVersionState,
      canManageInstallation:
        !membership || membership.role === 'owner' || membership.role === 'admin',
      canManageInstallationSecrets:
        !membership || membership.role === 'owner' || membership.role === 'admin',
    };
  }),

  changeInstallationVersion: moduleAppProcedure
    .input(InstallationVersionChangeInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.workspaceId) {
        await assertWorkspaceManagementPermission({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.workspaceId,
        });
      }

      const detail = await ctx.moduleAppModel.getAppDetail({
        appIdOrSlug: input.appId,
        includeHidden: true,
        plan: ctx.currentPlan,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
      if (!detail) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_not_found' });
      }

      await assertDetailEntitlement({
        db: ctx.serverDB,
        detail,
        operation: 'install',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      try {
        const result = await ctx.moduleAppModel.changeInstallationVersion({
          ...input,
          appId: detail.id,
          scopeType: input.workspaceId ? 'workspace' : 'personal',
          userId: ctx.userId,
        });
        recordModuleAppInstallationLifecycle({
          changed: result.changed,
          operation: input.operation,
          scope: input.workspaceId ? 'workspace' : 'personal',
        });
        return result;
      } catch (error) {
        throw mapInstallationVersionError(error);
      }
    }),

  getRuntimeManifest: moduleAppProcedure
    .input(RuntimeManifestInputSchema)
    .query(async ({ ctx, input }) => {
      if (input.workspaceId) {
        await assertWorkspaceMembership({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.workspaceId,
        });
      }
      await assertRunnableApp({
        appId: input.appId,
        currentPlan: ctx.currentPlan,
        db: ctx.serverDB,
        model: ctx.moduleAppModel,
        operation: 'launch',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      return ctx.moduleAppModel.getRuntimeManifest({
        ...input,
        userId: ctx.userId,
      });
    }),

  installPersonal: moduleAppProcedure.input(AppIdInputSchema).mutation(async ({ ctx, input }) => {
    const detail = await ctx.moduleAppModel.getAppDetail({
      appIdOrSlug: input.appId,
      includeHidden: true,
      plan: ctx.currentPlan,
      userId: ctx.userId,
    });

    if (!detail) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_not_found' });
    }

    await assertDetailEntitlement({
      db: ctx.serverDB,
      detail,
      operation: 'install',
      userId: ctx.userId,
    });

    const result = await ctx.moduleAppModel.installPersonalApp({
      appId: detail.id,
      userId: ctx.userId,
    });
    recordModuleAppInstallationLifecycle({
      changed: result.changed,
      operation: 'install',
      scope: 'personal',
    });

    return { ok: true };
  }),

  installWorkspace: moduleAppProcedure
    .input(WorkspaceAppInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceManagementPermission({
        db: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
      const detail = await ctx.moduleAppModel.getAppDetail({
        appIdOrSlug: input.appId,
        includeHidden: true,
        plan: ctx.currentPlan,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      if (!detail) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_not_found' });
      }

      await assertDetailEntitlement({
        db: ctx.serverDB,
        detail,
        operation: 'install',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
      const result = await ctx.moduleAppModel.installWorkspaceApp({
        appId: detail.id,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
      recordModuleAppInstallationLifecycle({
        changed: result.changed,
        operation: 'install',
        scope: 'workspace',
      });

      return { ok: true };
    }),

  listMarketplace: moduleAppProcedure
    .input(moduleAppMarketplaceListInputSchema)
    .query(async ({ ctx, input }) => {
      const [marketplaceItems, installedApps] = await Promise.all([
        ctx.moduleAppModel.listMarketplaceApps({
          filters: input,
          includeHidden: true,
          plan: ctx.currentPlan,
          userId: ctx.userId,
        }),
        ctx.moduleAppModel.listInstalledApps({
          scopeType: 'personal',
          userId: ctx.userId,
        }),
      ]);
      const installedByAppId = new Map(installedApps.map((app) => [app.id, app]));
      const items = marketplaceItems.map((item) => {
        const installation = installedByAppId.get(item.id);
        if (!installation) return { ...item, installed: false };

        return {
          ...item,
          installed: true,
          installedVersion: installation.installedVersion,
          installationReadiness: installation.installationReadiness,
          publishedVersion: installation.publishedVersion,
          updateAvailable: installation.updateAvailable,
        };
      });

      return items.filter((item) => {
        try {
          assertModuleAppEntitlement({
            appStatus: item.status,
            operation: 'visibility',
            planIncluded: item.planState.visible,
          });
          return true;
        } catch (error) {
          if (error instanceof ModuleAppEntitlementError) return false;
          throw error;
        }
      });
    }),

  listMobileApps: moduleAppProcedure
    .input(z.object({ workspaceId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      if (input.workspaceId) {
        await assertScopePermission({
          db: ctx.serverDB,
          operation: 'view',
          scopeType: 'workspace',
          userId: ctx.userId,
          workspaceId: input.workspaceId,
        });
      }

      const [personalResult, workspaceResult] = await Promise.allSettled([
        ctx.moduleAppModel.listInstalledApps({
          scopeType: 'personal',
          userId: ctx.userId,
        }),
        input.workspaceId
          ? ctx.moduleAppModel.listInstalledApps({
              scopeType: 'workspace',
              userId: ctx.userId,
              workspaceId: input.workspaceId,
            })
          : Promise.resolve([]),
      ]);
      if (personalResult.status === 'rejected' && workspaceResult.status === 'rejected') {
        throw personalResult.reason;
      }
      const personalApps = personalResult.status === 'fulfilled' ? personalResult.value : [];
      const workspaceApps = workspaceResult.status === 'fulfilled' ? workspaceResult.value : [];
      const workspaceIds = new Set(workspaceApps.map((app) => app.id));

      return [
        ...workspaceApps.map((app) => ({
          ...app,
          installationScope: 'workspace' as const,
          workspaceId: input.workspaceId,
        })),
        ...personalApps
          .filter((app) => !workspaceIds.has(app.id))
          .map((app) => ({ ...app, installationScope: 'personal' as const })),
      ];
    }),

  listMyApps: moduleAppProcedure
    .input(moduleAppInstallationListInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.moduleAppModel.listInstalledAppsPage({
        cursor: input.cursor,
        limit: input.limit,
        query: input.query,
        scopeType: 'personal',
        userId: ctx.userId,
      });
    }),

  listMyPackageSubmissions: moduleAppProcedure
    .input(moduleAppPackageSubmissionListInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.moduleAppModel.listAdminPackageSubmissions({
        cursor: input.cursor,
        limit: input.limit,
        reviewStatus: input.reviewStatus,
        submittedByUserId: ctx.userId,
      });

      return {
        items: result.items.map(serializePublicPackageSubmission).filter((item) => item !== null),
        nextCursor: result.nextCursor,
      };
    }),

  listTeamApps: moduleAppProcedure
    .input(TeamInstallationListInputSchema)
    .query(async ({ ctx, input }) => {
      await assertScopePermission({
        db: ctx.serverDB,
        operation: 'view',
        scopeType: 'workspace',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      return ctx.moduleAppModel.listInstalledAppsPage({
        cursor: input.cursor,
        limit: input.limit,
        query: input.query,
        scopeType: 'workspace',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
    }),

  submitUploadedPackage: moduleAppProcedure
    .input(moduleAppPackageUploadedSubmitSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await new ModuleAppPackageIngestionService({ db: ctx.serverDB }).submitUpload({
          input,
          userId: ctx.userId,
        });
      } catch (error) {
        throw mapPackageError(error);
      }
    }),

  uninstallPersonal: moduleAppProcedure
    .input(UninstallAppInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.moduleAppModel.uninstallPersonalApp({
        ...input,
        userId: ctx.userId,
      });
      recordModuleAppInstallationLifecycle({
        changed: result.changed,
        operation: 'uninstall',
        scope: 'personal',
      });
      return result;
    }),

  uninstallWorkspace: moduleAppProcedure
    .input(UninstallWorkspaceAppInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceManagementPermission({
        db: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      const result = await ctx.moduleAppModel.uninstallWorkspaceApp(input);
      recordModuleAppInstallationLifecycle({
        changed: result.changed,
        operation: 'uninstall',
        scope: 'workspace',
      });
      return result;
    }),
};
