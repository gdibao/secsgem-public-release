// @vitest-environment node
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceMemberRouter } from './workspaceMember';

const mocks = vi.hoisted(() => {
  const lookupRole = vi.fn();
  const createDatabase = () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: unknown) => ({ limit: vi.fn(() => lookupRole(condition)) })),
      })),
    })),
  });

  return {
    database: createDatabase(),
    fallbackDatabase: createDatabase(),
    getDisplayInfoByIds: vi.fn(),
    getEmailsByIds: vi.fn(),
    getServerDB: vi.fn(() => {
      throw new Error('Real database access is forbidden in this test');
    }),
    listMembers: vi.fn(),
    lookupRole,
    modelConstructor: vi.fn(),
  };
});

vi.mock('@lobechat/database', () => ({ serverDB: mocks.fallbackDatabase }));
vi.mock('@lobechat/database/schemas', async () => {
  const { pgTable, text, timestamp } = await import('drizzle-orm/pg-core');
  return {
    workspaceMembers: pgTable('workspace_members', {
      deletedAt: timestamp('deleted_at'),
      role: text('role'),
      userId: text('user_id'),
      workspaceId: text('workspace_id'),
    }),
  };
});
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: class {
    constructor(...args: unknown[]) {
      mocks.modelConstructor(...args);
    }
    listMembers = mocks.listMembers;
  },
}));
vi.mock('@/database/models/user', () => ({
  UserModel: {
    getDisplayInfoByIds: mocks.getDisplayInfoByIds,
    getEmailsByIds: mocks.getEmailsByIds,
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

// Keep the current tree's router, OIDC/user auth and workspace middleware real.
// Unrelated telemetry, admin and operation-token paths must not load release services.
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
vi.mock('@/libs/trpc/lambda/middleware/adminPermissions', () => ({ ADMIN_CAPABILITIES: [] }));
vi.mock('@/libs/trpc/lambda/middleware/requireSuperAdmin', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const middleware = trpc.middleware(({ next }) => next());
  return {
    requireAdminCapability: () => middleware,
    requireAnyAdminCapability: () => middleware,
    requireSuperAdmin: middleware,
  };
});

const dialect = new PgDialect();
const epoch = new Date('2026-01-01T00:00:00Z');
const member = (workspaceId: string, userId: string, deletedAt: Date | null = null) => ({
  deletedAt,
  joinedAt: epoch,
  role: 'member',
  updatedAt: epoch,
  userId,
  workspaceId,
});
const profile = (id: string) => ({ avatar: null, fullName: id, id, username: id });
const caller = (userId: string | undefined = 'alice', workspaceId: string | undefined = 'ws-a') =>
  workspaceMemberRouter.createCaller({ serverDB: mocks.database, userId, workspaceId } as never);

let memberships: Array<{
  deletedAt: Date | null;
  role: string;
  userId: string;
  workspaceId: string;
}>;
let roleQueries: Array<{ params: unknown[]; sql: string }>;

describe('workspaceMemberRouter.list', () => {
  afterEach(() => {
    expect(mocks.getServerDB).not.toHaveBeenCalled();
    expect(mocks.getEmailsByIds).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupRole.mockReset();
    mocks.listMembers.mockReset();
    mocks.getDisplayInfoByIds.mockReset();
    memberships = [
      { deletedAt: null, role: 'member', userId: 'alice', workspaceId: 'ws-a' },
      { deletedAt: null, role: 'member', userId: 'bob', workspaceId: 'ws-b' },
    ];
    roleQueries = [];
    mocks.lookupRole.mockImplementation(async (condition) => {
      const query = dialect.sqlToQuery(condition);
      roleQueries.push(query);
      const [workspaceId, userId] = query.params;
      const membership = memberships.find(
        (row) => row.workspaceId === workspaceId && row.userId === userId && row.deletedAt === null,
      );
      return membership ? [{ role: membership.role }] : [];
    });
    mocks.listMembers.mockResolvedValue([member('ws-a', 'alice')]);
    mocks.getDisplayInfoByIds.mockResolvedValue([profile('alice')]);
  });

  it('rejects an unauthenticated caller before any database query', async () => {
    const anonymous = workspaceMemberRouter.createCaller({ serverDB: mocks.database } as never);
    await expect(anonymous.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.database.select).not.toHaveBeenCalled();
    expect(mocks.listMembers).not.toHaveBeenCalled();
    expect(mocks.getServerDB).not.toHaveBeenCalled();
  });

  it('keeps personal scope empty without loading member profiles', async () => {
    const personal = workspaceMemberRouter.createCaller({ userId: 'alice' } as never);
    await expect(personal.list()).resolves.toEqual([]);
    expect(mocks.fallbackDatabase.select).not.toHaveBeenCalled();
    expect(mocks.listMembers).not.toHaveBeenCalled();
    expect(mocks.getDisplayInfoByIds).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'deleted', 'unknown-role'])(
    'does not query a directory for %s membership',
    async (kind) => {
      if (kind === 'deleted') memberships[0].deletedAt = epoch;
      if (kind === 'unknown-role') memberships[0].role = 'unknown';
      await expect(caller('alice', kind === 'foreign' ? 'ws-b' : 'ws-a').list()).resolves.toEqual([]);
      expect(mocks.listMembers).not.toHaveBeenCalled();
      expect(mocks.getDisplayInfoByIds).not.toHaveBeenCalled();
    },
  );

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'rejects inherited property role %s before directory or profile queries',
    async (role) => {
      memberships[0].role = role;
      await expect(caller().list()).resolves.toEqual([]);
      expect(mocks.listMembers).not.toHaveBeenCalled();
      expect(mocks.getDisplayInfoByIds).not.toHaveBeenCalled();
    },
  );

  it('scopes real middleware SQL to workspace, user and non-deleted membership', async () => {
    mocks.listMembers.mockImplementation(async (workspaceId) => [
      member(workspaceId, workspaceId === 'ws-a' ? 'alice' : 'bob'),
    ]);
    mocks.getDisplayInfoByIds.mockImplementation(async (_db, ids: string[]) => ids.map(profile));
    await expect(caller('alice', 'ws-a').list()).resolves.toMatchObject([
      { userId: 'alice', workspaceId: 'ws-a' },
    ]);
    await expect(caller('bob', 'ws-b').list()).resolves.toMatchObject([
      { userId: 'bob', workspaceId: 'ws-b' },
    ]);
    expect(roleQueries.map((query) => query.params)).toEqual([['ws-a', 'alice'], ['ws-b', 'bob']]);
    for (const query of roleQueries) {
      expect(query.sql).toContain('"workspace_members"."workspace_id" = $1');
      expect(query.sql).toContain('"workspace_members"."user_id" = $2');
      expect(query.sql).toContain('"workspace_members"."deleted_at" is null');
    }
    expect(mocks.listMembers.mock.calls).toEqual([
      ['ws-a', { includeDeleted: false }],
      ['ws-b', { includeDeleted: false }],
    ]);
    expect(mocks.getDisplayInfoByIds.mock.calls).toEqual([
      [mocks.database, ['alice']],
      [mocks.database, ['bob']],
    ]);
  });

  it('ignores injected workspace and user identifiers in input', async () => {
    await caller().list({ userId: 'bob', workspaceId: 'ws-b' } as never);
    expect(mocks.listMembers).toHaveBeenCalledWith('ws-a', { includeDeleted: false });
    expect(mocks.getDisplayInfoByIds).toHaveBeenCalledWith(mocks.database, ['alice']);
  });

  it.each([undefined, false])('requests current members for includeDeleted=%s', async (value) => {
    await caller().list(value === undefined ? undefined : { includeDeleted: value });
    expect(mocks.listMembers).toHaveBeenCalledWith('ws-a', { includeDeleted: false });
  });

  it.each(['owner', 'admin'])('allows %s history reads, preserving deletedAt', async (role) => {
    memberships[0].role = role;
    mocks.listMembers.mockResolvedValue([member('ws-a', 'departed', epoch)]);
    mocks.getDisplayInfoByIds.mockResolvedValue([profile('departed')]);
    const rows = await caller().list({ includeDeleted: true });
    expect(mocks.listMembers).toHaveBeenCalledWith('ws-a', { includeDeleted: true });
    expect(rows[0].deletedAt).toEqual(epoch);
    expect(rows[0]).not.toHaveProperty('isActive');
    expect(rows[0].user?.email).toBeNull();
    expect(roleQueries).toHaveLength(2);
  });

  it.each(['member', 'viewer'])('rejects %s history reads before querying', async (role) => {
    memberships[0].role = role;
    await expect(caller().list({ includeDeleted: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.listMembers).not.toHaveBeenCalled();
    expect(mocks.getDisplayInfoByIds).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [], state: 'revoked' },
    { rows: [{ role: 'viewer' }], state: 'downgraded' },
  ])('denies history when membership is $state at the role recheck', async ({ rows }) => {
    mocks.lookupRole.mockResolvedValueOnce([{ role: 'admin' }]).mockResolvedValueOnce(rows);
    await expect(caller().list({ includeDeleted: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.listMembers).not.toHaveBeenCalled();
    expect(mocks.getDisplayInfoByIds).not.toHaveBeenCalled();
  });

  it('whitelists fields and joins unordered profiles by authorized member ID', async () => {
    mocks.listMembers.mockResolvedValue([
      { ...member('ws-a', 'alice'), privateMetadata: 'excluded' },
      member('ws-a', 'carol'),
      member('ws-a', 'missing'),
    ]);
    mocks.getDisplayInfoByIds.mockResolvedValue([
      { ...profile('outsider'), email: 'outside@example.invalid' },
      profile('carol'),
      {
        ...profile('alice'),
        banned: true,
        email: 'alice@example.invalid',
        externalId: 'excluded',
        keyVaults: 'excluded',
        phone: 'excluded',
        preference: {},
      },
    ]);
    const rows = await caller().list();
    expect(rows).toEqual([
      {
        ...member('ws-a', 'alice'),
        user: { avatar: null, email: null, fullName: 'alice', username: 'alice' },
      },
      {
        ...member('ws-a', 'carol'),
        user: { avatar: null, email: null, fullName: 'carol', username: 'carol' },
      },
      { ...member('ws-a', 'missing'), user: null },
    ]);
    expect(mocks.getDisplayInfoByIds).toHaveBeenCalledWith(mocks.database, [
      'alice', 'carol', 'missing',
    ]);
    expect(mocks.getEmailsByIds).not.toHaveBeenCalled();
  });

  it('does not request any profiles for an empty directory', async () => {
    mocks.listMembers.mockResolvedValue([]);
    await expect(caller().list()).resolves.toEqual([]);
    expect(mocks.getDisplayInfoByIds).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'member', 'viewer'])('returns null email for %s', async (role) => {
    memberships[0].role = role;
    mocks.getDisplayInfoByIds.mockResolvedValue([
      { ...profile('alice'), email: 'alice@example.invalid' },
    ]);
    const rows = await caller().list();
    expect(rows[0].user?.email).toBeNull();
  });

  it('uses the context database for both authorization and models', async () => {
    await caller().list();
    expect(mocks.database.select).toHaveBeenCalled();
    expect(mocks.fallbackDatabase.select).not.toHaveBeenCalled();
    expect(mocks.modelConstructor).toHaveBeenCalledWith(mocks.database, 'alice');
    expect(mocks.getDisplayInfoByIds).toHaveBeenCalledWith(mocks.database, ['alice']);
    expect(mocks.getServerDB).not.toHaveBeenCalled();
  });

  it('uses the controlled fallback when no context database is supplied', async () => {
    const fallback = workspaceMemberRouter.createCaller({
      userId: 'alice',
      workspaceId: 'ws-a',
    } as never);
    await fallback.list();
    expect(mocks.fallbackDatabase.select).toHaveBeenCalled();
    expect(mocks.database.select).not.toHaveBeenCalled();
    expect(mocks.modelConstructor).toHaveBeenCalledWith(mocks.fallbackDatabase, 'alice');
    expect(mocks.getDisplayInfoByIds).toHaveBeenCalledWith(mocks.fallbackDatabase, ['alice']);
    expect(mocks.getServerDB).not.toHaveBeenCalled();
  });

  it.each(['directory', 'profiles'])('propagates %s failures without fallback', async (stage) => {
    if (stage === 'directory') {
      mocks.listMembers.mockRejectedValueOnce(new Error('directory unavailable'));
    }
    else mocks.getDisplayInfoByIds.mockRejectedValueOnce(new Error('profiles unavailable'));
    await expect(caller().list()).rejects.toThrow(`${stage} unavailable`);
    expect(mocks.fallbackDatabase.select).not.toHaveBeenCalled();
    expect(mocks.listMembers).toHaveBeenCalledTimes(1);
    expect(mocks.getDisplayInfoByIds).toHaveBeenCalledTimes(stage === 'directory' ? 0 : 1);
    expect(mocks.getEmailsByIds).not.toHaveBeenCalled();
  });
});
