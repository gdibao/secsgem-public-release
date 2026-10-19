import { normalizeAboutLinksConfig, normalizeAboutPageConfig } from '@/const/aboutLinks';
import { normalizeAvatarPresets } from '@/const/avatarPresets';
import { DEFAULT_RUNTIME_BRAND } from '@/const/brand';
import { normalizeHelpMenuItems } from '@/const/helpMenu';
import { publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { loadCachedMobileFeaturedAssistants } from '@/server/services/mobileFeaturedAssistants';

import {
  buildDesktopSettings,
  buildExpertPlazaSettings,
  buildGrowthSettings,
  buildNotificationSettings,
  buildOperationsSettings,
  buildRecommendationSettings,
} from '../adminReadModel';
import { loadAppSettingsSectionSnapshot, loadAppSettingsSnapshot } from '../loader';
import { SETTING_KEYS, toString } from '../procedureShared';
import { loadMobileConfigPublication } from './mobilePublicationProcedures';
import { normalizePublicBrandName } from './publicBrand';

const publicDbProcedure = publicProcedure.use(serverDatabase);
const toBoolean = (value: unknown, fallback = false) =>
  typeof value === 'boolean' ? value : fallback;
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

export const publicSettingsProcedures = {
  getPublicMobileConfig: publicDbProcedure.query(async ({ ctx }) => {
    const { published } = await loadMobileConfigPublication(ctx.serverDB);
    const config = published.config;
    const featuredAssistants = await loadCachedMobileFeaturedAssistants(ctx.serverDB, published);

    return {
      ...config,
      discover: { ...config.discover, featuredAssistants },
    };
  }),
  getPublicBrand: publicDbProcedure.query(async ({ ctx }) => {
    const snapshot = await loadAppSettingsSnapshot(ctx.serverDB, [
      SETTING_KEYS.brandName,
      SETTING_KEYS.brandLogoUrl,
      SETTING_KEYS.brandFaviconUrl,
      SETTING_KEYS.brandPrimaryColor,
      SETTING_KEYS.brandSlogan,
      SETTING_KEYS.brandLoadingText,
      SETTING_KEYS.brandLoadingSvgUrl,
      SETTING_KEYS.brandAuthTitle,
      SETTING_KEYS.brandCopyrightText,
      SETTING_KEYS.defaultSkillName,
      SETTING_KEYS.homeMessengerEnabled,
      SETTING_KEYS.homeMessengerBannerTitle,
      SETTING_KEYS.communityForkAndChatLabel,
      SETTING_KEYS.sidebarMemberLabel,
      SETTING_KEYS.sidebarMemberUrl,
      SETTING_KEYS.sidebarGenerationLabel,
    ]);
    const name = snapshot.get(SETTING_KEYS.brandName);
    const brandName = normalizePublicBrandName(name);
    const favicon = snapshot.get(SETTING_KEYS.brandFaviconUrl);
    const logo = snapshot.get(SETTING_KEYS.brandLogoUrl);
    const primary = snapshot.get(SETTING_KEYS.brandPrimaryColor);
    const loadingText = snapshot.get(SETTING_KEYS.brandLoadingText);
    const loadingSvgUrl = snapshot.get(SETTING_KEYS.brandLoadingSvgUrl);
    const authTitle = snapshot.get(SETTING_KEYS.brandAuthTitle);
    const copyrightText = snapshot.get(SETTING_KEYS.brandCopyrightText);
    const defaultSkillName = snapshot.get(SETTING_KEYS.defaultSkillName);
    const homeMessengerBannerTitle = snapshot.get(SETTING_KEYS.homeMessengerBannerTitle);
    const communityForkAndChatLabel = snapshot.get(SETTING_KEYS.communityForkAndChatLabel);
    const sidebarGenerationLabel = snapshot.get(SETTING_KEYS.sidebarGenerationLabel);
    const sidebarMemberLabel = snapshot.get(SETTING_KEYS.sidebarMemberLabel);
    const sidebarMemberUrl = snapshot.get(SETTING_KEYS.sidebarMemberUrl);
    const slogan = snapshot.get(SETTING_KEYS.brandSlogan);

    return {
      authTitle:
        typeof authTitle === 'string' && authTitle.trim()
          ? authTitle
          : DEFAULT_RUNTIME_BRAND.authTitle,
      communityForkAndChatLabel:
        typeof communityForkAndChatLabel === 'string' && communityForkAndChatLabel.trim()
          ? communityForkAndChatLabel
          : null,
      copyrightText:
        typeof copyrightText === 'string' && copyrightText.trim()
          ? copyrightText
          : DEFAULT_RUNTIME_BRAND.copyrightText,
      defaultSkillName:
        typeof defaultSkillName === 'string' && defaultSkillName.trim()
          ? defaultSkillName
          : brandName,
      faviconUrl: typeof favicon === 'string' ? favicon : null,
      homeMessengerBannerTitle:
        typeof homeMessengerBannerTitle === 'string' && homeMessengerBannerTitle.trim()
          ? homeMessengerBannerTitle
          : null,
      homeMessengerEnabled: toBoolean(snapshot.get(SETTING_KEYS.homeMessengerEnabled), true),
      loadingSvgUrl:
        typeof loadingSvgUrl === 'string' && loadingSvgUrl.trim() ? loadingSvgUrl.trim() : null,
      loadingText:
        typeof loadingText === 'string' && loadingText.trim()
          ? loadingText
          : DEFAULT_RUNTIME_BRAND.loadingText,
      logoUrl: typeof logo === 'string' ? logo : DEFAULT_RUNTIME_BRAND.logoUrl,
      name: brandName,
      primaryColor: typeof primary === 'string' ? primary : DEFAULT_RUNTIME_BRAND.primaryColor,
      sidebarGenerationLabel:
        typeof sidebarGenerationLabel === 'string' && sidebarGenerationLabel.trim()
          ? sidebarGenerationLabel
          : '生成',
      sidebarMemberLabel:
        typeof sidebarMemberLabel === 'string' && sidebarMemberLabel.trim()
          ? sidebarMemberLabel
          : '会员',
      sidebarMemberUrl:
        typeof sidebarMemberUrl === 'string' && sidebarMemberUrl.trim()
          ? sidebarMemberUrl
          : '/settings/plans',
      slogan:
        typeof slogan === 'string' && slogan.trim() ? slogan : DEFAULT_RUNTIME_BRAND.authTitle,
    };
  }),
  getPublicRecommendations: publicDbProcedure.query(async ({ ctx }) =>
    buildRecommendationSettings(
      await loadAppSettingsSectionSnapshot(ctx.serverDB, 'recommendations'),
    ),
  ),
  getPublicOperations: publicDbProcedure.query(async ({ ctx }) =>
    buildOperationsSettings(await loadAppSettingsSectionSnapshot(ctx.serverDB, 'operations')),
  ),
  getPublicGrowth: publicDbProcedure.query(async ({ ctx }) =>
    buildGrowthSettings(await loadAppSettingsSectionSnapshot(ctx.serverDB, 'growth')),
  ),
  getPublicExpertPlaza: publicDbProcedure.query(async ({ ctx }) =>
    buildExpertPlazaSettings(await loadAppSettingsSectionSnapshot(ctx.serverDB, 'expert-plaza')),
  ),
  getPublicProfileOptions: publicDbProcedure.query(async ({ ctx }) => {
    const snapshot = await loadAppSettingsSnapshot(ctx.serverDB, [
      SETTING_KEYS.profileInterestAreas,
      SETTING_KEYS.profileAvatarPresets,
    ]);

    return {
      avatarPresets: normalizeAvatarPresets(snapshot.get(SETTING_KEYS.profileAvatarPresets)),
      interestAreas: normalizeProfileInterestAreas(snapshot.get(SETTING_KEYS.profileInterestAreas)),
    };
  }),
  getPublicNotificationConfig: publicDbProcedure.query(async ({ ctx }) => {
    const settings = buildNotificationSettings(
      await loadAppSettingsSectionSnapshot(ctx.serverDB, 'notifications'),
    );

    return {
      desktopEnabled: settings.notificationDesktopEnabled,
      emailEnabled: settings.notificationEmailEnabled,
      eventDefaults: settings.notificationEventDefaults,
      inboxEnabled: settings.notificationInboxEnabled,
      pushEnabled: settings.notificationPushEnabled,
      system: {
        actionLabel: settings.notificationSystemActionLabel,
        actionUrl: settings.notificationSystemActionUrl || null,
        content: settings.notificationSystemContent,
        enabled: settings.notificationSystemEnabled,
        title: settings.notificationSystemTitle,
        type: settings.notificationSystemType,
      },
    };
  }),
  getPublicHelpMenu: publicDbProcedure.query(async ({ ctx }) => {
    const snapshot = await loadAppSettingsSnapshot(ctx.serverDB, [SETTING_KEYS.helpMenuItems]);
    return snapshot.has(SETTING_KEYS.helpMenuItems)
      ? normalizeHelpMenuItems(snapshot.get(SETTING_KEYS.helpMenuItems))
      : null;
  }),
  getPublicAboutLinks: publicDbProcedure.query(async ({ ctx }) => {
    const snapshot = await loadAppSettingsSnapshot(ctx.serverDB, [
      SETTING_KEYS.aboutLinks,
      SETTING_KEYS.aboutLogoUrl,
      SETTING_KEYS.brandLogoUrl,
    ]);

    return {
      links: normalizeAboutLinksConfig(snapshot.get(SETTING_KEYS.aboutLinks)),
      logoUrl:
        toString(snapshot.get(SETTING_KEYS.aboutLogoUrl)) ||
        toString(snapshot.get(SETTING_KEYS.brandLogoUrl)) ||
        DEFAULT_RUNTIME_BRAND.logoUrl,
    };
  }),
  getPublicAboutPage: publicDbProcedure.query(async ({ ctx }) => {
    const snapshot = await loadAppSettingsSnapshot(ctx.serverDB, [SETTING_KEYS.aboutPage]);
    return normalizeAboutPageConfig(snapshot.get(SETTING_KEYS.aboutPage));
  }),
  getPublicDesktopUpdate: publicDbProcedure.query(async ({ ctx }) => {
    const settings = buildDesktopSettings(
      await loadAppSettingsSectionSnapshot(ctx.serverDB, 'desktop-update'),
    );

    return {
      autoCheck: settings.desktopUpdateConfig.autoCheck,
      channel: settings.desktopUpdateConfig.channel,
      checkIntervalMinutes: settings.desktopUpdateConfig.checkInterval,
      currentVersion: settings.desktopUpdateConfig.currentVersion || null,
      downloadLabel: settings.desktopDownloadLabel,
      downloadUrl: settings.desktopDownloadUrl,
      loginConfig: {
        cloudButtonLabel: settings.desktopLoginConfig.cloudButtonLabel || null,
        description: settings.desktopLoginConfig.description || null,
        footerText: settings.desktopLoginConfig.footerText || null,
        logoUrl: settings.desktopLoginConfig.logoUrl || null,
        title: settings.desktopLoginConfig.title || null,
        windowTitle: settings.desktopLoginConfig.windowTitle || null,
      },
      releaseNotes: settings.desktopUpdateConfig.releaseNotes || null,
      serverUrl: settings.desktopUpdateConfig.serverUrl,
    };
  }),
} as const;
