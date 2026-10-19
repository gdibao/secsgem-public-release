import { aiUsagePricingRulesSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { normalizeAboutLinksConfig, normalizeAboutPageConfig } from '@/const/aboutLinks';
import { APP_SETTING_KEYS, type AppSettingKey } from '@/const/appSettingsRegistry';
import { normalizeAvatarPresets } from '@/const/avatarPresets';
import { normalizePlanFaqSettings } from '@/const/billingPresentation';
import {
  normalizeDesktopDownloadUrl,
  normalizeDesktopUpdateServerUrl,
} from '@/const/desktopUpdate';
import { normalizeExpertPlazaCards } from '@/const/expertPlaza';
import { normalizeHelpMenuItems } from '@/const/helpMenu';
import { normalizeMobileConfig } from '@/const/mobileConfig';
import { normalizeMobileConfigPublication } from '@/const/mobileConfigPublication';
import { normalizeNotificationEventDefaults } from '@/const/notificationPreferences';

import type { AppSettingNormalizer, AppSettingValueDefinition } from '../types';

const stringSchema = z.string();
const booleanSchema = z.boolean();
const numberSchema = z.number().finite();
const stringListSchema = z.array(z.string());
const recordSchema = z.record(z.string(), z.unknown());
const recordListSchema = z.array(recordSchema);

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };
const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);

// User defaults are intentionally partial: administrators commonly configure only
// one model or preference group. Known fields still need their declared primitive
// types validated so malformed values cannot be copied into every user's settings.
const userSettingsModelItemSchema = z
  .object({
    contextLimit: numberSchema.optional(),
    customPrompt: stringSchema.optional(),
    enabled: booleanSchema.optional(),
    model: stringSchema.optional(),
    provider: stringSchema.optional(),
  })
  .passthrough();

const userSystemAgentSchema = z
  .object({
    agentMeta: userSettingsModelItemSchema.optional(),
    followUpAction: userSettingsModelItemSchema.optional(),
    generationTopic: userSettingsModelItemSchema.optional(),
    historyCompress: userSettingsModelItemSchema.optional(),
    inputCompletion: userSettingsModelItemSchema.optional(),
    onboardingTaskRecommender: userSettingsModelItemSchema.optional(),
    onboardingUnderstanding: userSettingsModelItemSchema.optional(),
    promptRewrite: userSettingsModelItemSchema.optional(),
    thread: userSettingsModelItemSchema.optional(),
    topic: userSettingsModelItemSchema.optional(),
    translation: userSettingsModelItemSchema.optional(),
    memoryAnalysisAgentConfig: userSettingsModelItemSchema.optional(),
    userMemoryEmbedding: userSettingsModelItemSchema.optional(),
    userMemoryPersonaWriter: userSettingsModelItemSchema.optional(),
  })
  .partial()
  .passthrough();

