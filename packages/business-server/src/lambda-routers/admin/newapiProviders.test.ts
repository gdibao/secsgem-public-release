import { ADMIN_COMMANDS } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { getModelDependencyImpact } from '../../adminImpact/modelDependencyImpact';
import { recordAdminAudit } from './audit';
import { adminNewapiProvidersRouter } from './newapiProviders';

const mocks = vi.hoisted(() => ({
  getLobeHubOfficialModelPricing: vi.fn(),
}));

vi.mock('@/server/services/newapiInstance/lobeHubOfficialPricing', () => ({
  getLobeHubOfficialModelPricing: mocks.getLobeHubOfficialModelPricing,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('../../adminImpact/modelDependencyImpact', () => ({
  getModelDependencyImpact: vi.fn(),
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

vi.mock('model-bank', async (importOriginal) => ({
  ...(await importOriginal()),
  LOBE_DEFAULT_MODEL_LIST: [
    {
      id: 'deepseek-v4-pro',
      pricing: {
        units: [{ name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' }],
      },
      providerId: 'deepseek',
    },
    {
      id: 'deepseek-v4-pro',
      pricing: {
        units: [{ name: 'textInput', rate: 99, strategy: 'fixed', unit: 'millionTokens' }],
      },
      providerId: 'other-provider',
    },
  ],
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({
      decrypt: vi.fn(async (value: string) => ({
        plaintext: value === 'bad-cipher' ? '' : value.replace(/^enc:/, ''),
        wasAuthentic: value !== 'bad-cipher',
      })),
      encrypt: vi.fn(async (value: string) => `enc:${value}`),
    }),
  },
}));

const instanceId = '00000000-0000-4000-8000-000000000001';

const dependencyImpact = (
  blocking: Array<{ code: string; count: number; title: string }> = [],
) => ({
  blocking,
  canProceed: blocking.length === 0,
  immediateEffects: [],
  liveEffects: [],
  target: { id: instanceId, type: 'provider-instance' as const },
  targetExists: true,
});

const createDbMock = ({
  allEnabledModelRows = [],
  existingRows = [],
  findFirstRow,
  findManyRows,
  providerType = 'newapi',
  role = 'admin',
}: {
  allEnabledModelRows?: Array<Record<string, any>>;
  existingRows?: Array<Record<string, any>>;
  findFirstRow?: Record<string, any>;
  findManyRows?: Array<Record<string, any>>;
  providerType?: string;
  role?: string | null;
} = {}) => {
  const writes = {
    conflictConfig: undefined as any,
    deletedRows: [] as any[],
    insertRows: [] as any[],
    insertValue: undefined as any,
    mutationOrder: [] as string[],
    updateValue: undefined as any,
  };
  const updateWhere = vi.fn(() => ({
    returning: vi.fn().mockResolvedValue([{ id: instanceId }]),
  }));
  const updateSet = vi.fn((value: Record<string, any>) => {
    writes.updateValue = value;

    return {
      where: updateWhere,
    };
  });

  const db: any = {
    insert: vi.fn(() => ({
      values: vi.fn((rows: any[] | Record<string, any>) => {
        writes.mutationOrder.push('insert');
        writes.insertValue = rows;
        writes.insertRows = Array.isArray(rows) ? rows : [rows];

        return {
          onConflictDoUpdate: vi.fn((config) => {
            writes.conflictConfig = config;
            return Promise.resolve(undefined);
          }),
          returning: vi.fn().mockResolvedValue([{ id: instanceId }]),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockImplementation(async () => {
          writes.mutationOrder.push('delete');
          writes.deletedRows = existingRows;
          return existingRows;
        }),
      })),
    })),
    query: {
      adminNewapiInstances: {
        findFirst: vi.fn().mockResolvedValue(
          findFirstRow ?? {
            apiKey: 'kv:enc:sk-test',
            baseUrl: 'https://newapi.example.com',
            groupKey: 'default',
            groupName: 'Default',
            groupMultiplier: null,
            id: instanceId,
            name: 'Default',
            providerType,
            usageScope: null,
          },
        ),
        findMany: vi.fn().mockResolvedValue(
          findManyRows ?? [
            {
              apiKey: 'sk-test-key',
              baseUrl: 'https://newapi.example.com',
              groupKey: 'pro',
              groupName: 'Pro Group',
              groupMultiplier: 1.25,
              id: instanceId,
              name: 'NewAPI Pro',
              providerType: 'deepseek',
              usageScope: ['chat', 'image'],
            },
          ],
        ),
      },
      users: {
        findFirst: vi.fn().mockResolvedValue({ banned: false, role }),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn().mockResolvedValue(allEnabledModelRows),
          })),
        })),
        where: vi.fn().mockResolvedValue(existingRows),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSet,
    })),
  };
  db.transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db));

  return { db, updateSet, updateWhere, writes };
};

