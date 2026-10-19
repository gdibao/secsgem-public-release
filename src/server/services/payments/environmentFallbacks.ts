import { APP_SETTING_KEYS, type AppSettingKey } from '@/const/appSettingsRegistry';

export const PAYMENT_ENVIRONMENT_FALLBACKS: Partial<Record<AppSettingKey, readonly string[]>> = {
  [APP_SETTING_KEYS.paymentAlipayAppCertSn]: [
    'PAYMENT_ALIPAY_APP_CERT_SN',
    'MODULE_APP_ALIPAY_APP_CERT_SN',
  ],
  [APP_SETTING_KEYS.paymentAlipayAppId]: ['PAYMENT_ALIPAY_APP_ID', 'MODULE_APP_ALIPAY_APP_ID'],
  [APP_SETTING_KEYS.paymentAlipayCertMode]: [
    'PAYMENT_ALIPAY_CERT_MODE',
    'MODULE_APP_ALIPAY_CERT_MODE',
  ],
  [APP_SETTING_KEYS.paymentAlipayCertificate]: [
    'PAYMENT_ALIPAY_CERTIFICATE',
    'MODULE_APP_ALIPAY_CERTIFICATE',
  ],
  [APP_SETTING_KEYS.paymentAlipayEnabled]: ['PAYMENT_ALIPAY_ENABLED', 'MODULE_APP_ALIPAY_ENABLED'],
  [APP_SETTING_KEYS.paymentAlipayGateway]: ['PAYMENT_ALIPAY_GATEWAY', 'MODULE_APP_ALIPAY_GATEWAY'],
  [APP_SETTING_KEYS.paymentAlipayMerchantPrivateKey]: [
    'PAYMENT_ALIPAY_MERCHANT_PRIVATE_KEY',
    'MODULE_APP_ALIPAY_MERCHANT_PRIVATE_KEY',
  ],
  [APP_SETTING_KEYS.paymentAlipayMode]: ['PAYMENT_ALIPAY_MODE', 'MODULE_APP_ALIPAY_MODE'],
  [APP_SETTING_KEYS.paymentAlipayPublicKey]: [
    'PAYMENT_ALIPAY_PUBLIC_KEY',
    'MODULE_APP_ALIPAY_PUBLIC_KEY',
  ],
  [APP_SETTING_KEYS.paymentAlipayRootCertSn]: [
    'PAYMENT_ALIPAY_ROOT_CERT_SN',
    'MODULE_APP_ALIPAY_ROOT_CERT_SN',
  ],
  [APP_SETTING_KEYS.paymentAlipaySellerId]: [
    'PAYMENT_ALIPAY_SELLER_ID',
    'MODULE_APP_ALIPAY_SELLER_ID',
  ],
  [APP_SETTING_KEYS.paymentDefaultProvider]: ['PAYMENT_DEFAULT_PROVIDER'],
  [APP_SETTING_KEYS.paymentEnabled]: ['PAYMENT_ENABLED', 'MODULE_APP_ALIPAY_ENABLED'],
  [APP_SETTING_KEYS.paymentModuleAppEnabled]: [
    'PAYMENT_MODULE_APP_ENABLED',
    'MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED',
  ],
  [APP_SETTING_KEYS.paymentPublicBaseUrl]: [
    'PAYMENT_PUBLIC_BASE_URL',
    'NEXT_PUBLIC_SITE_URL',
    'MODULE_APP_ALIPAY_NOTIFY_URL',
    'MODULE_APP_ALIPAY_RETURN_URL',
  ],
  [APP_SETTING_KEYS.paymentSubscriptionEnabled]: ['PAYMENT_SUBSCRIPTION_ENABLED'],
  [APP_SETTING_KEYS.paymentTopUpEnabled]: ['PAYMENT_TOP_UP_ENABLED'],
  [APP_SETTING_KEYS.paymentWechatApiBaseUrl]: ['PAYMENT_WECHAT_API_BASE_URL'],
  [APP_SETTING_KEYS.paymentWechatApiV3Key]: ['PAYMENT_WECHAT_API_V3_KEY'],
  [APP_SETTING_KEYS.paymentWechatAppId]: ['PAYMENT_WECHAT_APP_ID'],
  [APP_SETTING_KEYS.paymentWechatEnabled]: ['PAYMENT_WECHAT_ENABLED'],
  [APP_SETTING_KEYS.paymentWechatMchId]: ['PAYMENT_WECHAT_MCH_ID'],
  [APP_SETTING_KEYS.paymentWechatMerchantPrivateKey]: ['PAYMENT_WECHAT_MERCHANT_PRIVATE_KEY'],
  [APP_SETTING_KEYS.paymentWechatMerchantSerialNo]: ['PAYMENT_WECHAT_MERCHANT_SERIAL_NO'],
  [APP_SETTING_KEYS.paymentWechatPlatformCertificate]: ['PAYMENT_WECHAT_PLATFORM_CERTIFICATE'],
  [APP_SETTING_KEYS.paymentWechatPlatformCertificateSerialNo]: [
    'PAYMENT_WECHAT_PLATFORM_CERTIFICATE_SERIAL_NO',
  ],
  [APP_SETTING_KEYS.paymentZpayAlipayEnabled]: ['PAYMENT_ZPAY_ALIPAY_ENABLED'],
  [APP_SETTING_KEYS.paymentZpayApiBaseUrl]: ['PAYMENT_ZPAY_API_BASE_URL'],
  [APP_SETTING_KEYS.paymentZpayEnabled]: ['PAYMENT_ZPAY_ENABLED'],
  [APP_SETTING_KEYS.paymentZpayMerchantId]: ['PAYMENT_ZPAY_MERCHANT_ID'],
  [APP_SETTING_KEYS.paymentZpayMerchantKey]: ['PAYMENT_ZPAY_MERCHANT_KEY'],
  [APP_SETTING_KEYS.paymentZpayWechatEnabled]: ['PAYMENT_ZPAY_WECHAT_ENABLED'],
};

export const PAYMENT_SETTING_KEYS = Object.freeze(
  Object.keys(PAYMENT_ENVIRONMENT_FALLBACKS) as AppSettingKey[],
);

export const PAYMENT_ENVIRONMENT_VARIABLES = Object.freeze(
  Array.from(new Set(Object.values(PAYMENT_ENVIRONMENT_FALLBACKS).flatMap((names) => names ?? []))),
);

export const hasStoredPaymentSettingValue = (value: unknown) =>
  typeof value === 'boolean' || (typeof value === 'string' && value.trim().length > 0);

export const getLegacyPaymentEnvironmentKeys = (
  isStored: (key: AppSettingKey) => boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => {
  const keys = new Set<string>();

  for (const [settingKey, environmentNames] of Object.entries(PAYMENT_ENVIRONMENT_FALLBACKS)) {
    if (!environmentNames || isStored(settingKey as AppSettingKey)) continue;

    for (const environmentName of environmentNames) {
      if (environment[environmentName]?.trim()) keys.add(environmentName);
    }
  }

  return Array.from(keys);
};
