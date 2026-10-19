/**
 * @vitest-environment node
 */
import { readFile } from 'node:fs/promises';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { LOBE_LOCALE_COOKIE } from '@/const/locale';

import { defineConfig } from './define-config';

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://example.com',
    MIDDLEWARE_REWRITE_THROUGH_LOCAL: false,
  },
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    ENABLE_OIDC: false,
  },
}));

beforeEach(() => {
  vi.mocked(auth.api.getSession).mockReset().mockResolvedValue(null);
});

const createRequest = (path: string, headers?: HeadersInit) => {
  const request = new NextRequest(new URL(path, 'https://example.com'), { headers });
  const cookieHeader = new Headers(headers).get('cookie');

  if (cookieHeader) {
    for (const item of cookieHeader.split(';')) {
      const [key, value] = item.trim().split('=');
      if (key && value) request.cookies.set(key, value);
    }
  }

  return request;
};

const getRewriteUrl = async (path: string, headers?: HeadersInit) => {
  const { middleware } = defineConfig();
  const response = await middleware(createRequest(path, headers));
  const rewrite = response.headers.get('x-middleware-rewrite');

  if (!rewrite) throw new Error('Expected middleware rewrite header');

  return new URL(rewrite);
};

const getAuthenticatedRewriteUrl = async (path: string, headers?: HeadersInit) => {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({ user: { id: 'user-1' } } as never);

  return getRewriteUrl(path, headers);
};

describe('defineConfig middleware locale routing', () => {
  it('serves sign-in through the upstream Next.js auth route with default zh-CN locale', async () => {
    const rewrite = await getRewriteUrl('/signin', {
      'accept-language': 'en-US,en;q=0.9',
    });

    expect(rewrite.pathname).toBe('/zh-CN__0/signin');
  });

  it('serves sign-in through the upstream Next.js auth route with locale cookie', async () => {
    const rewrite = await getRewriteUrl('/signin', {
      Cookie: `${LOBE_LOCALE_COOKIE}=en-US`,
    });

    expect(rewrite.pathname).toBe('/en-US__0/signin');
  });

  it('serves sign-in through the upstream Next.js auth route with query-string locale', async () => {
    const rewrite = await getRewriteUrl('/signin?hl=ja-JP', {
      Cookie: `${LOBE_LOCALE_COOKIE}=en-US`,
    });

    expect(rewrite.pathname).toBe('/ja-JP__0/signin');
  });
});

describe('defineConfig backend service routes', () => {
  it('allows desktop release writeback to use its own bearer token auth', async () => {
    const { middleware } = defineConfig();
    vi.mocked(auth.api.getSession).mockClear();

    const response = await middleware(
      createRequest('/api/admin/desktop-release', {
        authorization: 'Bearer release-token',
      }),
    );

    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBeNull();
  });
});

const mobileUserAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const tabletUserAgent =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

describe('defineConfig mobile workspace routes', () => {
  it('serves mobile discover through the SPA', async () => {
    const mobileRewrite = await getAuthenticatedRewriteUrl('/discover', {
      'user-agent': mobileUserAgent,
    });

    expect(mobileRewrite.pathname).toBe('/spa/zh-CN__1/discover');
  });

  it('serves tablet discover through the mobile SPA', async () => {
    const tabletRewrite = await getAuthenticatedRewriteUrl('/discover', {
      'user-agent': tabletUserAgent,
    });

    expect(tabletRewrite.pathname).toBe('/spa/zh-CN__1/discover');
  });

  it('redirects desktop legacy discover paths before authentication', async () => {
    const { middleware } = defineConfig();
    vi.mocked(auth.api.getSession).mockClear();

    const response = await middleware(createRequest('/discover/agent?source=legacy'));

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://example.com/community/agent?source=legacy',
    );
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });
});

describe('defineConfig locale path-traversal hardening', () => {
  it('falls back to en-US for a traversal locale (plain)', async () => {
    const rewrite = await getRewriteUrl('/signin?hl=../../api/dev/x');

    expect(rewrite.pathname).toBe('/en-US__0/signin');
  });

  it('falls back to en-US for a traversal locale (percent-encoded)', async () => {
    const rewrite = await getRewriteUrl('/signin?hl=..%2F..%2Fapi%2Fdev%2Fx');

    expect(rewrite.pathname).toBe('/en-US__0/signin');
  });

  it('does not treat workspace slugs beginning with an auth route as auth SPA pages', async () => {
    const rewrite = await getAuthenticatedRewriteUrl(
      '/oauth-preview-e2e-20260716/settings/oauth-apps?hl=en-US',
    );
    expect(rewrite.pathname).toMatch(
      /^\/spa\/[^/]+\/oauth-preview-e2e-20260716\/settings\/oauth-apps$/,
    );
  });
});

