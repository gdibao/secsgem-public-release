import { ADMIN_COMMANDS } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { adminCreditsRouter } from './credits';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

const createSelectChain = (rows: unknown[]) => ({
  from: vi.fn(() => ({
    where: vi.fn().mockResolvedValue(rows),
  })),
});

describe('adminCreditsRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects wrong typed confirmation before opening a credit transaction', async () => {
    const transaction = vi.fn();
    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'finance_admin' }),
        },
      },
      transaction,
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminCreditsRouter.createCaller({ userId: 'admin-user' } as any);
    await expect(
      caller.adjust({
        amount: 100,
        command: {
          actionId: 'credits.adjust',
          confirmationText: 'wrong',
          confirmed: true,
          reason: 'manual correction',
        },
        reason: 'manual correction',
        userId: 'target-user',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ADMIN_COMMAND_CONFIRMATION_TEXT_MISMATCH',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects conflicting legacy and envelope reasons before opening a credit transaction', async () => {
    const transaction = vi.fn();
    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'finance_admin' }),
        },
      },
      transaction,
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminCreditsRouter.createCaller({ userId: 'admin-user' } as any);
    await expect(
      caller.adjust({
        amount: 100,
        command: {
          actionId: 'credits.adjust',
          confirmationText: 'credits.adjust',
          confirmed: true,
          reason: 'finance evidence A',
        },
        reason: 'finance evidence B',
        userId: 'target-user',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ADMIN_COMMAND_REASON_MISMATCH',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('accepts an envelope-only reason and records before and after credit snapshots', async () => {
    const before = { balance: 200, totalCredited: 500, totalDebited: 300 };
    const after = { balance: 300, totalCredited: 600, totalDebited: 300 };
    const insertAuditValues = vi.fn().mockResolvedValue(undefined);
    const insertLedgerValues = vi.fn().mockResolvedValue(undefined);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const insert = vi
      .fn()
      .mockReturnValueOnce({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        })),
      })
      .mockReturnValueOnce({
        values: insertLedgerValues,
      })
      .mockReturnValueOnce({
        values: insertAuditValues,
      });
    const tx = {
      insert,
      select: vi
        .fn()
        .mockReturnValueOnce(createSelectChain([before]))
        .mockReturnValueOnce(createSelectChain([after])),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    } as any;
    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'finance_admin' }),
        },
      },
      transaction: vi.fn(async (handler: (transaction: typeof tx) => Promise<void>) => handler(tx)),
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminCreditsRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(
      caller.adjust({
        amount: 100,
        command: {
          actionId: 'credits.adjust',
          confirmationText: 'credits.adjust',
          confirmed: true,
          reason: 'manual correction',
        },
        userId: 'target-user',
      }),
    ).resolves.toEqual({ ok: true });

    expect(insertAuditValues).toHaveBeenCalledWith({
      action: ADMIN_COMMANDS['credits.adjust'].auditAction,
      actorUserId: 'admin-user',
      ipAddress: null,
      payload: expect.objectContaining({
        after,
        amount: 100,
        before,
        correlationId: expect.any(String),
        reason: 'manual correction',
        status: 'succeeded',
      }),
      resourceId: null,
      resourceType: 'credit_account',
      targetUserId: 'target-user',
    });
  });

  it('rejects the critical adjustment when its same-transaction audit insert fails', async () => {
    const before = { balance: 200, totalCredited: 500, totalDebited: 300 };
    const after = { balance: 300, totalCredited: 600, totalDebited: 300 };
    const auditFailure = new Error('audit insert failed');
    const tx = {
      insert: vi
        .fn()
        .mockReturnValueOnce({
          values: vi.fn(() => ({
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          })),
        })
        .mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) })
        .mockReturnValueOnce({ values: vi.fn().mockRejectedValue(auditFailure) }),
      select: vi
        .fn()
        .mockReturnValueOnce(createSelectChain([before]))
        .mockReturnValueOnce(createSelectChain([after])),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      })),
    } as any;
    const transaction = vi.fn(async (handler: (transaction: typeof tx) => Promise<void>) =>
      handler(tx),
    );
    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'finance_admin' }),
        },
      },
      transaction,
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminCreditsRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(
      caller.adjust({
        amount: 100,
        command: {
          actionId: 'credits.adjust',
          confirmationText: 'credits.adjust',
          confirmed: true,
          reason: 'manual correction',
        },
        userId: 'target-user',
      }),
    ).rejects.toMatchObject({ message: auditFailure.message });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(3);
  });

  it('audits listAccounts with bounded filters and count without row data', async () => {
    const items = [
      {
        balance: 100,
        currency: 'credits',
        totalCredited: 120,
        totalDebited: 20,
        userId: 'private-user-id',
      },
    ];
    const auditValues = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn(() => ({ values: auditValues })),
      query: {
        creditAccounts: { findMany: vi.fn().mockResolvedValue(items) },
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'finance_admin' }),
        },
      },
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminCreditsRouter.createCaller({ userId: 'admin-user' } as any).listAccounts({
        cursor: 25,
        limit: 50,
        negativeOnly: true,
        order: 'asc',
        sort: 'totalDebited',
      }),
    ).resolves.toEqual({ items, nextCursor: null });

    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'credits.list',
        payload: expect.objectContaining({
          count: 1,
          cursor: 25,
          filters: {
            limit: 50,
            negativeOnly: true,
            order: 'asc',
            sort: 'totalDebited',
          },
          status: 'succeeded',
        }),
        resourceType: 'credit_account',
      }),
    );
    expect(JSON.stringify(auditValues.mock.calls)).not.toContain('private-user-id');
  });

  it('returns credits CSV rows through a distinct audited backend export procedure', async () => {
    const items = [
      { balance: 100, currency: 'credits', totalCredited: 120, totalDebited: 20, userId: 'user-1' },
      { balance: -10, currency: 'credits', totalCredited: 0, totalDebited: 10, userId: 'user-2' },
    ];
    const auditValues = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn(() => ({ values: auditValues })),
      query: {
        creditAccounts: { findMany: vi.fn().mockResolvedValue(items) },
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'finance_admin' }),
        },
      },
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      (adminCreditsRouter.createCaller({ userId: 'admin-user' } as any) as any).exportAccounts({
        limit: 500,
        negativeOnly: true,
        order: 'asc',
        sort: 'balance',
      }),
    ).resolves.toEqual({ items });

    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'credits.export',
        payload: expect.objectContaining({
          count: 2,
          filters: { negativeOnly: true, order: 'asc', sort: 'balance' },
          limit: 500,
          status: 'succeeded',
        }),
        resourceType: 'credit_account',
      }),
    );
    expect(JSON.stringify(auditValues.mock.calls)).not.toContain('user-1');
  });
});
