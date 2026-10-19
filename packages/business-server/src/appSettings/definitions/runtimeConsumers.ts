import { APP_SETTING_KEYS, type AppSettingKey } from '@/const/appSettingsRegistry';

import type {
  AppSettingLifecycle,
  AppSettingRuntimeConsumer,
  AppSettingRuntimeConsumerContract,
} from '../types';

const allKeys = Object.values(APP_SETTING_KEYS) as AppSettingKey[];
const keysWithPrefixes = (...prefixes: string[]) =>
  allKeys.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
const keysWithout = (keys: AppSettingKey[], excluded: AppSettingKey[]) => {
  const excludedKeys = new Set(excluded);
  return keys.filter((key) => !excludedKeys.has(key));
};

const appSettingsService = 'src/server/services/appSettings/index.ts';
const adminSettingsReadModel = 'packages/business-server/src/appSettings/adminReadModel.ts';
const adminSettingsPublicProcedures =
  'packages/business-server/src/appSettings/readers/publicProcedures.ts';
const adminSettingsRuntimeProcedures =
  'packages/business-server/src/appSettings/writers/runtimeProcedures.ts';
const mobilePublicationProcedures =
  'packages/business-server/src/appSettings/readers/mobilePublicationProcedures.ts';
const moduleAppRuntimeConfig = 'packages/business-server/src/module-apps/runtimeConfig.ts';

