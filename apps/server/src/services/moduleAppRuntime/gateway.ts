import { getModuleAppGeneralOutboundHosts, type ModuleAppCapabilityClaims } from '@lobechat/types';

import { ModuleAppDataService } from '@/business/server/module-apps/data/service';
import { ModuleAppFileGateway } from '@/business/server/module-apps/sdk/files';
import {
  ModuleAppCapabilityGateway,
  ModuleAppReplayGuard,
} from '@/business/server/module-apps/sdk/gateway';
import { ModuleAppHttpGateway } from '@/business/server/module-apps/sdk/http';
import {
  ModuleAppNotificationGateway,
  ModuleAppNotificationRateLimiter,
} from '@/business/server/module-apps/sdk/notifications';
import { ModuleAppSecretsGateway } from '@/business/server/module-apps/sdk/secrets';
import { ModuleAppTaskService } from '@/business/server/module-apps/workflows/taskService';
import { ModuleAppModel } from '@/database/models/moduleApp';
import { ModuleAppDataModel } from '@/database/models/moduleAppData';
import { ModuleAppWorkflowModel } from '@/database/models/moduleAppWorkflow';
import { NotificationModel } from '@/database/models/notification';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';

import {
  createModuleAppNotificationRateLimitBackend,
  createModuleAppReplayGuardBackend,
} from './distributedGuards';
import { createModuleAppPlatformGateways } from './platformGateways';

// Runtime switches can change without restarting the server, so fail closed for every gateway.
const distributedGuardMode = 'distributed-required' as const;

const replayGuard = new ModuleAppReplayGuard({
  backend: createModuleAppReplayGuardBackend({ mode: distributedGuardMode }),
});
const notificationRateLimiter = new ModuleAppNotificationRateLimiter({
  backend: createModuleAppNotificationRateLimitBackend({ mode: distributedGuardMode }),
});

export const createModuleAppCapabilityGateway = (params: {
  capability: ModuleAppCapabilityClaims;
  db: LobeChatDatabase;
}) => {
  const model = new ModuleAppModel(params.db);
  const platformGateways = createModuleAppPlatformGateways({
    db: params.db,
    rollout: {
      appIds: appEnv.MODULE_APP_RUNTIME_APP_ALLOWLIST,
      publisherIds: appEnv.MODULE_APP_PUBLISHER_ALLOWLIST,
    },
  });
  let gateKeeperPromise: ReturnType<typeof KeyVaultsGateKeeper.initWithEnvKey> | undefined;

  return new ModuleAppCapabilityGateway({
    context: {
      resolve: async (capability) => {
        const installation = await model.getRuntimeInstallationContext({
          appId: capability.appId,
          installationId: capability.installationId,
          userId: capability.userId,
          versionId: capability.versionId,
          workspaceId: capability.workspaceId,
        });
        if (!installation) throw new Error('MODULE_APP_CAPABILITY_SCOPE_MISMATCH');

        let workspaceRole: 'admin' | 'member' | 'owner' | undefined;
        if (installation.scopeType === 'workspace') {
          if (!installation.workspaceId) throw new Error('MODULE_APP_CAPABILITY_SCOPE_MISMATCH');
          const member = await new WorkspaceMemberModel(params.db, capability.userId).getMember(
            installation.workspaceId,
            capability.userId,
          );
          if (!member) throw new Error('MODULE_APP_CAPABILITY_SCOPE_MISMATCH');
          if (member.role === 'admin' || member.role === 'member' || member.role === 'owner') {
            workspaceRole = member.role;
          } else {
            throw new Error('MODULE_APP_CAPABILITY_SCOPE_MISMATCH');
          }
        }

        return {
          appId: installation.appId,
          billing: installation.billing,
          displayName: installation.displayName,
          installationId: installation.installationId,
          outboundHosts: getModuleAppGeneralOutboundHosts(installation.runtimeManifest),
          secretKeys: installation.secretKeys,
          scopeType: installation.scopeType,
          userId: installation.userId,
          versionId: installation.versionId,
          workspaceRole,
          workspaceId: installation.workspaceId,
        };
      },
    },
    data: new ModuleAppDataService({ repository: new ModuleAppDataModel(params.db) }),
    ai: platformGateways.ai,
    files: new ModuleAppFileGateway({ storage: new FileS3() }),
    http: new ModuleAppHttpGateway(),
    notifications: new ModuleAppNotificationGateway({
      create: (input) => new NotificationModel(params.db, params.capability.userId).create(input),
      rateLimiter: notificationRateLimiter,
    }),
    payments: platformGateways.payments,
    replayGuard,
    secrets: new ModuleAppSecretsGateway({
      decrypt: async (encryptedValue) => {
        gateKeeperPromise ??= KeyVaultsGateKeeper.initWithEnvKey();
        return (await gateKeeperPromise).decrypt(encryptedValue);
      },
      getEncryptedValue: ({ installationId, key }) =>
        model.getInstallationSecret({ installationId, key }),
    }),
    tasks: new ModuleAppTaskService(new ModuleAppWorkflowModel(params.db)),
  });
};
