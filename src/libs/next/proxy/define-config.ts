import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UAParser } from 'ua-parser-js';
import urlJoin from 'url-join';

import { auth } from '@/auth';
import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { hasVerifiedPhoneIdentity, isPhoneBindingExempt } from '@/libs/better-auth/phone-identity';
import { type Locales } from '@/locales/resources';
import { parseBrowserLanguage } from '@/utils/locale';
import { DEFAULT_LANG, locales, RouteVariants } from '@/utils/server/routeVariants';

import { nextjsOnlyRoutes } from '../nextjsOnlyRoutes';
import { isShareSpaRoute } from '../shareRoutes';
import { isAlwaysWorkbenchSpaRoute, isWorkbenchSpaRoute } from '../workbenchRoutes';
import { createRouteMatcher } from './createRouteMatcher';

// Create debug logger instances
const logDefault = debug('middleware:default');
const logBetterAuth = debug('middleware:better-auth');

// Dev-only debug proxy route should bypass all middleware rewrites.
const dangerousLocalDevProxyRoute = '/_dangerous_local_dev_proxy';

// The locale is embedded raw into rewrite paths (/${locale}, /spa/${route}).
// An unvalidated value (e.g. ?hl=../../api/dev) would let the URL parser collapse the
// traversal and rewrite to a confused internal target, so allowlist it before use.
const toSafeLocale = (locale: string): Locales =>
  (locales as readonly string[]).includes(locale) ? (locale as Locales) : DEFAULT_LANG;

