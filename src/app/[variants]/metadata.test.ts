// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

const mockGetServerBrand = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/business-const', () => ({
  BRANDING_LOGO_URL: 'https://example.com/default-logo.png',
  BRANDING_NAME: 'LobeHub',
  ORG_NAME: 'lobehub',
}));

vi.mock('@lobechat/const', () => ({
  OG_URL: 'https://example.com/og.png',
}));

vi.mock('@/const/locale', () => ({
  DEFAULT_LANG: 'zh-CN',
}));

vi.mock('@/const/url', () => ({
  OFFICIAL_URL: 'https://chat.example.com',
}));

vi.mock('@/const/version', () => ({
  isCustomBranding: false,
  isCustomORG: false,
}));

vi.mock('@/server/services/brand', () => ({
  getServerBrand: mockGetServerBrand,
}));

vi.mock('@/server/translation', () => ({
  translation: vi.fn(async () => ({
    t: (key: string, vars?: { appName?: string }) => `${vars?.appName ?? 'App'} ${key}`,
  })),
}));

vi.mock('@/utils/server/routeVariants', () => ({
  RouteVariants: {
    getLocale: vi.fn(async () => 'zh-CN'),
  },
}));

describe('generateMetadata', () => {
  it('uses the backend brand name for page titles and SEO metadata', async () => {
    mockGetServerBrand.mockResolvedValue({
      faviconUrl: null,
      name: 'XuanGuo AI',
    });

    const { generateMetadata } = await import('./metadata');
    const metadata = await generateMetadata({} as any);

    expect(metadata.appleWebApp.title).toBe('XuanGuo AI');
    expect(metadata.description).toBe('XuanGuo AI chat.description');
    expect(metadata.openGraph.siteName).toBe('XuanGuo AI');
    expect(metadata.openGraph.title).toBe('XuanGuo AI');
    expect(metadata.title.default).toBe('XuanGuo AI chat.title');
    expect(metadata.title.template).toBe('%s · XuanGuo AI');
    expect(metadata.twitter.title).toBe('XuanGuo AI chat.title');
  });
});