describe('defineConfig Workbench SPA rewrite', () => {
  it('routes verify through Workbench for every user agent', async () => {
    const mobileVerify = await getRewriteUrl('/verify/run-1?hl=en-US', {
      'user-agent': mobileUserAgent,
    });
    const desktopVerify = await getRewriteUrl('/verify/run-1?hl=en-US');
    const tabletVerify = await getRewriteUrl('/verify/run-1?hl=en-US', {
      'user-agent': tabletUserAgent,
    });

    expect(mobileVerify.pathname).toBe('/spa-workbench/en-US/verify/run-1');
    expect(desktopVerify.pathname).toBe('/spa-workbench/en-US/verify/run-1');
    expect(tabletVerify.pathname).toBe('/spa-workbench/en-US/verify/run-1');
  });

  it('keeps acceptance on the responsive desktop main SPA', async () => {
    const mobileAcceptance = await getRewriteUrl('/acceptance/acceptance-1?hl=en-US', {
      'user-agent': mobileUserAgent,
    });
    const desktopAcceptance = await getRewriteUrl('/acceptance/acceptance-1?hl=en-US');

    expect(mobileAcceptance.pathname).toBe('/spa/en-US__0/acceptance/acceptance-1');
    expect(desktopAcceptance.pathname).toBe('/spa/en-US__0/acceptance/acceptance-1');
  });

  it.each([mobileUserAgent, tabletUserAgent])(
    'keeps the agent documents index in the handheld main SPA (%s)',
    async (userAgent) => {
      const detail = await getAuthenticatedRewriteUrl('/agent/agt_1/docs/doc_1?hl=en-US', {
        'user-agent': userAgent,
      });
      const index = await getAuthenticatedRewriteUrl('/agent/agt_1/docs?hl=en-US', {
        'user-agent': userAgent,
      });

      expect(detail.pathname).toBe('/spa-workbench/en-US/agent/agt_1/docs/doc_1');
      expect(index.pathname).toBe('/spa/en-US__1/agent/agt_1/docs');
    },
  );

  it('keeps desktop agent documents in the main SPA', async () => {
    const detail = await getAuthenticatedRewriteUrl('/agent/agt_1/docs/doc_1?hl=en-US');

    expect(detail.pathname).toBe('/spa/en-US__0/agent/agt_1/docs/doc_1');
  });

  it('still authenticates protected Workbench documents on the configured host', async () => {
    const { middleware } = defineConfig();
    const response = await middleware(
      new NextRequest('https://untrusted.example/agent/agt_1/docs/doc_1?hl=zh-CN', {
        headers: { 'user-agent': mobileUserAgent },
      }),
    );
    const location = new URL(response.headers.get('location')!);

    expect(location.origin).toBe('https://example.com');
    expect(location.pathname).toBe('/signin');
    expect(location.searchParams.get('callbackUrl')).toBe(
      'https://example.com/agent/agt_1/docs/doc_1?hl=zh-CN',
    );
    expect(location.searchParams.get('hl')).toBe('zh-CN');
  });
});

describe('defineConfig Share SPA rewrite', () => {
  it('routes share pages through the Share SPA for every user agent', async () => {
    const mobileTopic = await getRewriteUrl('/share/t/topic-1?hl=en-US', {
      'user-agent': mobileUserAgent,
    });
    const desktopTopic = await getRewriteUrl('/share/t/topic-1?hl=en-US');
    const desktopPage = await getRewriteUrl('/share/page/docs_1?hl=en-US');
    const desktopArtifact = await getRewriteUrl('/share/artifact/42?hl=en-US');

    expect(mobileTopic.pathname).toBe('/spa-share/en-US/share/t/topic-1');
    expect(desktopTopic.pathname).toBe('/spa-share/en-US/share/t/topic-1');
    expect(desktopPage.pathname).toBe('/spa-share/en-US/share/page/docs_1');
    expect(desktopArtifact.pathname).toBe('/spa-share/en-US/share/artifact/42');
  });

  it('leaves non-share paths that merely start with the prefix in the main SPA', async () => {
    const rewrite = await getRewriteUrl('/shared-workspace/settings?hl=en-US');

    expect(rewrite.pathname).toMatch(/^\/spa\/[^/]+\/shared-workspace\/settings$/);
  });

  it.each([
    ['/share/t/topic-1', '/spa-share/en-US/share/t/topic-1'],
    ['/verify/run-1', '/spa-workbench/en-US/verify/run-1'],
  ])('sanitizes locale traversal for %s', async (path, expectedPath) => {
    const rewrite = await getRewriteUrl(`${path}?hl=..%2F..%2Fapi%2Fdev%2Fx`);

    expect(rewrite.pathname).toBe(expectedPath);
  });
});

describe('Acceptance installation guide', () => {
  it('serves the public Markdown asset without authentication or SPA rewrites', async () => {
    const { auth } = await import('@/auth');
    const { middleware } = defineConfig();
    vi.mocked(auth.api.getSession).mockClear();
    const response = await middleware(new NextRequest('http://localhost:3010/acceptance/skill.md'));

    expect(response?.headers.get('x-middleware-next')).toBe('1');
    expect(response?.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response?.headers.get('location')).toBeNull();
    expect(auth.api.getSession).not.toHaveBeenCalled();

    const guide = await readFile('public/acceptance/skill.md', 'utf8');
    expect(guide).toContain('npm install -g @lobehub/cli');
    expect(guide).toContain('lh login');
    expect(guide).toContain('lh acceptance install');
    expect(guide).toContain('.agents/skills/acceptance/SKILL.md');
  });
});