const persistLocaleCookie = (
  response: NextResponse,
  request: NextRequest,
  explicitlyLocale: Locales | undefined,
) => {
  if (!explicitlyLocale) return;
  const existingLocale = request.cookies.get(LOBE_LOCALE_COOKIE)?.value as Locales | undefined;
  if (existingLocale) return;
  response.cookies.set(LOBE_LOCALE_COOKIE, explicitlyLocale, {
    // 90 days is a balanced persistence for locale preference
    maxAge: 60 * 60 * 24 * 90,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
};

export function defineConfig() {
  const comhubDefaultPublicLocale: Locales = 'zh-CN';
  // `/oauth/connector` is a backend route handler (custom connector OAuth callback);
  // the rest of `/oauth/*` (e.g. /oauth/callback/success) are SPA pages, so scope
  // the passthrough to the connector subtree only.
  const backendApiEndpoints = ['/api', '/trpc', '/webapi', '/oidc', '/oauth/connector'];

  const defaultMiddleware = (request: NextRequest) => {
    const url = new URL(request.url);
    logDefault('Processing request: %s %s', request.method, request.url);

    // Public installation instructions must remain readable by coding agents.
    if (url.pathname === '/acceptance/skill.md') return NextResponse.next();

    // skip all api requests
    if (backendApiEndpoints.some((path) => url.pathname.startsWith(path))) {
      logDefault('Skipping API request: %s', url.pathname);
      return NextResponse.next();
    }

    // locale has three levels
    // 1. search params
    // 2. cookie
    // 3. browser

    // highest priority is explicitly in search params, like ?hl=zh-CN
    const explicitlyLocale = (url.searchParams.get('hl') || undefined) as Locales | undefined;

    // if it's a new user, there's no cookie, So we need to use the fallback language parsed by accept-language
    // ComHub defaults public entry shells to Chinese while still honoring ?hl=
    // and a user's explicit LOBE_LOCALE cookie from the language switcher.
    const browserLanguage = parseBrowserLanguage(request.headers, comhubDefaultPublicLocale);

    const locale =
      explicitlyLocale ||
      ((request.cookies.get(LOBE_LOCALE_COOKIE)?.value || browserLanguage) as Locales);

    const ua = request.headers.get('user-agent');

    const device = new UAParser(ua || '').getDevice();

    logDefault('User preferences: %O', {
      browserLanguage,
      deviceType: device.type,
      hasCookies: {
        locale: !!request.cookies.get(LOBE_LOCALE_COOKIE)?.value,
      },
      locale,
    });

    // Routes outside the dedicated Share/Workbench shells still use the
    // responsive desktop pages, including the acceptance decision page.
    const desktopOnlyPaths = ['/share', '/verify', '/acceptance'];
    const isDesktopOnlyPath = desktopOnlyPaths.some(
      (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
    );

    const safeLocale = toSafeLocale(locale);

    // 2. Create normalized preference values
    const isHandheld = device.type === 'mobile' || device.type === 'tablet';
    const route = RouteVariants.serializeVariants({
      isMobile: !isDesktopOnlyPath && isHandheld,
      locale: safeLocale,
    });

    logDefault('Serialized route variant: %s', route);

    // if app is in docker, rewrite to self container
    // https://github.com/lobehub/lobe-chat/issues/5876
    if (appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL) {
      logDefault('Local container rewrite enabled: %O', {
        host: '127.0.0.1',
        original: url.toString(),
        port: process.env.PORT || '3210',
        protocol: 'http',
      });

      url.protocol = 'http';
      url.host = '127.0.0.1';
      url.port = process.env.PORT || '3210';
    }

    if (
      url.pathname === dangerousLocalDevProxyRoute ||
      url.pathname.startsWith(`${dangerousLocalDevProxyRoute}/`)
    ) {
      logDefault('Skipping rewrite for dangerous local dev proxy route: %s', url.pathname);
      return NextResponse.next();
    }

    // Share pages are responsive on their own, so they get one bundle for every
    // device rather than a mobile variant.
    if (isShareSpaRoute(url.pathname)) {
      const sharePath = `/spa-share/${safeLocale}${url.pathname}`;
      logDefault('Share SPA route, rewriting to: %s', sharePath);
      url.pathname = sharePath;

      const response = NextResponse.rewrite(url);
      persistLocaleCookie(response, request, explicitlyLocale);

      return response;
    }

    if (
      isAlwaysWorkbenchSpaRoute(url.pathname) ||
      (isHandheld && isWorkbenchSpaRoute(url.pathname))
    ) {
      const workbenchPath = `/spa-workbench/${safeLocale}${url.pathname}`;
      logDefault('Workbench SPA route, rewriting to: %s', workbenchPath);
      url.pathname = workbenchPath;

      const response = NextResponse.rewrite(url);
      persistLocaleCookie(response, request, explicitlyLocale);

      return response;
    }

    const isMobileDiscoverRoute = isHandheld && url.pathname === '/discover';
    const isNextjsRoute =
      !isMobileDiscoverRoute &&
      nextjsOnlyRoutes.some(
        (route) => url.pathname === route || url.pathname.startsWith(`${route}/`),
      );

    // SPA routes: rewrite to /spa/[variants]/[...path] catch-all
    if (!isNextjsRoute) {
      const spaPath = `/spa/${route}${url.pathname === '/' ? '' : url.pathname}`;
      logDefault('SPA route, rewriting to: %s', spaPath);
      url.pathname = spaPath;

      const response = NextResponse.rewrite(url);
      persistLocaleCookie(response, request, explicitlyLocale);

      return response;
    }

    // Next.js App Router routes: rewrite with variants prefix
    const nextPathname = `/${route}` + (url.pathname === '/' ? '' : url.pathname);
    const nextURL = appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL
      ? urlJoin(url.origin, nextPathname)
      : nextPathname;

    logDefault('URL rewrite: %O', {
      isLocalRewrite: appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL,
      nextPathname,
      nextURL,
      originalPathname: url.pathname,
    });

    url.pathname = nextPathname;

    logDefault('nextURL after rewrite: %s', url.toString());
    // build rewrite response first
    const rewrite = NextResponse.rewrite(url, { status: 200 });

    persistLocaleCookie(rewrite, request, explicitlyLocale);

    return rewrite;
  };

  const isPublicRoute = createRouteMatcher([
    // backend api
    '/api/v1(.*)', // OpenAPI routes should use OpenAPI auth (API Key/OIDC), not BetterAuth session
    '/api/auth(.*)',
    '/api/webhooks(.*)',
    '/api/workflows(.*)',
    '/api/agent(.*)',
    '/api/dev(.*)',
    '/webapi(.*)',
    '/trpc(.*)',
    // version
    '/api/version',
    '/api/desktop/(.*)',
    // CI/CD service endpoint; the route performs its own Bearer token check.
    '/api/admin/desktop-release',
    // Composio OAuth callback — hit via a cross-site redirect from the provider
    // after Composio-managed auth; only renders a popup-closing page, so it must
    // not be session-gated.
    '/api/composio/oauth/callback',
    // better auth
    '/signin',
    '/signup',
    '/auth-error',
    '/verify-email',
    '/reset-password',
    '/bind-phone',
    // oauth
    // Make only the consent view public (GET page), not other oauth paths
    '/oauth/consent/(.*)',
    // Custom connector OAuth callback — hit via a cross-site redirect from the
    // provider, carries its own code+state, so it must not be session-gated.
    '/oauth/connector/callback',
    '/oidc/handoff',
    '/oidc/device/auth',
    '/oidc/token',
    // Interaction details for the consent/login page — must be reachable
    // before the user has a session, so it cannot be session-gated.
    '/oidc/interaction/(.*)',
    // market
    '/market-auth-callback',
    // public share pages
    '/share(.*)',
    // standalone verification report viewer — the run id in the URL is the
    // read-only capability for viewing the report without a signed-in session.
    '/verify/(.*)',
    // acceptance decision page — same shape as /verify/:id: the id is the
    // capability; the tRPC layer enforces the aggregate's `visibility` (a
    // private aggregate 404s for anyone but the owner / workspace members).
    '/acceptance/(.*)',
    // messenger verify-im — page itself handles unauth (in-page sign-in CTA)
    // and the random_id token is the actual capability check; no need for
    // session-protected access at the middleware layer.
    '/verify-im',
  ]);

  const betterAuthMiddleware = async (req: NextRequest) => {
    logBetterAuth('BetterAuth middleware processing request: %s %s', req.method, req.url);

    const legacyDiscoverPath = req.nextUrl.pathname;
    const isLegacyDiscoverPath =
      legacyDiscoverPath === '/discover' || legacyDiscoverPath.startsWith('/discover/');
    const deviceType = new UAParser(req.headers.get('user-agent') || '').getDevice().type;
    const isMobile = deviceType === 'mobile' || deviceType === 'tablet';

    if (isLegacyDiscoverPath && !isMobile) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = legacyDiscoverPath.replace(/^\/discover/, '/community');

      return Response.redirect(redirectUrl, 308);
    }

    const response = defaultMiddleware(req);

    // when enable auth protection, only public route is not protected, others are all protected
    const isProtected = !isPublicRoute(req);

    logBetterAuth('Route protection status: %s, %s', req.url, isProtected ? 'protected' : 'public');

    // Skip session lookup for public routes to reduce latency
    if (!isProtected) return response;

    // Get full session with user data (Next.js 15.2.0+ feature)
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    const isLoggedIn = !!session?.user;

    logBetterAuth('BetterAuth session status: %O', {
      isLoggedIn,
      userId: session?.user?.id,
    });

    if (!isLoggedIn) {
      // If request a protected route, redirect to sign-in page
      if (isProtected) {
        logBetterAuth('Request a protected route, redirecting to sign-in page');

        const callbackUrl = `${appEnv.APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`;
        const signInUrl = new URL('/signin', appEnv.APP_URL);
        signInUrl.searchParams.set('callbackUrl', callbackUrl);
        const hl = req.nextUrl.searchParams.get('hl');
        if (hl) {
          signInUrl.searchParams.set('hl', hl);
          logBetterAuth('Preserving locale to sign-in: hl=%s', hl);
        }
        // Preserve marketing attribution (e.g. sign-ups originating from Market)
        // so it survives the auth detour and reaches the sign-up page.
        const utmSource = req.nextUrl.searchParams.get('utm_source');
        if (utmSource) {
          signInUrl.searchParams.set('utm_source', utmSource);
          logBetterAuth('Preserving utm_source to sign-in: %s', utmSource);
        }
        return Response.redirect(signInUrl);
      }
      logBetterAuth('Request a free route but not login, allow visit without auth header');
    }

    if (
      authEnv.AUTH_PHONE_BINDING_REQUIRED &&
      session?.user?.id &&
      !hasVerifiedPhoneIdentity(session.user) &&
      !isPhoneBindingExempt(session.user.id, authEnv.AUTH_PHONE_BINDING_EXEMPT_USER_IDS)
    ) {
      // The session cookie cache can retain the pre-binding user for up to two minutes.
      // Re-read only this exceptional path from the database so a successful SMS binding
      // can return immediately without a redirect loop.
      const freshSession = await auth.api.getSession({
        headers: req.headers,
        query: { disableCookieCache: true },
      });
      if (freshSession?.user && hasVerifiedPhoneIdentity(freshSession.user)) return response;

      const bindingUrl = new URL('/bind-phone', appEnv.APP_URL);
      bindingUrl.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);
      return Response.redirect(bindingUrl);
    }

    return response;
  };

  logDefault('Middleware configuration: %O', { enableOIDC: authEnv.ENABLE_OIDC });

  return { middleware: betterAuthMiddleware };
}
