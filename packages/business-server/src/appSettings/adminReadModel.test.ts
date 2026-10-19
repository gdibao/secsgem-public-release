import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSettingKey } from '@/const/appSettingsRegistry';
import { DEFAULT_MOBILE_CONFIG, normalizeMobileConfig } from '@/const/mobileConfig';
import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import { PAYMENT_ENVIRONMENT_VARIABLES } from '@/server/services/payments/environmentFallbacks';

import {
  buildDesktopSettings,
  buildMobileSettings,
  buildModuleRuntimeSettings,
  buildPaymentSettings,
  buildSystemDefaultsSettings,
} from './adminReadModel';
import { AppSettingsSnapshot } from './loader';

describe('system defaults admin read model', () => {
  it('preserves persisted user global defaults instead of returning an empty baseline', async () => {
    const storedDefaults = {
      general: { themeMode: 'dark' },
      systemAgent: { inputCompletion: { enabled: true } },
    };
    const snapshot = new AppSettingsSnapshot(
      [APP_SETTING_KEYS.userGlobalSettingsDefaults],
      [{ key: APP_SETTING_KEYS.userGlobalSettingsDefaults, value: storedDefaults }],
    );

    const result = await buildSystemDefaultsSettings(snapshot);

    expect(result.userGlobalSettingsDefaults).toEqual(storedDefaults);
    expect(result.userGlobalSettingsDefaults).not.toEqual({});
  });
});

describe('mobile admin read model', () => {
  const mobileSnapshot = (value?: unknown) =>
    new AppSettingsSnapshot(
      [APP_SETTING_KEYS.mobileConfig],
      value === undefined ? [] : [{ key: APP_SETTING_KEYS.mobileConfig, value }],
    );

  it('returns safe defaults when the mobile setting is missing', () => {
    expect(buildMobileSettings(mobileSnapshot())).toEqual(DEFAULT_MOBILE_CONFIG);
  });

  it('returns safe defaults for an unsupported mobile config version', () => {
    expect(buildMobileSettings(mobileSnapshot({ version: 2 }))).toEqual(DEFAULT_MOBILE_CONFIG);
  });

  it('repairs unsafe navigation routes while retaining the valid version 1 config', () => {
    const rawConfig = {
      brand: { displayName: 'ComHub' },
      navigation: {
        items: [
          {
            icon: 'bell',
            id: 'slot-1',
            label: 'Inbox',
            order: 1,
            path: 'javascript:alert(1)',
            visible: true,
          },
        ],
      },
      version: 1,
    };

    const result = buildMobileSettings(mobileSnapshot(rawConfig));

    expect(result).toEqual(normalizeMobileConfig(rawConfig));
    expect(result.brand.displayName).toBe('ComHub');
    expect(result.navigation.items.find((item) => item.id === 'slot-1')?.path).toBe('/');
  });

  it('limits persisted featured assistants to four', () => {
    const rawConfig = {
      discover: {
        assistants: Array.from({ length: 5 }, (_, index) => ({
          assistantId: `assistant-${index}`,
          model: 'chat-model',
          order: index + 1,
          provider: 'catalog',
        })),
      },
      version: 1,
    };

    expect(buildMobileSettings(mobileSnapshot(rawConfig)).discover.assistants).toHaveLength(4);
  });
});

describe('desktop admin read model', () => {
  it('returns OSS metadata without credential material', () => {
    const snapshot = new AppSettingsSnapshot(
      [
        APP_SETTING_KEYS.desktopOssAccessKeyId,
        APP_SETTING_KEYS.desktopOssAccessKeySecret,
        APP_SETTING_KEYS.desktopOssBucket,
        APP_SETTING_KEYS.desktopOssEndpoint,
        APP_SETTING_KEYS.desktopOssPath,
      ],
      [
        { key: APP_SETTING_KEYS.desktopOssAccessKeyId, value: 'access-key-id' },
        { key: APP_SETTING_KEYS.desktopOssAccessKeySecret, value: 'access-key-secret' },
        { key: APP_SETTING_KEYS.desktopOssBucket, value: 'releases' },
        { key: APP_SETTING_KEYS.desktopOssEndpoint, value: 'oss.example.com' },
        { key: APP_SETTING_KEYS.desktopOssPath, value: 'desktop' },
      ],
    );

    const result = buildDesktopSettings(snapshot);

    expect(result.desktopOssConfig).toEqual({
      bucket: 'releases',
      credentialsConfigured: true,
      endpoint: 'oss.example.com',
      path: 'desktop',
    });
    expect(result.desktopOssConfig).not.toHaveProperty('accessKeyId');
    expect(result.desktopOssConfig).not.toHaveProperty('accessKeySecretMasked');
    expect(JSON.stringify(result)).not.toContain('access-key-id');
    expect(JSON.stringify(result)).not.toContain('access-key-secret');
  });

  it('removes unsafe legacy download URLs from browser-facing settings', () => {
    const snapshot = new AppSettingsSnapshot(
      [APP_SETTING_KEYS.desktopDownloadUrl],
      [{ key: APP_SETTING_KEYS.desktopDownloadUrl, value: 'javascript:alert(1)' }],
    );

    expect(buildDesktopSettings(snapshot).desktopDownloadUrl).toBeNull();
  });
});

describe('module runtime admin read model', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves the legacy token fallback when no database token exists', async () => {
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_TOKEN', 'legacy-runtime-token');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_URL', 'http://legacy-runtime:3210');

    const result = await buildModuleRuntimeSettings(
      new AppSettingsSnapshot(
        [
          APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
          APP_SETTING_KEYS.moduleAppRuntimeInternalUrl,
        ],
        [],
      ),
    );

    expect(result.moduleAppRuntimeConfig).toMatchObject({
      internalTokenConfigured: true,
      internalTokenMasked: '****oken',
      internalUrl: 'http://legacy-runtime:3210',
      source: {
        backendManaged: false,
        legacyEnvironmentKeys: expect.arrayContaining([
          'MODULE_APP_RUNTIME_INTERNAL_TOKEN',
          'MODULE_APP_RUNTIME_INTERNAL_URL',
        ]),
        values: {
          internalToken: 'environment',
          internalUrl: 'environment',
        },
      },
    });
  });
});

