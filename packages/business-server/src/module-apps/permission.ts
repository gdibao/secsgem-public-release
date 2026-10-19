import type { ModuleAppScopeType } from '@lobechat/types';

export type ModuleAppRecordOperation = 'archive' | 'create' | 'update' | 'view';

export type ModuleAppPermissionReason =
  | 'archive_denied'
  | 'personal_not_owner'
  | 'workspace_admin_required'
  | 'workspace_not_member'
  | 'workspace_required';

export type ModuleAppPermissionDecision =
  { allowed: true; reason?: never } | { allowed: false; reason: ModuleAppPermissionReason };

export type ModuleAppWorkspaceMembership = {
  role: 'admin' | 'member' | 'owner';
  workspaceId: string;
} | null;

export interface ResolveModuleAppRecordPermissionInput {
  actorIsSystemAdmin?: boolean;
  actorUserId: string;
  createdBy?: null | string;
  operation: ModuleAppRecordOperation;
  ownerUserId?: null | string;
  scopeType: ModuleAppScopeType;
  workspaceId?: null | string;
  workspaceMembership: ModuleAppWorkspaceMembership;
}

export interface ResolveModuleAppWorkspaceManagementPermissionInput {
  workspaceId?: null | string;
  workspaceMembership: ModuleAppWorkspaceMembership;
}

const allow = { allowed: true } as const;

const deny = (reason: ModuleAppPermissionReason): ModuleAppPermissionDecision => ({
  allowed: false,
  reason,
});

export function resolveModuleAppRecordPermission(
  input: ResolveModuleAppRecordPermissionInput,
): ModuleAppPermissionDecision {
  if (input.actorIsSystemAdmin) return allow;

  if (input.scopeType === 'personal') {
    const canCreateOwnRecord =
      input.operation === 'create' &&
      (!input.ownerUserId || input.ownerUserId === input.actorUserId);

    return input.ownerUserId === input.actorUserId || canCreateOwnRecord
      ? allow
      : deny('personal_not_owner');
  }

  if (!input.workspaceId) return deny('workspace_required');

  if (!input.workspaceMembership || input.workspaceMembership.workspaceId !== input.workspaceId) {
    return deny('workspace_not_member');
  }

  if (input.operation !== 'archive') return allow;

  const isCreator = input.createdBy === input.actorUserId;
  const isWorkspaceAdmin =
    input.workspaceMembership.role === 'admin' || input.workspaceMembership.role === 'owner';

  return isCreator || isWorkspaceAdmin ? allow : deny('archive_denied');
}

export function resolveModuleAppWorkspaceManagementPermission(
  input: ResolveModuleAppWorkspaceManagementPermissionInput,
): ModuleAppPermissionDecision {
  if (!input.workspaceId) return deny('workspace_required');
  if (!input.workspaceMembership || input.workspaceMembership.workspaceId !== input.workspaceId) {
    return deny('workspace_not_member');
  }

  return input.workspaceMembership.role === 'owner' || input.workspaceMembership.role === 'admin'
    ? allow
    : deny('workspace_admin_required');
}

export function assertModuleAppWorkspaceManagementPermission(
  input: ResolveModuleAppWorkspaceManagementPermissionInput,
) {
  const decision = resolveModuleAppWorkspaceManagementPermission(input);
  if (!decision.allowed) throw new Error(decision.reason);
}

export function assertModuleAppRecordPermission(input: ResolveModuleAppRecordPermissionInput): void;
export function assertModuleAppRecordPermission(
  input: Omit<ResolveModuleAppRecordPermissionInput, 'operation'>,
  operation: ModuleAppRecordOperation,
): void;
export function assertModuleAppRecordPermission(
  input:
    | ResolveModuleAppRecordPermissionInput
    | Omit<ResolveModuleAppRecordPermissionInput, 'operation'>,
  operation?: ModuleAppRecordOperation,
): void {
  const decision = resolveModuleAppRecordPermission({
    ...input,
    operation: operation ?? (input as ResolveModuleAppRecordPermissionInput).operation,
  });

  if (!decision.allowed) throw new Error(decision.reason);
}