describe('adminNewapiProvidersRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLobeHubOfficialModelPricing.mockResolvedValue(undefined);
    vi.mocked(getModelDependencyImpact).mockResolvedValue(dependencyImpact());
  });

  it('creates and lists instances with group routing fields while masking api key', async () => {
    const { db, writes } = createDbMock();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);

    await caller.createInstance({
      apiKey: 'sk-test-key',
      baseUrl: 'https://newapi.example.com',
      groupKey: 'pro',
      groupName: 'Pro Group',
      groupMultiplier: 1.25,
      name: 'NewAPI Pro',
      priority: 10,
      providerType: 'deepseek',
      usageScope: ['chat', 'image'],
    } as any);

    expect(writes.insertValue).toEqual(
      expect.objectContaining({
        apiKey: 'kv:enc:sk-test-key',
        groupKey: 'pro',
        groupName: 'Pro Group',
        groupMultiplier: 1.25,
        providerType: 'deepseek',
        usageScope: ['chat', 'image'],
      }),
    );

    const result = await caller.listInstances();

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        apiKey: 'sk-t****-key',
        groupKey: 'pro',
        groupName: 'Pro Group',
        groupMultiplier: 1.25,
        providerType: 'deepseek',
        usageScope: ['chat', 'image'],
      }),
    );
  });

  it('defaults legacy create payloads to the newapi provider type', async () => {
    const { db, writes } = createDbMock();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);

    await caller.createInstance({
      apiKey: 'sk-test-key',
      baseUrl: 'https://newapi.example.com',
      name: 'Legacy NewAPI',
    } as any);

    expect(writes.insertValue).toEqual(
      expect.objectContaining({
        providerType: 'newapi',
      }),
    );
  });

  it('stores instance pricing policy without exposing it as a database column', async () => {
    const { db, writes } = createDbMock({
      findFirstRow: {
        apiKey: 'kv:enc:sk-test',
        baseUrl: 'https://newapi.example.com',
        id: instanceId,
        metadata: { retained: true },
        name: 'Default',
        providerType: 'newapi',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);

    await caller.updateInstance({
      data: {
        pricingPolicy: {
          modelBankFallbackEnabled: true,
          upstreamSyncEnabled: false,
        },
      },
      id: instanceId,
    });

    expect(writes.updateValue).toEqual(
      expect.objectContaining({
        metadata: {
          pricingPolicy: {
            modelBankFallbackEnabled: true,
            upstreamSyncEnabled: false,
          },
          retained: true,
        },
      }),
    );
    expect(writes.updateValue).not.toHaveProperty('pricingPolicy');
  });

  it('allows model ops admins to refresh the AI provider runtime cache', async () => {
    const { db } = createDbMock({ role: 'model_ops' });
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    await expect(
      adminNewapiProvidersRouter
        .createCaller({ userId: 'model-ops-user' } as any)
        .refreshRuntimeCache(),
    ).resolves.toEqual(expect.objectContaining({ refreshedAt: expect.any(String) }));
  });

  it('rejects finance admins from mutating AI provider instances', async () => {
    const { db } = createDbMock({ role: 'finance_admin' });
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    await expect(
      adminNewapiProvidersRouter.createCaller({ userId: 'finance-user' } as any).createInstance({
        apiKey: 'sk-test-key',
        baseUrl: 'https://newapi.example.com',
        name: 'Denied Provider',
      } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('forces direct create and update payloads to server-side fetching', async () => {
    const { db, writes } = createDbMock();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);

    await caller.createInstance({
      apiKey: 'sk-test-key',
      baseUrl: 'https://newapi.example.com',
      fetchOnClient: true,
      name: 'Server-side only',
    } as any);

    expect(writes.insertValue).toEqual(expect.objectContaining({ fetchOnClient: false }));

    await caller.updateInstance({
      data: { fetchOnClient: true },
      id: instanceId,
    } as any);

    expect(writes.updateValue).toEqual(expect.objectContaining({ fetchOnClient: false }));
  });

  it('marks invalid encrypted api keys without breaking the instance list', async () => {
    const { db } = createDbMock({
      findManyRows: [
        {
          apiKey: 'kv:bad-cipher',
          baseUrl: 'https://bad.example.com',
          groupKey: 'default',
          id: 'bad-instance',
          name: 'Bad Instance',
          providerType: 'newapi',
        },
        {
          apiKey: 'kv:enc:sk-good-key',
          baseUrl: 'https://good.example.com',
          groupKey: 'default',
          id: 'good-instance',
          name: 'Good Instance',
          providerType: 'newapi',
        },
      ],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    const result = await caller.listInstances();

    expect(result.items).toEqual([
      expect.objectContaining({
        apiKey: null,
        apiKeyStatus: 'invalid',
        id: 'bad-instance',
      }),
      expect.objectContaining({
        apiKey: 'sk-g****-key',
        apiKeyStatus: 'ok',
        id: 'good-instance',
      }),
    ]);
  });

  it('backfills legacy plaintext api keys when instances are read', async () => {
    const { db, updateSet } = createDbMock({
      findManyRows: [
        {
          apiKey: 'sk-legacy-key',
          baseUrl: 'https://legacy.example.com',
          groupKey: 'default',
          id: instanceId,
          name: 'Legacy Instance',
          providerType: 'newapi',
        },
      ],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    await caller.listInstances();

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'kv:enc:sk-legacy-key' }),
    );
  });

  it('decrypts encrypted instance api keys before syncing models', async () => {
    const { db, writes } = createDbMock();
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [{ id: 'gpt-4o-mini', object: 'model' }] }),
        ok: true,
      })
      .mockResolvedValueOnce({
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [], success: true }),
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    await caller.syncInstanceModels({ id: instanceId });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://newapi.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
    expect(writes.insertRows[0]).toEqual(expect.objectContaining({ modelId: 'gpt-4o-mini' }));
  });

  it('fetches latest upstream prices during manual sync even when runtime use is disabled', async () => {
    const { db, writes } = createDbMock({
      findFirstRow: {
        apiKey: 'kv:enc:sk-test',
        baseUrl: 'https://newapi.example.com',
        id: instanceId,
        metadata: {
          pricingPolicy: {
            modelBankFallbackEnabled: true,
            upstreamSyncEnabled: false,
          },
        },
        name: 'Default',
        providerType: 'newapi',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [{ id: 'gpt-4o-mini', object: 'model' }] }),
        ok: true,
      })
      .mockResolvedValueOnce({
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: [{ model_name: 'gpt-4o-mini', model_ratio: 2 }],
          success: true,
        }),
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    const result = await caller.syncInstanceModels({ id: instanceId });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({ pricingCount: 1 }));
    expect(writes.insertRows[0].metadata).toEqual(
      expect.objectContaining({ modelRatio: 2, pricingAvailable: true }),
    );
  });

  it('returns a readable connection test failure for invalid encrypted api keys', async () => {
    const { db } = createDbMock({
      findFirstRow: {
        apiKey: 'kv:bad-cipher',
        baseUrl: 'https://bad.example.com',
        id: instanceId,
        name: 'Bad Instance',
        providerType: 'newapi',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(caller.testInstanceConnection({ id: instanceId })).resolves.toEqual(
      expect.objectContaining({
        error: 'Instance API key is invalid. Please reset it before retrying.',
        ok: false,
      }),
    );
  });

  it('syncs fetched models as disabled by default', async () => {
    const { db, writes } = createDbMock();
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({ data: [{ id: 'sora-2', object: 'model' }] }),
          ok: true,
        })
        .mockResolvedValueOnce({
          json: async () => ({ data: [], success: true }),
          ok: true,
        }),
    );

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    const result = await caller.syncInstanceModels({ id: instanceId });

    expect(result).toEqual(
      expect.objectContaining({
        importedCount: 1,
        modelsCount: 1,
        ok: true,
      }),
    );
    expect(writes.insertRows).toEqual([
      expect.objectContaining({
        enabled: false,
        instanceId,
        modelId: 'sora-2',
        modelType: 'video',
      }),
    ]);
  });

  it('atomically replaces existing models and discards prior manual state', async () => {
    const { db, writes } = createDbMock({
      existingRows: [
        {
          enabled: true,
          metadata: { manualAbilities: { vision: true }, manualPricing: { imageRate: 9 } },
          modelId: 'flux-pro',
          modelType: 'image',
        },
      ],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({ data: [{ id: 'flux-pro', object: 'model' }] }),
          ok: true,
        })
        .mockResolvedValueOnce({
          json: async () => ({ data: [], success: true }),
          ok: true,
        }),
    );

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    const result = await caller.syncInstanceModels({ id: instanceId });

    expect(result).toEqual(expect.objectContaining({ deletedCount: 1, importedCount: 1 }));
    expect(writes.mutationOrder).toEqual(['delete', 'insert']);
    expect(writes.insertRows[0]).toEqual(
      expect.objectContaining({
        enabled: false,
        modelId: 'flux-pro',
        modelType: 'image',
      }),
    );
    expect(writes.insertRows[0].metadata).not.toHaveProperty('manualAbilities');
    expect(writes.insertRows[0].metadata).not.toHaveProperty('manualPricing');
  });

  it('removes models missing from the latest non-empty upstream catalog', async () => {
    const { db, writes } = createDbMock({
      existingRows: [
        {
          displayName: 'Legacy Model',
          enabled: true,
          metadata: { manualAbilities: { vision: true }, syncSource: 'newapi' },
          modelId: 'legacy-model',
          modelType: 'chat',
          sortOrder: 3,
        } as any,
      ],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [{ id: 'new-model', object: 'model' }] }),
          ok: true,
        })
        .mockResolvedValueOnce({
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [], success: true }),
          ok: true,
        }),
    );

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    const result = await caller.syncInstanceModels({ id: instanceId });

    expect(result).toEqual(
      expect.objectContaining({ deletedCount: 1, importedCount: 1, staleCount: 0 }),
    );
    expect(writes.insertRows).toHaveLength(1);
    expect(writes.insertRows[0]).toEqual(expect.objectContaining({ modelId: 'new-model' }));
    expect(writes.insertRows[0].metadata).not.toHaveProperty('syncStatus', 'stale');
  });

  it('keeps existing models when the upstream model catalog is empty', async () => {
    const { db, writes } = createDbMock({
      existingRows: [{ enabled: true, modelId: 'existing-model', modelType: 'chat' }],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
          ok: true,
        })
        .mockResolvedValueOnce({
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [], success: true }),
          ok: true,
        }),
    );

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(caller.syncInstanceModels({ id: instanceId })).rejects.toThrow(
      'Upstream model catalog is empty; existing models were preserved',
    );
    expect(writes.mutationOrder).toEqual([]);
  });

  it('keeps existing models when supported upstream pricing is unavailable', async () => {
    const { db, writes } = createDbMock({
      existingRows: [{ enabled: true, modelId: 'existing-model', modelType: 'chat' }],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [{ id: 'new-model', object: 'model' }] }),
          ok: true,
        })
        .mockResolvedValueOnce({
          headers: new Headers({ 'content-type': 'application/json' }),
          ok: false,
          status: 503,
        }),
    );

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(caller.syncInstanceModels({ id: instanceId })).rejects.toThrow(
      'Upstream pricing is unavailable; existing models were preserved',
    );
    expect(writes.mutationOrder).toEqual([]);
  });

  it('returns pricing source metadata for enabled models', async () => {
    mocks.getLobeHubOfficialModelPricing.mockImplementation(async (modelId: string) =>
      modelId === 'official-chat'
        ? {
            units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
          }
        : undefined,
    );
    const { db } = createDbMock({
      allEnabledModelRows: [
        {
          baseUrl: 'https://newapi.example.com',
          displayName: 'Priced Chat',
          groupKey: 'default',
          groupName: 'Default',
          instanceId,
          instanceName: 'NewAPI Gateway',
          metadata: { modelRatio: 1, pricingAvailable: true },
          modelId: 'priced-chat',
          modelType: 'chat',
          priority: 0,
          providerType: 'newapi',
        },
        {
          baseUrl: 'https://newapi.example.com',
          displayName: 'Missing Chat',
          groupKey: 'default',
          groupName: 'Default',
          instanceId,
          instanceName: 'NewAPI Gateway',
          metadata: {},
          modelId: 'missing-chat',
          modelType: 'chat',
          priority: 1,
          providerType: 'newapi',
        },
        {
          baseUrl: 'https://newapi.example.com',
          displayName: 'Official Chat',
          groupKey: 'default',
          groupName: 'Default',
          instanceId,
          instanceMetadata: {
            pricingPolicy: {
              lobeHubOfficialPricingEnabled: true,
              modelBankFallbackEnabled: false,
              upstreamSyncEnabled: false,
            },
          },
          instanceName: 'LobeHub Pricing Gateway',
          metadata: {},
          modelId: 'official-chat',
          modelType: 'chat',
          priority: 1,
          providerType: 'newapi',
        },
        {
          baseUrl: 'https://deepseek.example.com',
          displayName: 'DeepSeek V4 Pro',
          groupKey: 'default',
          groupName: 'Default',
          instanceId,
          instanceName: 'DeepSeek',
          metadata: {},
          modelId: 'deepseek-v4-pro',
          modelType: 'chat',
          priority: 2,
          providerType: 'deepseek',
        },
        {
          baseUrl: 'https://compatible.example.com',
          displayName: 'Compatible DeepSeek',
          groupKey: 'default',
          groupName: 'Default',
          instanceId,
          instanceName: 'Compatible Gateway',
          metadata: {},
          modelId: 'deepseek-v4-pro',
          modelType: 'chat',
          priority: 3,
          providerType: 'openai-compatible',
        },
        {
          baseUrl: 'https://newapi.example.com',
          displayName: 'Fallback DeepSeek',
          groupKey: 'default',
          groupName: 'Default',
          instanceId,
          instanceMetadata: {
            pricingPolicy: {
              modelBankFallbackEnabled: true,
              upstreamSyncEnabled: false,
            },
          },
          instanceName: 'NewAPI Fallback',
          metadata: { modelRatio: 1, pricingAvailable: true },
          modelId: 'deepseek-v4-pro',
          modelType: 'chat',
          priority: 4,
          providerType: 'newapi',
        },
        {
          baseUrl: 'https://newapi.example.com',
          displayName: 'Dated Fallback DeepSeek',
          groupKey: 'default',
          groupName: 'Default',
          instanceId,
          instanceMetadata: {
            pricingPolicy: {
              modelBankFallbackEnabled: true,
              upstreamSyncEnabled: false,
            },
          },
          instanceName: 'NewAPI Dated Fallback',
          metadata: {},
          modelId: 'deepseek-v4-pro-0731',
          modelType: 'chat',
          priority: 5,
          providerType: 'newapi',
        },
      ],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    const result = await caller.getAllEnabledModels();

    expect(result.items[0]).not.toHaveProperty('baseUrl');
    expect(result.items).toEqual([
      expect.objectContaining({
        hasModelPricing: true,
        modelId: 'priced-chat',
        pricingSource: 'database',
      }),
      expect.objectContaining({
        hasModelPricing: false,
        modelId: 'missing-chat',
        pricingSource: 'missing',
      }),
      expect.objectContaining({
        hasModelPricing: false,
        modelId: 'official-chat',
        pricingSource: 'lobehub-official',
      }),
      expect.objectContaining({
        hasModelPricing: false,
        modelId: 'deepseek-v4-pro',
        pricingSource: 'model-bank',
        providerType: 'deepseek',
      }),
      expect.objectContaining({
        hasModelPricing: false,
        modelId: 'deepseek-v4-pro',
        pricingSource: 'missing',
        providerType: 'openai-compatible',
      }),
      expect.objectContaining({
        hasModelPricing: false,
        modelId: 'deepseek-v4-pro',
        pricingSource: 'model-bank',
        providerType: 'newapi',
      }),
      expect.objectContaining({
        hasModelPricing: false,
        modelId: 'deepseek-v4-pro-0731',
        pricingSource: 'model-bank',
        providerType: 'newapi',
      }),
    ]);
    expect(mocks.getLobeHubOfficialModelPricing).toHaveBeenCalledWith('official-chat');
  });

  it('treats synchronized chat abilities and non-chat modalities as complete metadata', async () => {
    const { db } = createDbMock({
      allEnabledModelRows: [
        {
          displayName: 'Reasoning Chat',
          groupKey: 'default',
          instanceId,
          instanceName: 'NewAPI Gateway',
          metadata: { syncedAbilities: { reasoning: true } },
          modelId: 'reasoning-chat',
          modelType: 'chat',
          priority: 0,
          providerType: 'newapi',
        },
        {
          displayName: 'Embedding Model',
          groupKey: 'default',
          instanceId,
          instanceName: 'NewAPI Gateway',
          metadata: {},
          modelId: 'embedding-model',
          modelType: 'embedding',
          priority: 1,
          providerType: 'newapi',
        },
        {
          displayName: 'Unknown Chat',
          groupKey: 'default',
          instanceId,
          instanceName: 'NewAPI Gateway',
          metadata: {},
          modelId: 'unknown-chat',
          modelType: 'chat',
          priority: 2,
          providerType: 'newapi',
        },
      ],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    const result = await caller.getAllEnabledModels();

    expect(
      result.items.map(({ hasModelAbilities, modelId }) => [modelId, hasModelAbilities]),
    ).toEqual([
      ['reasoning-chat', true],
      ['embedding-model', true],
      ['unknown-chat', false],
    ]);
  });

  it('warns about manual pricing when the service provider format has no pricing sync', async () => {
    const { db } = createDbMock({ providerType: 'siliconflow' });
    vi.mocked(getServerDB).mockResolvedValue(db as any);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [{ id: 'gpt-4o-mini', object: 'model' }] }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    const result = await caller.syncInstanceModels({ id: instanceId });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        pricingCount: 0,
        warnings: [
          'Pricing sync is not supported for provider type siliconflow. Configure manual pricing in the model billing matrix.',
        ],
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records the admin supplied reason when deleting an instance', async () => {
    const deleteWhere = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: instanceId }]),
    }));
    const db = {
      delete: vi.fn(() => ({ where: deleteWhere })),
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
        },
      },
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
    };
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    await caller.deleteInstance({
      command: {
        actionId: 'newapiProvider.deleteInstance',
        confirmationText: 'newapiProvider.deleteInstance',
        confirmed: true,
        reason: 'provider retired after outage',
      },
      id: instanceId,
      reason: 'provider retired after outage',
    } as any);

    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: ADMIN_COMMANDS['newapiProvider.deleteInstance'].auditAction,
        payload: { reason: 'provider retired after outage' },
        resourceId: instanceId,
      }),
    );
  });

  it('rejects conflicting legacy and envelope reasons before deleting an instance', async () => {
    const deleteWhere = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: instanceId }]),
    }));
    const db = {
      delete: vi.fn(() => ({ where: deleteWhere })),
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
        },
      },
    };
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any);
    await expect(
      caller.deleteInstance({
        command: {
          actionId: 'newapiProvider.deleteInstance',
          confirmationText: 'newapiProvider.deleteInstance',
          confirmed: true,
          reason: 'provider evidence A',
        },
        id: instanceId,
        reason: 'provider evidence B',
      } as any),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ADMIN_COMMAND_REASON_MISMATCH',
    });
    expect(db.delete).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('blocks provider deletion when the dependency preview contains references', async () => {
    vi.mocked(getModelDependencyImpact).mockResolvedValue(
      dependencyImpact([{ code: 'SYSTEM_DEFAULT_MODEL_REFERENCE', count: 1, title: 'default' }]),
    );
    const deleteWhere = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: instanceId }]),
    }));
    const db = {
      delete: vi.fn(() => ({ where: deleteWhere })),
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
        },
      },
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
    };
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    await expect(
      adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any).deleteInstance({
        command: {
          actionId: 'newapiProvider.deleteInstance',
          confirmationText: 'newapiProvider.deleteInstance',
          confirmed: true,
          reason: 'retired',
        },
        id: instanceId,
        reason: 'retired',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'PROVIDER_DELETE_BLOCKED' });

    expect(db.delete).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it('rolls back a model enablement batch when any model is missing', async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ modelId: 'existing-model' }])
      .mockResolvedValueOnce([]);
    const db: any = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
        },
      },
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning })),
        })),
      })),
    };
    vi.mocked(getServerDB).mockResolvedValue(db);

    await expect(
      adminNewapiProvidersRouter.createCaller({ userId: 'admin-user' } as any).setModelsEnabled({
        enabled: false,
        instanceId,
        models: [
          { modelId: 'existing-model', modelType: 'chat' },
          { modelId: 'missing-model', modelType: 'chat' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });
});