export const APP_SETTING_RUNTIME_CONSUMER_CONTRACTS = [
  {
    id: 'public-mobile-config',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.mobileConfig, APP_SETTING_KEYS.mobileConfigPublication],
    sourcePath: mobilePublicationProcedures,
    symbol: 'loadMobileConfigPublication',
  },
  {
    id: 'composio-runtime-config',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('composio.'),
    sourcePath: appSettingsService,
    symbol: 'getServerComposioConfig',
  },
  {
    id: 's3-runtime-config',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('storage.s3.'),
    sourcePath: appSettingsService,
    symbol: 'getServerFileS3Config',
  },
  {
    id: 'payment-runtime-config',
    keyEvidence: {
      consumerReferenceSymbol: 'PAYMENT_SETTING_KEYS',
      kind: 'registry',
      namespace: 'APP_SETTING_KEYS',
      sourcePath: 'src/server/services/payments/environmentFallbacks.ts',
      sourceSymbol: 'PAYMENT_ENVIRONMENT_FALLBACKS',
    },
    keys: keysWithPrefixes('payment.'),
    sourcePath: 'src/server/services/payments/config.ts',
    symbol: 'getServerPaymentConfig',
  },
  {
    id: 'module-app-runtime-config',
    keyEvidence: {
      kind: 'registry',
      namespace: 'APP_SETTING_KEYS',
    },
    keys: keysWithPrefixes('moduleApp.runtime.'),
    sourcePath: moduleAppRuntimeConfig,
    symbol: 'resolveModuleAppRuntimeConfig',
  },
  {
    id: 'maintenance-endpoint',
    keyEvidence: { kind: 'literal' },
    keys: keysWithPrefixes('cron.'),
    sourcePath: 'src/app/(backend)/api/admin/maintenance/route.ts',
    symbol: 'POST',
  },
  {
    id: 'desktop-release-legacy-authentication',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.cronSecret],
    sourcePath: 'src/app/(backend)/api/admin/desktop-release/auth.ts',
    symbol: 'resolveDesktopReleaseToken',
  },
  {
    id: 'manual-maintenance',
    keyEvidence: { kind: 'registry', namespace: 'SETTING_KEYS' },
    keys: [
      APP_SETTING_KEYS.cronAuditRetentionDays,
      APP_SETTING_KEYS.cronPendingOrderExpiryDays,
      APP_SETTING_KEYS.notificationRetentionDays,
    ],
    sourcePath: adminSettingsRuntimeProcedures,
    symbol: 'runMaintenance',
  },
  {
    id: 'docmee-ppt-runtime',
    keyEvidence: {
      kind: 'prefix',
      prefix: 'docmee.ppt.',
      sourceSymbol: 'DOCMEE_SETTING_KEYS',
    },
    keys: keysWithPrefixes('docmee.ppt.'),
    sourcePath: 'src/server/services/docmee/index.ts',
    symbol: 'readSettings',
  },
  {
    id: 'public-recommendations',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('recommendation.'),
    sourcePath: adminSettingsReadModel,
    symbol: 'buildRecommendationSettings',
  },
  {
    id: 'public-operations',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithout(keysWithPrefixes('community.'), [
      APP_SETTING_KEYS.communityForkAndChatLabel,
      APP_SETTING_KEYS.communitySkillUseButtonLabel,
    ]),
    sourcePath: adminSettingsReadModel,
    symbol: 'buildOperationsSettings',
  },
  {
    id: 'public-growth',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('auth.', 'onboarding.', 'upload.'),
    sourcePath: adminSettingsReadModel,
    symbol: 'buildGrowthSettings',
  },
  {
    id: 'referral-reward-runtime',
    keyEvidence: { kind: 'literal', sourceSymbol: 'REFERRAL_REWARD_CREDITS_KEY' },
    keys: [APP_SETTING_KEYS.referralRewardCredits],
    sourcePath: 'packages/database/src/models/commercial.ts',
    symbol: 'resolveReferralRewardCredits',
  },
  {
    id: 'public-expert-plaza',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('expertPlaza.'),
    sourcePath: adminSettingsReadModel,
    symbol: 'buildExpertPlazaSettings',
  },
  {
    id: 'public-profile-options',
    keyEvidence: { kind: 'registry', namespace: 'SETTING_KEYS' },
    keys: keysWithPrefixes('profile.'),
    sourcePath: adminSettingsPublicProcedures,
    symbol: 'getPublicProfileOptions',
  },
  {
    id: 'public-notification-config',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithout(keysWithPrefixes('notification.'), [
      APP_SETTING_KEYS.notificationRetentionDays,
    ]),
    sourcePath: adminSettingsReadModel,
    symbol: 'buildNotificationSettings',
  },
  {
    id: 'public-desktop-update',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithout(keysWithPrefixes('desktop.'), [
      APP_SETTING_KEYS.desktopOssAccessKeyId,
      APP_SETTING_KEYS.desktopOssAccessKeySecret,
      APP_SETTING_KEYS.desktopOssBucket,
      APP_SETTING_KEYS.desktopOssEndpoint,
      APP_SETTING_KEYS.desktopOssPath,
    ]),
    sourcePath: adminSettingsReadModel,
    symbol: 'buildDesktopSettings',
  },
  {
    id: 'public-help-menu',
    keyEvidence: { kind: 'registry', namespace: 'SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.helpMenuItems],
    sourcePath: adminSettingsPublicProcedures,
    symbol: 'getPublicHelpMenu',
  },
  {
    id: 'runtime-help-customization',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.communitySkillUseButtonLabel, APP_SETTING_KEYS.helpMenuItems],
    sourcePath: appSettingsService,
    symbol: 'getServerPublicCustomizationConfig',
  },
  {
    id: 'public-about-links',
    keyEvidence: { kind: 'registry', namespace: 'SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.aboutLinks, APP_SETTING_KEYS.aboutLogoUrl],
    sourcePath: adminSettingsPublicProcedures,
    symbol: 'getPublicAboutLinks',
  },
  {
    id: 'public-about-page',
    keyEvidence: { kind: 'registry', namespace: 'SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.aboutPage],
    sourcePath: adminSettingsPublicProcedures,
    symbol: 'getPublicAboutPage',
  },
  {
    id: 'public-brand',
    keyEvidence: { kind: 'registry', namespace: 'SETTING_KEYS' },
    keys: [
      ...keysWithPrefixes('brand.', 'home.', 'sidebar.'),
      APP_SETTING_KEYS.communityForkAndChatLabel,
      APP_SETTING_KEYS.defaultSkillName,
    ],
    sourcePath: adminSettingsPublicProcedures,
    symbol: 'getPublicBrand',
  },
  {
    id: 'default-agent-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('defaultAgent.'),
    sourcePath: appSettingsService,
    symbol: 'getServerDefaultAgentSettingOverrides',
  },
  {
    id: 'default-generation-model-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('defaultImage.', 'defaultVideo.'),
    sourcePath: appSettingsService,
    symbol: 'getServerDefaultGenerationModelSettingOverrides',
  },
  {
    id: 'vector-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('vector.'),
    sourcePath: appSettingsService,
    symbol: 'getServerVectorSettingOverrides',
  },
  {
    id: 'memory-extraction-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithout(keysWithPrefixes('memory.'), [APP_SETTING_KEYS.memoryUserMemoryTriggerMode]),
    sourcePath: appSettingsService,
    symbol: 'getServerMemoryExtractionSettingOverrides',
  },
  {
    id: 'user-memory-trigger-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.memoryUserMemoryTriggerMode],
    sourcePath: 'apps/server/src/routers/lambda/userMemory.ts',
    symbol: 'resolveUserMemoryTriggerMode',
  },
  {
    id: 'user-defaults-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.userGlobalSettingsDefaults],
    sourcePath: appSettingsService,
    symbol: 'getServerUserGlobalSettingsDefaults',
  },
  {
    id: 'model-policy-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: keysWithPrefixes('model.policy.'),
    sourcePath: appSettingsService,
    symbol: 'getServerModelPolicyConfig',
  },
  {
    id: 'plan-faq-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.plansFaqItems],
    sourcePath: 'packages/business-server/src/lambda-routers/subscription.ts',
    symbol: 'listPlanFaq',
  },
  {
    id: 'generation-pricing-runtime',
    keyEvidence: { kind: 'registry', namespace: 'APP_SETTING_KEYS' },
    keys: [APP_SETTING_KEYS.pricingCreditMultiplier, APP_SETTING_KEYS.pricingModelRules],
    sourcePath: 'packages/business-server/src/generationBilling.ts',
    symbol: 'resolveGenerationPricingMultiplier',
  },
] as const satisfies AppSettingRuntimeConsumerContract[];

export const getAppSettingRuntimeConsumers = (
  key: AppSettingKey,
  lifecycle: AppSettingLifecycle,
): AppSettingRuntimeConsumer[] => {
  if (lifecycle !== 'active') return [];

  return APP_SETTING_RUNTIME_CONSUMER_CONTRACTS.filter((contract) =>
    (contract.keys as readonly AppSettingKey[]).includes(key),
  ).map(({ id, sourcePath, symbol }) => ({ id, sourcePath, symbol }));
};
