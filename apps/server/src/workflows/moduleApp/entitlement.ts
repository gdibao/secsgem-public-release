import { moduleAppExecutableRuntimeSchema } from '@lobechat/types';

import { assertModuleAppEntitlement } from '@/business/server/module-apps/entitlement';
import { getSubscriptionPlan } from '@/business/server/user';
import { ModuleAppModel } from '@/database/models/moduleApp';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

export const resolveModuleAppWorkflowEntitlement = async (input: {
  db: LobeChatDatabase;
  installationId: string;
}) => {
  const model = new ModuleAppModel(input.db);
  const subject = await model.getInstallationEntitlementSubject({
    installationId: input.installationId,
  });
  if (!subject?.userId) throw new Error('MODULE_APP_INSTALLATION_REQUIRED');
  const plan = await getSubscriptionPlan(input.db, subject.userId);
  const detail = await model.getAppDetail({
    appIdOrSlug: subject.appId,
    includeHidden: true,
    plan,
    userId: subject.userId,
    workspaceId: subject.workspaceId ?? undefined,
  });
  if (!detail) throw new Error('MODULE_APP_ENTITLEMENT_SUSPENDED');
  const membership = subject.workspaceId
    ? await new WorkspaceMemberModel(input.db, subject.userId).getMember(
        subject.workspaceId,
        subject.userId,
      )
    : undefined;
  assertModuleAppEntitlement({
    appStatus: detail.status,
    installation: { active: detail.installed },
    operation: 'job',
    planIncluded: detail.planState.runnable,
    teamMembership: subject.workspaceId ? { active: Boolean(membership) } : undefined,
    workspaceScoped: Boolean(subject.workspaceId),
  });
  const installation = await model.getLaunchInstallationContext({
    appId: subject.appId,
    userId: subject.userId,
    workspaceId: subject.workspaceId ?? undefined,
  });
  if (!installation || installation.installationId !== input.installationId) {
    throw new Error('MODULE_APP_INSTALLATION_REQUIRED');
  }
  const manifest = installation.runtimeManifest;
  const runtime = moduleAppExecutableRuntimeSchema.safeParse(
    manifest && typeof manifest === 'object' && 'runtime' in manifest ? manifest.runtime : manifest,
  );
  if (!runtime.success) throw new Error('MODULE_APP_WORKFLOW_RUNTIME_INVALID');

  return { detail, installation, runtime: runtime.data, subject };
};
