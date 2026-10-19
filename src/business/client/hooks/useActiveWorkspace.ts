import type { WorkspaceItem } from '@lobechat/database/schemas';
import { useParams } from 'react-router';

import { useWorkspaces } from './useWorkspaces';

export type WorkspaceListItem = WorkspaceItem & {
  /**
   * True when the caller is a non-primary member of a workspace whose paid
   * subscription has lapsed. The cloud override of `workspace.list` sets it;
   * open-source stub leaves it absent.
   */
  lockedOut?: boolean;
  plan?: 'business' | 'free' | 'pro';
  role?: string | null;
};

export const useActiveWorkspace = (): WorkspaceListItem | null => {
  const { workspaceSlug } = useParams<{ workspaceSlug?: string }>();
  const workspaces = useWorkspaces();

  return workspaceSlug
    ? (workspaces.find((workspace) => workspace.slug === workspaceSlug) ?? null)
    : null;
};
