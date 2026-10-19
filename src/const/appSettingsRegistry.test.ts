import { describe, expect, it } from 'vitest';

import {
  APP_SETTING_KEYS,
  APP_SETTINGS_SECTIONS,
  getAppSettingsSectionForKey,
} from './appSettingsRegistry';

describe('app settings section ownership', () => {
  it('assigns defaults to their canonical admin owner without changing storage ownership', () => {
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.userGlobalSettingsDefaults)).toBe(
      'user-defaults',
    );
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.profileAvatarPresets)).toBe(
      'user-defaults',
    );
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.profileInterestAreas)).toBe(
      'user-defaults',
    );
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.plansFaqItems)).toBe('plans');
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.vectorEmbeddingModel)).toBe(
      'ai-runtime-defaults',
    );
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.memoryUserMemoryEmbeddingModel)).toBe(
      'ai-runtime-defaults',
    );
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.composioApiKey)).toBe('integrations');
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.storageS3PublicDomain)).toBe(
      'file-storage',
    );
  });

  it('assigns mobile configuration exclusively to the mobile section', () => {
    expect(APP_SETTINGS_SECTIONS).toContain('mobile');
    expect(getAppSettingsSectionForKey(APP_SETTING_KEYS.mobileConfig)).toBe('mobile');
  });

  it('assigns every runtime control exclusively to the module runtime section', () => {
    expect(APP_SETTINGS_SECTIONS).toContain('module-runtime');
    for (const key of [
      APP_SETTING_KEYS.moduleAppExecutionEnabled,
      APP_SETTING_KEYS.moduleAppPublicExecutionEnabled,
      APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
      APP_SETTING_KEYS.moduleAppRuntimeInternalUrl,
      APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
      APP_SETTING_KEYS.moduleAppRuntimePublicOrigin,
      APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled,
      APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
    ]) {
      expect(getAppSettingsSectionForKey(key)).toBe('module-runtime');
    }
  });
});