const userGlobalSettingsDefaultsSchema = z
  .object({
    defaultAgent: z
      .object({
        config: z
          .object({ model: stringSchema.optional(), provider: stringSchema.optional() })
          .passthrough()
          .optional(),
        meta: recordSchema.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    general: z
      .object({
        animationMode: z.enum(['disabled', 'agile', 'elegant']).optional(),
        contextMenuMode: z.enum(['disabled', 'default']).optional(),
        costEstimateWarningThreshold: numberSchema.optional(),
        enableAutoScrollOnStreaming: booleanSchema.optional(),
        enableMessageLinkIcon: booleanSchema.optional(),
        fontSize: numberSchema.optional(),
        isDevMode: booleanSchema.optional(),
        isLiteMode: booleanSchema.optional(),
        responseLanguage: stringSchema.optional(),
        telemetry: booleanSchema.optional(),
        timezone: stringSchema.optional(),
        transitionMode: stringSchema.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    hotkey: z.record(z.string(), stringSchema).optional(),
    image: z
      .object({
        defaultImageNum: numberSchema.optional(),
        defaultModel: stringSchema.optional(),
        defaultProvider: stringSchema.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    languageModel: z
      .record(
        z.string(),
        z
          .object({
            autoFetchModelLists: booleanSchema.optional(),
            customModelCards: z.array(recordSchema).optional(),
            enabled: booleanSchema.optional(),
            enabledModels: z.array(stringSchema).nullable().optional(),
            fetchOnClient: booleanSchema.optional(),
            latestFetchTime: numberSchema.optional(),
            remoteModelCards: z.array(recordSchema).optional(),
            serverModelLists: z.array(recordSchema).optional(),
          })
          .partial()
          .passthrough(),
      )
      .optional(),
    market: z.record(z.string(), z.unknown()).nullable().optional(),
    memory: z
      .object({
        effort: z.enum(['high', 'low', 'medium']).optional(),
        enabled: booleanSchema.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    notification: z
      .object({
        email: z
          .object({
            enabled: booleanSchema.optional(),
            items: z.record(z.string(), z.record(z.string(), booleanSchema)).optional(),
          })
          .partial()
          .passthrough()
          .optional(),
        inbox: z
          .object({
            enabled: booleanSchema.optional(),
            items: z.record(z.string(), z.record(z.string(), booleanSchema)).optional(),
          })
          .partial()
          .passthrough()
          .optional(),
        push: z
          .object({
            enabled: booleanSchema.optional(),
            items: z.record(z.string(), z.record(z.string(), booleanSchema)).optional(),
          })
          .partial()
          .passthrough()
          .optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    systemAgent: userSystemAgentSchema.optional(),
    tool: z
      .object({
        uninstalledBuiltinTools: z.array(stringSchema).optional(),
        uninstalledBuiltinToolsByWorkspace: z.record(z.string(), z.array(stringSchema)).optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    tts: z
      .object({
        openAI: z
          .object({ sttModel: stringSchema.optional(), ttsModel: stringSchema.optional() })
          .partial()
          .passthrough()
          .optional(),
        sttAutoStop: booleanSchema.optional(),
        sttServer: z.enum(['openai', 'browser']).optional(),
      })
      .partial()
      .passthrough()
      .optional(),
  })
  .partial()
  .passthrough();

const defineValue = <T>(
  normalizer: AppSettingNormalizer,
  valueSchema: z.ZodType<T>,
  normalize: (value: unknown) => T,
  options: { clearValue?: null } = {},
): AppSettingValueDefinition => ({
  ...(options.clearValue === null ? { clearValue: null } : {}),
  normalizer,
  normalizeValue: (value) => valueSchema.parse(normalize(value)),
  valueSchema: valueSchema as z.ZodType<unknown>,
});

const toString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const toBoolean = (value: unknown) => Boolean(value);
const toStringList = (value: unknown): string[] => {
  const raw = Array.isArray(value)
    ? value.flatMap((item) => (typeof item === 'string' ? item.split(/[\r\n,;\uFF0C\uFF1B]+/) : []))
    : typeof value === 'string'
      ? value.split(/[\r\n,;\uFF0C\uFF1B]+/)
      : [];

  return Array.from(new Set(raw.map((item) => item.trim()).filter(Boolean)));
};
const toBoundedInt = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};
const normalizeS3FilePath = (value: unknown) =>
  toString(value)
    .replaceAll('\\', '/')
    .replaceAll(/^\/+|\/+$/g, '');
const toOptionalUrlString = (value: unknown, key: string) => {
  const text = toString(value);
  if (!text) return '';

  try {
    new URL(text);
    return text;
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${key} must be a valid URL` });
  }
};
const toPaymentUrlString = (value: unknown, key: string) => {
  const text = toString(value);
  if (!text) return '';

  try {
    const url = new URL(text);
    const localHttp =
      url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (!url.username && !url.password && (url.protocol === 'https:' || localHttp)) return text;
  } catch {
    // The validation error below covers malformed and unsafe payment URLs.
  }
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `${key} must be a valid HTTPS URL`,
  });
};
const toModuleAppRuntimeInternalUrl = (value: unknown, key: string) => {
  const text = toString(value);
  if (!text) return '';

  try {
    const url = new URL(text);
    if (!url.username && !url.password && ['http:', 'https:'].includes(url.protocol)) {
      return url.origin;
    }
  } catch {
    // The validation error below covers malformed and credentialed URLs.
  }
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `${key} must be a valid HTTP(S) origin`,
  });
};
const toModuleAppRuntimePublicOrigin = (value: unknown, key: string) => {
  const text = toString(value);
  if (!text) return '';

  try {
    const url = new URL(text);
    if (!url.username && !url.password && url.protocol === 'https:') return url.origin;
  } catch {
    // The validation error below covers malformed and unsafe public origins.
  }
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `${key} must be a valid HTTPS origin`,
  });
};
const normalizeMemoryTriggerMode = (value: unknown) =>
  value === 'direct' || value === 'workflow' || value === 'auto' ? value : 'auto';
const normalizeProfileInterestAreas = (value: unknown) => {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const normalized: Array<{ key: string; label: string }> = [];

  for (const item of items) {
    const label =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object'
          ? toString((item as Record<string, unknown>).label)
          : '';
    const key =
      item && typeof item === 'object'
        ? toString((item as Record<string, unknown>).key) || label
        : label;

    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ key, label });
  }

  return normalized;
};

const stringValue = (normalizer: AppSettingNormalizer) =>
  defineValue(normalizer, stringSchema, toString);
const booleanValue = (normalizer: AppSettingNormalizer) =>
  defineValue(normalizer, booleanSchema, toBoolean);
const numberValue = (normalizer: AppSettingNormalizer, normalize: (value: unknown) => number) =>
  defineValue(normalizer, numberSchema, normalize);

const OPERATION_BOOLEAN_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.communityCreatorRewardBannerEnabled,
  APP_SETTING_KEYS.communityFeaturedAssistantsEnabled,
  APP_SETTING_KEYS.communityFeaturedMcpsEnabled,
  APP_SETTING_KEYS.communityFeaturedSkillsEnabled,
  APP_SETTING_KEYS.communityHomeAnnouncementEnabled,
]);
const OPERATION_PAGE_SIZE_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.communityFeaturedAssistantPageSize,
  APP_SETTING_KEYS.communityFeaturedMcpPageSize,
  APP_SETTING_KEYS.communityFeaturedSkillPageSize,
]);
const GROWTH_BOOLEAN_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.authSignupEnabled,
  APP_SETTING_KEYS.authSignupPhoneEnabled,
  APP_SETTING_KEYS.onboardingInitialCreditsEnabled,
]);
const GROWTH_NUMBER_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.onboardingInitialCredits,
  APP_SETTING_KEYS.uploadMaxActualSizeMb,
  APP_SETTING_KEYS.uploadMaxInputSizeMb,
]);
const NOTIFICATION_BOOLEAN_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.notificationDesktopEnabled,
  APP_SETTING_KEYS.notificationEmailEnabled,
  APP_SETTING_KEYS.notificationInboxEnabled,
  APP_SETTING_KEYS.notificationPushEnabled,
  APP_SETTING_KEYS.notificationSystemEnabled,
]);
const MODEL_POLICY_BOOLEAN_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.modelPolicyApplyToEmbeddings,
  APP_SETTING_KEYS.modelPolicyApplyToGenerateObject,
  APP_SETTING_KEYS.modelPolicyEnabled,
]);
const MODEL_POLICY_LIST_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.modelPolicyAllowlist,
  APP_SETTING_KEYS.modelPolicyBlocklist,
]);
const RECOMMENDATION_BOOLEAN_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.recommendationAssistantsEnabled,
  APP_SETTING_KEYS.recommendationGeneralSkillsEnabled,
  APP_SETTING_KEYS.recommendationHotSkillsEnabled,
  APP_SETTING_KEYS.recommendationMcpsEnabled,
  APP_SETTING_KEYS.recommendationSectionEnabled,
  APP_SETTING_KEYS.recommendationSkillsEnabled,
]);
const RECOMMENDATION_TITLE_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.recommendationAssistantTitle,
  APP_SETTING_KEYS.recommendationGeneralSkillTitle,
  APP_SETTING_KEYS.recommendationHotSkillTitle,
  APP_SETTING_KEYS.recommendationMcpTitle,
  APP_SETTING_KEYS.recommendationSkillTitle,
]);
const DOCMEE_BOOLEAN_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.docmeePptAllowPdfExport,
  APP_SETTING_KEYS.docmeePptAllowPptxDownload,
  APP_SETTING_KEYS.docmeePptAuditEnabled,
  APP_SETTING_KEYS.docmeePptEnabled,
]);
const PAYMENT_BOOLEAN_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.paymentAlipayEnabled,
  APP_SETTING_KEYS.paymentEnabled,
  APP_SETTING_KEYS.paymentModuleAppEnabled,
  APP_SETTING_KEYS.paymentSubscriptionEnabled,
  APP_SETTING_KEYS.paymentTopUpEnabled,
  APP_SETTING_KEYS.paymentWechatEnabled,
  APP_SETTING_KEYS.paymentZpayAlipayEnabled,
  APP_SETTING_KEYS.paymentZpayEnabled,
  APP_SETTING_KEYS.paymentZpayWechatEnabled,
]);
const PAYMENT_SECRET_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.paymentAlipayCertificate,
  APP_SETTING_KEYS.paymentAlipayMerchantPrivateKey,
  APP_SETTING_KEYS.paymentAlipayPublicKey,
  APP_SETTING_KEYS.paymentWechatApiV3Key,
  APP_SETTING_KEYS.paymentWechatMerchantPrivateKey,
  APP_SETTING_KEYS.paymentWechatPlatformCertificate,
  APP_SETTING_KEYS.paymentZpayMerchantKey,
]);
const PAYMENT_URL_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.paymentAlipayGateway,
  APP_SETTING_KEYS.paymentPublicBaseUrl,
  APP_SETTING_KEYS.paymentWechatApiBaseUrl,
  APP_SETTING_KEYS.paymentZpayApiBaseUrl,
]);
const MODULE_APP_RUNTIME_BOOLEAN_KEYS = new Set<AppSettingKey>([
  APP_SETTING_KEYS.moduleAppExecutionEnabled,
  APP_SETTING_KEYS.moduleAppPublicExecutionEnabled,
  APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
  APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled,
  APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
]);
export const getAppSettingValueDefinition = (key: AppSettingKey): AppSettingValueDefinition => {
  if (key === APP_SETTING_KEYS.cronAuditRetentionDays) {
    return numberValue('cron-audit-retention-integer', (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error('cronAuditRetentionDays must be a number');
      return Math.max(7, Math.min(3650, Math.round(n)));
    });
  }
  if (key === APP_SETTING_KEYS.cronPendingOrderExpiryDays) {
    return numberValue('cron-pending-order-expiry-integer', (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error('cronPendingOrderExpiryDays must be a number');
      return Math.max(1, Math.min(365, Math.round(n)));
    });
  }
  if (key === APP_SETTING_KEYS.referralRewardCredits) {
    return numberValue('referral-reward-integer', (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error('referralRewardCredits must be a number');
      return Math.max(0, Math.round(n));
    });
  }
  if (key === APP_SETTING_KEYS.cronSecret) {
    return defineValue('cron-secret-string', stringSchema, (value) => value as string);
  }

  if (key === APP_SETTING_KEYS.composioEnabled) return booleanValue('composio-boolean');
  if (key === APP_SETTING_KEYS.composioAuthConfigIds) {
    return defineValue('composio-auth-config-json-string', stringSchema, (value) => {
      const normalized = toString(value);
      if (!normalized) return '';

      try {
        const parsed = JSON.parse(normalized);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('COMPOSIO_AUTH_CONFIG_IDS_MUST_BE_OBJECT');
        }
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'composioAuthConfigIds must be a JSON object',
        });
      }
      return normalized;
    });
  }
  if (key.startsWith('composio.')) return stringValue('composio-string');

  if (key === APP_SETTING_KEYS.pricingCreditMultiplier) {
    return numberValue('pricing-positive-number', (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'pricingCreditMultiplier must be a number',
        });
      }
      if (n <= 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'pricingCreditMultiplier must be greater than 0',
        });
      }
      return Math.min(100, n);
    });
  }
  if (key === APP_SETTING_KEYS.pricingModelRules) {
    return defineValue('pricing-model-rules-array', aiUsagePricingRulesSchema, (value) =>
      aiUsagePricingRulesSchema.parse(value),
    );
  }
  if (key === APP_SETTING_KEYS.ordersManagementEnabled) return booleanValue('orders-boolean');
  if (key === APP_SETTING_KEYS.plansFaqItems) {
    return defineValue('plans-faq-record-list', recordListSchema, normalizePlanFaqSettings);
  }

  if (PAYMENT_BOOLEAN_KEYS.has(key)) return booleanValue('payment-boolean');
  if (PAYMENT_SECRET_KEYS.has(key)) {
    return defineValue('payment-secret-string', stringSchema, (value) => value as string);
  }
  if (PAYMENT_URL_KEYS.has(key)) {
    return defineValue('payment-url', stringSchema, (value) => toPaymentUrlString(value, key));
  }
  if (key === APP_SETTING_KEYS.paymentDefaultProvider) {
    return defineValue('payment-provider-enum', stringSchema, (value) =>
      value === 'wechat_pay' || value === 'zpay' ? value : 'alipay',
    );
  }
  if (key === APP_SETTING_KEYS.paymentAlipayMode) {
    return defineValue('payment-mode-enum', stringSchema, (value) =>
      value === 'production' ? 'production' : 'sandbox',
    );
  }
  if (key === APP_SETTING_KEYS.paymentAlipayCertMode) {
    return defineValue('payment-cert-mode-enum', stringSchema, (value) =>
      value === 'certificate' ? 'certificate' : 'public_key',
    );
  }
  if (key.startsWith('payment.')) return stringValue('payment-string');

  if (MODULE_APP_RUNTIME_BOOLEAN_KEYS.has(key)) {
    return booleanValue('module-app-runtime-boolean');
  }
  if (key === APP_SETTING_KEYS.moduleAppRuntimeInternalToken) {
    return defineValue('module-app-runtime-secret', stringSchema, (value) => value as string);
  }
  if (key === APP_SETTING_KEYS.moduleAppRuntimeInternalUrl) {
    return defineValue('module-app-runtime-internal-url', stringSchema, (value) =>
      toModuleAppRuntimeInternalUrl(value, key),
    );
  }
  if (key === APP_SETTING_KEYS.moduleAppRuntimePublicOrigin) {
    return defineValue('module-app-runtime-public-origin', stringSchema, (value) =>
      toModuleAppRuntimePublicOrigin(value, key),
    );
  }

  if (OPERATION_BOOLEAN_KEYS.has(key)) return booleanValue('operations-boolean');
  if (OPERATION_PAGE_SIZE_KEYS.has(key)) {
    return numberValue('operations-page-size-integer', (value) => toBoundedInt(value, 12, 1, 24));
  }
  if (key.startsWith('community.')) return stringValue('operations-string');

  if (GROWTH_BOOLEAN_KEYS.has(key)) return booleanValue('growth-boolean');
  if (GROWTH_NUMBER_KEYS.has(key)) {
    return numberValue('growth-nonnegative-integer', (value) =>
      toBoundedInt(value, 0, 0, 10_000_000_000),
    );
  }
  if (key.startsWith('auth.') || key.startsWith('onboarding.') || key.startsWith('upload.')) {
    return stringValue('growth-string');
  }

  if (key === APP_SETTING_KEYS.profileInterestAreas) {
    return defineValue('profile-interest-areas', recordListSchema, normalizeProfileInterestAreas);
  }
  if (key === APP_SETTING_KEYS.profileAvatarPresets) {
    return defineValue('profile-avatar-presets', recordListSchema, normalizeAvatarPresets);
  }
  if (key === APP_SETTING_KEYS.memoryUserMemoryTriggerMode) {
    return defineValue('memory-trigger-mode', stringSchema, normalizeMemoryTriggerMode);
  }
  if (key === APP_SETTING_KEYS.mobileConfig) {
    return defineValue(
      'mobile-config',
      jsonSchema,
      (value) => normalizeMobileConfig(value) as unknown as JsonValue,
    );
  }
  if (key === APP_SETTING_KEYS.mobileConfigPublication) {
    return defineValue(
      'mobile-config-publication',
      jsonSchema,
      (value) => normalizeMobileConfigPublication(value) as unknown as JsonValue,
    );
  }
  if (key.startsWith('memory.') || key.startsWith('vector.') || key.startsWith('default')) {
    return stringValue('runtime-model-string');
  }
  if (key === APP_SETTING_KEYS.userGlobalSettingsDefaults) {
    return defineValue('user-global-settings-object', userGlobalSettingsDefaultsSchema, (value) =>
      value && typeof value === 'object' && !Array.isArray(value) ? value : {},
    );
  }

  if (key === APP_SETTING_KEYS.expertPlazaEnabled) return booleanValue('expert-plaza-boolean');
  if (key === APP_SETTING_KEYS.expertPlazaCards) {
    return defineValue('expert-plaza-cards', recordListSchema, normalizeExpertPlazaCards);
  }
  if (key === APP_SETTING_KEYS.expertPlazaCategories) {
    return defineValue('expert-plaza-categories', stringListSchema, toStringList);
  }
  if (key.startsWith('expertPlaza.')) return stringValue('expert-plaza-string');

  if (NOTIFICATION_BOOLEAN_KEYS.has(key)) return booleanValue('notification-boolean');
  if (key === APP_SETTING_KEYS.notificationEventDefaults) {
    return defineValue(
      'notification-event-defaults-record',
      recordSchema,
      normalizeNotificationEventDefaults,
    );
  }
  if (key === APP_SETTING_KEYS.notificationRetentionDays) {
    return numberValue('notification-retention-integer', (value) =>
      toBoundedInt(value, 90, 1, 3650),
    );
  }
  if (key === APP_SETTING_KEYS.notificationSystemType) {
    return defineValue('notification-type-enum', stringSchema, (value) => {
      const type = toString(value);
      return ['success', 'info', 'warning', 'error'].includes(type) ? type : 'warning';
    });
  }
  if (key.startsWith('notification.')) return stringValue('notification-string');

  if (
    key === APP_SETTING_KEYS.storageS3EnablePathStyle ||
    key === APP_SETTING_KEYS.storageS3SetAcl
  ) {
    return booleanValue('storage-boolean');
  }
  if (key === APP_SETTING_KEYS.storageS3PreviewUrlExpireIn) {
    return numberValue('storage-preview-expiry-integer', (value) =>
      toBoundedInt(value, 7200, 60, 604_800),
    );
  }
  if (key === APP_SETTING_KEYS.storageS3FilePath) {
    return defineValue('storage-file-path', stringSchema, normalizeS3FilePath);
  }
  if (
    key === APP_SETTING_KEYS.storageS3Endpoint ||
    key === APP_SETTING_KEYS.storageS3PublicDomain
  ) {
    return defineValue('storage-optional-url', stringSchema, (value) =>
      toOptionalUrlString(value, key),
    );
  }
  if (key.startsWith('storage.')) return stringValue('storage-string');

  if (MODEL_POLICY_BOOLEAN_KEYS.has(key)) return booleanValue('model-policy-boolean');
  if (MODEL_POLICY_LIST_KEYS.has(key)) {
    return defineValue('model-policy-string-list', stringListSchema, toStringList);
  }
  if (key === APP_SETTING_KEYS.modelPolicyMode) {
    return defineValue('model-policy-mode-enum', stringSchema, (value) =>
      value === 'allowlist' || value === 'blocklist' ? value : 'blocklist',
    );
  }
  if (key.startsWith('model.policy.')) return stringValue('model-policy-string');

  if (RECOMMENDATION_BOOLEAN_KEYS.has(key)) return booleanValue('recommendation-boolean');
  if (key === APP_SETTING_KEYS.recommendationHotSkillSort) {
    return defineValue(
      'recommendation-hot-sort',
      stringSchema,
      (value) => toString(value) || 'installCount',
    );
  }
  if (RECOMMENDATION_TITLE_KEYS.has(key)) return stringValue('recommendation-title-string');
  if (key.startsWith('recommendation.')) {
    return defineValue('recommendation-string-list', stringListSchema, toStringList);
  }

  if (key === APP_SETTING_KEYS.homeMessengerEnabled) {
    return booleanValue('brand-home-messenger-boolean');
  }
  if (key === APP_SETTING_KEYS.helpMenuItems) {
    return defineValue('help-menu', recordListSchema, normalizeHelpMenuItems);
  }
  if (key === APP_SETTING_KEYS.aboutLinks) {
    return defineValue('about-links', recordSchema, normalizeAboutLinksConfig);
  }
  if (key === APP_SETTING_KEYS.aboutPage) {
    return defineValue('about-page', recordSchema, normalizeAboutPageConfig);
  }
  if (
    key.startsWith('about.') ||
    key.startsWith('brand.') ||
    key.startsWith('home.') ||
    key.startsWith('sidebar.')
  ) {
    return stringValue('brand-string');
  }

  if (key === APP_SETTING_KEYS.desktopUpdateAutoCheck) {
    return booleanValue('desktop-update-boolean');
  }
  if (key === APP_SETTING_KEYS.desktopUpdateCheckInterval) {
    return numberValue('desktop-update-interval-integer', (value) =>
      toBoundedInt(value, 60, 1, 1440),
    );
  }
  if (key === APP_SETTING_KEYS.desktopUpdateChannel) {
    return defineValue('desktop-update-channel-enum', stringSchema, (value) =>
      value === 'canary' ? 'canary' : 'stable',
    );
  }
  if (key === APP_SETTING_KEYS.desktopUpdateServerUrl) {
    return defineValue('desktop-update-string', z.string().max(2048), (value) => {
      const normalized = normalizeDesktopUpdateServerUrl(value);
      if ('reason' in normalized) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `desktop.update.serverUrl is not allowed: ${normalized.reason}`,
        });
      }
      return normalized.url;
    });
  }
  if (key === APP_SETTING_KEYS.desktopDownloadUrl) {
    return defineValue('desktop-update-string', z.string().max(2048), (value) => {
      const normalized = normalizeDesktopDownloadUrl(value);
      if ('reason' in normalized) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `desktop.download.url is not allowed: ${normalized.reason}`,
        });
      }
      return normalized.url;
    });
  }
  if (key.startsWith('desktop.login.')) return stringValue('desktop-login-string');
  if (key.startsWith('desktop.')) return stringValue('desktop-update-string');

  if (DOCMEE_BOOLEAN_KEYS.has(key)) return booleanValue('ppt-boolean');
  if (key === APP_SETTING_KEYS.docmeePptApiKey) {
    return defineValue(
      'ppt-api-key',
      stringSchema,
      (value) => (typeof value === 'string' ? value.trim() : ''),
      { clearValue: null },
    );
  }
  if (key === APP_SETTING_KEYS.docmeePptBaseUrl) {
    return defineValue('ppt-base-url', z.string().trim().min(1).max(512), toString);
  }
  if (key === APP_SETTING_KEYS.docmeePptCreatorVersion) {
    return defineValue(
      'ppt-creator-version-enum',
      z.enum(['v1', 'v2']),
      (value) => value as 'v1' | 'v2',
    );
  }
  if (key === APP_SETTING_KEYS.docmeePptDailyLimit) {
    return defineValue('ppt-daily-limit', z.number().int().min(0).nullable(), (value) =>
      typeof value === 'number' && value > 0 ? value : null,
    );
  }
  if (key === APP_SETTING_KEYS.docmeePptDefaultLang) {
    return defineValue('ppt-default-language', z.string().trim().min(1).max(16), toString);
  }
  if (key === APP_SETTING_KEYS.docmeePptThemeColor) {
    return defineValue('ppt-theme-color', z.string().trim().max(32).nullable(), (value) => {
      if (value === null) return null;
      return toString(value) || null;
    });
  }
  if (key === APP_SETTING_KEYS.docmeePptTokenTtlMinutes) {
    return defineValue(
      'ppt-token-ttl-integer',
      z.number().int().min(1).max(1440),
      (value) => value as number,
    );
  }
  if (key.startsWith('docmee.')) return stringValue('ppt-string');

  return stringValue('fallback-string');
};
