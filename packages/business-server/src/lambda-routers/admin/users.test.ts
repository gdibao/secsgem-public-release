// @vitest-environment node
import { ADMIN_COMMANDS, Plans } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { getTestDB } from '@/database/core/getTestDB';
import { userPlanSnapshots, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { recordAdminAudit } from './audit';
import {
  adminUsersRouter,
  getResetAllUsersToFreePlanPreview,
  resetAllUsersToFreePlan,
} from './users';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('./audit', () => ({
  recordAdminAudit: vi.fn(),
  runRequiredAdminAuditMutation: vi.fn(async (ctx, options) => {
    const result = await ctx.serverDB.transaction((tx: unknown) => options.mutation(tx));
    await recordAdminAudit(ctx, await options.audit(result));
    return result;
  }),
}));

const serverDB: LobeChatDatabase = await getTestDB();

const testUserIds = ['admin-users-reset-paid', 'admin-users-reset-free', 'admin-users-reset-empty'];

beforeEach(async () => {
  vi.clearAllMocks();
  await serverDB.insert(users).values(testUserIds.map((id) => ({ id })));
});

afterEach(async () => {
  await serverDB.delete(userPlanSnapshots).where(inArray(userPlanSnapshots.userId, testUserIds));
  await serverDB.delete(users).where(inArray(users.id, testUserIds));
});

describe('resetAllUsersToFreePlan', () => {
  it('previews the same affected counts without mutating plan snapshots', async () => {
    const paidUserId = testUserIds[0];
    const freeUserId = testUserIds[1];
    const emptyUserId = testUserIds[2];

    await serverDB.insert(userPlanSnapshots).values([
      {
        cycle: 'monthly',
        endsAt: new Date('2026-06-10T00:00:00.000Z'),
        monthlyCredits: 1000,
        monthlyPrice: 68,
        plan: Plans.Starter,
        provider: 'admin_manual',
        renewsAt: new Date('2026-06-10T00:00:00.000Z'),
        startedAt: new Date('2026-05-10T00:00:00.000Z'),
        status: 'active',
        userId: paidUserId,
      },
      {
        cycle: 'monthly',
        endsAt: new Date('2026-06-10T00:00:00.000Z'),
        monthlyCredits: 99,
        monthlyPrice: 1,
        plan: Plans.Free,
        provider: null,
        renewsAt: new Date('2026-06-10T00:00:00.000Z'),
        startedAt: new Date('2026-05-10T00:00:00.000Z'),
        status: 'active',
        userId: freeUserId,
      },
    ]);

    const result = await getResetAllUsersToFreePlanPreview(serverDB, {
      userIds: testUserIds,
    });

    expect(result).toEqual({
      canceledPaid: 1,
      insertedFree: 2,
      normalizedFree: 1,
    });

    const activePaid = await serverDB.query.userPlanSnapshots.findFirst({
      where: eq(userPlanSnapshots.userId, paidUserId),
    });
    const emptySnapshot = await serverDB.query.userPlanSnapshots.findFirst({
      where: eq(userPlanSnapshots.userId, emptyUserId),
    });

    expect(activePaid).toMatchObject({
      plan: Plans.Starter,
      status: 'active',
    });
    expect(emptySnapshot).toBeUndefined();
  });

  it('cancels active paid plans, normalizes active free plans, and inserts missing free plans', async () => {
    const paidUserId = testUserIds[0];
    const freeUserId = testUserIds[1];
    const emptyUserId = testUserIds[2];

    await serverDB.insert(userPlanSnapshots).values([
      {
        cycle: 'monthly',
        endsAt: new Date('2026-06-10T00:00:00.000Z'),
        monthlyCredits: 1000,
        monthlyPrice: 68,
        plan: Plans.Starter,
        provider: 'admin_manual',
        renewsAt: new Date('2026-06-10T00:00:00.000Z'),
        startedAt: new Date('2026-05-10T00:00:00.000Z'),
        status: 'active',
        userId: paidUserId,
      },
      {
        cycle: 'monthly',
        endsAt: new Date('2026-06-10T00:00:00.000Z'),
        monthlyCredits: 99,
        monthlyPrice: 1,
        plan: Plans.Free,
        provider: null,
        renewsAt: new Date('2026-06-10T00:00:00.000Z'),
        startedAt: new Date('2026-05-10T00:00:00.000Z'),
        status: 'active',
        userId: freeUserId,
      },
    ]);

    const result = await resetAllUsersToFreePlan(serverDB, 'test_reset_all_to_free', {
      userIds: testUserIds,
    });

    expect(result).toEqual({
      canceledPaid: 1,
      insertedFree: 2,
      normalizedFree: 1,
    });

    const snapshots = await serverDB.query.userPlanSnapshots.findMany({
      where: inArray(userPlanSnapshots.userId, testUserIds),
    });

    const activeSnapshots = snapshots.filter((snapshot) => snapshot.status === 'active');
    expect(activeSnapshots).toHaveLength(3);
    expect(activeSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'CNY',
          endsAt: null,
          monthlyCredits: 0,
          monthlyPrice: 0,
          plan: Plans.Free,
          renewsAt: null,
          status: 'active',
          userId: paidUserId,
        }),
        expect.objectContaining({
          currency: 'CNY',
          endsAt: null,
          monthlyCredits: 0,
          monthlyPrice: 0,
          plan: Plans.Free,
          provider: 'system_default',
          renewsAt: null,
          status: 'active',
          userId: freeUserId,
        }),
        expect.objectContaining({
          currency: 'CNY',
          endsAt: null,
          monthlyCredits: 0,
          monthlyPrice: 0,
          plan: Plans.Free,
          provider: 'system_default',
          renewsAt: null,
          status: 'active',
          userId: emptyUserId,
        }),
      ]),
    );

    const paidSnapshots = snapshots.filter((snapshot) => snapshot.userId === paidUserId);
    expect(paidSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan: Plans.Starter,
          status: 'canceled',
        }),
      ]),
    );
  });
});

