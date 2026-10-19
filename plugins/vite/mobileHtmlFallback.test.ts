import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveMobileHtmlFallback } from './mobileHtmlFallback';

describe('mobile SPA development HTML fallback', () => {
  it('registers the mobile HTML fallback before Vite handles history requests', async () => {
    const source = await readFile(path.join(process.cwd(), 'vite.config.ts'), 'utf8');

    expect(source).toContain(
      "import { mobileHtmlFallback } from './plugins/vite/mobileHtmlFallback'",
    );
    expect(source).toContain('isMobile && mobileHtmlFallback()');
  });

  it.each([
    ['/', '/index.mobile.html'],
    ['/settings/plans', '/index.mobile.html'],
    ['/settings/plans?hl=zh-CN', '/index.mobile.html?hl=zh-CN'],
    ['/index.html', '/index.mobile.html'],
  ])('rewrites HTML navigation %s to %s', (url, expected) => {
    expect(
      resolveMobileHtmlFallback({ accept: 'text/html,application/xhtml+xml', method: 'GET', url }),
    ).toBe(expected);
  });

  it.each([
    ['/index.mobile.html', 'text/html', 'GET'],
    ['/src/spa/entry.mobile.tsx', '*/*', 'GET'],
    ['/favicon.ico', 'image/avif,image/webp', 'GET'],
    ['/api/auth/session', 'text/html', 'GET'],
    ['/trpc/user.getUserState', 'text/html', 'GET'],
    ['/settings/plans', 'text/html', 'POST'],
  ])('leaves non-navigation request %s unchanged', (url, accept, method) => {
    expect(resolveMobileHtmlFallback({ accept, method, url })).toBeUndefined();
  });
});
