import { randomUUID } from 'node:crypto';

import {
  moduleAppBuildConfigSchema,
  moduleAppExecutableRuntimeSchema,
  moduleAppRunInputSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { assertModuleAppRolloutAllowed } from '@/business/server/module-apps/productionControls';
import { runModuleAppAction } from '@/business/server/module-apps/runModuleAppAction';
import { runModuleAppExecutableAction } from '@/business/server/module-apps/runners/executableActionRunner';
import { ModuleAppWorkflowEngine } from '@/business/server/module-apps/workflows/engine';
import { createModuleAppWorkflowExecutor } from '@/business/server/module-apps/workflows/executors';
import { ModuleAppCreditModel } from '@/database/models/moduleAppCredit';
import { ModuleAppWorkflowModel } from '@/database/models/moduleAppWorkflow';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';
import { createModuleAppTextGenerator } from '@/server/services/moduleAppAi';
import {
  resolveModuleAppActionOutboundHosts,
  resolveModuleAppActionSecrets,
  resolveModuleAppWorkflowAction,
} from '@/server/services/moduleAppRuntime/actionDependencies';
import {
  signModuleAppCapability,
  verifyModuleAppCapability,
} from '@/server/services/moduleAppRuntime/capability';
import { ModuleAppRuntimeClient } from '@/server/services/moduleAppRuntime/client';
import { getServerModuleAppRuntimeConfig } from '@/server/services/moduleAppRuntime/config';
import { createModuleAppCapabilityGateway } from '@/server/services/moduleAppRuntime/gateway';
import { createModuleAppServerAction } from '@/server/services/moduleAppRuntime/serverAction';

import {
  assertRecordPermission,
  assertRunnableApp,
  assertScopePermission,
  getWorkspaceMembership,
  moduleAppProcedure,
} from './data';
import { mapModuleAppGatewayError } from './errors';

const AppIdInputSchema = z.object({ appId: z.string().uuid() });
const ModuleAppLaunchInputSchema = AppIdInputSchema.extend({
  workspaceId: z.string().min(1).optional(),
});
const ModuleAppLaunchRuntimeManifestSchema = z
  .object({
    build: moduleAppBuildConfigSchema,
    manifestVersion: z.literal(2),
    runtime: moduleAppExecutableRuntimeSchema,
  })
  .strict();
const ModuleAppGatewayCallInputSchema = z.object({
  capability: z.string().min(1).max(8192),
  input: z.unknown().optional(),
  method: z.enum([
    'context.get',
    'data.archive',
    'data.get',
    'data.insert',
    'data.list',
    'data.transaction',
    'data.update',
    'files.createDownload',
    'files.createUpload',
    'http.fetch',
    'notifications.create',
    'ai.models.list',
    'ai.chat',
    'payments.methods.list',
    'payments.catalog.list',
    'payments.checkout.create',
    'payments.status.get',
    'secrets.get',
    'tasks.cancel',
    'tasks.getRun',
  ]),
  requestId: z.string().min(1).max(160).optional(),
});

const assertRuntimeRolloutAllowed = (identity: {
  appId?: null | string;
  publisherId?: null | string;
}) => {
  try {
    assertModuleAppRolloutAllowed(identity, {
      appIds: appEnv.MODULE_APP_RUNTIME_APP_ALLOWLIST,
      publisherIds: appEnv.MODULE_APP_PUBLISHER_ALLOWLIST,
    });
  } catch (error) {
    throw new TRPCError({
      cause: error,
      code: 'FORBIDDEN',
      message: 'module_app_rollout_not_allowed',
    });
  }
};

export const moduleAppRuntimeProcedures = {
  callSdk: moduleAppProcedure
    .input(ModuleAppGatewayCallInputSchema)
    .mutation(async ({ ctx, input }) => {
      const runtimeConfig = await getServerModuleAppRuntimeConfig(ctx.serverDB);
      if (!runtimeConfig.switches.executionEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'module_app_runtime_unavailable',
        });
      }

      let capability;
      try {
        capability = await verifyModuleAppCapability(input.capability, { userId: ctx.userId });
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'UNAUTHORIZED',
          message: 'MODULE_APP_CAPABILITY_INVALID',
        });
      }
      if (capability.surface !== 'browser') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'MODULE_APP_CAPABILITY_SURFACE_DENIED' });
      }
      await assertRunnableApp({
        appId: capability.appId,
        currentPlan: ctx.currentPlan,
        db: ctx.serverDB,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        workspaceId: capability.workspaceId,
      });

      try {
        return await createModuleAppCapabilityGateway({
          capability,
          db: ctx.serverDB,
        }).call({
          capability,
          input: input.input,
          method: input.method,
          requestId: input.requestId,
        });
      } catch (error) {
        throw mapModuleAppGatewayError(error);
      }
    }),

  getLaunchContext: moduleAppProcedure
    .input(ModuleAppLaunchInputSchema)
    .query(async ({ ctx, input }) => {
      const runtimeConfig = await getServerModuleAppRuntimeConfig(ctx.serverDB);
      if (!runtimeConfig.connections.publicOrigin) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'module_app_runtime_unavailable',
        });
      }
      if (!runtimeConfig.switches.publicExecutionEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'module_app_public_execution_disabled',
        });
      }
      let runtimeOrigin: string;
      try {
        const publicOrigin = new URL(runtimeConfig.connections.publicOrigin);
        if (publicOrigin.protocol !== 'https:') throw new Error('HTTPS origin required');
        runtimeOrigin = publicOrigin.origin;
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'PRECONDITION_FAILED',
          message: 'module_app_runtime_unavailable',
        });
      }
      const readiness = await new ModuleAppRuntimeClient({
        baseUrl: runtimeConfig.connections.internalUrl,
        enabled: runtimeConfig.switches.executionEnabled,
        internalToken: runtimeConfig.connections.internalToken,
        invocationEnabled: runtimeConfig.switches.invocationEnabled,
      }).healthCheck();
      if (readiness.status !== 'ready') {
        throw new TRPCError({
          cause: readiness,
          code: 'PRECONDITION_FAILED',
          message: 'module_app_runtime_unavailable',
        });
      }

      if (input.workspaceId) {
        const membership = await getWorkspaceMembership(
          ctx.serverDB,
          ctx.userId,
          input.workspaceId,
        );
        if (!membership) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'module_app_workspace_denied' });
        }
      }

      await assertRunnableApp({
        appId: input.appId,
        currentPlan: ctx.currentPlan,
        db: ctx.serverDB,
        model: ctx.moduleAppModel,
        userId: ctx.userId,
        operation: 'launch',
        workspaceId: input.workspaceId,
      });
      const installation = await ctx.moduleAppModel.getLaunchInstallationContext({
        ...input,
        userId: ctx.userId,
      });
      if (!installation) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'module_app_installation_required',
        });
      }
      assertRuntimeRolloutAllowed({ appId: input.appId, publisherId: installation.publisherId });

      const manifest = ModuleAppLaunchRuntimeManifestSchema.safeParse(installation.runtimeManifest);
      const artifactReady =
        installation.buildStatus === 'ready' &&
        Boolean(installation.artifactKey) &&
        Boolean(installation.artifactSha256) &&
        installation.artifactKey === installation.buildArtifactKey &&
        installation.artifactSha256 === installation.buildArtifactSha256;
      if (!artifactReady || !manifest.success) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'module_app_build_not_ready' });
      }

      const now = new Date();
      const nonce = randomUUID();
      const output = manifest.data.build.frontend.output.replace(/\/+$/, '');
      const entry = output.endsWith('.html') ? output : `${output}/index.html`;
      const iframeUrl = new URL(
        `/artifacts/${installation.artifactSha256}/${entry}`,
        `${runtimeOrigin}/`,
      );
      iframeUrl.searchParams.set('nonce', nonce);
      const capability = await signModuleAppCapability(
        {
          appId: input.appId,
          installationId: installation.installationId,
          permissions: runtimeConfig.switches.executionEnabled
            ? manifest.data.runtime.permissions
            : [],
          surface: 'browser',
          userId: ctx.userId,
          versionId: installation.versionId,
          workspaceId: installation.workspaceId ?? undefined,
        },
        { expiresInSeconds: 300, nonce, now: () => now },
      );

      return {
        capability,
        displayName: installation.displayName,
        expiresAt: new Date(now.getTime() + 300_000).toISOString(),
        iframeUrl: iframeUrl.toString(),
        installationId: installation.installationId,
        nonce,
        runtimeOrigin,
      };
    }),

  runAction: moduleAppProcedure.input(moduleAppRunInputSchema).mutation(async ({ ctx, input }) => {
    const runtimeConfig = await getServerModuleAppRuntimeConfig(ctx.serverDB);
    if (!runtimeConfig.switches.executionEnabled) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'module_app_runtime_unavailable',
      });
    }

    await assertRunnableApp({
      appId: input.appId,
      currentPlan: ctx.currentPlan,
      db: ctx.serverDB,
      model: ctx.moduleAppModel,
      workspaceId: input.workspaceId,
      userId: ctx.userId,
    });

    const installation = await ctx.moduleAppModel.getLaunchInstallationContext({
      appId: input.appId,
      userId: ctx.userId,
      workspaceId: input.workspaceId,
    });
    if (!installation) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module_app_installation_required' });
    }

    const action = installation.actions.find((item) => item.id === input.actionId);
    if (!action) throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_action_not_found' });

    if (action.runtimeType === 'record_update' || action.runtimeType === 'record_archive') {
      if (!input.recordId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'module_app_record_id_required' });
      }

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
        operation: action.runtimeType === 'record_archive' ? 'archive' : 'update',
        record,
        userId: ctx.userId,
      });
    } else {
      await assertScopePermission({
        db: ctx.serverDB,
        operation: 'create',
        scopeType: input.scopeType,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
    }

    let executableRunner;
    const installationId = installation.installationId;
    if (action.runtimeType === 'executable_action') {
      if (!runtimeConfig.switches.invocationEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'module_app_runtime_invocation_disabled',
        });
      }
      assertRuntimeRolloutAllowed({ appId: input.appId, publisherId: installation.publisherId });
      const manifest = ModuleAppLaunchRuntimeManifestSchema.safeParse(installation.runtimeManifest);
      const artifactReady =
        installation.buildStatus === 'ready' &&
        Boolean(installation.artifactKey) &&
        Boolean(installation.artifactSha256) &&
        installation.artifactKey === installation.buildArtifactKey &&
        installation.artifactSha256 === installation.buildArtifactSha256;
      if (!artifactReady || !manifest.success || !installation.artifactSha256) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'module_app_build_not_ready' });
      }
      const functionKey = action.runtimeConfig.functionKey;
      const runtimeFunction = manifest.data.runtime.functions.find(
        (item) => item.key === functionKey,
      );
      if (!runtimeFunction) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'module_app_executable_function_not_found',
        });
      }
      const configuredTimeout = action.runtimeConfig.timeoutMs;
      const timeoutMs = configuredTimeout === undefined ? 60_000 : Number(configuredTimeout);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'module_app_executable_timeout_invalid',
        });
      }
      const capability = await signModuleAppCapability(
        {
          appId: input.appId,
          artifactSha256: installation.artifactSha256,
          installationId: installation.installationId,
          permissions: manifest.data.runtime.permissions,
          surface: 'runtime',
          userId: ctx.userId,
          versionId: installation.versionId,
          workspaceId: installation.workspaceId ?? undefined,
        },
        { expiresInSeconds: 300 },
      );
      const runtimeClient = new ModuleAppRuntimeClient({
        baseUrl: runtimeConfig.connections.internalUrl,
        enabled: runtimeConfig.switches.executionEnabled,
        internalToken: runtimeConfig.connections.internalToken,
        invocationEnabled: runtimeConfig.switches.invocationEnabled,
      });
      const invocationId = randomUUID();
      executableRunner = () =>
        runModuleAppExecutableAction({
          action,
          artifactSha256: installation.artifactSha256!,
          input: input.input,
          invocationId,
          invoke: ({ artifactSha256, input: runtimeInput, invocationId: runtimeInvocationId }) =>
            runtimeClient.invoke({
              artifactSha256,
              capability,
              entry: runtimeFunction.entry,
              input: runtimeInput,
              invocationId: runtimeInvocationId,
              runtime: runtimeFunction.runtime,
              timeoutMs,
            }),
        });
    }

    const workflow =
      action.runtimeType === 'workflow_step'
        ? resolveModuleAppWorkflowAction({ action, runtimeManifest: installation.runtimeManifest })
        : undefined;
    const workflowEngine = workflow
      ? new ModuleAppWorkflowEngine({
          execute: createModuleAppWorkflowExecutor({}),
          repository: new ModuleAppWorkflowModel(ctx.serverDB),
        })
      : undefined;
    const outboundHosts =
      action.runtimeType === 'api_action'
        ? resolveModuleAppActionOutboundHosts({ runtimeManifest: installation.runtimeManifest })
        : undefined;
    let gateKeeperPromise: ReturnType<typeof KeyVaultsGateKeeper.initWithEnvKey> | undefined;
    const resolvedSecrets =
      action.runtimeType === 'api_action'
        ? await resolveModuleAppActionSecrets({
            action,
            decrypt: async (encryptedValue) => {
              gateKeeperPromise ??= KeyVaultsGateKeeper.initWithEnvKey();
              return (await gateKeeperPromise).decrypt(encryptedValue);
            },
            getEncryptedValue: ({ installationId: secretInstallationId, key }) =>
              ctx.moduleAppModel.getInstallationSecret({
                installationId: secretInstallationId,
                key,
              }),
            installationId,
          })
        : undefined;
    const creditAdapter = new ModuleAppCreditModel(ctx.serverDB);
    const artifactStorage = new FileS3();

    return runModuleAppAction({
      action,
      appId: input.appId,
      artifactStorage: {
        uploadBuffer: async (key, buffer, contentType) => {
          await artifactStorage.uploadBuffer(key, buffer, contentType);
        },
      },
      assertEntitlement: () =>
        assertRunnableApp({
          appId: input.appId,
          currentPlan: ctx.currentPlan,
          db: ctx.serverDB,
          model: ctx.moduleAppModel,
          userId: ctx.userId,
          workspaceId: input.workspaceId,
        }),
      input: input.input,
      installationId,
      billing: installation.billing,
      creditAdapter,
      model: ctx.moduleAppModel,
      outboundHosts,
      recordId: input.recordId,
      resolvedSecrets,
      runner: executableRunner,
      scopeType: input.scopeType,
      serverAction: createModuleAppServerAction({ db: ctx.serverDB }),
      textGenerator: createModuleAppTextGenerator({
        db: ctx.serverDB,
        workspaceId: input.workspaceId,
      }),
      userId: ctx.userId,
      workflow,
      workflowEngine,
      workspaceId: input.workspaceId,
    });
  }),
};