describe('adminUsersRouter reset command', () => {
  it('rejects conflicting legacy and envelope reasons before resetting users', async () => {
    const transaction = vi.fn();
    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
        },
      },
      transaction,
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminUsersRouter.createCaller({ userId: 'admin-user' } as any);
    await expect(
      caller.resetAllToFreePlan({
        command: {
          actionId: 'user.resetAllToFreePlan',
          confirmationText: 'user.resetAllToFreePlan',
          confirmed: true,
          reason: 'reset evidence A',
        },
        reason: 'reset evidence B',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ADMIN_COMMAND_REASON_MISMATCH',
    });

    expect(transaction).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });
});

describe('adminUsersRouter impersonation audit', () => {
  it('rejects support admins because impersonation requires full admin access', async () => {
    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'support_admin' }),
        },
      },
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminUsersRouter.createCaller({ userId: 'support-user' } as any);
    await expect(
      caller.recordImpersonationAttempt({
        command: { actionId: 'user.impersonate.attempt', confirmed: true },
        userId: 'target-user',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('records impersonation as an attempt instead of a started session', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ banned: false, role: 'admin' })
      .mockResolvedValueOnce({
        email: 'target@example.com',
        fullName: 'Target User',
        id: 'target-user',
        username: 'target',
      });
    const db = {
      query: {
        users: {
          findFirst,
        },
      },
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminUsersRouter.createCaller({ userId: 'admin-user' } as any);
    await (caller as any).recordImpersonationAttempt({
      command: { actionId: 'user.impersonate.attempt', confirmed: true },
      userId: 'target-user',
    });

    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        serverDB: db,
        userId: 'admin-user',
      }),
      expect.objectContaining({
        action: ADMIN_COMMANDS['user.impersonate.attempt'].auditAction,
        payload: {
          targetEmail: 'target@example.com',
          targetFullName: 'Target User',
          targetUsername: 'target',
        },
        resourceType: 'user',
        targetUserId: 'target-user',
      }),
    );
    expect(recordAdminAudit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'user.impersonate.start' }),
    );
  });
});

describe('adminUsersRouter export audit', () => {
  it('records a distinct sanitized user export event', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);
    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
          findMany,
        },
      },
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    await adminUsersRouter.createCaller({ userId: 'admin-user' } as any).exportAll({
      limit: 25,
      query: 'person@example.com',
    });

    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-user' }),
      {
        action: 'user.export',
        payload: { count: 2, filters: { hasQuery: true }, limit: 25 },
        resourceType: 'user_export',
      },
    );
    expect(JSON.stringify(vi.mocked(recordAdminAudit).mock.calls)).not.toContain(
      'person@example.com',
    );
  });
});

describe('adminUsersRouter compact detail', () => {
  it('allows finance readers without returning support PII fields', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ banned: false, role: 'finance_admin' })
      .mockResolvedValueOnce({
        banned: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        id: 'target-user',
        lastActiveAt: null,
        role: 'user',
      });
    const db = { query: { users: { findFirst } } } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminUsersRouter.createCaller({ userId: 'finance-user' } as any).compactDetail({
        userId: 'target-user',
      }),
    ).resolves.toEqual({
      banned: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 'target-user',
      lastActiveAt: null,
      role: 'user',
    });

    expect(findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        columns: { banned: true, createdAt: true, id: true, lastActiveAt: true, role: true },
      }),
    );
    expect(JSON.stringify(await findFirst.mock.results[1].value)).not.toContain('email');
    expect(JSON.stringify(await findFirst.mock.results[1].value)).not.toContain('phone');
  });

  it('keeps full support detail unavailable to finance-only readers', async () => {
    const db = {
      query: {
        users: { findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'finance_admin' }) },
      },
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminUsersRouter.createCaller({ userId: 'finance-user' } as any).fullDetail({
        userId: 'target-user',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
