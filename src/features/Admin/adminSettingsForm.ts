import { SOCIAL_URL } from '@lobechat/business-const';
import { DEFAULT_PRICING_CREDIT_MULTIPLIER } from '@lobechat/const/currency';

import {
  type AboutLinksConfig,
  type AboutPageConfig,
  DEFAULT_ABOUT_LINKS,
  normalizeAboutLinksConfig,
  normalizeAboutPageConfig,
} from '@/const/aboutLinks';
import {
  BRAND_CONFIG_SWR_KEY,
  PROFILE_INTEREST_AREAS_SWR_KEY,
  PUBLIC_ABOUT_LINKS_SWR_KEY,
  PUBLIC_ABOUT_PAGE_SWR_KEY,
  PUBLIC_HELP_MENU_SWR_KEY,
  PUBLIC_PLAN_FAQ_SWR_KEY,
  RUNTIME_CONFIG_SWR_KEY,
  USER_STATE_SWR_KEY,
} from '@/const/adminCacheKeys';
import { APP_SETTING_KEYS, type AppSettingKey } from '@/const/appSettingsRegistry';
import { DEFAULT_RUNTIME_BRAND } from '@/const/brand';
import { DEFAULT_COMHUB_AGENT_AVATAR, DEFAULT_COMHUB_AGENT_NAME } from '@/const/defaultAgent';
import { type HelpMenuItem, normalizeHelpMenuItems } from '@/const/helpMenu';
import { type NotificationEventDefaults } from '@/const/notificationPreferences';
import { DOCUMENTS_REFER_URL, GITHUB } from '@/const/url';

export {
  ADMIN_SETTINGS_SWR_KEY,
  BRAND_CONFIG_SWR_KEY,
  PROFILE_INTEREST_AREAS_SWR_KEY,
  PROFILE_OPTIONS_SWR_KEY,
  PUBLIC_ABOUT_LINKS_SWR_KEY,
  PUBLIC_ABOUT_PAGE_SWR_KEY,
  PUBLIC_EXPERT_PLAZA_SWR_KEY,
  PUBLIC_HELP_MENU_SWR_KEY,
  PUBLIC_PLAN_FAQ_SWR_KEY,
  RUNTIME_CONFIG_SWR_KEY,
  USER_STATE_SWR_KEY,
} from '@/const/adminCacheKeys';

export const SETTING_KEYS = APP_SETTING_KEYS;

export type MemoryUserMemoryTriggerMode = 'auto' | 'direct' | 'workflow';

export type EnabledNewapiModelOption = {
  displayName?: string | null;
  instanceName?: string | null;
  modelId: string;
  modelType: string;
  provider?: string | null;
  providerType?: string | null;
};

export type DefaultModelOption = {
  label: string;
  model: string;
  provider: string;
  providerLabel?: string;
  value: string;
};

export type AdminSettingsData = {
  aboutLogoUrl?: string | null;
  brandFaviconUrl?: string | null;
  brandAuthTitle?: string | null;
  brandCopyrightText?: string | null;
  brandLogoUrl?: string | null;
  brandLoadingText?: string | null;
  brandLoadingSvgUrl?: string | null;
  brandName?: string | null;
  brandPrimaryColor?: string | null;
  brandSlogan?: string | null;
  communityForkAndChatLabel?: string | null;
  communitySkillUseButtonLabel?: string | null;
  aboutLinks?: unknown;
  aboutPage?: unknown;
  cronAuditRetentionDays?: number | null;
  cronPendingOrderExpiryDays?: number | null;
  defaultAgentAvatar?: string | null;
  defaultAgentModel?: string | null;
  defaultAgentName?: string | null;
  defaultAgentProvider?: string | null;
  defaultImageModel?: string | null;
  defaultImageProvider?: string | null;
  defaultSkillName?: string | null;
  defaultVideoModel?: string | null;
  defaultVideoProvider?: string | null;
  defaultModelSuggestions?: string[] | null;
  enabledNewapiModels?: EnabledNewapiModelOption[] | null;
  helpMenuItems?: unknown;
  homeMessengerBannerTitle?: string | null;
  homeMessengerEnabled?: boolean | null;
  memoryUserMemoryTriggerMode?: MemoryUserMemoryTriggerMode | string | null;
  memoryUserMemoryTriggerModeEnv?: string | null;
  qstashTokenConfigured?: boolean | null;
  notificationDesktopEnabled?: boolean | null;
  notificationEmailEnabled?: boolean | null;
  notificationEventDefaults?: NotificationEventDefaults | null;
  notificationInboxEnabled?: boolean | null;
  notificationPushEnabled?: boolean | null;
  notificationRetentionDays?: number | null;
  notificationSystemActionLabel?: string | null;
  notificationSystemActionUrl?: string | null;
  notificationSystemContent?: string | null;
  notificationSystemEnabled?: boolean | null;
  notificationSystemTitle?: string | null;
  notificationSystemType?: string | null;
  ordersManagementEnabled?: boolean | null;
  paymentGatewayStatus?: {
    configured: boolean;
    message: string;
    provider?: string | null;
  } | null;
  pricingCreditMultiplier?: number | null;
  pricingModelRules?: unknown[] | null;
  referralRewardCredits?: number | null;
  sidebarGenerationLabel?: string | null;
  sidebarMemberLabel?: string | null;
  sidebarMemberUrl?: string | null;
  storageS3AccessKeyId?: string | null;
  storageS3Bucket?: string | null;
  storageS3EnablePathStyle?: boolean | null;
  storageS3Endpoint?: string | null;
  storageS3FilePath?: string | null;
  storageS3PreviewUrlExpireIn?: number | null;
  storageS3PublicDomain?: string | null;
  storageS3Region?: string | null;
  storageS3SecretAccessKeyConfigured?: boolean | null;
  storageS3SecretAccessKeyMasked?: string | null;
  storageS3SetAcl?: boolean | null;
};

