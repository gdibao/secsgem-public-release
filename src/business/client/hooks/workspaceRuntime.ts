import type { WorkspaceListItem } from './useActiveWorkspace';

let workspaceSnapshot: WorkspaceListItem[] = [];

export const setWorkspaceSnapshot = (workspaces: WorkspaceListItem[]) => {
  workspaceSnapshot = workspaces;
};

export const getWorkspaceSnapshot = () => workspaceSnapshot;

export const getWorkspaceSlugFromLocation = (): string | null => {
  if (typeof window === 'undefined') return null;
  const segment = window.location.pathname.split('/').find(Boolean);
  return segment && workspaceSnapshot.some(({ slug }) => slug === segment) ? segment : null;
};

export const getWorkspaceIdFromLocation = (): string | null => {
  const slug = getWorkspaceSlugFromLocation();
  return slug ? (workspaceSnapshot.find((workspace) => workspace.slug === slug)?.id ?? null) : null;
};
