// @vitest-environment node
import { Plans } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import { encryptAppSettingSecret } from '@/server/services/appSettings/secrets';

import { DocmeePptService } from './index';

const { allocateAndTrackCreditConsumption, assertNoOpenDebt, expireDueLots } = vi.hoisted(() => ({
  allocateAndTrackCreditConsumption: vi.fn(),
  assertNoOpenDebt: vi.fn(),
  expireDueLots: vi.fn(),
}));

vi.mock('@/database/models/commercial', () => ({
  CommercialModel: class {
    allocateAndTrackCreditConsumption = allocateAndTrackCreditConsumption;
  },
}));

vi.mock('@/database/models/commercial/creditLot', () => ({
  CreditLotModel: class {
    assertNoOpenDebt = assertNoOpenDebt;
    expireDueLots = expireDueLots;
  },
}));

const createDb = (overrides: any = {}) =>
  ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(),
        returning: vi.fn().mockResolvedValue([{ id: 'ledger-1' }]),
      })),
    })),
    query: {
      appSettings: { findMany: vi.fn().mockResolvedValue([]) },
      creditLedgerEntries: { findFirst: vi.fn() },
      planCatalog: { findFirst: vi.fn() },
      pptUsageRecords: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      userPlanSnapshots: { findFirst: vi.fn() },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        for: vi.fn().mockResolvedValue([{ balance: 100 }]),
        where: vi.fn(() => ({
          for: vi.fn().mockResolvedValue([{ balance: 100 }]),
        })),
      })),
    })),
    transaction: vi.fn(async (fn) => fn(createDb(overrides))),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
          returning: vi.fn().mockResolvedValue([{ balance: 88 }]),
        })),
      })),
    })),
    ...overrides,
  }) as any;

const enabledSettings = [
  { key: APP_SETTING_KEYS.docmeePptEnabled, value: true },
  { key: APP_SETTING_KEYS.docmeePptApiKey, value: 'sk-secret' },
];

const TEST_KEY_VAULTS_SECRET = Buffer.alloc(32, 19).toString('base64');