export type AdminSettingsFormValues = {
  aboutLogoUrl: string;
  brandFaviconUrl: string;
  brandAuthTitle: string;
  brandCopyrightText: string;
  brandLogoUrl: string;
  brandLoadingText: string;
  brandLoadingSvgUrl: string;
  brandName: string;
  brandPrimaryColor: string;
  brandSlogan: string;
  communityForkAndChatLabel: string;
  communitySkillUseButtonLabel: string;
  aboutLinks: AboutLinksConfig;
  aboutPage: AboutPageConfig;
  cronAuditRetentionDays: number;
  cronPendingOrderExpiryDays: number;
  cronSecret: string;
  defaultAgentAvatar: string;
  defaultAgentModel: string;
  defaultAgentName: string;
  defaultAgentProvider: string;
  defaultImageModel: string;
  defaultImageProvider: string;
  defaultSkillName: string;
  defaultVideoModel: string;
  defaultVideoProvider: string;
  helpMenuItems: HelpMenuItem[];
  homeMessengerBannerTitle: string;
  homeMessengerEnabled: boolean;
  memoryUserMemoryTriggerMode: MemoryUserMemoryTriggerMode;
  ordersEnabled: boolean;
  pricingMultiplier: number;
  referralRewardCredits: number;
  sidebarGenerationLabel: string;
  sidebarMemberLabel: string;
  sidebarMemberUrl: string;
  storageS3AccessKeyId: string;
  storageS3Bucket: string;
  storageS3EnablePathStyle: boolean;
  storageS3Endpoint: string;
  storageS3FilePath: string;
  storageS3PreviewUrlExpireIn: number;
  storageS3PublicDomain: string;
  storageS3Region: string;
  storageS3SecretAccessKey: string;
  storageS3SecretAccessKeyConfigured: boolean;
  storageS3SetAcl: boolean;
};

export type SettingUpdate = { key: string; value: unknown };

export const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const normalizeTextWithFallback = (value: unknown, fallback: string) =>
  normalizeText(value) || fallback;

export const RECOMMENDED_HELP_MENU_ITEMS: HelpMenuItem[] = normalizeHelpMenuItems([
  {
    action: 'url',
    enabled: true,
    icon: 'book',
    key: 'docs',
    label: '使用文档',
    url: DOCUMENTS_REFER_URL,
  },
  {
    action: 'feedback',
    enabled: true,
    icon: 'feather',
    key: 'feedback',
    label: '联系我们',
  },
  {
    action: 'url',
    enabled: true,
    icon: 'discord',
    key: 'discord',
    label: 'Discord',
    url: SOCIAL_URL.discord,
  },
  {
    action: 'changelog',
    enabled: true,
    icon: 'file-clock',
    key: 'changelog',
    label: '更新日志',
  },
  {
    action: 'url',
    enabled: true,
    icon: 'github',
    key: 'github',
    label: 'GitHub',
    url: GITHUB,
  },
]);

export const normalizeMemoryUserMemoryTriggerMode = (
  value: unknown,
): MemoryUserMemoryTriggerMode =>
  value === 'direct' || value === 'workflow' || value === 'auto' ? value : 'auto';

const legacyProviderIdPattern =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const normalizeManagedProviderParts = ({
  instanceName,
  provider,
  providerType,
}: {
  instanceName: string;
  provider: string;
  providerType: string;
}) => {
  const baseProvider =
    providerType || (legacyProviderIdPattern.test(provider) ? 'newapi' : provider);

  return [baseProvider, instanceName].filter(Boolean);
};

const buildManagedModelOptionLabel = ({
  instanceName,
  modelType,
  name,
  provider,
  providerType,
}: {
  instanceName: string;
  modelType: string;
  name: string;
  provider: string;
  providerType: string;
}) => {
  const providerParts = normalizeManagedProviderParts({ instanceName, provider, providerType });

  return `${name} (${[...providerParts, modelType].join(' / ')})`;
};

const buildManagedProviderLabel = ({
  instanceName,
  provider,
  providerType,
}: {
  instanceName: string;
  provider: string;
  providerType: string;
}) => normalizeManagedProviderParts({ instanceName, provider, providerType }).join(' / ');

