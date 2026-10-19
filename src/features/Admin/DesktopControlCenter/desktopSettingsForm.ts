import type { AdminSettingsSectionData } from '@/services/adminCommercial';

import { DESKTOP_UPDATE_SETTING_KEYS as SETTING_KEYS } from '../adminDesktopUpdateSettings';

type DesktopSettingsData = AdminSettingsSectionData<'desktop-update'>;
type SettingUpdate = { key: string; value: unknown };
type DesktopDirtyFields = ReadonlySet<keyof DesktopSettingsValues>;

export const isDesktopFormValidationError = (error: unknown) =>
  typeof error === 'object' && error !== null && 'errorFields' in error;

export interface DesktopSettingsValues {
  autoCheck: boolean;
  channel: string;
  checkInterval: number;
  currentVersion: string;
  downloadLabel: string;
  downloadUrl: string;
  loginCloudButtonLabel: string;
  loginDescription: string;
  loginFooterText: string;
  loginLogoUrl: string;
  loginTitle: string;
  loginWindowTitle: string;
  ossBucket: string;
  ossCredentialsConfigured: boolean;
  ossEndpoint: string;
  ossPath: string;
  releaseNotes: string;
  serverUrl: string;
}

export const getDesktopSettingsValues = (data?: DesktopSettingsData): DesktopSettingsValues => ({
  autoCheck: data?.desktopUpdateConfig?.autoCheck ?? true,
  channel: data?.desktopUpdateConfig?.channel || 'stable',
  checkInterval: data?.desktopUpdateConfig?.checkInterval ?? 60,
  currentVersion: data?.desktopUpdateConfig?.currentVersion || '',
  downloadLabel: data?.desktopDownloadLabel || '',
  downloadUrl: data?.desktopDownloadUrl || '',
  loginCloudButtonLabel: data?.desktopLoginConfig?.cloudButtonLabel || '',
  loginDescription: data?.desktopLoginConfig?.description || '',
  loginFooterText: data?.desktopLoginConfig?.footerText || '',
  loginLogoUrl: data?.desktopLoginConfig?.logoUrl || '',
  loginTitle: data?.desktopLoginConfig?.title || '',
  loginWindowTitle: data?.desktopLoginConfig?.windowTitle || '',
  ossBucket: data?.desktopOssConfig?.bucket || '',
  ossCredentialsConfigured: data?.desktopOssConfig?.credentialsConfigured ?? false,
  ossEndpoint: data?.desktopOssConfig?.endpoint || '',
  ossPath: data?.desktopOssConfig?.path || 'releases',
  releaseNotes: data?.desktopUpdateConfig?.releaseNotes || '',
  serverUrl: data?.desktopUpdateConfig?.serverUrl || '',
});

const changedText = (
  updates: SettingUpdate[],
  initial: DesktopSettingsValues,
  next: DesktopSettingsValues,
  field: keyof DesktopSettingsValues,
  key: string,
  dirtyFields?: DesktopDirtyFields,
) => {
  if (dirtyFields && !dirtyFields.has(field)) return;
  const value = String(next[field] ?? '').trim();
  if (value !== String(initial[field] ?? '')) updates.push({ key, value });
};

export const buildUpdateSettingsUpdates = (
  initial: DesktopSettingsValues,
  next: DesktopSettingsValues,
  dirtyFields?: DesktopDirtyFields,
): SettingUpdate[] => {
  const updates: SettingUpdate[] = [];
  changedText(
    updates,
    initial,
    next,
    'serverUrl',
    SETTING_KEYS.desktopUpdateServerUrl,
    dirtyFields,
  );
  if ((!dirtyFields || dirtyFields.has('channel')) && next.channel !== initial.channel) {
    updates.push({ key: SETTING_KEYS.desktopUpdateChannel, value: next.channel });
  }
  if ((!dirtyFields || dirtyFields.has('autoCheck')) && next.autoCheck !== initial.autoCheck) {
    updates.push({ key: SETTING_KEYS.desktopUpdateAutoCheck, value: next.autoCheck });
  }
  if (
    (!dirtyFields || dirtyFields.has('checkInterval')) &&
    next.checkInterval !== initial.checkInterval
  ) {
    updates.push({ key: SETTING_KEYS.desktopUpdateCheckInterval, value: next.checkInterval });
  }
  changedText(
    updates,
    initial,
    next,
    'currentVersion',
    SETTING_KEYS.desktopUpdateCurrentVersion,
    dirtyFields,
  );
  changedText(
    updates,
    initial,
    next,
    'releaseNotes',
    SETTING_KEYS.desktopUpdateReleaseNotes,
    dirtyFields,
  );
  return updates;
};

export const buildDistributionUpdates = (
  initial: DesktopSettingsValues,
  next: DesktopSettingsValues,
  dirtyFields?: DesktopDirtyFields,
): SettingUpdate[] => {
  const updates: SettingUpdate[] = [];
  changedText(updates, initial, next, 'downloadUrl', SETTING_KEYS.desktopDownloadUrl, dirtyFields);
  changedText(
    updates,
    initial,
    next,
    'downloadLabel',
    SETTING_KEYS.desktopDownloadLabel,
    dirtyFields,
  );
  return updates;
};

export const buildBrandUpdates = (
  initial: DesktopSettingsValues,
  next: DesktopSettingsValues,
  dirtyFields?: DesktopDirtyFields,
): SettingUpdate[] => {
  const updates: SettingUpdate[] = [];
  changedText(
    updates,
    initial,
    next,
    'loginWindowTitle',
    SETTING_KEYS.desktopLoginWindowTitle,
    dirtyFields,
  );
  changedText(
    updates,
    initial,
    next,
    'loginLogoUrl',
    SETTING_KEYS.desktopLoginLogoUrl,
    dirtyFields,
  );
  changedText(updates, initial, next, 'loginTitle', SETTING_KEYS.desktopLoginTitle, dirtyFields);
  changedText(
    updates,
    initial,
    next,
    'loginDescription',
    SETTING_KEYS.desktopLoginDescription,
    dirtyFields,
  );
  changedText(
    updates,
    initial,
    next,
    'loginCloudButtonLabel',
    SETTING_KEYS.desktopLoginCloudButtonLabel,
    dirtyFields,
  );
  changedText(
    updates,
    initial,
    next,
    'loginFooterText',
    SETTING_KEYS.desktopLoginFooterText,
    dirtyFields,
  );
  return updates;
};
