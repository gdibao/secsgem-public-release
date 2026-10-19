import { useCallback, useEffect, useMemo } from 'react';
import useSWRInfinite from 'swr/infinite';

import {
  type InstalledModuleApp,
  type ModuleAppInstallationListResult,
  moduleAppService,
} from '@/services/moduleApp';

const PAGE_SIZE = 20;

type InstalledAppsKey = readonly [
  'moduleApp.listMyApps' | 'moduleApp.listTeamApps',
  null | string,
  string,
  number,
];

type InstalledAppsKeyLoader = (
  pageIndex: number,
  previousPageData: ModuleAppInstallationListResult | null,
) => InstalledAppsKey | null;

type UseInstalledAppsOptions = {
  enabled?: boolean;
  query: string;
  scope: 'personal' | 'workspace';
  workspaceId?: string;
};

export const useInstalledApps = ({
  enabled = true,
  query,
  scope,
  workspaceId,
}: UseInstalledAppsOptions) => {
  const normalizedQuery = query.trim();
  const getKey = useCallback<InstalledAppsKeyLoader>(
    (pageIndex, previousPageData) => {
      if (
        !enabled ||
        (scope === 'workspace' && !workspaceId) ||
        (previousPageData && previousPageData.nextCursor === null)
      )
        return null;

      return [
        scope === 'personal' ? 'moduleApp.listMyApps' : 'moduleApp.listTeamApps',
        scope === 'workspace' ? workspaceId! : null,
        normalizedQuery,
        pageIndex === 0 ? 0 : (previousPageData?.nextCursor ?? 0),
      ];
    },
    [enabled, normalizedQuery, scope, workspaceId],
  );
  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite<
    ModuleAppInstallationListResult,
    Error,
    InstalledAppsKeyLoader
  >(
    getKey,
    ([procedure, keyWorkspaceId, keyQuery, cursor]) => {
      const input = {
        cursor,
        limit: PAGE_SIZE,
        query: keyQuery || undefined,
      };

      if (procedure === 'moduleApp.listMyApps') return moduleAppService.listMyApps(input);
      if (!keyWorkspaceId) throw new Error('module_app_workspace_required');

      return moduleAppService.listTeamApps({ ...input, workspaceId: keyWorkspaceId });
    },
    {
      revalidateFirstPage: false,
      shouldRetryOnError: false,
    },
  );

  useEffect(() => {
    if (enabled) void setSize(1);
  }, [enabled, normalizedQuery, scope, setSize, workspaceId]);

  const items = useMemo(() => {
    const byId = new Map<string, InstalledModuleApp>();
    for (const item of data?.flatMap((page) => page.items) ?? []) byId.set(item.id, item);
    return [...byId.values()];
  }, [data]);
  const hasMore = data?.at(-1)?.nextCursor != null;
  const isLoadingMore = Boolean(data?.length) && isValidating;

  return {
    error,
    hasMore,
    isLoading,
    isLoadingMore,
    items,
    loadMore: () => {
      if (hasMore && !isValidating) void setSize(size + 1);
    },
    retry: () => mutate(),
  };
};
