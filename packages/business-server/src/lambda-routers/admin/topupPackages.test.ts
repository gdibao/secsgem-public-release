import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { recordAdminAudit } from './audit';
import { adminTopUpPackagesRouter } from './topupPackages';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('./audit', () => ({
  recordAdminAudit: vi.fn(),
  runRequiredAdminAuditMutation: vi.fn(async (ctx, options) => {
    const result = await options.mutation(ctx.serverDB);
    await recordAdminAudit(ctx, await options.audit(result));
    return result;
  }),
}));

const createDb = ({
  referencingRedemptionCode = undefined,
}: { referencingRedemptionCode?: { id: string } } = {}) => {
  const where = vi.fn().mockResolvedValue(undefined);
  const deleteFrom = vi.fn(() => ({ where }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));

  return {
    __mocks: { set, values },
    delete: deleteFrom,
    insert,
    query: {
      redemptionCodes: {
        findFirst: vi.fn().mockResolvedValue(referencingRedemptionCode),
      },
      topUpPackages: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'growth',
          metadata: { keep: 'yes' },
        }),
      },
      users: {
        findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
      },
    },
    update,
  } as any;
};

describe('adminTopUpPackagesRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('blocks deleting a top-up package referenced by redemption codes', async () => {
    const db = createDb({ referencingRedemptionCode: { id: 'code-1' } });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminTopUpPackagesRouter.createCaller({ userId: 'admin-user' } as any).delete({
        id: 'growth',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(db.delete).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('deletes a top-up package without redemption code references', async () => {
    const db = createDb({ referencingRedemptionCode: undefined });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminTopUpPackagesRouter.createCaller({ userId: 'admin-user' } as any).delete({
        id: 'growth',
      }),
    ).resolves.toEqual({ ok: true });

    expect(db.delete).toHaveBeenCalled();
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'topupPackage.delete', resourceId: 'growth' }),
    );
  });

  it('saves promotion metadata when a top-up package is saved', async () => {
    const db = createDb();
    vi.mocked(getServerDB).mockResolvedValue(db);

    await adminTopUpPackagesRouter.createCaller({ userId: 'admin-user' } as any).upsert({
      amount: 20,
      credits: 1_000_000,
      currency: 'USD',
      displayName: 'Growth',
      id: 'growth',
      isActive: true,
      originalAmount: 30,
      promotionEnabled: true,
      promotionLabel: 'Limited offer',
      promotionNote: 'Valid for 6 months',
      recommended: true,
      sortOrder: 1,
      validityMonths: 6,
    } as any);

    expect(db.__mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          keep: 'yes',
          originalAmount: 30,
          promotionEnabled: true,
          promotionLabel: 'Limited offer',
          promotionNote: 'Valid for 6 months',
        }),
      }),
    );
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'topupPackage.update', resourceId: 'growth' }),
    );
  });
});
