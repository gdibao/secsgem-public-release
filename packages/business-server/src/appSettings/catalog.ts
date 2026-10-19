import {
  APP_SETTING_KEYS,
  type AppSettingKey,
  getAppSettingsSectionForKey,
  listAppSettingRegistryItems,
} from '@/const/appSettingsRegistry';

import { getAppSettingSourceMetadata } from './definitions/metadata';
import { getAppSettingRuntimeConsumers } from './definitions/runtimeConsumers';
import { getAppSettingValueDefinition } from './definitions/valueDefinitions';
import type {
  AppSettingCatalogItem,
  AppSettingNormalizer,
  AppSettingsSection,
  AppSettingWriteSurface,
} from './types';

export { APP_SETTING_RUNTIME_CONSUMER_CONTRACTS } from './definitions/runtimeConsumers';
export type {
  AppSettingCatalogItem,
  AppSettingLifecycle,
  AppSettingRuntimeConsumer,
  AppSettingRuntimeConsumerContract,
  AppSettingsSection,
  AppSettingWriteSurface,
} from './types';

export const APP_SETTING_WRITE_SURFACES = {
  genericAdmin: 'adminSettingsRouter.setAppSetting',
  mobilePublication: 'adminSettingsRouter.mobilePublication',
  pptAdmin: 'adminPptRouter.saveSettings',
} as const satisfies Record<string, AppSettingWriteSurface>;

const EXTERNAL_SETTING_OWNERS: Partial<Record<AppSettingKey, string>> = {
  [APP_SETTING_KEYS.desktopOssAccessKeyId]: 'CI/GitHub Secrets',
  [APP_SETTING_KEYS.desktopOssAccessKeySecret]: 'CI/GitHub Secrets',
  [APP_SETTING_KEYS.desktopOssBucket]: 'CI/GitHub Secrets',
  [APP_SETTING_KEYS.desktopOssEndpoint]: 'CI/GitHub Secrets',
  [APP_SETTING_KEYS.desktopOssPath]: 'CI/GitHub Secrets',
};

const DEPRECATED_SETTING_KEYS = new Set<AppSettingKey>([APP_SETTING_KEYS.ordersManagementEnabled]);

const writeSurfacesFor = (
  key: AppSettingKey,
  lifecycle: AppSettingCatalogItem['lifecycle'],
): AppSettingWriteSurface[] => {
  if (lifecycle !== 'active') return [];
  if (key.startsWith('docmee.')) return [APP_SETTING_WRITE_SURFACES.pptAdmin];
  if (key === APP_SETTING_KEYS.mobileConfig || key === APP_SETTING_KEYS.mobileConfigPublication) {
    return [APP_SETTING_WRITE_SURFACES.mobilePublication];
  }

  return [APP_SETTING_WRITE_SURFACES.genericAdmin];
};

const runtimeEffectsFor = (key: AppSettingKey, cacheScopes: AppSettingCatalogItem['cacheScopes']) =>
  Array.from(
    new Set([
      ...cacheScopes.filter((scope) => scope !== 'app-settings'),
      ...(key === APP_SETTING_KEYS.defaultSkillName ||
      key === APP_SETTING_KEYS.communityForkAndChatLabel ||
      key === APP_SETTING_KEYS.communitySkillUseButtonLabel
        ? ['brand']
        : []),
    ]),
  );

export const APP_SETTINGS_CATALOG: AppSettingCatalogItem[] = listAppSettingRegistryItems().map(
  (registryItem) => {
    const section = getAppSettingsSectionForKey(registryItem.key);
    const externalOwner = EXTERNAL_SETTING_OWNERS[registryItem.key];
    const lifecycle = externalOwner
      ? 'external'
      : DEPRECATED_SETTING_KEYS.has(registryItem.key)
        ? 'deprecated'
        : 'active';
    const sourceMetadata = getAppSettingSourceMetadata(registryItem.key, lifecycle);
    const valueDefinition = getAppSettingValueDefinition(registryItem.key);
    const writeSurfaces = writeSurfacesFor(registryItem.key, lifecycle);
    const writable = writeSurfaces.length > 0;

    return {
      auditPolicy: writable ? (registryItem.sensitive ? 'write-redacted' : 'write') : 'none',
      cacheScopes: registryItem.cacheScopes,
      defaultSource: sourceMetadata.defaultSource,
      domain: registryItem.domain,
      effectiveSource: sourceMetadata.effectiveSource,
      ...(externalOwner ? { externalOwner } : {}),
      key: registryItem.key,
      lifecycle,
      ...valueDefinition,
      ownership: externalOwner ? 'external' : 'application',
      publicRuntime: registryItem.publicRuntime,
      requiredCapability:
        registryItem.domain === 'module-apps'
          ? writable
            ? 'moduleAppWrite'
            : 'moduleAppRead'
          : writable
            ? 'systemWrite'
            : 'systemRead',
      runtimeConsumers: getAppSettingRuntimeConsumers(registryItem.key, lifecycle),
      runtimeEffects: runtimeEffectsFor(registryItem.key, registryItem.cacheScopes),
      section,
      sensitive: registryItem.sensitive,
      writable,
      writeSurfaces,
    };
  },
);

