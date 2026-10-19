import { describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { adminContentRouter } from './content';
import { adminCreditsRouter } from './credits';
import { adminOrdersRouter } from './orders';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/config/db', () => ({ serverDBEnv: { REMOVE_GLOBAL_FILE: true } }));

vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));

vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));

vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));

const adminUser = { banned: false, role: 'admin' };

describe('required admin audit router transactions', () => {
  it('rolls back a content archive when the real audit insert fails', async () => {
    const committed = { topicStatus: 'active' };
    const db = {
      query: {
        topics: {
          findFirst: vi.fn().mockResolvedValue({ id: 'topic-1', title: 'Topic', userId: 'user-1' }),
        },
        users: { findFirst: vi.fn().mockResolvedValue(adminUser) },
      },
      transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
        const working = { ...committed };
        const tx = {
          insert: vi.fn(() => ({
            values: vi.fn(async () => {
              throw new Error('audit insert failed');
            }),
          })),
          update: vi.fn(() => ({
            set: vi.fn((value) => ({
              where: vi.fn(async () => {
                working.topicStatus = value.status;
              }),
            })),
          })),
        };

        const result = await callback(tx);
        committed.topicStatus = working.topicStatus;
        return result;
      }),
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminContentRouter.createCaller({ userId: 'admin-user' } as any).archiveTopic({
        topicId: 'topic-1',
      }),
    ).rejects.toThrow('audit insert failed');

    expect(committed.topicStatus).toBe('active');
  });

  it('rolls back an order cancellation when the real audit insert fails', async () => {
    const committed = { orderStatus: 'pending' };
    const db = {
      query: { users: { findFirst: vi.fn().mockResolvedValue(adminUser) } },
      transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
        const working = { ...committed };
        const tx = {
          insert: vi.fn(() => ({
            values: vi.fn(async () => {
              throw new Error('audit insert failed');
            }),
          })),
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: 'order-1',
                    provider: 'redemption',
                    redemptionCodeId: 'redemption-code-1',
                    source: 'redemption',
                    status: 'pending',
                    userId: 'user-1',
                  },
                ]),
              })),
            })),
          })),
          update: vi.fn(() => ({
            set: vi.fn((value) => ({
              where: vi.fn(() => ({
                returning: vi.fn(async () => {
                  working.orderStatus = value.status;
                  return [{ id: 'order-1', userId: 'user-1' }];
                }),
              })),
            })),
          })),
        };

        const result = await callback(tx);
        committed.orderStatus = working.orderStatus;
        return result;
      }),
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminOrdersRouter.createCaller({ userId: 'admin-user' } as any).cancel({
        command: { actionId: 'order.cancel', confirmed: true },
        orderId: 'order-1',
      }),
    ).rejects.toThrow('audit insert failed');

    expect(committed.orderStatus).toBe('pending');
  });

  it('rolls back a credit adjustment and ledger write when the real audit insert fails', async () => {
    const committed = { balance: 100, ledgerEntries: 0 };
    const db = {
      query: {
        users: { findFirst: vi.fn().mockResolvedValue({ ...adminUser, role: 'finance_admin' }) },
      },
      transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
        const working = { ...committed };
        const tx = {
          insert: vi.fn(() => ({
            values: vi.fn((value: Record<string, unknown>) => {
              if ('action' in value) throw new Error('audit insert failed');
              if ('balance' in value) {
                return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
              }
              working.ledgerEntries += 1;
              return Promise.resolve(undefined);
            }),
          })),
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(async () => [
                { balance: working.balance, totalCredited: 100, totalDebited: 0 },
              ]),
            })),
          })),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(async () => {
                working.balance += 25;
              }),
            })),
          })),
        };

        const result = await callback(tx);
        committed.balance = working.balance;
        committed.ledgerEntries = working.ledgerEntries;
        return result;
      }),
    } as any;
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminCreditsRouter.createCaller({ userId: 'finance-admin' } as any).adjust({
        amount: 25,
        command: {
          actionId: 'credits.adjust',
          confirmationText: 'credits.adjust',
          confirmed: true,
          reason: 'manual correction',
        },
        reason: 'manual correction',
        userId: 'user-1',
      }),
    ).rejects.toThrow('audit insert failed');

    expect(committed).toEqual({ balance: 100, ledgerEntries: 0 });
  });
});
