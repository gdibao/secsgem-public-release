import {
  APPLE_APP_STORE_ID,
  BRANDING_LOGO_URL,
  BRANDING_NAME,
  ORG_NAME,
} from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';

import { DEFAULT_LANG } from '@/const/locale';
import { OFFICIAL_URL } from '@/const/url';
import { isCustomBranding, isCustomORG } from '@/const/version';
import { getServerBrand } from '@/server/services/brand';
import { translation } from '@/server/translation';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

const isDev = process.env.NODE_ENV === 'development';

export const generateMetadata = async (props: DynamicLayoutProps) => {
  const locale = await RouteVariants.getLocale(props);
  const { t } = await translation('metadata', locale);
  const brand = await getServerBrand();
  const appName = brand.name?.trim() || BRANDING_NAME;
  const faviconUrl = brand.faviconUrl?.trim();

  return {
    alternates: {
      canonical: OFFICIAL_URL,
    },
    appleWebApp: {
      statusBarStyle: 'black-translucent',
      title: appName,
    },
    description: t('chat.description', { appName }),
    icons:
      faviconUrl ||
      (isCustomBranding
        ? BRANDING_LOGO_URL
        : {
            apple: '/apple-touch-icon.png?v=chituo-20260924',
            icon: isDev ? '/favicon-dev.ico' : '/favicon.ico?v=chituo-20260924',
            shortcut: isDev ? '/favicon-32x32-dev.ico' : '/favicon-32x32.ico?v=chituo-20260924',
          }),
    ...(APPLE_APP_STORE_ID ? { itunes: { appId: APPLE_APP_STORE_ID } } : {}),
    manifest: '/manifest.json',
    metadataBase: new URL(OFFICIAL_URL),
    openGraph: {
      description: t('chat.description', { appName }),
      images: [
        {
          alt: t('chat.title', { appName }),
          height: 640,
          url: OG_URL,
          width: 1200,
        },
      ],
      locale: DEFAULT_LANG,
      siteName: appName,
      title: appName,
      type: 'website',
      url: OFFICIAL_URL,
    },
    title: {
      default: t('chat.title', { appName }),
      template: `%s · ${appName}`,
    },
    twitter: {
      card: 'summary_large_image',
      description: t('chat.description', { appName }),
      images: [OG_URL],
      site: isCustomORG ? `@${ORG_NAME}` : '@lobehub',
      title: t('chat.title', { appName }),
    },
  };
};
