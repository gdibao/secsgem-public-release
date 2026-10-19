import { useParams } from 'react-router';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { engineeringWorkspaceService as service } from '@/services/engineeringWorkspace';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export const useEngineeringWorkspaceScope = () => {
  const { workspaceSlug } = useParams<{ workspaceSlug?: string }>();
  const workspaceId = useActiveWorkspaceId();
  return { ready: !workspaceSlug || !!workspaceId, workspaceId: workspaceId ?? null };
};

export const useFetchPersonalCollections = () => {
  const userId = useUserStore(userProfileSelectors.userId);
  const scope = useEngineeringWorkspaceScope();
  return useClientDataSWR(userId && scope.ready ? ['engineering-workspace-personal', userId, scope.workspaceId] : null, service.listPersonal);
};

export const useFetchSharedCollections = (enabled: boolean) => {
  const workspace = useActiveWorkspace();
  const userId = useUserStore(userProfileSelectors.userId);
  const response = useClientDataSWR(enabled && userId && workspace ? ['engineering-workspace-shared', userId, workspace.id] : null, service.listShared);
  return { ...response, available: !!workspace, canEdit: workspace?.role === 'owner' || workspace?.role === 'admin' };
};

export const useFetchToolEndpoints = (toolId?: string) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const scope = useEngineeringWorkspaceScope();
  return useClientDataSWR(toolId && userId && scope.ready ? ['engineering-workspace-endpoints', userId, scope.workspaceId, toolId] : null, () => service.listEndpoints(toolId!));
};

export const useFetchAdminEndpoints = () => useClientDataSWR('engineering-workspace-admin-endpoints', service.adminListEndpoints);
