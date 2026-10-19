import { useActiveWorkspace } from './useActiveWorkspace';
import { getWorkspaceIdFromLocation } from './workspaceRuntime';

export const getActiveWorkspaceId = (): string | null => getWorkspaceIdFromLocation();

export const useActiveWorkspaceId = (): string | null => useActiveWorkspace()?.id ?? null;