export const buildModelOptions = (data?: {
  defaultModelSuggestions?: string[] | null;
  enabledNewapiModels?: EnabledNewapiModelOption[] | null;
  modelType?: string;
}): DefaultModelOption[] => {
  const seen = new Set<string>();
  const options: DefaultModelOption[] = [];

  for (const item of data?.enabledNewapiModels ?? []) {
    const model = normalizeText(item.modelId);
    if (!model) continue;

    const provider = normalizeText(item.provider) || 'newapi';
    const key = `${provider}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const name = normalizeText(item.displayName) || model;
    const modelType = normalizeText(item.modelType) || 'chat';
    if (data?.modelType && modelType !== data.modelType) continue;
    const instanceName = normalizeText(item.instanceName);
    const providerType = normalizeText(item.providerType);

    options.push({
      label: buildManagedModelOptionLabel({
        instanceName,
        modelType,
        name,
        provider,
        providerType,
      }),
      model,
      provider,
      providerLabel: buildManagedProviderLabel({ instanceName, provider, providerType }),
      value: key,
    });
  }

  for (const suggestion of data?.modelType && data.modelType !== 'chat'
    ? []
    : (data?.defaultModelSuggestions ?? [])) {
    const model = normalizeText(suggestion);
    if (!model) continue;

    const provider = 'newapi';
    const key = `${provider}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);

    options.push({
      label: `${model} (${provider} / suggested)`,
      model,
      provider,
      value: key,
    });
  }

  return options;
};

export const resolveModelOptionValue = (
  value?: { model?: unknown; provider?: unknown } | null,
  options: DefaultModelOption[] = [],
) => {
  const provider = normalizeText(value?.provider);
  const model = normalizeText(value?.model);
  if (!provider || !model) return '';

  const directValue = `${provider}:${model}`;
  if (options.some((option) => option.value === directValue)) return directValue;

  if (!legacyProviderIdPattern.test(provider)) return directValue;

  const candidates = options.filter((option) => option.model === model);
  return candidates.length === 1 ? candidates[0].value : directValue;
};

export const resolveModelProviderLabel = (
  value?: { model?: unknown; provider?: unknown } | null,
  options: DefaultModelOption[] = [],
) => {
  const provider = normalizeText(value?.provider);
  const model = normalizeText(value?.model);
  if (!provider) return '';

  const candidates = model ? options.filter((option) => option.model === model) : [];
  const selected =
    candidates.find((option) => option.provider === provider) ??
    (legacyProviderIdPattern.test(provider) && candidates.length === 1 ? candidates[0] : undefined);

  return selected?.providerLabel || selected?.provider || provider;
};

export const buildFormValues = (data?: AdminSettingsData): AdminSettingsFormValues => ({
  aboutLogoUrl: data?.aboutLogoUrl ?? '',
  brandFaviconUrl: data?.brandFaviconUrl ?? '',
  brandAuthTitle: data?.brandAuthTitle ?? DEFAULT_RUNTIME_BRAND.authTitle,
  brandCopyrightText: data?.brandCopyrightText ?? DEFAULT_RUNTIME_BRAND.copyrightText,
  brandLogoUrl: data?.brandLogoUrl ?? DEFAULT_RUNTIME_BRAND.logoUrl ?? '',
  brandLoadingText: data?.brandLoadingText ?? DEFAULT_RUNTIME_BRAND.loadingText,
  brandLoadingSvgUrl: data?.brandLoadingSvgUrl ?? '',
  brandName: data?.brandName ?? DEFAULT_RUNTIME_BRAND.name,
  brandPrimaryColor: data?.brandPrimaryColor ?? DEFAULT_RUNTIME_BRAND.primaryColor,
  brandSlogan: data?.brandSlogan ?? DEFAULT_RUNTIME_BRAND.authTitle,
  communityForkAndChatLabel: data?.communityForkAndChatLabel ?? '',
  communitySkillUseButtonLabel: data?.communitySkillUseButtonLabel ?? '',
  aboutLinks: normalizeAboutLinksConfig(data?.aboutLinks ?? DEFAULT_ABOUT_LINKS),
  aboutPage: normalizeAboutPageConfig(data?.aboutPage),
  cronAuditRetentionDays: data?.cronAuditRetentionDays ?? 365,
  cronPendingOrderExpiryDays: data?.cronPendingOrderExpiryDays ?? 7,
  cronSecret: '',
  defaultAgentAvatar: normalizeTextWithFallback(
    data?.defaultAgentAvatar,
    DEFAULT_COMHUB_AGENT_AVATAR,
  ),
  defaultAgentModel: data?.defaultAgentModel ?? '',
  defaultAgentName: normalizeTextWithFallback(data?.defaultAgentName, DEFAULT_COMHUB_AGENT_NAME),
  defaultAgentProvider: data?.defaultAgentProvider ?? '',
  defaultImageModel: data?.defaultImageModel ?? '',
  defaultImageProvider: data?.defaultImageProvider ?? '',
  defaultSkillName:
    normalizeText(data?.defaultSkillName) ||
    normalizeText(data?.brandName) ||
    DEFAULT_RUNTIME_BRAND.name,
  defaultVideoModel: data?.defaultVideoModel ?? '',
  defaultVideoProvider: data?.defaultVideoProvider ?? '',
  helpMenuItems: normalizeHelpMenuItems(data?.helpMenuItems),
  homeMessengerBannerTitle: data?.homeMessengerBannerTitle ?? '',
  homeMessengerEnabled: data?.homeMessengerEnabled ?? true,
  memoryUserMemoryTriggerMode: normalizeMemoryUserMemoryTriggerMode(
    data?.memoryUserMemoryTriggerMode,
  ),
  ordersEnabled: data?.ordersManagementEnabled ?? true,
  pricingMultiplier: data?.pricingCreditMultiplier ?? DEFAULT_PRICING_CREDIT_MULTIPLIER,
  referralRewardCredits: data?.referralRewardCredits ?? 0,
  sidebarGenerationLabel: data?.sidebarGenerationLabel ?? '生成',
  sidebarMemberLabel: data?.sidebarMemberLabel ?? '会员',
  sidebarMemberUrl: data?.sidebarMemberUrl ?? '/settings/plans',
  storageS3AccessKeyId: data?.storageS3AccessKeyId ?? '',
  storageS3Bucket: data?.storageS3Bucket ?? '',
  storageS3EnablePathStyle: data?.storageS3EnablePathStyle ?? false,
  storageS3Endpoint: data?.storageS3Endpoint ?? '',
  storageS3FilePath: data?.storageS3FilePath ?? 'files',
  storageS3PreviewUrlExpireIn: data?.storageS3PreviewUrlExpireIn ?? 7200,
  storageS3PublicDomain: data?.storageS3PublicDomain ?? '',
  storageS3Region: data?.storageS3Region ?? '',
  storageS3SecretAccessKey: '',
  storageS3SecretAccessKeyConfigured: data?.storageS3SecretAccessKeyConfigured ?? false,
  storageS3SetAcl: data?.storageS3SetAcl ?? false,
});

