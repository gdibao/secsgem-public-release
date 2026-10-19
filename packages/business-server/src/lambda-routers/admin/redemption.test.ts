import { ADMIN_COMMANDS } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { CommercialModel } from '@/database/models/commercial';

import { recordAdminAudit } from './audit';
import { adminRedemptionRouter, redemptionRouter } from './redemption';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/commercial', () => ({
  CommercialModel: vi.fn(),
}));

vi.mock('./audit', () => ({
  recordAdminAudit: vi.fn(),
  runRequiredAdminAuditMutation: vi.fn(async (ctx, options) => {
    const result = await ctx.serverDB.transaction((tx: unknown) => options.mutation(tx));
    await recordAdminAudit(ctx, await options.audit(result));
    return result;
  }),
}));

describe('adminRedemptionRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('records the admin supplied reason when bulk deleting redemption codes', async () => {
    const db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'code-1' }]),
        })),
      })),
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
        },
      },
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
    };
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminRedemptionRouter.createCaller({ userId: 'admin-user' } as any);
    await caller.bulkDelete({
      command: {
        actionId: 'redemption.bulkDelete',
        confirmationText: 'redemption.bulkDelete',
        confirmed: true,
        reason: 'compromised promotional batch',
      },
      ids: ['code-1', 'code-2'],
      reason: 'compromised promotional batch',
    } as any);

    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: ADMIN_COMMANDS['redemption.bulkDelete'].auditAction,
        payload: {
          deleted: 1,
          reason: 'compromised promotional batch',
          requested: 2,
        },
        resourceType: 'redemption_code',
      }),
    );
  });

  it('rejects conflicting legacy and envelope reasons before bulk deletion', async () => {
    const db = {
      delete: vi.fn(),
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
        },
      },
    };
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminRedemptionRouter.createCaller({ userId: 'admin-user' } as any);
    await expect(
      caller.bulkDelete({
        command: {
          actionId: 'redemption.bulkDelete',
          confirmationText: 'redemption.bulkDelete',
          confirmed: true,
          reason: 'batch evidence A',
        },
        ids: ['code-1'],
        reason: 'batch evidence B',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ADMIN_COMMAND_REASON_MISMATCH',
    });
    expect(db.delete).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('creates and settles redeemed top-up orders inside the redemption transaction', async () => {
    const createTopUpOrder = vi.fn().mockResolvedValue({ id: 'order-1' });
    const settleTopUpOrder = vi.fn().mockResolvedValue({ status: 'paid' });
    vi.mocked(CommercialModel).mockImplementation(function CommercialModel() {
      return {
        createTopUpOrder,
        settleTopUpOrder,
      } as any;
    });

    const tx = {
      query: {
        redemptionCodes: {
          findFirst: vi.fn().mockResolvedValue({
            expiresAt: null,
            id: 'redemption-1',
            rewardType: 'topup_package',
            status: 'active',
            topupPackageId: 'package-1',
          }),
        },
        topUpPackages: {
          findFirst: vi.fn().mockResolvedValue({
            credits: 1000,
            id: 'package-1',
            isActive: true,
          }),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 'redemption-1' }]),
          })),
        })),
      })),
    };
    const serverDB = {
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    vi.mocked(getServerDB).mockResolvedValue(serverDB as any);

    const caller = redemptionRouter.createCaller({ userId: 'user-1' } as any);
    await caller.redeem({ code: 'promo-code' });

    expect(CommercialModel).toHaveBeenCalledWith(tx, 'user-1');
    expect(createTopUpOrder).toHaveBeenCalledWith({
      credits: 1000,
      redemptionCodeId: 'redemption-1',
      source: 'redemption',
    });
    expect(settleTopUpOrder).toHaveBeenCalledWith('order-1');
  });
});
