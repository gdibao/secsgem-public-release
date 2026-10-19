import { getDesktopEnv } from '@/env';
import { netFetch } from '@/utils/net-fetch';

const PUBLIC_BRAND_ENDPOINT = 'trpc/lambda/admin.settings.getPublicBrand';
const FALLBACK_BRAND_NAME = '驰拓AI';
const BRAND_REQUEST_TIMEOUT = 1200;

type PublicBrandPayload = {
  loadingText?: unknown;
  loadingSvgUrl?: unknown;
  name?: unknown;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const normalizeText = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const resolveLoadingSvgUrl = (value: string) => {
  const baseUrl = normalizeText(getDesktopEnv().OFFICIAL_CLOUD_SERVER);
  if (!baseUrl) return undefined;

  try {
    const resolvedUrl = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(resolvedUrl.protocol)) return undefined;

    return resolvedUrl.toString();
  } catch {
    return undefined;
  }
};

const getPublicBrandUrl = () => {
  const baseUrl = getDesktopEnv().OFFICIAL_CLOUD_SERVER || '';
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return new URL(PUBLIC_BRAND_ENDPOINT, normalizedBaseUrl).toString();
};

const readPublicBrand = (responseJson: any): PublicBrandPayload => {
  return responseJson?.result?.data?.json ?? {};
};

export const fetchPublicBrand = async (): Promise<PublicBrandPayload> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRAND_REQUEST_TIMEOUT);

  try {
    const response = await netFetch(getPublicBrandUrl(), {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) return {};

    return readPublicBrand(await response.json());
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
};

export const buildSplashHtml = (brand: PublicBrandPayload) => {
  const brandName = normalizeText(brand.name) ?? FALLBACK_BRAND_NAME;
  const loadingText = normalizeText(brand.loadingText);
  const loadingSvgUrl = normalizeText(brand.loadingSvgUrl);
  const resolvedLoadingSvgUrl = loadingSvgUrl ? resolveLoadingSvgUrl(loadingSvgUrl) : undefined;
  const safeBrandName = escapeHtml(brandName);
  const safeLoadingText = loadingText ? escapeHtml(loadingText) : '';
  const loadingBrandHtml = resolvedLoadingSvgUrl
    ? `<img alt="${safeBrandName}" class="brand-loading-svg" src="${escapeHtml(resolvedLoadingSvgUrl)}" />`
    : `<div class="brand-name">${safeBrandName}</div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeBrandName}</title>
    <style>
      .drag-bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 48px;
        -webkit-app-region: drag;
      }

      body {
        margin: 0;
        padding: 48px 0 0;
        height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
        color: #1f1f1f;
        font-family:
          -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }

      @media (prefers-color-scheme: dark) {
        body {
          color: #f5f5f5;
          background: #000;
        }
      }

      .container {
        text-align: center;
        user-select: none;
      }

      .brand-name {
        font-size: 32px;
        font-weight: 650;
        line-height: 1.25;
      }

      .brand-loading-svg {
        display: block;
        height: 40px;
        max-width: 240px;
        object-fit: contain;
      }

      .brand-loading-text {
        margin-top: 12px;
        font-size: 15px;
        line-height: 1.5;
        opacity: 0.62;
      }
    </style>
  </head>
  <body>
    <div class="drag-bar"></div>
    <main class="container" aria-label="${safeBrandName}">
      ${loadingBrandHtml}
      ${safeLoadingText ? `<div class="brand-loading-text">${safeLoadingText}</div>` : ''}
    </main>
  </body>
</html>`;
};

export const buildSplashDataUrl = async () => {
  const brand = await fetchPublicBrand();
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildSplashHtml(brand))}`;
};