export const normalizeFormValues = (
  values: Partial<AdminSettingsFormValues>,
): AdminSettingsFormValues => ({
  aboutLogoUrl: normalizeText(values.aboutLogoUrl),
  brandFaviconUrl: normalizeText(values.brandFaviconUrl),
  brandAuthTitle: normalizeText(values.brandAuthTitle),
  brandCopyrightText: normalizeText(values.brandCopyrightText),
  brandLogoUrl: normalizeText(values.brandLogoUrl),
  brandLoadingText: normalizeText(values.brandLoadingText),
  brandLoadingSvgUrl: normalizeText(values.brandLoadingSvgUrl),
  brandName: normalizeText(values.brandName),
  brandPrimaryColor: normalizeText(values.brandPrimaryColor),
  brandSlogan: normalizeText(values.brandSlogan),
  communityForkAndChatLabel: normalizeText(values.communityForkAndChatLabel),
  communitySkillUseButtonLabel: normalizeText(values.communitySkillUseButtonLabel),
  aboutLinks: normalizeAboutLinksConfig(values.aboutLinks),
  aboutPage: normalizeAboutPageConfig(values.aboutPage),
  cronAuditRetentionDays:
    typeof values.cronAuditRetentionDays === 'number' ? values.cronAuditRetentionDays : 365,
  cronPendingOrderExpiryDays:
    typeof values.cronPendingOrderExpiryDays === 'number' ? values.cronPendingOrderExpiryDays : 7,
  cronSecret: normalizeText(values.cronSecret),
  defaultAgentAvatar: normalizeTextWithFallback(
    values.defaultAgentAvatar,
    DEFAULT_COMHUB_AGENT_AVATAR,
  ),
  defaultAgentModel: normalizeText(values.defaultAgentModel),
  defaultAgentName: normalizeTextWithFallback(values.defaultAgentName, DEFAULT_COMHUB_AGENT_NAME),
  defaultAgentProvider: normalizeText(values.defaultAgentProvider),
  defaultImageModel: normalizeText(values.defaultImageModel),
  defaultImageProvider: normalizeText(values.defaultImageProvider),
  defaultSkillName:
    normalizeText(values.defaultSkillName) ||
    normalizeText(values.brandName) ||
    DEFAULT_RUNTIME_BRAND.name,
  defaultVideoModel: normalizeText(values.defaultVideoModel),
  defaultVideoProvider: normalizeText(values.defaultVideoProvider),
  helpMenuItems: normalizeHelpMenuItems(values.helpMenuItems),
  homeMessengerBannerTitle: normalizeText(values.homeMessengerBannerTitle),
  homeMessengerEnabled:
    typeof values.homeMessengerEnabled === 'boolean' ? values.homeMessengerEnabled : true,
  memoryUserMemoryTriggerMode: normalizeMemoryUserMemoryTriggerMode(
    values.memoryUserMemoryTriggerMode,
  ),
  ordersEnabled: typeof values.ordersEnabled === 'boolean' ? values.ordersEnabled : true,
  pricingMultiplier:
    typeof values.pricingMultiplier === 'number' && values.pricingMultiplier > 0
      ? values.pricingMultiplier
      : DEFAULT_PRICING_CREDIT_MULTIPLIER,
  referralRewardCredits:
    typeof values.referralRewardCredits === 'number' ? values.referralRewardCredits : 0,
  sidebarGenerationLabel: normalizeText(values.sidebarGenerationLabel) || '生成',
  sidebarMemberLabel: normalizeText(values.sidebarMemberLabel) || '会员',
  sidebarMemberUrl: normalizeText(values.sidebarMemberUrl) || '/settings/plans',
  storageS3AccessKeyId: normalizeText(values.storageS3AccessKeyId),
  storageS3Bucket: normalizeText(values.storageS3Bucket),
  storageS3EnablePathStyle:
    typeof values.storageS3EnablePathStyle === 'boolean' ? values.storageS3EnablePathStyle : false,
  storageS3Endpoint: normalizeText(values.storageS3Endpoint),
  storageS3FilePath:
    normalizeText(values.storageS3FilePath)
      .replaceAll('\\', '/')
      .replaceAll(/^\/+|\/+$/g, '') || 'files',
  storageS3PreviewUrlExpireIn:
    typeof values.storageS3PreviewUrlExpireIn === 'number'
      ? values.storageS3PreviewUrlExpireIn
      : 7200,
  storageS3PublicDomain: normalizeText(values.storageS3PublicDomain),
  storageS3Region: normalizeText(values.storageS3Region),
  storageS3SecretAccessKey: normalizeText(values.storageS3SecretAccessKey),
  storageS3SecretAccessKeyConfigured:
    typeof values.storageS3SecretAccessKeyConfigured === 'boolean'
      ? values.storageS3SecretAccessKeyConfigured
      : false,
  storageS3SetAcl: typeof values.storageS3SetAcl === 'boolean' ? values.storageS3SetAcl : false,
});

