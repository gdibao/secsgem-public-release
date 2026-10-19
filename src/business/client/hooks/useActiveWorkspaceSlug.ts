import { useActiveWorkspace } from './useActiveWorkspace';
import { getWorkspaceSlugFromLocation } from './workspaceRuntime';

export const getActiveWorkspaceSlug = (): string | null => getWorkspaceSlugFromLocation();

export const useActiveWorkspaceSlug = (): string | null => useActiveWorkspace()?.slug ?? null;
