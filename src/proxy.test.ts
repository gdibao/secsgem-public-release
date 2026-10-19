/** @vitest-environment node */
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it, vi } from 'vitest';

import { config } from './proxy';

vi.mock('@/libs/next/proxy/define-config', () => ({
  defineConfig: () => ({ middleware: vi.fn() }),
}));

describe('SPA proxy route matching', () => {
  it('includes mobile workspace deep links', () => {
    expect(config.matcher).toEqual(
      expect.arrayContaining(['/design', '/apps', '/apps(.*)', '/discover', '/discover(.*)']),
    );
  });

  it.each(['/a/shared-agent', '/a/e2e-missing-share', '/a/shared-agent?hl=en-US'])(
    'routes %s through the SPA proxy',
    (pathname) => {
      expect(
        unstable_doesMiddlewareMatch({ config, url: `http://localhost:3010${pathname}` }),
      ).toBe(true);
    },
  );

  it.each(['/bind-phone', '/bind-phone?callbackUrl=%2Fagent'])(
    'routes phone binding page %s through the variant proxy',
    (pathname) => {
      expect(
        unstable_doesMiddlewareMatch({ config, url: `http://localhost:3010${pathname}` }),
      ).toBe(true);
    },
  );

  it.each([
    '/engineering/agent/agt_1',
    '/engineering/group/grp_1',
    '/engineering/settings/members',
    '/engineering/tasks',
  ])('routes workspace deep link %s through the SPA proxy', (pathname) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3010${pathname}` })).toBe(
      true,
    );
  });

  it.each(['/api/chat', '/trpc/lambda/share.getSharedAgent', '/webapi/chat'])(
    'keeps backend authentication in the handler for %s',
    (pathname) => {
      expect(
        unstable_doesMiddlewareMatch({ config, url: `http://localhost:3010${pathname}` }),
      ).toBe(false);
    },
  );
});