const SITE_CUSTOMIZATION_FIELDS: Array<keyof AdminSettingsFormValues> = [
  'aboutLogoUrl',
  'defaultAgentName',
  'defaultAgentAvatar',
  'defaultSkillName',
  'brandName',
  'brandLoadingText',
  'brandLoadingSvgUrl',
  'brandAuthTitle',
  'brandCopyrightText',
  'brandLogoUrl',
  'brandFaviconUrl',
  'brandPrimaryColor',
  'brandSlogan',
  'homeMessengerBannerTitle',
  'homeMessengerEnabled',
  'communityForkAndChatLabel',
  'communitySkillUseButtonLabel',
  'sidebarMemberLabel',
  'sidebarMemberUrl',
  'sidebarGenerationLabel',
];

const SETTING_KEY_BY_FORM_FIELD: Record<keyof AdminSettingsFormValues, AppSettingKey> = {
  aboutLogoUrl: SETTING_KEYS.aboutLogoUrl,
  brandFaviconUrl: SETTING_KEYS.brandFaviconUrl,
  aboutLinks: SETTING_KEYS.aboutLinks,
  aboutPage: SETTING_KEYS.aboutPage,
  brandAuthTitle: SETTING_KEYS.brandAuthTitle,
  brandCopyrightText: SETTING_KEYS.brandCopyrightText,
  brandLogoUrl: SETTING_KEYS.brandLogoUrl,
  brandLoadingText: SETTING_KEYS.brandLoadingText,
  brandLoadingSvgUrl: SETTING_KEYS.brandLoadingSvgUrl,
  brandName: SETTING_KEYS.brandName,
  brandPrimaryColor: SETTING_KEYS.brandPrimaryColor,
  brandSlogan: SETTING_KEYS.brandSlogan,
  communityForkAndChatLabel: SETTING_KEYS.communityForkAndChatLabel,
  communitySkillUseButtonLabel: SETTING_KEYS.communitySkillUseButtonLabel,
  cronAuditRetentionDays: SETTING_KEYS.cronAuditRetentionDays,
  cronPendingOrderExpiryDays: SETTING_KEYS.cronPendingOrderExpiryDays,
  cronSecret: SETTING_KEYS.cronSecret,
  defaultAgentAvatar: SETTING_KEYS.defaultAgentAvatar,
  defaultAgentModel: SETTING_KEYS.defaultAgentModel,
  defaultAgentName: SETTING_KEYS.defaultAgentName,
  defaultAgentProvider: SETTING_KEYS.defaultAgentProvider,
  defaultImageModel: SETTING_KEYS.defaultImageModel,
  defaultImageProvider: SETTING_KEYS.defaultImageProvider,
  defaultSkillName: SETTING_KEYS.defaultSkillName,
  defaultVideoModel: SETTING_KEYS.defaultVideoModel,
  defaultVideoProvider: SETTING_KEYS.defaultVideoProvider,
  helpMenuItems: SETTING_KEYS.helpMenuItems,
  homeMessengerEnabled: SETTING_KEYS.homeMessengerEnabled,
  homeMessengerBannerTitle: SETTING_KEYS.homeMessengerBannerTitle,
  memoryUserMemoryTriggerMode: SETTING_KEYS.memoryUserMemoryTriggerMode,
  ordersEnabled: SETTING_KEYS.ordersManagementEnabled,
  pricingMultiplier: SETTING_KEYS.pricingCreditMultiplier,
  referralRewardCredits: SETTING_KEYS.referralRewardCredits,
  sidebarGenerationLabel: SETTING_KEYS.sidebarGenerationLabel,
  sidebarMemberLabel: SETTING_KEYS.sidebarMemberLabel,
  sidebarMemberUrl: SETTING_KEYS.sidebarMemberUrl,
  storageS3AccessKeyId: SETTING_KEYS.storageS3AccessKeyId,
  storageS3Bucket: SETTING_KEYS.storageS3Bucket,
  storageS3EnablePathStyle: SETTING_KEYS.storageS3EnablePathStyle,
  storageS3Endpoint: SETTING_KEYS.storageS3Endpoint,
  storageS3FilePath: SETTING_KEYS.storageS3FilePath,
  storageS3PreviewUrlExpireIn: SETTING_KEYS.storageS3PreviewUrlExpireIn,
  storageS3PublicDomain: SETTING_KEYS.storageS3PublicDomain,
  storageS3Region: SETTING_KEYS.storageS3Region,
  storageS3SecretAccessKey: SETTING_KEYS.storageS3SecretAccessKey,
  storageS3SecretAccessKeyConfigured: SETTING_KEYS.storageS3SecretAccessKey,
  storageS3SetAcl: SETTING_KEYS.storageS3SetAcl,
};

