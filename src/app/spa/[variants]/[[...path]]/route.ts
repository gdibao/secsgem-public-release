import { APPLE_APP_STORE_ID, BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';

import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { OFFICIAL_URL } from '@/const/url';
import { isCustomORG, isDesktop } from '@/const/version';
import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { pythonEnv } from '@/envs/python';
import { buildStaticLoadingBrandHtml, getBrandLoadingText } from '@/features/Brand/loadingBrand';
import { type Locales } from '@/locales/resources';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { getServerFileS3Config } from '@/server/services/appSettings';
import { getServerBrand } from '@/server/services/brand';
import { buildAnalyticsConfig, fetchViteDevTemplate, renderSpaHtml } from '@/server/spaHtml';
import { translation } from '@/server/translation';
import { type SPAClientEnv, type SPAServerConfig } from '@/types/spaServerConfig';
import { RouteVariants } from '@/utils/server/routeVariants';

export function generateStaticParams() {
  const mobileOptions = isDesktop ? [false] : [true, false];
  const staticLocales: Locales[] = ['en-US', 'zh-CN'];

  const variants: { variants: string }[] = [];

  for (const locale of staticLocales) {
    for (const isMobile of mobileOptions) {
      variants.push({
        variants: RouteVariants.serializeVariants({ isMobile, locale }),
      });
    }
  }

  return variants;
}

const isDev = process.env.NODE_ENV === 'development';

async function getTemplate(isMobile: boolean): Promise<string> {
  if (isDev) return fetchViteDevTemplate();

  const { desktopHtmlTemplate, mobileHtmlTemplate } = await import('./spaHtmlTemplates');

  return isMobile ? mobileHtmlTemplate : desktopHtmlTemplate;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

async function buildClientEnv(): Promise<SPAClientEnv> {
  const s3Config = await getServerFileS3Config();

  return {
    marketBaseUrl: appEnv.MARKET_BASE_URL,
    pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL,
    pyodidePipIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL,
    s3FilePath: s3Config.filePath || fileEnv.NEXT_PUBLIC_S3_FILE_PATH,
  };
}

async function buildSeoMeta(
  locale: string,
  brand: Awaited<ReturnType<typeof getServerBrand>>,
  isMobile: boolean,
): Promise<string> {
  const { t } = await translation('metadata', locale);
  const appName = brand.name?.trim() || BRANDING_NAME;
  const title = t('chat.title', { appName });
  const description = t('chat.description', { appName });

  const metas = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${OFFICIAL_URL}" />`,
    `<meta property="og:image" content="${OG_URL}" />`,
    `<meta property="og:site_name" content="${appName}" />`,
    `<meta property="og:locale" content="${locale}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${OG_URL}" />`,
    `<meta name="twitter:site" content="${isCustomORG ? `@${ORG_NAME}` : '@lobehub'}" />`,
  ];

  if (isMobile && APPLE_APP_STORE_ID) {
    metas.push(`<meta name="apple-itunes-app" content="app-id=${APPLE_APP_STORE_ID}" />`);
  }

  return metas.join('\n    ');
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[]; variants: string }> },
) {
  const { variants } = await params;
  const { locale, isMobile } = RouteVariants.deserializeVariants(variants);

  const serverConfig = await getServerGlobalConfig();
  const brand = await getServerBrand();
  const featureFlags = getServerFeatureFlagsValue();
  const analyticsConfig = buildAnalyticsConfig({ desktop: true });
  const clientEnv = await buildClientEnv();

  const spaConfig: SPAServerConfig = {
    analyticsConfig,
    brand,
    clientEnv,
    config: serverConfig,
    featureFlags,
    isMobile,
  };

  const template = await getTemplate(isMobile);
  const seoMeta = await buildSeoMeta(locale, brand, isMobile);
  const appName = brand.name?.trim() || BRANDING_NAME;
  const loadingText = getBrandLoadingText(
    { loadingText: brand.loadingText, name: appName, slogan: brand.slogan },
    appName,
  );
  const loadingSvgUrl = typeof brand.loadingSvgUrl === 'string' ? brand.loadingSvgUrl.trim() : '';
  const loadingBrandHtml = loadingSvgUrl
    ? buildStaticLoadingBrandHtml(loadingText, loadingSvgUrl)
    : undefined;

  return renderSpaHtml(template, {
    loadingBrandHtml: loadingBrandHtml
      ? `<div id="loading-brand" aria-label="${escapeHtml(loadingText)}" role="status">${loadingBrandHtml}</div>`
      : undefined,
    seoMeta,
    serverConfig: spaConfig,
  });
}
