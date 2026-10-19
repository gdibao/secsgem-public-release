import { APP_SETTING_KEYS, type AppSettingKey } from '@/const/appSettingsRegistry';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

export const APP_SETTING_SECRET_PREFIX = 'app-setting:v1:';

const APP_SETTING_SECRET_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.composioApiKey,
  APP_SETTING_KEYS.cronSecret,
  APP_SETTING_KEYS.docmeePptApiKey,
  APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
  APP_SETTING_KEYS.paymentAlipayCertificate,
  APP_SETTING_KEYS.paymentAlipayMerchantPrivateKey,
  APP_SETTING_KEYS.paymentAlipayPublicKey,
  APP_SETTING_KEYS.paymentWechatApiV3Key,
  APP_SETTING_KEYS.paymentWechatMerchantPrivateKey,
  APP_SETTING_KEYS.paymentWechatPlatformCertificate,
  APP_SETTING_KEYS.paymentZpayMerchantKey,
  APP_SETTING_KEYS.storageS3SecretAccessKey,
]);

export type AppSettingSecretKey =
  | typeof APP_SETTING_KEYS.composioApiKey
  | typeof APP_SETTING_KEYS.cronSecret
  | typeof APP_SETTING_KEYS.docmeePptApiKey
  | typeof APP_SETTING_KEYS.moduleAppRuntimeInternalToken
  | typeof APP_SETTING_KEYS.paymentAlipayCertificate
  | typeof APP_SETTING_KEYS.paymentAlipayMerchantPrivateKey
  | typeof APP_SETTING_KEYS.paymentAlipayPublicKey
  | typeof APP_SETTING_KEYS.paymentWechatApiV3Key
  | typeof APP_SETTING_KEYS.paymentWechatMerchantPrivateKey
  | typeof APP_SETTING_KEYS.paymentWechatPlatformCertificate
  | typeof APP_SETTING_KEYS.paymentZpayMerchantKey
  | typeof APP_SETTING_KEYS.storageS3SecretAccessKey;

export type AppSettingSecretWritePolicy = 'blank-clears' | 'blank-noop' | 'explicit-clear';

const APP_SETTING_SECRET_WRITE_POLICIES: Record<AppSettingSecretKey, AppSettingSecretWritePolicy> =
  {
    [APP_SETTING_KEYS.composioApiKey]: 'blank-clears',
    [APP_SETTING_KEYS.cronSecret]: 'blank-noop',
    [APP_SETTING_KEYS.docmeePptApiKey]: 'explicit-clear',
    [APP_SETTING_KEYS.moduleAppRuntimeInternalToken]: 'blank-noop',
    [APP_SETTING_KEYS.paymentAlipayCertificate]: 'blank-noop',
    [APP_SETTING_KEYS.paymentAlipayMerchantPrivateKey]: 'blank-noop',
    [APP_SETTING_KEYS.paymentAlipayPublicKey]: 'blank-noop',
    [APP_SETTING_KEYS.paymentWechatApiV3Key]: 'blank-noop',
    [APP_SETTING_KEYS.paymentWechatMerchantPrivateKey]: 'blank-noop',
    [APP_SETTING_KEYS.paymentWechatPlatformCertificate]: 'blank-noop',
    [APP_SETTING_KEYS.paymentZpayMerchantKey]: 'blank-noop',
    [APP_SETTING_KEYS.storageS3SecretAccessKey]: 'blank-noop',
  };

const assertSecretKey: (key: AppSettingKey) => asserts key is AppSettingSecretKey = (key) => {
  if (!APP_SETTING_SECRET_KEYS.has(key)) {
    throw new Error(`App setting is not registered as a secret: ${key}`);
  }
};

const prefixFor = (key: AppSettingSecretKey) => `${APP_SETTING_SECRET_PREFIX}${key}:`;

const invalidCiphertext = () => new Error('Invalid encrypted app setting secret');

export const isAppSettingSecretKey = (key: string): key is AppSettingSecretKey =>
  APP_SETTING_SECRET_KEYS.has(key as AppSettingKey);

export const getAppSettingSecretWritePolicy = (
  key: AppSettingSecretKey,
): AppSettingSecretWritePolicy => APP_SETTING_SECRET_WRITE_POLICIES[key];

export const encryptAppSettingSecret = async (key: AppSettingKey, plaintext: string) => {
  assertSecretKey(key);
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const ciphertext = await gateKeeper.encrypt(plaintext);

  return `${prefixFor(key)}${ciphertext}`;
};

export const decryptAppSettingSecret = async (
  key: AppSettingKey,
  value: unknown,
): Promise<unknown> => {
  assertSecretKey(key);
  if (typeof value !== 'string' || !value.startsWith(APP_SETTING_SECRET_PREFIX)) return value;

  const prefix = prefixFor(key);
  if (!value.startsWith(prefix)) throw invalidCiphertext();

  const ciphertext = value.slice(prefix.length);
  if (!ciphertext) throw invalidCiphertext();

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const result = await gateKeeper.decrypt(ciphertext).catch(() => {
    throw invalidCiphertext();
  });
  if (!result.wasAuthentic) throw invalidCiphertext();

  return result.plaintext;
};

export const maskAppSettingSecret = (value: null | string | undefined): null | string => {
  if (!value) return null;
  if (value.length <= 4) return '****';

  return `****${value.slice(-4)}`;
};