export const ADMIN_SETTINGS_FORM_SETTING_KEYS = Array.from(
  new Set(Object.values(SETTING_KEY_BY_FORM_FIELD)),
).sort() as AppSettingKey[];

export const ADMIN_SETTINGS_NON_FORM_SETTING_KEYS = [
  SETTING_KEYS.authSignupDisabledMessage,
  SETTING_KEYS.authSignupEnabled,
  SETTING_KEYS.authSignupPhoneEnabled,
  SETTING_KEYS.communityCreatorRewardBannerEnabled,
  SETTING_KEYS.communityFeaturedAssistantPageSize,
  SETTING_KEYS.communityFeaturedAssistantTitle,
  SETTING_KEYS.communityFeaturedAssistantsEnabled,
  SETTING_KEYS.communityFeaturedMcpPageSize,
  SETTING_KEYS.communityFeaturedMcpTitle,
  SETTING_KEYS.communityFeaturedMcpsEnabled,
  SETTING_KEYS.communityFeaturedSkillCategory,
  SETTING_KEYS.communityFeaturedSkillPageSize,
  SETTING_KEYS.communityFeaturedSkillSort,
  SETTING_KEYS.communityFeaturedSkillTitle,
  SETTING_KEYS.communityFeaturedSkillsEnabled,
  SETTING_KEYS.communityHomeAnnouncementContent,
  SETTING_KEYS.communityHomeAnnouncementEnabled,
  SETTING_KEYS.communityHomeAnnouncementTitle,
  SETTING_KEYS.communityHomeAnnouncementType,
  SETTING_KEYS.composioApiKey,
  SETTING_KEYS.composioAuthConfigIds,
  SETTING_KEYS.composioEnabled,
  SETTING_KEYS.desktopDownloadLabel,
  SETTING_KEYS.desktopDownloadUrl,
  SETTING_KEYS.desktopLoginCloudButtonLabel,
  SETTING_KEYS.desktopLoginDescription,
  SETTING_KEYS.desktopLoginFooterText,
  SETTING_KEYS.desktopLoginLogoUrl,
  SETTING_KEYS.desktopLoginTitle,
  SETTING_KEYS.desktopLoginWindowTitle,
  SETTING_KEYS.desktopOssAccessKeyId,
  SETTING_KEYS.desktopOssAccessKeySecret,
  SETTING_KEYS.desktopOssBucket,
  SETTING_KEYS.desktopOssEndpoint,
  SETTING_KEYS.desktopOssPath,
  SETTING_KEYS.desktopUpdateAutoCheck,
  SETTING_KEYS.desktopUpdateChannel,
  SETTING_KEYS.desktopUpdateCheckInterval,
  SETTING_KEYS.desktopUpdateCurrentVersion,
  SETTING_KEYS.desktopUpdateReleaseNotes,
  SETTING_KEYS.desktopUpdateServerUrl,
  SETTING_KEYS.docmeePptAllowPdfExport,
  SETTING_KEYS.docmeePptAllowPptxDownload,
  SETTING_KEYS.docmeePptApiKey,
  SETTING_KEYS.docmeePptAuditEnabled,
  SETTING_KEYS.docmeePptBaseUrl,
  SETTING_KEYS.docmeePptCreatorVersion,
  SETTING_KEYS.docmeePptDailyLimit,
  SETTING_KEYS.docmeePptDefaultLang,
  SETTING_KEYS.docmeePptEnabled,
  SETTING_KEYS.docmeePptThemeColor,
  SETTING_KEYS.docmeePptTokenTtlMinutes,
  SETTING_KEYS.expertPlazaCards,
  SETTING_KEYS.expertPlazaCategories,
  SETTING_KEYS.expertPlazaDescription,
  SETTING_KEYS.expertPlazaEnabled,
  SETTING_KEYS.expertPlazaName,
  SETTING_KEYS.memoryUserMemoryEmbeddingModel,
  SETTING_KEYS.memoryUserMemoryEmbeddingProvider,
  SETTING_KEYS.memoryUserMemoryGatekeeperModel,
  SETTING_KEYS.memoryUserMemoryGatekeeperProvider,
  SETTING_KEYS.memoryUserMemoryLayerExtractorModel,
  SETTING_KEYS.memoryUserMemoryLayerExtractorProvider,
  SETTING_KEYS.memoryUserMemoryPersonaWriterModel,
  SETTING_KEYS.memoryUserMemoryPersonaWriterProvider,
  SETTING_KEYS.moduleAppExecutionEnabled,
  SETTING_KEYS.moduleAppPublicExecutionEnabled,
  SETTING_KEYS.moduleAppRuntimeInternalToken,
  SETTING_KEYS.moduleAppRuntimeInternalUrl,
  SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
  SETTING_KEYS.moduleAppRuntimePublicOrigin,
  SETTING_KEYS.moduleAppScheduleDispatchEnabled,
  SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
  SETTING_KEYS.notificationDesktopEnabled,
  SETTING_KEYS.notificationEmailEnabled,
  SETTING_KEYS.notificationEventDefaults,
  SETTING_KEYS.notificationInboxEnabled,
  SETTING_KEYS.notificationPushEnabled,
  SETTING_KEYS.notificationRetentionDays,
  SETTING_KEYS.notificationSystemActionLabel,
  SETTING_KEYS.notificationSystemActionUrl,
  SETTING_KEYS.notificationSystemContent,
  SETTING_KEYS.notificationSystemEnabled,
  SETTING_KEYS.notificationSystemTitle,
  SETTING_KEYS.notificationSystemType,
  SETTING_KEYS.profileAvatarPresets,
  SETTING_KEYS.profileInterestAreas,
  SETTING_KEYS.modelPolicyAllowlist,
  SETTING_KEYS.modelPolicyApplyToEmbeddings,
  SETTING_KEYS.modelPolicyApplyToGenerateObject,
  SETTING_KEYS.modelPolicyBlocklist,
  SETTING_KEYS.modelPolicyDefaultModelFallback,
  SETTING_KEYS.modelPolicyDeniedMessage,
  SETTING_KEYS.modelPolicyEnabled,
  SETTING_KEYS.modelPolicyMode,
  SETTING_KEYS.onboardingInitialCredits,
  SETTING_KEYS.onboardingInitialCreditsEnabled,
  SETTING_KEYS.plansFaqItems,
  SETTING_KEYS.pricingModelRules,
  SETTING_KEYS.recommendationAssistantTags,
  SETTING_KEYS.recommendationAssistantTitle,
  SETTING_KEYS.recommendationAssistantsEnabled,
  SETTING_KEYS.recommendationGeneralSkillCategories,
  SETTING_KEYS.recommendationGeneralSkillTitle,
  SETTING_KEYS.recommendationGeneralSkillsEnabled,
  SETTING_KEYS.recommendationHotSkillSort,
  SETTING_KEYS.recommendationHotSkillTitle,
  SETTING_KEYS.recommendationHotSkillsEnabled,
  SETTING_KEYS.recommendationMcpCategories,
  SETTING_KEYS.recommendationMcpTitle,
  SETTING_KEYS.recommendationMcpsEnabled,
  SETTING_KEYS.recommendationSectionEnabled,
  SETTING_KEYS.recommendationSelectedTags,
  SETTING_KEYS.recommendationSkillCategories,
  SETTING_KEYS.recommendationSkillTitle,
  SETTING_KEYS.recommendationSkillsEnabled,
  SETTING_KEYS.uploadMaxActualSizeMb,
  SETTING_KEYS.uploadMaxInputSizeMb,
  SETTING_KEYS.userGlobalSettingsDefaults,
  SETTING_KEYS.vectorEmbeddingModel,
  SETTING_KEYS.vectorEmbeddingProvider,
  SETTING_KEYS.vectorQueryMode,
  SETTING_KEYS.vectorRerankerModel,
  SETTING_KEYS.vectorRerankerProvider,
] as const satisfies readonly AppSettingKey[];