describe('DocmeePptService', () => {
  beforeEach(() => {
    process.env.KEY_VAULTS_SECRET = TEST_KEY_VAULTS_SECRET;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    allocateAndTrackCreditConsumption.mockResolvedValue({
      allocations: [{ amount: 12, source: 'subscription' }],
      creditLotAllocations: [{ amount: 12, lotId: 'lot-1', source: 'subscription' }],
    });
    assertNoOpenDebt.mockResolvedValue(undefined);
    expireDueLots.mockResolvedValue(0);
  });

  afterEach(() => {
    delete process.env.KEY_VAULTS_SECRET;
  });

  it('rejects token creation when PPT is disabled', async () => {
    const service = new DocmeePptService({ db: createDb(), userId: 'u1' });

    await expect(service.createToken()).rejects.toMatchObject({
      code: 'PPT_DISABLED',
    });
  });

  it('does not expose the configured API key in runtime', async () => {
    const db = createDb({
      query: {
        appSettings: {
          findMany: vi.fn().mockResolvedValue(enabledSettings),
        },
        planCatalog: { findFirst: vi.fn().mockResolvedValue({ metadata: { pptEnabled: true } }) },
        pptUsageRecords: { findMany: vi.fn().mockResolvedValue([]) },
        userPlanSnapshots: { findFirst: vi.fn().mockResolvedValue({ plan: Plans.Starter }) },
      },
    });
    const service = new DocmeePptService({ db, userId: 'u1' });

    const runtime = await service.getRuntime();

    expect(JSON.stringify(runtime)).not.toContain('sk-secret');
    expect(runtime).toMatchObject({ configured: true, enabled: true });
  });

  it('decrypts the API key before the Docmee upstream request', async () => {
    const encrypted = await encryptAppSettingSecret(
      APP_SETTING_KEYS.docmeePptApiKey,
      'encrypted-docmee-secret',
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ token: 'docmee-token' }), { status: 200 }));
    const db = createDb({
      query: {
        appSettings: {
          findMany: vi.fn().mockResolvedValue([
            { key: APP_SETTING_KEYS.docmeePptEnabled, value: true },
            { key: APP_SETTING_KEYS.docmeePptApiKey, value: encrypted },
          ]),
        },
        creditLedgerEntries: { findFirst: vi.fn() },
        planCatalog: { findFirst: vi.fn().mockResolvedValue({ metadata: { pptEnabled: true } }) },
        pptUsageRecords: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
        userPlanSnapshots: { findFirst: vi.fn().mockResolvedValue({ plan: Plans.Starter }) },
      },
    });
    const service = new DocmeePptService({ db, userId: 'u1' });

    await expect(service.createToken()).resolves.toMatchObject({ token: 'docmee-token' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Api-Key': 'encrypted-docmee-secret' }),
      }),
    );
  });

  it('resumes only a user-owned local PPT record without creating a second usage row', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ token: 'resume-token' }), { status: 200 }));
    const insert = vi.fn();
    const findFirst = vi.fn().mockResolvedValue({
      sessionId: 'saved-session',
      upstreamTaskId: 'upstream-ppt-1',
    });
    const db = createDb({
      insert,
      query: {
        appSettings: { findMany: vi.fn().mockResolvedValue(enabledSettings) },
        planCatalog: { findFirst: vi.fn().mockResolvedValue({ metadata: { pptEnabled: true } }) },
        pptUsageRecords: { findFirst, findMany: vi.fn().mockResolvedValue([]) },
        userPlanSnapshots: { findFirst: vi.fn().mockResolvedValue({ plan: Plans.Starter }) },
      },
    });
    const service = new DocmeePptService({ db, userId: 'u1' });

    await expect(
      service.createToken('00000000-0000-4000-8000-000000000001'),
    ).resolves.toMatchObject({
      sessionId: 'saved-session',
      token: 'resume-token',
      upstreamTaskId: 'upstream-ppt-1',
    });
    expect(findFirst).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects an unknown or foreign local PPT record before opening the upstream editor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const db = createDb({
      query: {
        appSettings: { findMany: vi.fn().mockResolvedValue(enabledSettings) },
        planCatalog: { findFirst: vi.fn().mockResolvedValue({ metadata: { pptEnabled: true } }) },
        pptUsageRecords: {
          findFirst: vi.fn().mockResolvedValue(undefined),
          findMany: vi.fn().mockResolvedValue([]),
        },
        userPlanSnapshots: { findFirst: vi.fn().mockResolvedValue({ plan: Plans.Starter }) },
      },
    });
    const service = new DocmeePptService({ db, userId: 'u1' });

    await expect(service.createToken('00000000-0000-4000-8000-000000000002')).rejects.toMatchObject(
      { code: 'PPT_EVENT_INVALID' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks PPT plan capability without writing during reads', async () => {
    const db = createDb({
      query: {
        appSettings: {
          findMany: vi.fn().mockResolvedValue(enabledSettings),
        },
        planCatalog: { findFirst: vi.fn().mockResolvedValue({ metadata: { pptEnabled: true } }) },
        pptUsageRecords: { findMany: vi.fn().mockResolvedValue([]) },
        userPlanSnapshots: { findFirst: vi.fn().mockResolvedValue({ plan: Plans.Starter }) },
      },
    });
    const service = new DocmeePptService({ db, userId: 'u1' });

    await service.getRuntime();

    expect(db.update).not.toHaveBeenCalled();
  });

  it('uses the purchased PPT entitlement after the plan catalog changes', async () => {
    const db = createDb({
      query: {
        appSettings: { findMany: vi.fn().mockResolvedValue(enabledSettings) },
        planCatalog: { findFirst: vi.fn().mockResolvedValue({ metadata: { pptEnabled: false } }) },
        pptUsageRecords: { findMany: vi.fn().mockResolvedValue([]) },
        userPlanSnapshots: {
          findFirst: vi.fn().mockResolvedValue({
            metadata: {
              entitlementSnapshot: {
                catalogUpdatedAt: new Date().toISOString(),
                features: [],
                modelRules: null,
                planMetadata: null,
                pptCreditCost: 12,
                pptEnabled: true,
                pptMonthlyQuota: 20,
                storageQuotaBytes: null,
                vectorQuota: null,
                version: 2,
              },
            },
            plan: Plans.Starter,
          }),
        },
      },
    });

    await expect(new DocmeePptService({ db, userId: 'u1' }).getRuntime()).resolves.toMatchObject({
      enabled: true,
      quota: { monthly: 20 },
    });
    expect(db.query.planCatalog.findFirst).not.toHaveBeenCalled();
  });

  it('rejects token creation before calling upstream when credits are insufficient', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const db = createDb({
      query: {
        appSettings: {
          findMany: vi.fn().mockResolvedValue(enabledSettings),
        },
        planCatalog: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ metadata: { pptCreditCost: 12, pptEnabled: true } }),
        },
        pptUsageRecords: { findMany: vi.fn().mockResolvedValue([]) },
        userPlanSnapshots: { findFirst: vi.fn().mockResolvedValue({ plan: Plans.Starter }) },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ balance: 5 }]),
        })),
      })),
    });
    const service = new DocmeePptService({ db, userId: 'u1' });

    await expect(service.createToken()).rejects.toMatchObject({
      code: 'PPT_QUOTA_EXHAUSTED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects token creation before calling upstream when the account has refund debt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    assertNoOpenDebt.mockRejectedValueOnce(new Error('COMMERCIAL_CREDIT_DEBT_OUTSTANDING'));
    const db = createDb({
      query: {
        appSettings: { findMany: vi.fn().mockResolvedValue(enabledSettings) },
        planCatalog: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ metadata: { pptCreditCost: 12, pptEnabled: true } }),
        },
        pptUsageRecords: { findMany: vi.fn().mockResolvedValue([]) },
        userPlanSnapshots: { findFirst: vi.fn().mockResolvedValue({ plan: Plans.Starter }) },
      },
    });

    await expect(new DocmeePptService({ db, userId: 'u1' }).createToken()).rejects.toThrow(
      'COMMERCIAL_CREDIT_DEBT_OUTSTANDING',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps generated status when a generated PPT is downloaded', async () => {
    const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const tx = createDb({
      query: {
        pptUsageRecords: {
          findFirst: vi.fn().mockResolvedValue({
            chargedLedgerEntryId: 'ledger-1',
            id: 'usage-1',
            status: 'generated',
          }),
        },
      },
      update: vi.fn(() => ({ set: updateSet })),
    });
    const db = createDb({ transaction: vi.fn(async (fn) => fn(tx)) });
    const service = new DocmeePptService({ db, userId: 'u1' });

    await service.reportEvent({ sessionId: 's1', type: 'beforeDownload' });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'generated' }));
  });

  it('charges a successful generation only once for the same session', async () => {
    const selectForUpdate = vi.fn().mockResolvedValue([
      {
        balance: 100,
        chargedLedgerEntryId: null,
        creditCost: 12,
        id: 'usage-1',
        metadata: {},
        plan: Plans.Starter,
        sessionId: 's1',
      },
    ]);
    const tx = createDb({
      query: {
        creditLedgerEntries: { findFirst: vi.fn().mockResolvedValue(null) },
        pptUsageRecords: { findFirst: vi.fn() },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          for: selectForUpdate,
          where: vi.fn(() => ({
            for: selectForUpdate,
          })),
        })),
      })),
    });
    const db = createDb({
      query: {
        appSettings: { findMany: vi.fn().mockResolvedValue(enabledSettings) },
        planCatalog: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ metadata: { pptCreditCost: 12, pptEnabled: true } }),
        },
        pptUsageRecords: { findMany: vi.fn().mockResolvedValue([]) },
        userPlanSnapshots: { findFirst: vi.fn().mockResolvedValue({ plan: Plans.Starter }) },
      },
      transaction: vi.fn(async (fn) => fn(tx)),
    });
    const service = new DocmeePptService({ db, userId: 'u1' });

    await expect(
      service.reportEvent({
        sessionId: 's1',
        type: 'afterGenerate',
        upstreamTaskId: 'task-1',
      }),
    ).resolves.toMatchObject({ charged: true });

    expect(tx.insert).toHaveBeenCalled();
    expect(tx.query.pptUsageRecords.findFirst).not.toHaveBeenCalled();
    expect(selectForUpdate).toHaveBeenCalled();
    expect(allocateAndTrackCreditConsumption).toHaveBeenCalledWith({
      accountBalance: 100,
      amount: 12,
      tx,
    });
  });
});
