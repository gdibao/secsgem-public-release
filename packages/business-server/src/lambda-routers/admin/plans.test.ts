import { Plans } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import { getServerDB } from '@/database/core/db-adaptor';
import { getPlanDeleteImpact } from '@/database/models/commercial';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';
import { getAllEnabledModels } from '@/server/services/newapiInstance';

import { recordAdminAudit } from './audit';
import { adminPlansRouter } from './plans';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/commercial', () => ({
  getPlanDeleteImpact: vi.fn(),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultAgentConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('@/server/services/newapiInstance', () => ({
  getAllEnabledModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('./audit', () => ({
  recordAdminAudit: vi.fn(),
  runRequiredAdminAuditMutation: vi.fn(async (ctx, options) => {
    const result = ctx.serverDB.transaction
      ? await ctx.serverDB.transaction((tx: unknown) => options.mutation(tx))
      : await options.mutation(ctx.serverDB);
    await recordAdminAudit(ctx, await options.audit(result));
    return result;
  }),
}));

const createDb = ({
  activePlanSnapshot = undefined,
  appSettingsRows = [],
  planCatalogRow = { plan: Plans.Premium },
  planRedemptionCode = undefined,
  role = 'admin',
}: {
  activePlanSnapshot?: { id: string };
  appSettingsRows?: Array<{ key: string; value: unknown }>;
  planCatalogRow?: Record<string, unknown> | null;
  planRedemptionCode?: { id: string };
  role?: string | null;
} = {}) => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn((payload: unknown) =>
    Array.isArray(payload) ? { onConflictDoUpdate } : Promise.resolve(undefined),
  );
  const insert = vi.fn(() => ({ values }));
  const returning = vi.fn().mockResolvedValue([{ plan: Plans.Premium }]);
  const where = vi.fn(() => ({ returning }));
  const deleteFrom = vi.fn(() => ({ where }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db));

  const db = {
    __mocks: {
      onConflictDoUpdate,
      returning,
      set,
      update,
      values,
    },
    delete: deleteFrom,
    insert,
    query: {
      appSettings: {
        findMany: vi.fn().mockResolvedValue(appSettingsRows),
      },
      planCatalog: {
        findFirst: vi.fn().mockResolvedValue(planCatalogRow),
      },
      redemptionCodes: {
        findFirst: vi.fn().mockResolvedValue(planRedemptionCode),
      },
      userPlanSnapshots: {
        findFirst: vi.fn().mockResolvedValue(activePlanSnapshot),
        findMany: vi
          .fn()
          .mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-1' }]),
      },
      users: {
        findFirst: vi.fn().mockResolvedValue({ banned: false, role }),
      },
    },
    transaction,
    update,
  } as any;
  return db;
};

const planDeleteImpact = (
  blocking: Array<{ code: string; count: number; title: string }> = [],
) => ({
  blocking,
  canProceed: blocking.length === 0,
  immediateEffects: [{ code: 'PLAN_CATALOG_DELETE', count: 1, title: 'delete' }],
  liveEffects: [{ code: 'PLAN_NEW_ASSIGNMENTS_STOP', count: 1, title: 'stop' }],
  target: { id: Plans.Premium, label: 'Premium', type: 'plan' as const },
  targetExists: true,
});

describe('adminPlansRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getPlanDeleteImpact).mockResolvedValue(planDeleteImpact());
    vi.mocked(getServerDefaultAgentConfig).mockReturnValue({});
    vi.mocked(getAllEnabledModels).mockResolvedValue([]);
  });

  it('blocks deleting a plan with active user snapshots', async () => {
    vi.mocked(getPlanDeleteImpact).mockResolvedValue(
      planDeleteImpact([{ code: 'PLAN_ACTIVE_SNAPSHOTS', count: 1, title: 'active' }]),
    );
    const db = createDb({ activePlanSnapshot: { id: 'snapshot-1' } });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).delete({
        plan: Plans.Premium,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(db.delete).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('deletes a plan without active user snapshots', async () => {
    const db = createDb({ activePlanSnapshot: undefined });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).delete({
        plan: Plans.Premium,
      }),
    ).resolves.toEqual({ ok: true });

    expect(db.delete).toHaveBeenCalled();
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'plan.delete',
        payload: expect.objectContaining({
          after: null,
          before: expect.objectContaining({ plan: Plans.Premium }),
        }),
        resourceId: Plans.Premium,
      }),
    );
  });

  it('blocks deleting a plan referenced by redemption codes', async () => {
    vi.mocked(getPlanDeleteImpact).mockResolvedValue(
      planDeleteImpact([{ code: 'PLAN_REDEMPTION_CODES', count: 1, title: 'codes' }]),
    );
    const db = createDb({ planRedemptionCode: { id: 'code-1' } });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).delete({
        plan: Plans.Premium,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(db.delete).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('blocks deleting a plan referenced by pending subscription changes', async () => {
    vi.mocked(getPlanDeleteImpact).mockResolvedValue(
      planDeleteImpact([
        { code: 'PLAN_PENDING_CHANGE_REQUESTS', count: 2, title: 'pending changes' },
      ]),
    );
    const db = createDb();
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).delete({
        plan: Plans.Premium,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'PLAN_DELETE_BLOCKED' });

    expect(db.delete).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('syncs resource quotas to active users when a plan is saved', async () => {
    const existingPlan = {
      currency: 'CNY',
      displayName: 'Old Premium',
      features: ['old feature'],
      isActive: true,
      metadata: { storageQuotaMb: 256, vectorQuota: 600 },
      modelRules: null,
      monthlyCredits: 1000,
      monthlyPrice: 100,
      plan: Plans.Premium,
      sortOrder: 2,
      yearlyPrice: 1000,
    };
    const db = createDb({ planCatalogRow: existingPlan });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await adminPlansRouter.createCaller({ userId: 'admin-user' } as any).upsert({
      currency: 'CNY',
      displayName: 'Premium',
      features: [],
      isActive: true,
      lifetimePrice: 9800,
      monthlyCredits: 5000,
      monthlyPrice: 500,
      oneTimePrice: 4680,
      plan: Plans.Premium,
      badge: 'Popular',
      sortOrder: 3,
      storageQuotaMb: 512,
      vectorQuota: 1200,
      yearlyDiscountLabel: '优惠 20%',
      comparisonNote: '包含高阶模型',
      yearlyPrice: 5000,
    } as any);

    expect(db.__mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          badge: 'Popular',
          comparisonNote: '包含高阶模型',
          storageQuotaMb: 512,
          vectorQuota: 1200,
          yearlyDiscountLabel: '优惠 20%',
        }),
      }),
    );

    const quotaPayload = db.__mocks.values.mock.calls.find(([payload]: [unknown]) =>
      Array.isArray(payload),
    )?.[0] as Array<Record<string, unknown>>;

    expect(quotaPayload).toEqual([
      expect.objectContaining({
        storageQuota: 512 * 1024 * 1024,
        userId: 'user-1',
        vectorQuota: 1200,
      }),
      expect.objectContaining({
        storageQuota: 512 * 1024 * 1024,
        userId: 'user-2',
        vectorQuota: 1200,
      }),
    ]);
    expect(db.__mocks.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          storageQuota: 512 * 1024 * 1024,
          vectorQuota: 1200,
        }),
      }),
    );
    expect(db.__mocks.update).toHaveBeenCalledTimes(2);
    expect(db.__mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          lifetimePrice: 9800,
          oneTimePrice: 4680,
          storageQuotaMb: 512,
          vectorQuota: 1200,
        }),
      }),
    );
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'plan.update',
        payload: expect.objectContaining({
          activeUserCount: 2,
          after: expect.objectContaining({
            displayName: 'Premium',
            metadata: expect.objectContaining({
              badge: 'Popular',
              comparisonNote: expect.any(String),
              storageQuotaMb: 512,
              vectorQuota: 1200,
              yearlyDiscountLabel: expect.any(String),
            }),
            monthlyCredits: 5000,
            plan: Plans.Premium,
          }),
          before: expect.objectContaining({
            displayName: 'Old Premium',
            metadata: { storageQuotaMb: 256, vectorQuota: 600 },
            plan: Plans.Premium,
          }),
          quotaUpdate: expect.objectContaining({
            storageQuota: 512 * 1024 * 1024,
            vectorQuota: 1200,
          }),
        }),
        resourceId: Plans.Premium,
      }),
    );
  });

  it('allows a scoped finance admin to save plans', async () => {
    const db = createDb({ role: 'finance_admin' });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'finance-user' } as any).upsert({
        currency: 'CNY',
        displayName: 'Premium',
        features: [],
        isActive: true,
        monthlyCredits: 5000,
        monthlyPrice: 500,
        plan: Plans.Premium,
        sortOrder: 3,
        yearlyPrice: 5000,
      } as any),
    ).resolves.toEqual({ ok: true });
  });

  it('records before and after snapshots when toggling plan active state', async () => {
    const db = createDb({
      planCatalogRow: {
        displayName: 'Premium',
        isActive: true,
        plan: Plans.Premium,
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).setActive({
        isActive: false,
        plan: Plans.Premium,
      }),
    ).resolves.toEqual({ ok: true });

    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'plan.setActive',
        payload: expect.objectContaining({
          after: expect.objectContaining({ isActive: false, plan: Plans.Premium }),
          before: expect.objectContaining({ isActive: true, plan: Plans.Premium }),
          isActive: false,
        }),
        resourceId: Plans.Premium,
      }),
    );
  });

  it('records before and after snapshots when updating plan model rules', async () => {
    const previousModelRules = {
      chat: { blocklist: ['old-*'], mode: 'blocklist' },
    };
    const nextModelRules = {
      chat: { allowlist: ['gpt-*'], mode: 'allowlist' },
    };
    const db = createDb({
      planCatalogRow: {
        displayName: 'Premium',
        modelRules: previousModelRules,
        plan: Plans.Premium,
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).setModelRules({
        modelRules: nextModelRules as any,
        plan: Plans.Premium,
      }),
    ).resolves.toEqual({ ok: true });

    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'plan.setModelRules',
        payload: expect.objectContaining({
          after: expect.objectContaining({ modelRules: nextModelRules, plan: Plans.Premium }),
          before: expect.objectContaining({
            modelRules: previousModelRules,
            plan: Plans.Premium,
          }),
          modelRules: nextModelRules,
        }),
        resourceId: Plans.Premium,
      }),
    );
  });

  it('saves a batch of plan model rules in one audited transaction', async () => {
    const db = createDb();
    db.query.planCatalog.findFirst
      .mockResolvedValueOnce({ displayName: 'Premium', modelRules: null, plan: Plans.Premium })
      .mockResolvedValueOnce({ displayName: 'Ultimate', modelRules: null, plan: Plans.Ultimate });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).setModelRulesBatch({
        updates: [
          {
            modelRules: { chat: { allowlist: ['premium-*'], mode: 'allowlist' } },
            plan: Plans.Premium,
          },
          {
            modelRules: { chat: { allowlist: ['business-*'], mode: 'allowlist' } },
            plan: Plans.Ultimate,
          },
        ],
      }),
    ).resolves.toEqual({ count: 2, ok: true });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(recordAdminAudit).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate plans before starting a batch transaction', async () => {
    const db = createDb();
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).setModelRulesBatch({
        updates: [
          { modelRules: undefined, plan: Plans.Premium },
          { modelRules: undefined, plan: Plans.Premium },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('does not audit a partially failed plan model rules batch', async () => {
    const db = createDb();
    db.query.planCatalog.findFirst
      .mockResolvedValueOnce({ displayName: 'Premium', modelRules: null, plan: Plans.Premium })
      .mockResolvedValueOnce(null);
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).setModelRulesBatch({
        updates: [
          { modelRules: undefined, plan: Plans.Premium },
          { modelRules: undefined, plan: Plans.Ultimate },
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('prevents finance admins from blocking the active default model on the free plan', async () => {
    const db = createDb({
      appSettingsRows: [
        { key: APP_SETTING_KEYS.defaultAgentModel, value: 'deepseek-chat' },
        { key: APP_SETTING_KEYS.defaultAgentProvider, value: 'newapi' },
      ],
      planCatalogRow: {
        displayName: 'Free',
        modelRules: null,
        plan: Plans.Free,
      },
      role: 'finance_admin',
    });
    vi.mocked(getAllEnabledModels).mockResolvedValue([
      {
        groupKey: 'default',
        id: 'deepseek-chat',
        instanceId: 'instance-1',
        providerId: null,
        providerType: 'newapi',
        type: 'chat',
      } as any,
    ]);
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'finance-user' } as any).setModelRules({
        modelRules: { chat: { allowlist: ['other-model'], mode: 'allowlist' } },
        plan: Plans.Free,
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'DEFAULT_MODEL_DENIED_BY_FREE_PLAN',
    });

    expect(db.update).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('preserves a configured default model that is temporarily absent from the enabled catalog', async () => {
    const db = createDb({
      appSettingsRows: [
        { key: APP_SETTING_KEYS.defaultAgentModel, value: 'gpt-5.4' },
        { key: APP_SETTING_KEYS.defaultAgentProvider, value: 'newapi' },
      ],
      planCatalogRow: {
        displayName: 'Free',
        modelRules: null,
        plan: Plans.Free,
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);
    vi.mocked(getAllEnabledModels).mockResolvedValue([]);

    await expect(
      adminPlansRouter.createCaller({ userId: 'admin-user' } as any).setModelRulesBatch({
        updates: [
          {
            modelRules: { chat: { allowlist: ['currently-enabled'], mode: 'allowlist' } },
            plan: Plans.Free,
          },
        ],
      }),
    ).resolves.toEqual({ count: 1, ok: true });

    expect(db.__mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRules: {
          chat: { allowlist: ['currently-enabled', 'gpt-5.4'], mode: 'allowlist' },
        },
      }),
    );
  });

  it('enforces the free-plan default model invariant through plan upserts', async () => {
    const db = createDb({
      appSettingsRows: [
        { key: APP_SETTING_KEYS.defaultAgentModel, value: 'deepseek-chat' },
        { key: APP_SETTING_KEYS.defaultAgentProvider, value: 'newapi' },
      ],
      planCatalogRow: {
        displayName: 'Free',
        modelRules: null,
        plan: Plans.Free,
      },
      role: 'finance_admin',
    });
    vi.mocked(getAllEnabledModels).mockResolvedValue([
      {
        groupKey: 'default',
        id: 'deepseek-chat',
        instanceId: 'instance-1',
        providerId: null,
        providerType: 'newapi',
        type: 'chat',
      } as any,
    ]);
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'finance-user' } as any).upsert({
        currency: 'CNY',
        displayName: 'Free',
        features: [],
        isActive: true,
        modelRules: { chat: { allowlist: ['other-model'], mode: 'allowlist' } },
        monthlyCredits: 0,
        monthlyPrice: 0,
        plan: Plans.Free,
        sortOrder: 0,
        yearlyPrice: 0,
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'DEFAULT_MODEL_DENIED_BY_FREE_PLAN',
    });

    expect(db.update).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('rejects model ops admins from saving plans', async () => {
    const db = createDb({ role: 'model_ops' });
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminPlansRouter.createCaller({ userId: 'model-ops-user' } as any).upsert({
        currency: 'CNY',
        displayName: 'Premium',
        features: [],
        isActive: true,
        monthlyCredits: 5000,
        monthlyPrice: 500,
        plan: Plans.Premium,
        sortOrder: 3,
        yearlyPrice: 5000,
      } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
