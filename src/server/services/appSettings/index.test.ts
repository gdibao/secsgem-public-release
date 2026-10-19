// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COMHUB_AGENT_NAME } from '@/const/defaultAgent';

import {
  APP_SETTING_KEYS,
  getAppSettingRegistryItem,
  getServerComposioConfig,
  getServerDefaultAgentSettingOverrides,
  getServerDefaultModelSuggestions,
  getServerFileS3Config,
  getServerModelPolicyConfig,
  getServerPublicCustomizationConfig,
  invalidateServerAppSettings,
  isSensitiveAppSettingKey,
  normalizeModelIdList,
  serializeModelIdList,
} from './index';
import { APP_SETTING_SECRET_PREFIX, encryptAppSettingSecret } from './secrets';

const { mockBumpAppSettingsCacheVersion, mockGetAppSettingsCacheVersion } = vi.hoisted(() => ({
  mockBumpAppSettingsCacheVersion: vi.fn(),
  mockGetAppSettingsCacheVersion: vi.fn(),
}));

vi.mock('./cacheVersion', () => ({
  bumpAppSettingsCacheVersion: mockBumpAppSettingsCacheVersion,
  getAppSettingsCacheVersion: mockGetAppSettingsCacheVersion,
}));

const TEST_KEY_VAULTS_SECRET = Buffer.alloc(32, 13).toString('base64');

