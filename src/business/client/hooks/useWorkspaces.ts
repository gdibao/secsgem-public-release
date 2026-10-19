import { useEffect } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import type { WorkspaceListItem } from './useActiveWorkspace';
import { setWorkspaceSnapshot } from './workspaceRuntime';

export const WORKSPACE_LIST_SWR_KEY = 'fab/workspaces/list';

export const useWorkspaceListQuery = () =>
  useSWR<WorkspaceListItem[]>(WORKSPACE_LIST_SWR_KEY, () => lambdaClient.workspace.list.query(), {
    revalidateOnFocus: true,
  });

export const useWorkspaces = (): WorkspaceListItem[] => {
  const { data } = useWorkspaceListQuery();
  const workspaces = data ?? [];

  useEffect(() => setWorkspaceSnapshot(workspaces), [workspaces]);

  return workspaces;
};
