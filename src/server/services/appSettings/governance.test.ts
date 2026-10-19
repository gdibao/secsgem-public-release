import { describe, expect, it } from 'vitest';

import {
  APP_SETTING_KEYS,
  APP_SETTING_REGISTRY,
  hasSecretLikeAppSettingKeyName,
  listAppSettingRegistryItems,
} from '@/const/appSettingsRegistry';

import { buildAppSettingsGovernance, isUnknownAppSettingKey } from './governance';

describe('buildAppSettingsGovernance', () => {
  it('reports registered, persisted, unknown and sensitive setting counts', () => {
    const result = buildAppSettingsGovernance([
      { key: APP_SETTING_KEYS.brandName, value: 'ComHub' },
      { key: APP_SETTING_KEYS.storageS3SecretAccessKey, value: 'secret-value' },
      { key: 'legacy.unknown.key', value: 'legacy-value' },
    ]);

    expect(result.summary.persistedCount).toBe(3);
    expect(result.summary.unknownCount).toBe(1);
    expect(result.summary.sensitiveConfiguredCount).toBe(1);
    expect(result.unknownKeys).toEqual([{ key: 'legacy.unknown.key' }]);
    expect(result.sensitiveConfiguredKeys).toEqual([
      expect.objectContaining({
        key: APP_SETTING_KEYS.storageS3SecretAccessKey,
        sensitive: true,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-value');
    expect(JSON.stringify(result)).not.toContain('legacy-value');
  });

  it('groups registered settings by domain and cache scope with deterministic ordering', () => {
    const result = buildAppSettingsGovernance([
      { key: APP_SETTING_KEYS.brandName, value: 'ComHub' },
      { key: APP_SETTING_KEYS.defaultAgentModel, value: 'gpt-5.5' },
      { key: APP_SETTING_KEYS.storageS3Bucket, value: 'bucket' },
    ]);

    expect(result.domainGroups.map((group) => group.domain)).toEqual(
      [...result.domainGroups.map((group) => group.domain)].sort(),
    );
    expect(result.cacheScopeGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cacheScope: 'app-settings' }),
        expect.objectContaining({ cacheScope: 'brand' }),
        expect.objectContaining({ cacheScope: 'runtime' }),
        expect.objectContaining({ cacheScope: 's3' }),
      ]),
    );
  });

  it('marks unknown keys and includes readable group labels', () => {
    const result = buildAppSettingsGovernance([
      { key: APP_SETTING_KEYS.brandName, value: 'ComHub' },
      { key: 'legacy.unknown.key', value: true },
    ]);

    expect(isUnknownAppSettingKey(APP_SETTING_KEYS.brandName)).toBe(false);
    expect(isUnknownAppSettingKey('legacy.unknown.key')).toBe(true);
    expect(result.unknownKeys).toEqual([{ key: 'legacy.unknown.key' }]);
    expect(result.domainGroups[0]).toHaveProperty('label');
    expect(result.cacheScopeGroups[0]).toHaveProperty('label');
  });

  it('requires every app setting key to declare governance metadata', () => {
    const registeredKeys = Object.values(APP_SETTING_KEYS).sort();

    expect(Object.keys(APP_SETTING_REGISTRY).sort()).toEqual(registeredKeys);

    for (const item of listAppSettingRegistryItems()) {
      expect(item.key).toBeTruthy();
      expect(item.domain).toBeTruthy();
      expect(item.cacheScopes.length).toBeGreaterThan(0);
      expect(item.cacheScopes).toContain('app-settings');
      expect(typeof item.sensitive).toBe('boolean');
      expect(typeof item.publicRuntime).toBe('boolean');
      if (item.publicRuntime) expect(item.sensitive).toBe(false);
    }
  });

  it('keeps secret-like setting names out of public runtime settings', () => {
    expect(hasSecretLikeAppSettingKeyName(APP_SETTING_KEYS.storageS3SecretAccessKey)).toBe(true);
    expect(hasSecretLikeAppSettingKeyName(APP_SETTING_KEYS.desktopOssAccessKeySecret)).toBe(true);
    expect(hasSecretLikeAppSettingKeyName(APP_SETTING_KEYS.composioApiKey)).toBe(true);
    expect(hasSecretLikeAppSettingKeyName(APP_SETTING_KEYS.desktopDownloadUrl)).toBe(false);

    for (const item of listAppSettingRegistryItems()) {
      expect({
        key: item.key,
        publicRuntime: item.publicRuntime,
        secretLike: hasSecretLikeAppSettingKeyName(item.key),
      }).not.toMatchObject({ publicRuntime: true, secretLike: true });
    }
  });
});
