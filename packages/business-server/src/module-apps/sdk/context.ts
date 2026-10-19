import type { ModuleAppBillingConfig, ModuleAppCapabilityClaims } from '@lobechat/types';

export type ModuleAppGatewayContext = {
  appId: string;
  billing?: ModuleAppBillingConfig;
  displayName: string;
  installationId: string;
  outboundHosts: string[];
  secretKeys: string[];
  scopeType: 'personal' | 'workspace';
  userId?: null | string;
  versionId: string;
  workspaceRole?: 'admin' | 'member' | 'owner';
  workspaceId?: null | string;
};

export type ModuleAppContextResolver = {
  resolve: (capability: ModuleAppCapabilityClaims) => Promise<ModuleAppGatewayContext>;
};

export const assertModuleAppContextScope = (
  capability: ModuleAppCapabilityClaims,
  context: ModuleAppGatewayContext,
) => {
  const invalidIdentity =
    context.appId !== capability.appId ||
    context.installationId !== capability.installationId ||
    context.versionId !== capability.versionId;
  const invalidPersonalScope =
    context.scopeType === 'personal' &&
    (context.userId !== capability.userId || Boolean(capability.workspaceId));
  const invalidWorkspaceScope =
    context.scopeType === 'workspace' &&
    (!context.workspaceId || context.workspaceId !== capability.workspaceId);

  if (invalidIdentity || invalidPersonalScope || invalidWorkspaceScope) {
    throw new Error('MODULE_APP_CAPABILITY_SCOPE_MISMATCH');
  }
};

export const serializeModuleAppContext = (context: ModuleAppGatewayContext) => ({
  appId: context.appId,
  displayName: context.displayName,
  installationId: context.installationId,
  scopeType: context.scopeType,
  versionId: context.versionId,
  workspaceId: context.workspaceId ?? undefined,
});