describe('appSettings model helpers', () => {
  beforeEach(async () => {
    process.env.KEY_VAULTS_SECRET = TEST_KEY_VAULTS_SECRET;
    mockGetAppSettingsCacheVersion.mockReset().mockResolvedValue('test-version');
    mockBumpAppSettingsCacheVersion.mockReset().mockResolvedValue(undefined);
    await invalidateServerAppSettings();
  });

  afterEach(() => {
    delete process.env.KEY_VAULTS_SECRET;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_INTERNAL_ENDPOINT;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  it('normalizes and dedupes model IDs from mixed separators', () => {
    expect(normalizeModelIdList('gpt-4o-mini\n gpt-4.1 ;gpt-4o-mini，claude-3.7-sonnet')).toEqual([
      'gpt-4o-mini',
      'gpt-4.1',
      'claude-3.7-sonnet',
    ]);
    expect(serializeModelIdList(['gpt-4o-mini', 'gpt-4.1', 'gpt-4o-mini'])).toBe(
      'gpt-4o-mini\ngpt-4.1',
    );
  });

  it('exposes shared setting registry metadata', () => {
    expect(APP_SETTING_KEYS.brandName).toBe('brand.name');
    expect(getAppSettingRegistryItem(APP_SETTING_KEYS.brandName)).toMatchObject({
      domain: 'brand',
      publicRuntime: true,
    });
  });

  it('marks sensitive setting keys', () => {
    expect(isSensitiveAppSettingKey(APP_SETTING_KEYS.composioApiKey)).toBe(true);
    expect(isSensitiveAppSettingKey(APP_SETTING_KEYS.brandName)).toBe(false);
  });

  it('returns the current model as a default model suggestion', async () => {
    const result = await getServerDefaultModelSuggestions({
      currentModel: 'claude-3.7-sonnet',
    });

    expect(result).toEqual(['claude-3.7-sonnet']);
  });

  it('returns an empty list when the current model is not set', async () => {
    const result = await getServerDefaultModelSuggestions({
      currentModel: '',
    });

    expect(result).toEqual([]);
  });

  it('returns default assistant identity overrides from app settings', async () => {
    const db = {
      query: {
        appSettings: {
          findMany: async () => [
            { key: APP_SETTING_KEYS.defaultAgentModel, value: 'deepseek-chat' },
            { key: APP_SETTING_KEYS.defaultAgentProvider, value: 'newapi' },
            { key: APP_SETTING_KEYS.defaultAgentName, value: DEFAULT_COMHUB_AGENT_NAME },
            { key: APP_SETTING_KEYS.defaultAgentAvatar, value: '/images/brand/logo.svg' },
          ],
        },
      },
    } as any;

    await expect(getServerDefaultAgentSettingOverrides(db)).resolves.toEqual({
      avatar: '/images/brand/logo.svg',
      model: 'deepseek-chat',
      provider: 'newapi',
      title: DEFAULT_COMHUB_AGENT_NAME,
    });
  });

  it('resolves S3 file storage config from admin settings before environment fallback', async () => {
    const db = {
      query: {
        appSettings: {
          findMany: async () => [
            { key: APP_SETTING_KEYS.storageS3AccessKeyId, value: 'admin-access-key' },
            { key: APP_SETTING_KEYS.storageS3SecretAccessKey, value: 'admin-secret-key' },
            { key: APP_SETTING_KEYS.storageS3Endpoint, value: 'https://admin-s3.example.com' },
            { key: APP_SETTING_KEYS.storageS3Bucket, value: 'admin-bucket' },
            { key: APP_SETTING_KEYS.storageS3Region, value: 'ap-southeast-1' },
            { key: APP_SETTING_KEYS.storageS3PublicDomain, value: 'https://cdn.example.com' },
            { key: APP_SETTING_KEYS.storageS3FilePath, value: '/admin-files/' },
            { key: APP_SETTING_KEYS.storageS3EnablePathStyle, value: true },
            { key: APP_SETTING_KEYS.storageS3SetAcl, value: false },
            { key: APP_SETTING_KEYS.storageS3PreviewUrlExpireIn, value: 1800 },
          ],
        },
      },
    } as any;

    await expect(getServerFileS3Config(db)).resolves.toEqual({
      accessKeyId: 'admin-access-key',
      bucket: 'admin-bucket',
      enablePathStyle: true,
      endpoint: 'https://admin-s3.example.com',
      filePath: 'admin-files',
      previewUrlExpireIn: 1800,
      publicDomain: 'https://cdn.example.com',
      region: 'ap-southeast-1',
      secretAccessKey: 'admin-secret-key',
      setAcl: false,
    });
  });

  it('uses the environment internal endpoint when storage uses the environment endpoint', async () => {
    process.env.S3_ENDPOINT = 'https://env-s3.example.com';
    process.env.S3_INTERNAL_ENDPOINT = 'http://rustfs:9000';

    const db = {
      query: {
        appSettings: {
          findMany: async () => [],
        },
      },
    } as any;

    await expect(getServerFileS3Config(db)).resolves.toMatchObject({
      endpoint: 'https://env-s3.example.com',
      internalEndpoint: 'http://rustfs:9000',
    });
  });

  it('does not pair an environment internal endpoint with a different admin endpoint', async () => {
    process.env.S3_ENDPOINT = 'https://env-s3.example.com';
    process.env.S3_INTERNAL_ENDPOINT = 'http://legacy-rustfs:9000';

    const db = {
      query: {
        appSettings: {
          findMany: async () => [
            { key: APP_SETTING_KEYS.storageS3Endpoint, value: 'https://admin-s3.example.com' },
          ],
        },
      },
    } as any;

    await expect(getServerFileS3Config(db)).resolves.toMatchObject({
      endpoint: 'https://admin-s3.example.com',
      internalEndpoint: undefined,
    });
  });

  it('returns Composio config from app settings with env fallback', async () => {
    const db = {
      query: {
        appSettings: {
          findMany: async () => [
            { key: APP_SETTING_KEYS.composioEnabled, value: true },
            { key: APP_SETTING_KEYS.composioApiKey, value: 'ak_admin' },
            { key: APP_SETTING_KEYS.composioAuthConfigIds, value: '{"gmail":"ac_admin"}' },
          ],
        },
      },
    } as any;

    await expect(getServerComposioConfig(db)).resolves.toEqual({
      apiKey: 'ak_admin',
      authConfigIds: '{"gmail":"ac_admin"}',
      enabled: true,
    });
  });

  it('decrypts Composio and S3 secrets before runtime use', async () => {
    const composioSecret = await encryptAppSettingSecret(
      APP_SETTING_KEYS.composioApiKey,
      'encrypted-composio',
    );
    const s3Secret = await encryptAppSettingSecret(
      APP_SETTING_KEYS.storageS3SecretAccessKey,
      'encrypted-s3',
    );
    const db = {
      query: {
        appSettings: {
          findMany: async () => [
            { key: APP_SETTING_KEYS.composioApiKey, value: composioSecret },
            { key: APP_SETTING_KEYS.composioEnabled, value: true },
            { key: APP_SETTING_KEYS.storageS3SecretAccessKey, value: s3Secret },
          ],
        },
      },
    } as any;

    await expect(getServerComposioConfig(db)).resolves.toMatchObject({
      apiKey: 'encrypted-composio',
    });
    await expect(getServerFileS3Config(db)).resolves.toMatchObject({
      secretAccessKey: 'encrypted-s3',
    });
  });

  it('does not fall through to environment secrets for invalid ciphertext', async () => {
    process.env.COMPOSIO_API_KEY = 'environment-composio';
    process.env.S3_SECRET_ACCESS_KEY = 'environment-s3';
    const db = {
      query: {
        appSettings: {
          findMany: async () => [
            {
              key: APP_SETTING_KEYS.composioApiKey,
              value: `${APP_SETTING_SECRET_PREFIX}${APP_SETTING_KEYS.composioApiKey}:invalid`,
            },
            {
              key: APP_SETTING_KEYS.storageS3SecretAccessKey,
              value: `${APP_SETTING_SECRET_PREFIX}${APP_SETTING_KEYS.storageS3SecretAccessKey}:invalid`,
            },
          ],
        },
      },
    } as any;

    await expect(getServerComposioConfig(db)).rejects.toThrow(
      'Invalid encrypted app setting secret',
    );
    await expect(getServerFileS3Config(db)).rejects.toThrow('Invalid encrypted app setting secret');
  });

  it('preserves explicitly empty help menu items in public customization config', async () => {
    const db = {
      query: {
        appSettings: {
          findMany: async () => [{ key: APP_SETTING_KEYS.helpMenuItems, value: [] }],
        },
      },
    } as any;

    await expect(getServerPublicCustomizationConfig(db)).resolves.toEqual({
      helpMenuItems: [],
    });
  });

  it('does not share cached app settings between explicit database instances', async () => {
    const createDb = (model: string) =>
      ({
        query: {
          appSettings: {
            findMany: async () => [{ key: APP_SETTING_KEYS.defaultAgentModel, value: model }],
          },
        },
      }) as any;

    await expect(getServerDefaultAgentSettingOverrides(createDb('first-model'))).resolves.toEqual({
      model: 'first-model',
    });
    await expect(getServerDefaultAgentSettingOverrides(createDb('second-model'))).resolves.toEqual({
      model: 'second-model',
    });
  });

  it('fails closed when the first runtime settings read fails', async () => {
    const db = {
      query: {
        appSettings: {
          findMany: vi.fn().mockRejectedValue(new Error('database unavailable')),
        },
      },
    } as any;

    await expect(getServerModelPolicyConfig(db)).rejects.toThrow('database unavailable');
    expect(db.query.appSettings.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the last successful runtime snapshot when a refresh fails', async () => {
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { key: APP_SETTING_KEYS.modelPolicyEnabled, value: true },
        { key: APP_SETTING_KEYS.modelPolicyMode, value: 'blocklist' },
        { key: APP_SETTING_KEYS.modelPolicyBlocklist, value: ['newapi:blocked-model'] },
      ])
      .mockRejectedValue(new Error('database unavailable'));
    const db = { query: { appSettings: { findMany } } } as any;

    try {
      await expect(getServerModelPolicyConfig(db)).resolves.toMatchObject({
        blocklist: ['newapi:blocked-model'],
        enabled: true,
        mode: 'blocklist',
      });

      now += 30_001;

      await expect(getServerModelPolicyConfig(db)).resolves.toMatchObject({
        blocklist: ['newapi:blocked-model'],
        enabled: true,
        mode: 'blocklist',
      });
      expect(findMany).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('reloads settings when the shared cache version is unavailable', async () => {
    let model = 'first-model';
    const findMany = vi
      .fn()
      .mockImplementation(async () => [{ key: APP_SETTING_KEYS.defaultAgentModel, value: model }]);
    const db = { query: { appSettings: { findMany } } } as any;

    mockGetAppSettingsCacheVersion
      .mockReset()
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce(null);

    await expect(getServerDefaultAgentSettingOverrides(db)).resolves.toEqual({
      model: 'first-model',
    });

    model = 'second-model';

    await expect(getServerDefaultAgentSettingOverrides(db)).resolves.toEqual({
      model: 'second-model',
    });
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
