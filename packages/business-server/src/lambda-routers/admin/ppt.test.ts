// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import { decryptAppSettingSecret, encryptAppSettingSecret } from '@/server/services/appSettings/secrets';

import * as appSettingsCatalog from '../../appSettings/catalog';
import { recordAdminAudit } from './audit';
import { adminPptRouter } from './ppt';

vi.mock('../../appSettings/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof appSettingsCatalog>();

  return {
    ...actual,
    normalizeAppSettingValue: vi.fn(actual.normalizeAppSettingValue),
  };
});

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

const TEST_KEY_VAULTS_SECRET = Buffer.alloc(32, 11).toString('base64');

const createDb = (rows: Array<{ key: string; value: unknown }> = []) => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));

  return {
    __mocks: { onConflictDoUpdate, values },
    insert: vi.fn(() => ({ values })),
    query: {
      appSettings: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
      users: {
        findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
      },
    },
  } as any;
};

describe('adminPptRouter', () => {
  beforeEach(() => {
    process.env.KEY_VAULTS_SECRET = TEST_KEY_VAULTS_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.KEY_VAULTS_SECRET;
  });

  it('routes every dedicated setting write through the catalog contract', async () => {
    const db = createDb();
    vi.mocked(getServerDB).mockResolvedValue(db);

    await adminPptRouter.createCaller({ userId: 'admin-user' } as any).saveSettings({
      apiKey: '  ppt-secret  ',
      dailyLimit: null,
      tokenTtlMinutes: 1440,
    });

    expect(appSettingsCatalog.normalizeAppSettingValue).toHaveBeenCalledWith(
      APP_SETTING_KEYS.docmeePptApiKey,
      '  ppt-secret  ',
      'adminPptRouter.saveSettings',
    );
    expect(appSettingsCatalog.normalizeAppSettingValue).toHaveBeenCalledWith(
      APP_SETTING_KEYS.docmeePptDailyLimit,
      null,
      'adminPptRouter.saveSettings',
    );
    expect(appSettingsCatalog.normalizeAppSettingValue).toHaveBeenCalledWith(
      APP_SETTING_KEYS.docmeePptTokenTtlMinutes,
      1440,
      'adminPptRouter.saveSettings',
    );
    const stored = db.__mocks.values.mock.calls.find(
      ([value]: any[]) => value.key === APP_SETTING_KEYS.docmeePptApiKey,
    )?.[0].value;
    expect(stored).not.toBe('ppt-secret');
    await expect(
      decryptAppSettingSecret(APP_SETTING_KEYS.docmeePptApiKey, stored),
    ).resolves.toBe('ppt-secret');
    expect(db.__mocks.values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.docmeePptDailyLimit,
      value: null,
    });
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'ppt.settings.save' }),
    );
  });

  it('routes API-key clearing through the sensitive catalog contract', async () => {
    const db = createDb();
    vi.mocked(getServerDB).mockResolvedValue(db);

    await adminPptRouter.createCaller({ userId: 'admin-user' } as any).saveSettings({
      clearApiKey: true,
    });

    expect(appSettingsCatalog.normalizeAppSettingValue).toHaveBeenCalledWith(
      APP_SETTING_KEYS.docmeePptApiKey,
      null,
      'adminPptRouter.saveSettings',
    );
    expect(db.__mocks.values).toHaveBeenCalledWith({
      key: APP_SETTING_KEYS.docmeePptApiKey,
      value: null,
    });
  });

  it('decrypts the API key only for masked admin response fields', async () => {
    const encrypted = await encryptAppSettingSecret(
      APP_SETTING_KEYS.docmeePptApiKey,
      'existing-secret',
    );
    const db = createDb([{ key: APP_SETTING_KEYS.docmeePptApiKey, value: encrypted }]);
    vi.mocked(getServerDB).mockResolvedValue(db);

    const result = await adminPptRouter
      .createCaller({ userId: 'admin-user' } as any)
      .getSettings();

    expect(result).toMatchObject({
      apiKey: '',
      apiKeyConfigured: true,
      apiKeyMasked: '****cret',
    });
    expect(JSON.stringify(result)).not.toContain('existing-secret');
  });

  it('keeps an unchanged masked API key and rejects encryption failure before any writes', async () => {
    const encrypted = await encryptAppSettingSecret(
      APP_SETTING_KEYS.docmeePptApiKey,
      'existing-secret',
    );
    const maskedDb = createDb([
      { key: APP_SETTING_KEYS.docmeePptApiKey, value: encrypted },
    ]);
    vi.mocked(getServerDB).mockResolvedValue(maskedDb);

    const caller = adminPptRouter.createCaller({ userId: 'admin-user' } as any);
    await expect(caller.saveSettings({ apiKey: '****cret' })).resolves.toEqual({ ok: true });
    expect(
      maskedDb.__mocks.values.mock.calls.some(
        ([value]: any[]) => value.key === APP_SETTING_KEYS.docmeePptApiKey,
      ),
    ).toBe(false);

    delete process.env.KEY_VAULTS_SECRET;
    const failingDb = createDb();
    vi.mocked(getServerDB).mockResolvedValue(failingDb);
    await expect(caller.saveSettings({ apiKey: 'new-secret' })).rejects.toThrow(
      'KEY_VAULTS_SECRET',
    );
    expect(failingDb.insert).not.toHaveBeenCalled();
  });

  it('keeps the catalog limits at nullable daily quota and a 1..1440 token TTL', async () => {
    const db = createDb();
    vi.mocked(getServerDB).mockResolvedValue(db);
    const caller = adminPptRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(caller.saveSettings({ dailyLimit: null, tokenTtlMinutes: 1 })).resolves.toEqual({
      ok: true,
    });
    await expect(caller.saveSettings({ tokenTtlMinutes: 0 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.saveSettings({ tokenTtlMinutes: 1441 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
