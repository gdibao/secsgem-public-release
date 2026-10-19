import type {
  PaymentMethod,
  PaymentMethodId,
  PaymentProvider,
  PaymentPurpose,
} from '@lobechat/types';
import { inArray } from 'drizzle-orm';

import { APP_SETTING_KEYS, type AppSettingKey } from '@/const/appSettingsRegistry';
import { appSettings } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { decryptAppSettingSecret } from '@/server/services/appSettings/secrets';

import {
  getLegacyPaymentEnvironmentKeys,
  hasStoredPaymentSettingValue,
  PAYMENT_SETTING_KEYS as PAYMENT_ENVIRONMENT_SETTING_KEYS,
} from './environmentFallbacks';

export const PAYMENT_SETTING_KEYS = PAYMENT_ENVIRONMENT_SETTING_KEYS;

const ALIPAY_PRODUCTION_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const ALIPAY_SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const WECHAT_API_BASE_URL = 'https://api.mch.weixin.qq.com';
const ZPAY_API_BASE_URL = 'https://zpayz.cn';

export type ServerAlipayPaymentConfig = {
  alipayPublicKey?: string;
  appCertSn?: string;
  appId?: string;
  certMode: 'certificate' | 'public_key';
  configured: boolean;
  enabled: boolean;
  gateway: string;
  merchantPrivateKey?: string;
  mode: 'production' | 'sandbox';
  rootCertSn?: string;
  sellerId?: string;
};

export type ServerWechatPaymentConfig = {
  apiBaseUrl: string;
  apiV3Key?: string;
  appId?: string;
  configured: boolean;
  enabled: boolean;
  mchId?: string;
  merchantPrivateKey?: string;
  merchantSerialNo?: string;
  platformCertificate?: string;
  platformCertificateSerialNo?: string;
};

export type ServerZPayConfig = {
  alipayEnabled: boolean;
  apiBaseUrl: string;
  configured: boolean;
  enabled: boolean;
  merchantId?: string;
  merchantKey?: string;
  wechatEnabled: boolean;
};

export type ServerPaymentConfig = {
  alipay: ServerAlipayPaymentConfig;
  defaultProvider: PaymentProvider;
  enabled: boolean;
  moduleAppEnabled: boolean;
  publicBaseUrl?: string;
  source: {
    backendManaged: boolean;
    legacyEnvironmentKeys: string[];
  };
  subscriptionEnabled: boolean;
  topUpEnabled: boolean;
  wechat: ServerWechatPaymentConfig;
  zpay: ServerZPayConfig;
};

export const createOperationalPaymentConfig = (
  config: ServerPaymentConfig,
): ServerPaymentConfig => ({
  ...config,
  alipay: { ...config.alipay, enabled: true },
  enabled: true,
  moduleAppEnabled: true,
  subscriptionEnabled: true,
  topUpEnabled: true,
  wechat: { ...config.wechat, enabled: true },
  zpay: {
    ...config.zpay,
    alipayEnabled: true,
    enabled: true,
    wechatEnabled: true,
  },
});

const text = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replaceAll('\\n', '\n').trim();
  return normalized || undefined;
};

const firstEnvironmentValue = (...names: string[]) => {
  for (const name of names) {
    const value = text(process.env[name]);
    if (value) return value;
  }
};

const parseEnvironmentBoolean = (...names: string[]): boolean | undefined => {
  const value = firstEnvironmentValue(...names)?.toLowerCase();
  if (!value) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
};

const valueOrEnvironment = (
  values: ReadonlyMap<AppSettingKey, unknown>,
  key: AppSettingKey,
  ...environmentNames: string[]
) => text(values.get(key)) ?? firstEnvironmentValue(...environmentNames);

const booleanOrEnvironment = (
  values: ReadonlyMap<AppSettingKey, unknown>,
  key: AppSettingKey,
  fallback: boolean,
  ...environmentNames: string[]
) => {
  const stored = values.get(key);
  if (typeof stored === 'boolean') return stored;
  return parseEnvironmentBoolean(...environmentNames) ?? fallback;
};

