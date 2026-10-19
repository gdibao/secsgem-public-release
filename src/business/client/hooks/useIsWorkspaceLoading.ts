import { useWorkspaceListQuery } from './useWorkspaces';

export const useIsWorkspaceLoading = (): boolean => useWorkspaceListQuery().isLoading;
