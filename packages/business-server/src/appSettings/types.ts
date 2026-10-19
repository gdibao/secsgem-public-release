import type { z } from 'zod';

import type {
  AppSettingDomain,
  AppSettingKey,
  AppSettingsSection,
} from '@/const/appSettingsRegistry';

export type { AppSettingsSection } from '@/const/appSettingsRegistry';

export type AppSettingLifecycle = 'active' | 'deprecated' | 'external';

export type AppSettingWriteSurface =
  | 'adminPptRouter.saveSettings'
  | 'adminSettingsRouter.mobilePublication'
  | 'adminSettingsRouter.setAppSetting';

export type AppSettingNormalizer =
  | 'about-links'
  | 'about-page'
  | 'brand-home-messenger-boolean'
  | 'brand-string'
  | 'composio-auth-config-json-string'
  | 'composio-boolean'
  | 'composio-string'
  | 'cron-audit-retention-integer'
  | 'cron-pending-order-expiry-integer'
  | 'cron-secret-string'
  | 'desktop-login-string'
  | 'desktop-update-boolean'
  | 'desktop-update-channel-enum'
  | 'desktop-update-interval-integer'
  | 'desktop-update-string'
  | 'expert-plaza-boolean'
  | 'expert-plaza-cards'
  | 'expert-plaza-categories'
  | 'expert-plaza-string'
  | 'fallback-string'
  | 'growth-boolean'
  | 'growth-nonnegative-integer'
  | 'growth-string'
  | 'help-menu'
  | 'memory-trigger-mode'
  | 'mobile-config'
  | 'mobile-config-publication'
  | 'model-policy-boolean'
  | 'model-policy-mode-enum'
  | 'model-policy-string'
  | 'model-policy-string-list'
  | 'module-app-runtime-boolean'
  | 'module-app-runtime-internal-url'
  | 'module-app-runtime-public-origin'
  | 'module-app-runtime-secret'
  | 'notification-boolean'
  | 'notification-event-defaults-record'
  | 'notification-retention-integer'
  | 'notification-string'
  | 'notification-type-enum'
  | 'operations-boolean'
  | 'operations-page-size-integer'
  | 'operations-string'
  | 'orders-boolean'
  | 'payment-boolean'
  | 'payment-cert-mode-enum'
  | 'payment-mode-enum'
  | 'payment-provider-enum'
  | 'payment-secret-string'
  | 'payment-string'
  | 'payment-url'
  | 'plans-faq-record-list'
  | 'ppt-api-key'
  | 'ppt-base-url'
  | 'ppt-boolean'
  | 'ppt-creator-version-enum'
  | 'ppt-daily-limit'
  | 'ppt-default-language'
  | 'ppt-string'
  | 'ppt-theme-color'
  | 'ppt-token-ttl-integer'
  | 'pricing-model-rules-array'
  | 'pricing-positive-number'
  | 'profile-avatar-presets'
  | 'profile-interest-areas'
  | 'recommendation-boolean'
  | 'recommendation-hot-sort'
  | 'recommendation-string-list'
  | 'recommendation-title-string'
  | 'referral-reward-integer'
  | 'runtime-model-string'
  | 'storage-boolean'
  | 'storage-file-path'
  | 'storage-optional-url'
  | 'storage-preview-expiry-integer'
  | 'storage-string'
  | 'user-global-settings-object';

export type AppSettingRuntimeConsumer = {
  id: string;
  sourcePath: string;
  symbol: string;
};

type AppSettingRuntimeConsumerKeyEvidenceSource = {
  consumerReferenceSymbol?: string;
  sourcePath?: string;
  sourceSymbol?: string;
};

export type AppSettingRuntimeConsumerContract = AppSettingRuntimeConsumer & {
  keyEvidence: AppSettingRuntimeConsumerKeyEvidenceSource &
    (
      | { kind: 'literal' }
      | { kind: 'prefix'; prefix: string }
      | {
          kind: 'registry';
          namespace: 'APP_SETTING_KEYS' | 'SETTING_KEYS';
        }
    );
  keys: AppSettingKey[];
};

export type AppSettingCatalogItem = {
  auditPolicy: 'none' | 'write' | 'write-redacted';
  cacheScopes: Array<'app-settings' | 'brand' | 'runtime' | 's3' | 'user-state'>;
  clearValue?: null;
  defaultSource: string;
  domain: AppSettingDomain;
  effectiveSource: string[];
  externalOwner?: string;
  key: AppSettingKey;
  lifecycle: AppSettingLifecycle;
  normalizer: AppSettingNormalizer;
  normalizeValue: (value: unknown) => unknown;
  ownership: 'application' | 'external';
  publicRuntime: boolean;
  requiredCapability: 'moduleAppRead' | 'moduleAppWrite' | 'systemRead' | 'systemWrite';
  runtimeConsumers: AppSettingRuntimeConsumer[];
  runtimeEffects: string[];
  section: AppSettingsSection;
  sensitive: boolean;
  valueSchema: z.ZodType<unknown>;
  writable: boolean;
  writeSurfaces: AppSettingWriteSurface[];
};

export type AppSettingValueDefinition = Pick<
  AppSettingCatalogItem,
  'clearValue' | 'normalizer' | 'normalizeValue' | 'valueSchema'
>;