describe('payment admin read model', () => {
  beforeEach(() => {
    for (const name of PAYMENT_ENVIRONMENT_VARIABLES) {
      vi.stubEnv(name, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns only masked payment secrets and selects an available provider', async () => {
    const rows = [
      { key: APP_SETTING_KEYS.paymentEnabled, value: true },
      { key: APP_SETTING_KEYS.paymentDefaultProvider, value: 'alipay' },
      { key: APP_SETTING_KEYS.paymentAlipayEnabled, value: false },
      { key: APP_SETTING_KEYS.paymentWechatEnabled, value: false },
      { key: APP_SETTING_KEYS.paymentZpayEnabled, value: true },
      { key: APP_SETTING_KEYS.paymentZpayAlipayEnabled, value: true },
      { key: APP_SETTING_KEYS.paymentZpayWechatEnabled, value: false },
      { key: APP_SETTING_KEYS.paymentZpayMerchantId, value: 'merchant-1' },
      { key: APP_SETTING_KEYS.paymentZpayMerchantKey, value: 'top-secret-1234' },
      { key: APP_SETTING_KEYS.paymentPublicBaseUrl, value: 'https://app.example.com' },
    ] satisfies Array<{ key: AppSettingKey; value: unknown }>;
    const snapshot = new AppSettingsSnapshot(
      rows.map((row) => row.key),
      rows,
    );

    const result = await buildPaymentSettings(snapshot);

    expect(result.paymentGatewayStatus).toMatchObject({
      configured: true,
      methods: ['zpay_alipay'],
      provider: 'zpay',
    });
    expect(result.paymentConfig.zpay).toMatchObject({
      merchantKeyConfigured: true,
      merchantKeyMasked: '****1234',
    });
    expect(JSON.stringify(result)).not.toContain('top-secret-1234');
    expect(result.paymentConfig.zpay).not.toHaveProperty('merchantKey');
  });

  it('identifies legacy environment fallbacks until equivalent backend settings are stored', async () => {
    vi.stubEnv('PAYMENT_ENABLED', 'true');

    const legacyResult = await buildPaymentSettings(
      new AppSettingsSnapshot([APP_SETTING_KEYS.paymentEnabled], []),
    );
    const managedResult = await buildPaymentSettings(
      new AppSettingsSnapshot(
        [APP_SETTING_KEYS.paymentEnabled],
        [{ key: APP_SETTING_KEYS.paymentEnabled, value: true }],
      ),
    );

    expect(legacyResult.paymentConfig.source).toEqual({
      backendManaged: false,
      legacyEnvironmentKeys: ['PAYMENT_ENABLED'],
    });
    expect(managedResult.paymentConfig.source).toEqual({
      backendManaged: true,
      legacyEnvironmentKeys: [],
    });
  });

  it('does not report checkout ready without a valid public callback origin', async () => {
    const rows = [
      { key: APP_SETTING_KEYS.paymentEnabled, value: true },
      { key: APP_SETTING_KEYS.paymentZpayEnabled, value: true },
      { key: APP_SETTING_KEYS.paymentZpayAlipayEnabled, value: true },
      { key: APP_SETTING_KEYS.paymentZpayMerchantId, value: 'merchant-1' },
      { key: APP_SETTING_KEYS.paymentZpayMerchantKey, value: 'top-secret-1234' },
    ] satisfies Array<{ key: AppSettingKey; value: unknown }>;
    const snapshot = new AppSettingsSnapshot(
      rows.map((row) => row.key),
      rows,
    );

    const result = await buildPaymentSettings(snapshot);

    expect(result.paymentGatewayStatus).toMatchObject({
      configured: false,
      methods: ['zpay_alipay', 'zpay_wechat'],
    });
  });

  it('does not report WeChat ready when the API v3 key length is invalid', async () => {
    const rows = [
      { key: APP_SETTING_KEYS.paymentEnabled, value: true },
      { key: APP_SETTING_KEYS.paymentWechatEnabled, value: true },
      { key: APP_SETTING_KEYS.paymentWechatApiV3Key, value: 'too-short' },
      { key: APP_SETTING_KEYS.paymentWechatAppId, value: 'wechat-app' },
      { key: APP_SETTING_KEYS.paymentWechatMchId, value: 'wechat-merchant' },
      {
        key: APP_SETTING_KEYS.paymentWechatMerchantPrivateKey,
        value: 'merchant-private-key',
      },
      { key: APP_SETTING_KEYS.paymentWechatMerchantSerialNo, value: 'merchant-serial' },
      {
        key: APP_SETTING_KEYS.paymentWechatPlatformCertificate,
        value: 'platform-certificate',
      },
      {
        key: APP_SETTING_KEYS.paymentWechatPlatformCertificateSerialNo,
        value: 'platform-serial',
      },
      { key: APP_SETTING_KEYS.paymentPublicBaseUrl, value: 'https://app.example.com' },
    ] satisfies Array<{ key: AppSettingKey; value: unknown }>;
    const snapshot = new AppSettingsSnapshot(
      rows.map((row) => row.key),
      rows,
    );

    const result = await buildPaymentSettings(snapshot);

    expect(result.paymentConfig.wechat.configured).toBe(false);
    expect(result.paymentGatewayStatus).toMatchObject({ configured: false, methods: [] });
  });
});
