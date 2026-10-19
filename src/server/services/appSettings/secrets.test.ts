// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_SETTING_KEYS } from './index';
import {
  APP_SETTING_SECRET_PREFIX,
  decryptAppSettingSecret,
  encryptAppSettingSecret,
} from './secrets';

const TEST_KEY_VAULTS_SECRET = Buffer.alloc(32, 7).toString('base64');

describe('app setting secret codec', () => {
  beforeEach(() => {
    process.env.KEY_VAULTS_SECRET = TEST_KEY_VAULTS_SECRET;
  });

  afterEach(() => {
    delete process.env.KEY_VAULTS_SECRET;
  });

  it('encrypts authenticated ciphertext with a versioned key-specific prefix', async () => {
    const encrypted = await encryptAppSettingSecret(
      APP_SETTING_KEYS.composioApiKey,
      'composio-secret',
    );

    expect(encrypted).toMatch(
      new RegExp(`^${APP_SETTING_SECRET_PREFIX}${APP_SETTING_KEYS.composioApiKey}:`),
    );
    expect(encrypted).not.toContain('composio-secret');
    await expect(decryptAppSettingSecret(APP_SETTING_KEYS.composioApiKey, encrypted)).resolves.toBe(
      'composio-secret',
    );
  });

  it('encrypts and decrypts the Module Runtime internal token as a key-bound secret', async () => {
    const encrypted = await encryptAppSettingSecret(
      APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
      'runtime-secret',
    );

    expect(encrypted).toMatch(
      new RegExp(`^${APP_SETTING_SECRET_PREFIX}${APP_SETTING_KEYS.moduleAppRuntimeInternalToken}:`),
    );
    expect(encrypted).not.toContain('runtime-secret');
    await expect(
      decryptAppSettingSecret(APP_SETTING_KEYS.moduleAppRuntimeInternalToken, encrypted),
    ).resolves.toBe('runtime-secret');
  });

  it('keeps historical plaintext and non-string values readable', async () => {
    await expect(
      decryptAppSettingSecret(APP_SETTING_KEYS.cronSecret, 'legacy-secret'),
    ).resolves.toBe('legacy-secret');
    await expect(decryptAppSettingSecret(APP_SETTING_KEYS.cronSecret, 42)).resolves.toBe(42);
  });

  it('fails closed for invalid or cross-key ciphertext', async () => {
    const encrypted = await encryptAppSettingSecret(APP_SETTING_KEYS.cronSecret, 'cron-secret');
    const replacement = encrypted.endsWith('0') ? '1' : '0';
    const tampered = `${encrypted.slice(0, -1)}${replacement}`;

    await expect(decryptAppSettingSecret(APP_SETTING_KEYS.cronSecret, tampered)).rejects.toThrow(
      'Invalid encrypted app setting secret',
    );
    await expect(
      decryptAppSettingSecret(APP_SETTING_KEYS.composioApiKey, encrypted),
    ).rejects.toThrow('Invalid encrypted app setting secret');
  });

  it('rejects encryption when KEY_VAULTS_SECRET is unavailable', async () => {
    delete process.env.KEY_VAULTS_SECRET;

    await expect(
      encryptAppSettingSecret(APP_SETTING_KEYS.storageS3SecretAccessKey, 's3-secret'),
    ).rejects.toThrow('KEY_VAULTS_SECRET');
  });
});
