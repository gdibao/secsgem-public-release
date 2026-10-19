import { defineConfig } from '@/libs/next/proxy/define-config';

const { middleware } = defineConfig();

// required to be literal
export const config = {
  matcher: [
    // NOTE: `/api`, `/trpc`, `/webapi` are intentionally NOT matched. The
    // middleware is a no-op for them — `defaultMiddleware` short-circuits the
    // rewrite half via `backendApiEndpoints`, and they're all public routes, so
    // the better-auth session lookup is skipped. Auth lives in the route
    // handlers (`checkAuth`, trpc `protectedProcedure`), which return JSON 401s
    // rather than the HTML redirect-to-signin. Skipping the matcher avoids a
    // needless middleware invocation on the hottest backend traffic. (/oidc and
    // /oauth stay matched below — their middleware pass is still load-bearing.)
    // include the /
    '/',
    '/acceptance',
    '/acceptance(.*)',
    '/apps',
    '/apps(.*)',
    '/community',
    '/community(.*)',
    '/labs',
    '/eval',
    '/eval(.*)',
    /** Shared-agent pages need the same SPA rewrite as the other client routes. */
    '/a',
    '/a/(.*)',
    '/agent',
    '/agent(.*)',
    '/group',
    '/group(.*)',
    '/changelog(.*)',
    '/settings(.*)',
    '/design',
    '/discover',
    '/discover(.*)',
    '/engineering-tools(.*)',
    '/image',
    '/ppt',
    '/video',
    '/resource',
    '/resource(.*)',
    '/profile(.*)',
    '/page',
    '/page(.*)',
    '/tasks',
    '/tasks(.*)',
    '/task',
    '/task(.*)',
    '/goals',
    '/goals(.*)',
    '/goal',
    '/goal(.*)',
    '/me',
    '/me(.*)',
    '/apps',
    '/apps(.*)',
    '/share(.*)',

    // Workspace routes mirror the main SPA below `/:workspaceSlug`. Keep this
    // list aligned with WORKSPACE_MIRRORED_FIRST_SEGMENTS; without these
    // matchers Next serves a 404 before the SPA router can resolve the slug.
    '/:workspaceSlug/agent(.*)',
    '/:workspaceSlug/agents(.*)',
    '/:workspaceSlug/community(.*)',
    '/:workspaceSlug/eval(.*)',
    '/:workspaceSlug/engineering-tools(.*)',
    '/:workspaceSlug/group(.*)',
    '/:workspaceSlug/image(.*)',
    '/:workspaceSlug/memory(.*)',
    '/:workspaceSlug/page(.*)',
    '/:workspaceSlug/project(.*)',
    '/:workspaceSlug/projects(.*)',
    '/:workspaceSlug/resource(.*)',
    '/:workspaceSlug/settings(.*)',
    '/:workspaceSlug/task(.*)',
    '/:workspaceSlug/tasks(.*)',
    '/:workspaceSlug/video(.*)',

    '/onboarding',
    '/onboarding(.*)',

    '/signup(.*)',
    '/signin(.*)',
    '/verify-email(.*)',
    '/bind-phone(.*)',
    '/verify-im(.*)',
    '/verify',
    '/verify/(.*)',
    '/reset-password(.*)',
    '/auth-error(.*)',
    '/oauth(.*)',
    '/oidc(.*)',
    '/market-auth-callback(.*)',
  ],
};

export default middleware;
