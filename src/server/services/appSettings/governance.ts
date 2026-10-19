import {
  type AppSettingCatalogItem,
  getAppSettingCatalogItem,
  listAppSettingsCatalogItems,
} from '@/business/server/appSettings/catalog';
import type { AppSettingDomain } from '@/const/appSettingsRegistry';

type AppSettingsGovernanceInputRow = {
  key: string;
  updatedAt?: Date | null;
  value?: unknown;
};

type AppSettingsGovernanceRegisteredRow = Pick<
  AppSettingCatalogItem,
  'cacheScopes' | 'domain' | 'key' | 'publicRuntime' | 'sensitive'
> & {
  configured: boolean;
  hasValue: boolean;
};

export type AppSettingsGovernance = {
  cacheScopeGroups: Array<{
    cacheScope: string;
    configuredCount: number;
    label: string;
    registeredCount: number;
  }>;
  domainGroups: Array<{
    configuredCount: number;
    domain: AppSettingDomain;
    label: string;
    registeredCount: number;
    sensitiveConfiguredCount: number;
  }>;
  registeredSettings: AppSettingsGovernanceRegisteredRow[];
  sensitiveConfiguredKeys: AppSettingsGovernanceRegisteredRow[];
  summary: {
    configuredRegisteredCount: number;
    persistedCount: number;
    publicRuntimeConfiguredCount: number;
    registeredCount: number;
    sensitiveConfiguredCount: number;
    unknownCount: number;
  };
  unknownKeys: Array<{ key: string }>;
};

const DOMAIN_LABELS: Record<AppSettingDomain, string> = {
  'about': 'About',
  'brand': 'Brand',
  'client': 'Client',
  'composio': 'Composio',
  'content': 'Content',
  'growth': 'Growth',
  'model': 'Model',
  'module-apps': 'Module apps',
  'notification': 'Notification',
  'operations': 'Operations',
  'payments': 'Payments',
  'pricing': 'Pricing',
  'storage': 'Storage',
  'system': 'System',
  'user-defaults': 'User defaults',
};

const CACHE_SCOPE_LABELS: Record<string, string> = {
  'app-settings': 'App settings',
  'brand': 'Brand runtime',
  'runtime': 'Model/runtime',
  's3': 'S3 runtime',
  'user-state': 'User state',
};

const hasPersistedValue = (value: unknown) => value !== null && value !== undefined && value !== '';

export const isUnknownAppSettingKey = (key: string) => !getAppSettingCatalogItem(key);

export const buildAppSettingsGovernance = (
  rows: AppSettingsGovernanceInputRow[],
): AppSettingsGovernance => {
  const persistedByKey = new Map(rows.map((row) => [row.key, row]));
  const registeredSettings = listAppSettingsCatalogItems().map((item) => {
    const row = persistedByKey.get(item.key);

    return {
      cacheScopes: item.cacheScopes,
      configured: Boolean(row),
      domain: item.domain,
      hasValue: row ? hasPersistedValue(row.value) : false,
      key: item.key,
      publicRuntime: item.publicRuntime,
      sensitive: item.sensitive,
    };
  });
  const unknownKeys = rows
    .filter((row) => isUnknownAppSettingKey(row.key))
    .map((row) => ({ key: row.key }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const sensitiveConfiguredKeys = registeredSettings.filter(
    (item) => item.configured && item.sensitive,
  );
  const domainGroups = Array.from(
    registeredSettings
      .reduce((groups, item) => {
        const current = groups.get(item.domain) ?? {
          configuredCount: 0,
          domain: item.domain,
          label: DOMAIN_LABELS[item.domain],
          registeredCount: 0,
          sensitiveConfiguredCount: 0,
        };

        current.registeredCount += 1;
        if (item.configured) current.configuredCount += 1;
        if (item.configured && item.sensitive) current.sensitiveConfiguredCount += 1;
        groups.set(item.domain, current);

        return groups;
      }, new Map<AppSettingDomain, AppSettingsGovernance['domainGroups'][number]>())
      .values(),
  ).sort((a, b) => a.domain.localeCompare(b.domain));
  const cacheScopeGroups = Array.from(
    registeredSettings
      .reduce((groups, item) => {
        for (const cacheScope of item.cacheScopes) {
          const current = groups.get(cacheScope) ?? {
            cacheScope,
            configuredCount: 0,
            label: CACHE_SCOPE_LABELS[cacheScope] ?? cacheScope,
            registeredCount: 0,
          };

          current.registeredCount += 1;
          if (item.configured) current.configuredCount += 1;
          groups.set(cacheScope, current);
        }

        return groups;
      }, new Map<string, AppSettingsGovernance['cacheScopeGroups'][number]>())
      .values(),
  ).sort((a, b) => a.cacheScope.localeCompare(b.cacheScope));

  return {
    cacheScopeGroups,
    domainGroups,
    registeredSettings,
    sensitiveConfiguredKeys,
    summary: {
      configuredRegisteredCount: registeredSettings.filter((item) => item.configured).length,
      persistedCount: rows.length,
      publicRuntimeConfiguredCount: registeredSettings.filter(
        (item) => item.configured && item.publicRuntime,
      ).length,
      registeredCount: registeredSettings.length,
      sensitiveConfiguredCount: sensitiveConfiguredKeys.length,
      unknownCount: unknownKeys.length,
    },
    unknownKeys,
  };
};