export const buildSettingMaterializationUpdates = (
  values: Partial<AdminSettingsFormValues>,
): SettingUpdate[] => {
  const current = normalizeFormValues(values);

  return [
    ...SITE_CUSTOMIZATION_FIELDS.map((key) => ({
      key: SETTING_KEY_BY_FORM_FIELD[key],
      value: current[key],
    })),
    { key: SETTING_KEYS.aboutLinks, value: current.aboutLinks },
    { key: SETTING_KEYS.aboutPage, value: current.aboutPage },
    { key: SETTING_KEYS.helpMenuItems, value: current.helpMenuItems },
  ];
};

export const buildSettingUpdates = (
  currentValues: Partial<AdminSettingsFormValues>,
  initialValues: AdminSettingsFormValues,
): SettingUpdate[] => {
  const current = normalizeFormValues(currentValues);
  const initial = normalizeFormValues(initialValues);
  const updates: SettingUpdate[] = [];

  for (const key of SITE_CUSTOMIZATION_FIELDS) {
    if (current[key] !== initial[key])
      updates.push({ key: SETTING_KEY_BY_FORM_FIELD[key], value: current[key] });
  }

  if (JSON.stringify(current.helpMenuItems) !== JSON.stringify(initial.helpMenuItems)) {
    updates.push({ key: SETTING_KEYS.helpMenuItems, value: current.helpMenuItems });
  }

  if (JSON.stringify(current.aboutLinks) !== JSON.stringify(initial.aboutLinks)) {
    updates.push({ key: SETTING_KEYS.aboutLinks, value: current.aboutLinks });
  }

  if (JSON.stringify(current.aboutPage) !== JSON.stringify(initial.aboutPage)) {
    updates.push({ key: SETTING_KEYS.aboutPage, value: current.aboutPage });
  }

  return updates;
};