const secretOrEnvironment = async (
  values: ReadonlyMap<AppSettingKey, unknown>,
  key: AppSettingKey,
  ...environmentNames: string[]
) => {
  const stored = values.get(key);
  if (stored === undefined || stored === null || stored === '') {
    return firstEnvironmentValue(...environmentNames);
  }

  try {
    return text(await decryptAppSettingSecret(key, stored));
  } catch {
    // A damaged stored credential must disable its channel instead of reviving stale env secrets.
    return undefined;
  }
};

const normalizeBaseUrl = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !localHttp) return undefined;
    if (url.username || url.password) return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

const originFromEnvironmentUrl = (...names: string[]) => {
  for (const name of names) {
    const normalized = normalizeBaseUrl(text(process.env[name]));
    if (normalized) return new URL(normalized).origin;
  }
};

export const getServerPaymentConfig = async (
  db: LobeChatDatabase,
): Promise<ServerPaymentConfig> => {
  const rows = await db.query.appSettings.findMany({
    columns: { key: true, value: true },
    where: inArray(appSettings.key, [...PAYMENT_SETTING_KEYS]),
  });
  const values = new Map(rows.map((row) => [row.key as AppSettingKey, row.value]));
  const legacyEnvironmentKeys = getLegacyPaymentEnvironmentKeys((key) =>
    hasStoredPaymentSettingValue(values.get(key)),
  );
  const alipayMode =
    valueOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentAlipayMode,
      'PAYMENT_ALIPAY_MODE',
      'MODULE_APP_ALIPAY_MODE',
    ) === 'production'
      ? 'production'
      : 'sandbox';
  const alipayCertMode =
    valueOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentAlipayCertMode,
      'PAYMENT_ALIPAY_CERT_MODE',
      'MODULE_APP_ALIPAY_CERT_MODE',
    ) === 'certificate'
      ? 'certificate'
      : 'public_key';
  const defaultProviderValue = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentDefaultProvider,
    'PAYMENT_DEFAULT_PROVIDER',
  );
  const defaultProvider: PaymentProvider =
    defaultProviderValue === 'wechat_pay' || defaultProviderValue === 'zpay'
      ? defaultProviderValue
      : 'alipay';

  const [
    alipayPublicKey,
    alipayMerchantPrivateKey,
    wechatApiV3Key,
    wechatMerchantPrivateKey,
    wechatPlatformCertificate,
    zpayMerchantKey,
  ] = await Promise.all([
    secretOrEnvironment(
      values,
      alipayCertMode === 'certificate'
        ? APP_SETTING_KEYS.paymentAlipayCertificate
        : APP_SETTING_KEYS.paymentAlipayPublicKey,
      alipayCertMode === 'certificate' ? 'PAYMENT_ALIPAY_CERTIFICATE' : 'PAYMENT_ALIPAY_PUBLIC_KEY',
      alipayCertMode === 'certificate'
        ? 'MODULE_APP_ALIPAY_CERTIFICATE'
        : 'MODULE_APP_ALIPAY_PUBLIC_KEY',
    ),
    secretOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentAlipayMerchantPrivateKey,
      'PAYMENT_ALIPAY_MERCHANT_PRIVATE_KEY',
      'MODULE_APP_ALIPAY_MERCHANT_PRIVATE_KEY',
    ),
    secretOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentWechatApiV3Key,
      'PAYMENT_WECHAT_API_V3_KEY',
    ),
    secretOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentWechatMerchantPrivateKey,
      'PAYMENT_WECHAT_MERCHANT_PRIVATE_KEY',
    ),
    secretOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentWechatPlatformCertificate,
      'PAYMENT_WECHAT_PLATFORM_CERTIFICATE',
    ),
    secretOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentZpayMerchantKey,
      'PAYMENT_ZPAY_MERCHANT_KEY',
    ),
  ]);

  const alipayAppId = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentAlipayAppId,
    'PAYMENT_ALIPAY_APP_ID',
    'MODULE_APP_ALIPAY_APP_ID',
  );
  const alipaySellerId = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentAlipaySellerId,
    'PAYMENT_ALIPAY_SELLER_ID',
    'MODULE_APP_ALIPAY_SELLER_ID',
  );
  const alipayAppCertSn = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentAlipayAppCertSn,
    'PAYMENT_ALIPAY_APP_CERT_SN',
    'MODULE_APP_ALIPAY_APP_CERT_SN',
  );
  const alipayRootCertSn = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentAlipayRootCertSn,
    'PAYMENT_ALIPAY_ROOT_CERT_SN',
    'MODULE_APP_ALIPAY_ROOT_CERT_SN',
  );
  const alipayGateway =
    normalizeBaseUrl(
      valueOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentAlipayGateway,
        'PAYMENT_ALIPAY_GATEWAY',
        'MODULE_APP_ALIPAY_GATEWAY',
      ),
    ) ?? (alipayMode === 'production' ? ALIPAY_PRODUCTION_GATEWAY : ALIPAY_SANDBOX_GATEWAY);
  const alipayConfigured = Boolean(
    alipayAppId &&
    alipaySellerId &&
    alipayMerchantPrivateKey &&
    alipayPublicKey &&
    (alipayCertMode === 'public_key' || (alipayAppCertSn && alipayRootCertSn)),
  );

  const wechatAppId = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentWechatAppId,
    'PAYMENT_WECHAT_APP_ID',
  );
  const wechatMchId = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentWechatMchId,
    'PAYMENT_WECHAT_MCH_ID',
  );
  const wechatMerchantSerialNo = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentWechatMerchantSerialNo,
    'PAYMENT_WECHAT_MERCHANT_SERIAL_NO',
  );
  const wechatPlatformCertificateSerialNo = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentWechatPlatformCertificateSerialNo,
    'PAYMENT_WECHAT_PLATFORM_CERTIFICATE_SERIAL_NO',
  );
  const wechatApiBaseUrl =
    normalizeBaseUrl(
      valueOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentWechatApiBaseUrl,
        'PAYMENT_WECHAT_API_BASE_URL',
      ),
    ) ?? WECHAT_API_BASE_URL;
  const wechatConfigured = Boolean(
    wechatAppId &&
    wechatMchId &&
    wechatMerchantSerialNo &&
    wechatMerchantPrivateKey &&
    wechatApiV3Key &&
    Buffer.byteLength(wechatApiV3Key, 'utf8') === 32 &&
    wechatPlatformCertificate &&
    wechatPlatformCertificateSerialNo,
  );

  const zpayMerchantId = valueOrEnvironment(
    values,
    APP_SETTING_KEYS.paymentZpayMerchantId,
    'PAYMENT_ZPAY_MERCHANT_ID',
  );
  const zpayApiBaseUrl =
    normalizeBaseUrl(
      valueOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentZpayApiBaseUrl,
        'PAYMENT_ZPAY_API_BASE_URL',
      ),
    ) ?? ZPAY_API_BASE_URL;
  const publicBaseUrl =
    normalizeBaseUrl(
      valueOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentPublicBaseUrl,
        'PAYMENT_PUBLIC_BASE_URL',
        'NEXT_PUBLIC_SITE_URL',
      ),
    ) ?? originFromEnvironmentUrl('MODULE_APP_ALIPAY_NOTIFY_URL', 'MODULE_APP_ALIPAY_RETURN_URL');

  return {
    alipay: {
      alipayPublicKey,
      appCertSn: alipayAppCertSn,
      appId: alipayAppId,
      certMode: alipayCertMode,
      configured: alipayConfigured,
      enabled: booleanOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentAlipayEnabled,
        false,
        'PAYMENT_ALIPAY_ENABLED',
        'MODULE_APP_ALIPAY_ENABLED',
      ),
      gateway: alipayGateway,
      merchantPrivateKey: alipayMerchantPrivateKey,
      mode: alipayMode,
      rootCertSn: alipayRootCertSn,
      sellerId: alipaySellerId,
    },
    defaultProvider,
    enabled: booleanOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentEnabled,
      false,
      'PAYMENT_ENABLED',
      'MODULE_APP_ALIPAY_ENABLED',
    ),
    moduleAppEnabled: booleanOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentModuleAppEnabled,
      false,
      'PAYMENT_MODULE_APP_ENABLED',
      'MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED',
    ),
    publicBaseUrl,
    source: {
      backendManaged: legacyEnvironmentKeys.length === 0,
      legacyEnvironmentKeys,
    },
    subscriptionEnabled: booleanOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentSubscriptionEnabled,
      false,
      'PAYMENT_SUBSCRIPTION_ENABLED',
    ),
    topUpEnabled: booleanOrEnvironment(
      values,
      APP_SETTING_KEYS.paymentTopUpEnabled,
      false,
      'PAYMENT_TOP_UP_ENABLED',
    ),
    wechat: {
      apiBaseUrl: wechatApiBaseUrl,
      apiV3Key: wechatApiV3Key,
      appId: wechatAppId,
      configured: wechatConfigured,
      enabled: booleanOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentWechatEnabled,
        false,
        'PAYMENT_WECHAT_ENABLED',
      ),
      mchId: wechatMchId,
      merchantPrivateKey: wechatMerchantPrivateKey,
      merchantSerialNo: wechatMerchantSerialNo,
      platformCertificate: wechatPlatformCertificate,
      platformCertificateSerialNo: wechatPlatformCertificateSerialNo,
    },
    zpay: {
      alipayEnabled: booleanOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentZpayAlipayEnabled,
        true,
        'PAYMENT_ZPAY_ALIPAY_ENABLED',
      ),
      apiBaseUrl: zpayApiBaseUrl,
      configured: Boolean(zpayMerchantId && zpayMerchantKey),
      enabled: booleanOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentZpayEnabled,
        false,
        'PAYMENT_ZPAY_ENABLED',
      ),
      merchantId: zpayMerchantId,
      merchantKey: zpayMerchantKey,
      wechatEnabled: booleanOrEnvironment(
        values,
        APP_SETTING_KEYS.paymentZpayWechatEnabled,
        true,
        'PAYMENT_ZPAY_WECHAT_ENABLED',
      ),
    },
  };
};

