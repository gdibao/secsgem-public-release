import path from 'node:path';

import type { Plugin } from 'vite';

interface MobileHtmlRequest {
  accept?: string;
  method?: string;
  url?: string;
}

const PROXY_PATH_PREFIXES = ['/api', '/oidc', '/trpc', '/webapi'];

export const resolveMobileHtmlFallback = ({ accept, method, url }: MobileHtmlRequest) => {
  if (!url || !accept?.includes('text/html')) return;
  if (method && method !== 'GET' && method !== 'HEAD') return;

  const requestUrl = new URL(url, 'http://localhost');
  const { pathname } = requestUrl;

  if (pathname === '/index.mobile.html') return;
  if (
    PROXY_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  )
    return;

  const extension = path.posix.extname(pathname);
  if (extension && pathname !== '/index.html') return;

  return `/index.mobile.html${requestUrl.search}`;
};

export const mobileHtmlFallback = (): Plugin => ({
  name: 'lobe-mobile-html-fallback',
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const fallbackUrl = resolveMobileHtmlFallback({
        accept: request.headers.accept,
        method: request.method,
        url: request.url,
      });

      if (fallbackUrl) request.url = fallbackUrl;
      next();
    });
  },
});