export const getAdminSettingsRefreshKeys = (updates: SettingUpdate[]) => {
  const runtimeKeys = new Set([
    SETTING_KEYS.defaultAgentAvatar,
    SETTING_KEYS.defaultAgentModel,
    SETTING_KEYS.defaultAgentName,
    SETTING_KEYS.defaultAgentProvider,
    SETTING_KEYS.defaultImageModel,
    SETTING_KEYS.defaultImageProvider,
    SETTING_KEYS.defaultVideoModel,
    SETTING_KEYS.defaultVideoProvider,
    SETTING_KEYS.memoryUserMemoryEmbeddingModel,
    SETTING_KEYS.memoryUserMemoryEmbeddingProvider,
    SETTING_KEYS.memoryUserMemoryGatekeeperModel,
    SETTING_KEYS.memoryUserMemoryGatekeeperProvider,
    SETTING_KEYS.memoryUserMemoryLayerExtractorModel,
    SETTING_KEYS.memoryUserMemoryLayerExtractorProvider,
    SETTING_KEYS.memoryUserMemoryPersonaWriterModel,
    SETTING_KEYS.memoryUserMemoryPersonaWriterProvider,
    SETTING_KEYS.communitySkillUseButtonLabel,
  ]);
  const needsRuntimeRefresh = updates.some((update) => runtimeKeys.has(update.key as any));
  const brandKeys = new Set([
    SETTING_KEYS.aboutLogoUrl,
    SETTING_KEYS.brandAuthTitle,
    SETTING_KEYS.brandCopyrightText,
    SETTING_KEYS.brandFaviconUrl,
    SETTING_KEYS.brandLogoUrl,
    SETTING_KEYS.brandLoadingText,
    SETTING_KEYS.brandLoadingSvgUrl,
    SETTING_KEYS.brandName,
    SETTING_KEYS.brandPrimaryColor,
    SETTING_KEYS.brandSlogan,
    SETTING_KEYS.homeMessengerBannerTitle,
    SETTING_KEYS.homeMessengerEnabled,
    SETTING_KEYS.communityForkAndChatLabel,
    SETTING_KEYS.communitySkillUseButtonLabel,
    SETTING_KEYS.sidebarGenerationLabel,
    SETTING_KEYS.sidebarMemberLabel,
    SETTING_KEYS.sidebarMemberUrl,
    SETTING_KEYS.defaultSkillName,
  ]);
  const needsBrandRefresh = updates.some((update) => brandKeys.has(update.key as any));
  const needsProfileInterestRefresh = updates.some(
    (update) => update.key === SETTING_KEYS.profileInterestAreas,
  );
  const needsHelpMenuRefresh = updates.some((update) => update.key === SETTING_KEYS.helpMenuItems);
  const needsPlanFaqRefresh = updates.some((update) => update.key === SETTING_KEYS.plansFaqItems);
  const needsAboutLinksRefresh = updates.some((update) => update.key === SETTING_KEYS.aboutLinks);
  const needsAboutPageRefresh = updates.some((update) => update.key === SETTING_KEYS.aboutPage);

  return [
    ...(needsRuntimeRefresh ? [RUNTIME_CONFIG_SWR_KEY, USER_STATE_SWR_KEY] : []),
    ...(needsBrandRefresh ? [BRAND_CONFIG_SWR_KEY] : []),
    ...(needsHelpMenuRefresh ? [PUBLIC_HELP_MENU_SWR_KEY] : []),
    ...(needsPlanFaqRefresh ? [PUBLIC_PLAN_FAQ_SWR_KEY] : []),
    ...(needsAboutLinksRefresh ? [PUBLIC_ABOUT_LINKS_SWR_KEY] : []),
    ...(needsAboutPageRefresh ? [PUBLIC_ABOUT_PAGE_SWR_KEY] : []),
    ...(needsProfileInterestRefresh ? [PROFILE_INTEREST_AREAS_SWR_KEY] : []),
  ];
};