export const listEnabledPaymentMethods = (
  config: ServerPaymentConfig,
  purpose: PaymentPurpose,
): PaymentMethod[] => {
  if (!config.enabled) return [];
  if (purpose === 'module_app' && !config.moduleAppEnabled) return [];
  if (purpose === 'subscription' && !config.subscriptionEnabled) return [];
  if (purpose === 'top_up' && !config.topUpEnabled) return [];

  const methods: PaymentMethod[] = [];
  if (config.alipay.enabled && config.alipay.configured) {
    methods.push({ id: 'alipay', label: '支付宝', provider: 'alipay' });
  }
  if (config.wechat.enabled && config.wechat.configured) {
    methods.push({ id: 'wechat_pay', label: '微信支付', provider: 'wechat_pay' });
  }
  if (config.zpay.enabled && config.zpay.configured && config.zpay.alipayEnabled) {
    methods.push({ id: 'zpay_alipay', label: '第三方支付宝', provider: 'zpay' });
  }
  if (config.zpay.enabled && config.zpay.configured && config.zpay.wechatEnabled) {
    methods.push({ id: 'zpay_wechat', label: '第三方微信支付', provider: 'zpay' });
  }
  return methods;
};

export const listCheckoutPaymentMethods = (config: ServerPaymentConfig, purpose: PaymentPurpose) =>
  config.publicBaseUrl ? listEnabledPaymentMethods(config, purpose) : [];

export const resolvePaymentMethod = (
  config: ServerPaymentConfig,
  purpose: PaymentPurpose,
  requestedMethod?: PaymentMethodId,
) => {
  const methods = listEnabledPaymentMethods(config, purpose);
  const method = requestedMethod
    ? methods.find((item) => item.id === requestedMethod)
    : (methods.find((item) => item.provider === config.defaultProvider) ?? methods[0]);
  if (!method) throw new Error('PAYMENT_METHOD_NOT_AVAILABLE');
  return method;
};

export const buildPaymentCallbackUrl = (config: ServerPaymentConfig, provider: PaymentProvider) => {
  if (!config.publicBaseUrl) throw new Error('PAYMENT_PUBLIC_BASE_URL_REQUIRED');
  return `${config.publicBaseUrl}/api/webhooks/payments/${provider}`;
};

export const buildPaymentReturnUrl = (config: ServerPaymentConfig, purpose: PaymentPurpose) => {
  if (!config.publicBaseUrl) throw new Error('PAYMENT_PUBLIC_BASE_URL_REQUIRED');
  const pathname =
    purpose === 'module_app' ? '/apps' : purpose === 'subscription' ? '/settings/plans' : '/topup';
  return `${config.publicBaseUrl}${pathname}`;
};
