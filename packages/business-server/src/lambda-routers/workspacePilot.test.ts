// @vitest-environment node
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceRouter } from './workspace';
import { workspaceMemberRouter } from './workspaceMember';

const mocks = vi.hoisted(() => ({
  actorRole: 'owner' as string | null,
  addMember: vi.fn(),
  auditCreate: vi.fn(),
  createWorkspace: vi.fn(),
  getMemberForUpdate: vi.fn(),
  getServerDB: vi.fn(),
  linkedAccount: true,
  lookupRole: vi.fn(),
  managedRole: 'owner' as string | null,
  removeMember: vi.fn(),
  targetBanned: false,
  targetExists: true,
  updateMemberRole: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({ serverDB: {} }));
vi.mock('@lobechat/database/schemas', async () => {
  const { pgTable, text, timestamp } = await import('drizzle-orm/pg-core');
  return {
    account: pgTable('accounts', {
      id: text('id'),
      providerId: text('provider_id'),
      userId: text('user_id'),
    }),
    users: pgTable('users', { banned: text('banned'), id: text('id') }),
    workspaceMembers: pgTable('workspace_members', {
      deletedAt: timestamp('deleted_at'),
      role: text('role'),
      userId: text('user_id'),
      workspaceId: text('workspace_id'),
    }),
    workspaces: pgTable('workspaces', { id: text('id'), primaryOwnerId: text('primary_owner_id') }),
  };
});
vi.mock('@/database/schemas', async () => {
  const { pgTable, text } = await import('drizzle-orm/pg-core');
  return { users: pgTable('users', { id: text('id') }) };
});
vi.mock('@/database/models/workspace', () => ({
  getActiveWorkspaceMembershipRole: vi.fn(async () => mocks.managedRole),
  WorkspaceModel: class {
    create = mocks.createWorkspace;
  },
}));
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: class {
    addMember = mocks.addMember;
    getMemberForUpdate = mocks.getMemberForUpdate;
    removeMember = mocks.removeMember;
    updateMemberRole = mocks.updateMemberRole;
  },
}));
vi.mock('@/database/models/workspaceAuditLog', () => ({
  WorkspaceAuditLogModel: class {
    create = mocks.auditCreate;
  },
}));
vi.mock('@/database/models/user', () => ({
  UserModel: {
    getDisplayInfoByIds: vi.fn(async () => [
      { avatar: null, fullName: 'Pilot', id: 'target', username: 'pilot' },
    ]),
  },
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/envs/auth', () => ({
  authEnv: { AUTH_PHONE_BINDING_EXEMPT_USER_IDS: '', AUTH_PHONE_BINDING_REQUIRED: false },
}));
vi.mock('@/libs/better-auth/phone-identity', () => ({
  findVerifiedPhoneIdentity: vi.fn(),
  hasVerifiedPhoneIdentity: vi.fn(),
  isPhoneBindingExempt: vi.fn(),
}));
vi.mock('@/libs/trpc/middleware/openTelemetry', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { openTelemetry: trpc.middleware(({ next }) => next()) };
});
vi.mock('@/libs/trpc/lambda/middleware/apiKeyScope', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { apiKeyScopeGuard: trpc.middleware(({ next }) => next()) };
});
vi.mock('@/libs/trpc/lambda/middleware/heteroOperationAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { heteroOperationAuth: trpc.middleware(({ next }) => next()) };
});

const dialect = new PgDialect();
const member = (role: string, userId = 'target') => ({
  deletedAt: null,
  role,
  userId,
  workspaceId: 'ws-a',
});

const tx = {
  query: {
    account: { findFirst: vi.fn(async () => (mocks.linkedAccount ? { id: 'linked' } : null)) },
    users: {
      findFirst: vi.fn(async () =>
        mocks.targetExists ? { banned: mocks.targetBanned, id: 'target' } : null,
      ),
    },
  },
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({ for: async () => [{ primaryOwnerId: 'owner' }] }),
    }),
  })),
};
const db = {
  query: {
    account: { findFirst: vi.fn(async () => (mocks.linkedAccount ? { id: 'linked' } : null)) },
    users: {
      findFirst: vi.fn(async () =>
        mocks.targetExists ? { banned: mocks.targetBanned, id: 'target', role: 'admin' } : null,
      ),
    },
  },
  select: vi.fn(() => ({
    from: () => ({
      where: (condition: unknown) => ({
        limit: async () => {
          const query = dialect.sqlToQuery(condition as SQL);
          return query.params[0] === 'ws-a' && query.params[1] === 'owner' && mocks.actorRole
            ? [{ role: mocks.actorRole }]
            : [];
        },
      }),
    }),
  })),
  transaction: vi.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
};
const memberCaller = (userId: string | undefined = 'owner', workspaceId = 'ws-a') =>
  workspaceMemberRouter.createCaller({ serverDB: db, userId, workspaceId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actorRole = 'owner';
  mocks.managedRole = 'owner';
  mocks.linkedAccount = true;
  mocks.targetExists = true;
  mocks.targetBanned = false;
  mocks.getServerDB.mockResolvedValue(db);
  mocks.getMemberForUpdate.mockResolvedValue(undefined);
  mocks.addMember.mockResolvedValue(member('member'));
  mocks.removeMember.mockResolvedValue({ removedDeviceIds: [] });
  mocks.updateMemberRole.mockResolvedValue([{ userId: 'target' }]);
  mocks.createWorkspace.mockResolvedValue({ id: 'ws-new', name: 'Pilot', slug: 'pilot' });
  mocks.auditCreate.mockResolvedValue({ id: 'audit' });
});

