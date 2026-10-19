import { serverConfigKeys, userKeys } from '@/libs/swr/keys';

import { type AppSettingsSection } from './appSettingsRegistry';

export const ADMIN_SETTINGS_SWR_KEY = ['admin-settings'] as const;
export const ADMIN_SETTINGS_SECTION_SWR_KEY = (section: AppSettingsSection) =>
  ['admin-settings', 'section', section] as const;
export const ADMIN_DESKTOP_OVERVIEW_SWR_KEY = ['admin-desktop-overview'] as const;

export const getAdminSettingsWriteSWRKeys = (sections: readonly AppSettingsSection[]) => {
  const uniqueSections = Array.from(new Set(sections));

  return [
    ...uniqueSections.map(ADMIN_SETTINGS_SECTION_SWR_KEY),
    ...(uniqueSections.includes('desktop-update') ? [ADMIN_DESKTOP_OVERVIEW_SWR_KEY] : []),
    ADMIN_SETTINGS_SWR_KEY,
  ];
};

export const BRAND_CONFIG_SWR_KEY = 'brand-config';
export const PROFILE_INTEREST_AREAS_SWR_KEY = 'profile-interest-areas';
export const PROFILE_OPTIONS_SWR_KEY = 'profile-options';
export const PUBLIC_EXPERT_PLAZA_SWR_KEY = 'public-expert-plaza';
export const PUBLIC_ABOUT_LINKS_SWR_KEY = 'about-links';
export const PUBLIC_ABOUT_PAGE_SWR_KEY = 'public-about-page';
export const PUBLIC_HELP_MENU_SWR_KEY = 'public-help-menu';
export const PUBLIC_PLAN_FAQ_SWR_KEY = 'business-plan-faq';
export const RUNTIME_CONFIG_SWR_KEY = serverConfigKeys.get;
export const USER_STATE_SWR_KEY = userKeys.initState();
