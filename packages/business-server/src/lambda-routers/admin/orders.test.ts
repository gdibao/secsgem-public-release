import { ADMIN_COMMANDS } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { CommercialModel } from '@/database/models/commercial';

import { recordAdminAudit } from './audit';
import { adminOrdersRouter } from './orders';

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

describe('adminOrdersRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const setupSettleCaller = (
    role: string | null = 'admin',
    orderOverrides: Record<string, unknown> = {},
  ) => {
    const settleTopUpOrder = vi.fn().mockResolvedValue({ status: 'paid' });
    vi.mocked(CommercialModel).mockImplementation(
      () =>
        ({
          settleTopUpOrder,
        }) as any,
    );

    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role }),
        },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              {
                amount: 19.9,
                credits: 199_000_000,
                currency: 'CNY',
                provider: 'redemption',
                redemptionCodeId: 'redemption-code-1',
                source: 'redemption',
                userId: 'target-user',
                ...orderOverrides,
              },
            ]),
          })),
        })),
      })),
    };
    (db as any).transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    );
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminOrdersRouter.createCaller({ userId: `${role}-user` } as any);

    return { caller, settleTopUpOrder };
  };

  const setupStatusMutationCaller = () => {
    const update = vi.fn();
    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'finance_admin' }),
        },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: 'online-order',
                provider: 'alipay',
                redemptionCodeId: null,
                source: 'alipay',
                status: 'pending',
                userId: 'target-user',
              },
            ]),
          })),
        })),
      })),
      update,
    };
    (db as any).transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    );
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    return {
      caller: adminOrdersRouter.createCaller({ userId: 'finance-user' } as any),
      update,
    };
  };

  it('accepts and records an envelope-only reason when manually settling an order', async () => {
    const { caller, settleTopUpOrder } = setupSettleCaller();

    await caller.settle({
      command: {
        actionId: 'order.settle',
        confirmationText: 'order.settle',
        confirmed: true,
        reason: 'manual transfer confirmed by finance',
      },
      orderId: 'order-1',
    } as any);

    expect(settleTopUpOrder).toHaveBeenCalledWith('order-1');
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: ADMIN_COMMANDS['order.settle'].auditAction,
        payload: {
          amount: 19.9,
          credits: 199_000_000,
          currency: 'CNY',
          provider: 'redemption',
          reason: 'manual transfer confirmed by finance',
          source: 'redemption',
          status: 'paid',
        },
        resourceId: 'order-1',
        targetUserId: 'target-user',
      }),
    );
  });

  it('allows a scoped finance admin to manually settle an order', async () => {
    const { caller, settleTopUpOrder } = setupSettleCaller('finance_admin');

    await expect(
      caller.settle({
        command: {
          actionId: 'order.settle',
          confirmationText: 'order.settle',
          confirmed: true,
          reason: 'manual transfer confirmed by finance',
        },
        orderId: 'order-1',
        reason: 'manual transfer confirmed by finance',
      } as any),
    ).resolves.toMatchObject({ status: 'paid' });

    expect(settleTopUpOrder).toHaveBeenCalledWith('order-1');
  });

  it('rejects scoped admins without finance write when manually settling an order', async () => {
    const { caller, settleTopUpOrder } = setupSettleCaller('content_admin');

    await expect(
      caller.settle({
        command: {
          actionId: 'order.settle',
          confirmationText: 'order.settle',
          confirmed: true,
          reason: 'manual transfer confirmed by finance',
        },
        orderId: 'order-1',
        reason: 'manual transfer confirmed by finance',
      } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(settleTopUpOrder).not.toHaveBeenCalled();
  });

  it('accepts a normalized legacy reason when the envelope omits it', async () => {
    const { caller, settleTopUpOrder } = setupSettleCaller();

    await expect(
      caller.settle({
        command: {
          actionId: 'order.settle',
          confirmationText: 'order.settle',
          confirmed: true,
        },
        orderId: 'order-1',
        reason: '  legacy top-level reason  ',
      } as any),
    ).resolves.toMatchObject({ status: 'paid' });
    expect(settleTopUpOrder).toHaveBeenCalledWith('order-1');
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'legacy top-level reason' }),
      }),
    );
  });

  it('rejects conflicting legacy and envelope reasons before settling an order', async () => {
    const { caller, settleTopUpOrder } = setupSettleCaller();

    await expect(
      caller.settle({
        command: {
          actionId: 'order.settle',
          confirmationText: 'order.settle',
          confirmed: true,
          reason: 'finance evidence A',
        },
        orderId: 'order-1',
        reason: 'finance evidence B',
      } as any),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ADMIN_COMMAND_REASON_MISMATCH',
    });
    expect(settleTopUpOrder).not.toHaveBeenCalled();
  });

  it('rejects online orders and directs them to provider reconciliation', async () => {
    const { caller, settleTopUpOrder } = setupSettleCaller('finance_admin', {
      provider: 'alipay',
      redemptionCodeId: null,
      source: 'alipay',
    });

    await expect(
      caller.settle({
        command: {
          actionId: 'order.settle',
          confirmationText: 'order.settle',
          confirmed: true,
          reason: 'provider says paid',
        },
        orderId: 'order-1',
      } as any),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ONLINE_PAYMENT_ORDER_REQUIRES_RECONCILIATION',
    });
    expect(settleTopUpOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['cancel', 'order.cancel'],
    ['expire', 'order.expire'],
  ] as const)('rejects online orders before attempting to %s them', async (procedure, actionId) => {
    const { caller, update } = setupStatusMutationCaller();

    await expect(
      caller[procedure]({
        command: { actionId, confirmed: true },
        orderId: 'online-order',
      } as any),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ONLINE_PAYMENT_ORDER_REQUIRES_RECONCILIATION',
    });
    expect(update).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });
});