export const APP_SETTINGS_CATALOG_BY_KEY = new Map<string, AppSettingCatalogItem>(
  APP_SETTINGS_CATALOG.map((item) => [item.key, item]),
);

export const getAppSettingCatalogItem = (key: string) => APP_SETTINGS_CATALOG_BY_KEY.get(key);

export const WRITABLE_APP_SETTING_KEYS = APP_SETTINGS_CATALOG.filter((item) => item.writable).map(
  (item) => item.key,
);

export const GENERIC_WRITABLE_APP_SETTING_KEYS = APP_SETTINGS_CATALOG.filter((item) =>
  item.writeSurfaces.includes(APP_SETTING_WRITE_SURFACES.genericAdmin),
).map((item) => item.key);

export const PPT_WRITABLE_APP_SETTING_KEYS = APP_SETTINGS_CATALOG.filter((item) =>
  item.writeSurfaces.includes(APP_SETTING_WRITE_SURFACES.pptAdmin),
).map((item) => item.key);

export const SENSITIVE_APP_SETTING_KEYS = APP_SETTINGS_CATALOG.filter((item) => item.sensitive).map(
  (item) => item.key,
);

const canonicalSectionKeys = Object.fromEntries(
  Array.from(new Set(APP_SETTINGS_CATALOG.map((item) => item.section))).map((section) => [
    section,
    APP_SETTINGS_CATALOG.filter((item) => item.section === section).map((item) => item.key),
  ]),
) as Partial<Record<AppSettingsSection, AppSettingKey[]>>;

export const APP_SETTINGS_SECTION_KEYS = {
  ...canonicalSectionKeys,
  // Existing clients can still request the former aggregate section while new pages
  // load and save one owner domain at a time.
  'system-defaults': [
    ...(canonicalSectionKeys['ai-runtime-defaults'] ?? []),
    ...(canonicalSectionKeys.integrations ?? []),
    ...(canonicalSectionKeys['user-defaults'] ?? []),
  ],
} as Record<AppSettingsSection, AppSettingKey[]>;

export const APP_SETTINGS_NORMALIZATION_KEYS = Object.fromEntries(
  Array.from(new Set(APP_SETTINGS_CATALOG.map((item) => item.normalizer))).map((normalizer) => [
    normalizer,
    APP_SETTINGS_CATALOG.filter((item) => item.normalizer === normalizer).map((item) => item.key),
  ]),
) as Record<AppSettingNormalizer, AppSettingKey[]>;

export const listAppSettingsCatalogItems = () => [...APP_SETTINGS_CATALOG];

export const isSensitiveCatalogAppSettingKey = (key: string) =>
  getAppSettingCatalogItem(key)?.sensitive === true;

const getWriteDefinition = (key: string, writeSurface: AppSettingWriteSurface) => {
  const definition = getAppSettingCatalogItem(key);
  if (!definition?.writeSurfaces.includes(writeSurface)) {
    throw new Error(`App setting is not writable through ${writeSurface}: ${key}`);
  }

  return definition;
};

export const getAppSettingWriteSchema = (key: string, writeSurface: AppSettingWriteSurface) =>
  getWriteDefinition(key, writeSurface).valueSchema;

export const normalizeAppSettingValue = (
  key: string,
  value: unknown,
  writeSurface: AppSettingWriteSurface = APP_SETTING_WRITE_SURFACES.genericAdmin,
) => {
  const definition = getWriteDefinition(key, writeSurface);
  if (value === null && definition.clearValue === null) return null;

  return definition.normalizeValue(value);
};
