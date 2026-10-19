import { describe, expect, it } from 'vitest';

import {
  assertModuleAppRecordPermission,
  resolveModuleAppRecordPermission,
  resolveModuleAppWorkspaceManagementPermission,
} from './permission';

describe('resolveModuleAppRecordPermission', () => {
  it('allows personal owner operations', () => {
    const decision = resolveModuleAppRecordPermission({
      actorUserId: 'u1',
      createdBy: 'u1',
      operation: 'update',
      ownerUserId: 'u1',
      scopeType: 'personal',
      workspaceMembership: null,
    });

    expect(decision.allowed).toBe(true);
  });

  it('allows personal record creation before a record owner exists', () => {
    const decision = resolveModuleAppRecordPermission({
      actorUserId: 'u1',
      operation: 'create',
      scopeType: 'personal',
      workspaceMembership: null,
    });

    expect(decision.allowed).toBe(true);
  });

  it('denies personal records for other users', () => {
    const decision = resolveModuleAppRecordPermission({
      actorUserId: 'u2',
      createdBy: 'u1',
      operation: 'view',
      ownerUserId: 'u1',
      scopeType: 'personal',
      workspaceMembership: null,
    });

    expect(decision).toEqual({ allowed: false, reason: 'personal_not_owner' });
  });

  it('allows workspace members to view and edit workspace records', () => {
    const decision = resolveModuleAppRecordPermission({
      actorUserId: 'u2',
      createdBy: 'u1',
      operation: 'update',
      ownerUserId: 'u1',
      scopeType: 'workspace',
      workspaceId: 'w1',
      workspaceMembership: { role: 'member', workspaceId: 'w1' },
    });

    expect(decision.allowed).toBe(true);
  });

  it('allows workspace archive only by creator, workspace admin, or system admin', () => {
    expect(
      resolveModuleAppRecordPermission({
        actorUserId: 'u2',
        createdBy: 'u1',
        operation: 'archive',
        ownerUserId: 'u1',
        scopeType: 'workspace',
        workspaceId: 'w1',
        workspaceMembership: { role: 'member', workspaceId: 'w1' },
      }),
    ).toEqual({ allowed: false, reason: 'archive_denied' });

    expect(
      resolveModuleAppRecordPermission({
        actorUserId: 'u2',
        createdBy: 'u1',
        operation: 'archive',
        ownerUserId: 'u1',
        scopeType: 'workspace',
        workspaceId: 'w1',
        workspaceMembership: { role: 'admin', workspaceId: 'w1' },
      }).allowed,
    ).toBe(true);

    expect(
      resolveModuleAppRecordPermission({
        actorIsSystemAdmin: true,
        actorUserId: 'u3',
        createdBy: 'u1',
        operation: 'archive',
        ownerUserId: 'u1',
        scopeType: 'workspace',
        workspaceId: 'w1',
        workspaceMembership: null,
      }).allowed,
    ).toBe(true);
  });

  it('denies workspace operations without a matching workspace membership', () => {
    expect(
      resolveModuleAppRecordPermission({
        actorUserId: 'u2',
        createdBy: 'u1',
        operation: 'view',
        ownerUserId: 'u1',
        scopeType: 'workspace',
        workspaceMembership: null,
      }),
    ).toEqual({ allowed: false, reason: 'workspace_required' });

    expect(
      resolveModuleAppRecordPermission({
        actorUserId: 'u2',
        createdBy: 'u1',
        operation: 'view',
        ownerUserId: 'u1',
        scopeType: 'workspace',
        workspaceId: 'w1',
        workspaceMembership: { role: 'member', workspaceId: 'w2' },
      }),
    ).toEqual({ allowed: false, reason: 'workspace_not_member' });
  });

  it('throws the denial reason when asserted permission fails', () => {
    expect(() =>
      assertModuleAppRecordPermission({
        actorUserId: 'u2',
        createdBy: 'u1',
        operation: 'update',
        ownerUserId: 'u1',
        scopeType: 'personal',
        workspaceMembership: null,
      }),
    ).toThrow('personal_not_owner');
  });

  it('supports assertion with the operation as a second argument', () => {
    expect(() =>
      assertModuleAppRecordPermission(
        {
          actorUserId: 'u1',
          createdBy: 'u1',
          ownerUserId: 'u1',
          scopeType: 'personal',
          workspaceMembership: null,
        },
        'view',
      ),
    ).not.toThrow();
  });

  it('allows only workspace owners or admins to manage purchases and installations', () => {
    expect(
      resolveModuleAppWorkspaceManagementPermission({
        workspaceId: 'w1',
        workspaceMembership: { role: 'member', workspaceId: 'w1' },
      }),
    ).toEqual({ allowed: false, reason: 'workspace_admin_required' });
    expect(
      resolveModuleAppWorkspaceManagementPermission({
        workspaceId: 'w1',
        workspaceMembership: { role: 'owner', workspaceId: 'w1' },
      }).allowed,
    ).toBe(true);
    expect(
      resolveModuleAppWorkspaceManagementPermission({
        workspaceId: 'w1',
        workspaceMembership: { role: 'admin', workspaceId: 'w1' },
      }).allowed,
    ).toBe(true);
  });
});