describe('A2 workspace pilot mutations', () => {
  it('looks up only a precise Casdoor-linked Fab ID for a workspace admin', async () => {
    await expect(memberCaller().lookupByUserId({ userId: 'target' })).resolves.toEqual({
      user: { avatar: null, fullName: 'Pilot', username: 'pilot' },
      userId: 'target',
    });
    expect(db.query.account.findFirst).toHaveBeenCalledTimes(1);

    mocks.actorRole = 'member';
    await expect(memberCaller().lookupByUserId({ userId: 'target' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(db.query.account.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-user', 'banned', 'missing-oidc'])(
    'does not disclose %s in the member lookup',
    async (kind) => {
      if (kind === 'missing-user') mocks.targetExists = false;
      if (kind === 'banned') mocks.targetBanned = true;
      if (kind === 'missing-oidc') mocks.linkedAccount = false;
      await expect(memberCaller().lookupByUserId({ userId: 'target' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    },
  );

  it('requires platform admin to create and writes workspace audit in the same transaction', async () => {
    const caller = workspaceRouter.createCaller({ userId: 'owner' } as never);
    const input = { name: 'Pilot', slug: 'pilot' };
    await expect(caller.create(input)).resolves.toMatchObject({ id: 'ws-new' });
    expect(mocks.createWorkspace).toHaveBeenCalledWith(input);
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workspace.created',
        userId: 'owner',
        workspaceId: 'ws-new',
      }),
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);

    db.query.users.findFirst.mockResolvedValueOnce({ banned: false, id: 'owner', role: 'viewer' });
    await expect(caller.create(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it('adds only a Casdoor-linked existing Fab user ID, with scoped audit', async () => {
    await expect(
      memberCaller().addByUserId({ userId: 'target', role: 'member' }),
    ).resolves.toMatchObject({
      userId: 'target',
    });
    expect(mocks.addMember).toHaveBeenCalledWith({
      role: 'member',
      userId: 'target',
      workspaceId: 'ws-a',
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.joined',
        resourceId: 'target',
        workspaceId: 'ws-a',
      }),
    );
    expect(tx.query.account.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-user', 'banned', 'missing-oidc'])(
    'rejects %s before membership write',
    async (kind) => {
      if (kind === 'missing-user') mocks.targetExists = false;
      if (kind === 'banned') mocks.targetBanned = true;
      if (kind === 'missing-oidc') mocks.linkedAccount = false;
      await expect(memberCaller().addByUserId({ userId: 'target' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mocks.addMember).not.toHaveBeenCalled();
      expect(mocks.auditCreate).not.toHaveBeenCalled();
    },
  );

  it('does not overwrite an active membership when adding the same ID again', async () => {
    mocks.getMemberForUpdate.mockResolvedValue(member('admin'));
    await expect(
      memberCaller().addByUserId({ userId: 'target', role: 'viewer' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(mocks.addMember).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects foreign workspace and a revoked actor before writes', async () => {
    await expect(
      memberCaller('owner', 'ws-b').addByUserId({ userId: 'target' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(db.transaction).not.toHaveBeenCalled();
    mocks.managedRole = null;
    await expect(memberCaller().addByUserId({ userId: 'target' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.addMember).not.toHaveBeenCalled();
  });

  it('does not let an admin mint an admin or modify another admin', async () => {
    mocks.actorRole = 'admin';
    mocks.managedRole = 'admin';
    await expect(
      memberCaller().addByUserId({ userId: 'target', role: 'admin' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    mocks.getMemberForUpdate.mockResolvedValue(member('admin'));
    await expect(
      memberCaller().changeRoleByUserId({ userId: 'target', role: 'member' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
  });

  it('changes a member role with audit, but never changes the owner', async () => {
    mocks.getMemberForUpdate.mockResolvedValue(member('member'));
    await expect(
      memberCaller().changeRoleByUserId({ userId: 'target', role: 'viewer' }),
    ).resolves.toMatchObject({
      role: 'viewer',
    });
    expect(mocks.updateMemberRole).toHaveBeenCalledWith('ws-a', 'target', 'viewer');
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.role_updated',
        metadata: { from: 'member', to: 'viewer' },
      }),
    );
    await expect(
      memberCaller().changeRoleByUserId({ userId: 'owner', role: 'viewer' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects role changes for a revoked or missing membership', async () => {
    await expect(
      memberCaller().changeRoleByUserId({ userId: 'target', role: 'admin' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
  });

  it('uses the existing soft-revoke cleanup and audit, and propagates audit failures', async () => {
    mocks.getMemberForUpdate.mockResolvedValue(member('member'));
    await expect(memberCaller().revokeByUserId({ userId: 'target' })).resolves.toEqual({
      removedDeviceIds: [],
    });
    expect(mocks.removeMember).toHaveBeenCalledWith('ws-a', 'target');
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.removed',
        workspaceId: 'ws-a',
      }),
    );

    mocks.auditCreate.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(memberCaller().revokeByUserId({ userId: 'target' })).rejects.toThrow(
      'audit unavailable',
    );
  });

  it('never revokes the owner, self, or another admin from an admin session', async () => {
    mocks.actorRole = 'admin';
    mocks.managedRole = 'admin';
    mocks.getMemberForUpdate.mockResolvedValue(member('admin'));
    await expect(memberCaller().revokeByUserId({ userId: 'owner' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(memberCaller().revokeByUserId({ userId: 'target' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated calls without database access', async () => {
    const anonymous = workspaceMemberRouter.createCaller({
      serverDB: db,
      workspaceId: 'ws-a',
    } as never);
    await expect(anonymous.addByUserId({ userId: 'target' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
