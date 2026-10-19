// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetServerBrand = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/business-const', () => ({
  APPLE_APP_STORE_ID: '123456789',
  BRANDING_NAME: 'LobeHub',
  ORG_NAME: 'lobehub',
}));

vi.mock('@lobechat/const', () => ({
  OG_URL: 'https://example.com/og.png',
}));

vi.mock('@/config/featureFlags', () => ({
  getServerFeatureFlagsValue: () => ({ enablePpt: true }),
}));

vi.mock('@/const/url', () => ({
  OFFICIAL_URL: 'https://chat.example.com',
}));

vi.mock('@/const/version', () => ({
  isCustomORG: false,
  isDesktop: false,
}));

vi.mock('@/envs/analytics', () => ({
  analyticsEnv: {},
}));

vi.mock('@/envs/app', () => ({
  appEnv: { MARKET_BASE_URL: 'https://market.example.com' },
}));

vi.mock('@/envs/file', () => ({
  fileEnv: { NEXT_PUBLIC_S3_FILE_PATH: 'files' },
}));

vi.mock('@/envs/python', () => ({
  pythonEnv: {},
}));

vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: vi.fn(async () => ({ defaultAgent: {} })),
}));

vi.mock('@/server/services/appSettings', () => ({
  getServerFileS3Config: vi.fn(async () => ({ filePath: 'runtime-files' })),
}));

vi.mock('@/server/services/brand', () => ({
  getServerBrand: mockGetServerBrand,
}));

vi.mock('@/server/translation', () => ({
  translation: vi.fn(async () => ({
    t: (key: string, vars?: { appName?: string }) => `${vars?.appName ?? 'App'} ${key}`,
  })),
}));

vi.mock('./spaHtmlTemplates', () => ({
  desktopHtmlTemplate: `<!doctype html><html><head><!--SEO_META--><script>window.__SERVER_CONFIG__ = undefined; /* SERVER_CONFIG */</script></head><body><div id="loading-screen"><div id="loading-brand" aria-label="Loading" role="status"><svg><title>LobeHub</title></svg></div></div><div id="root"></div><!--ANALYTICS_SCRIPTS--></body></html>`,
  mobileHtmlTemplate: `<!doctype html><html><head><!--SEO_META--><script>window.__SERVER_CONFIG__ = undefined; /* SERVER_CONFIG */</script></head><body><div id="root"></div><!--ANALYTICS_SCRIPTS--></body></html>`,
}));

describe('SPA route brand boot config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerBrand.mockResolvedValue({
      authTitle: '登录页文案不作为加载文案',
      copyrightText: 'Copyright',
      defaultSkillName: '驰拓助手',
      faviconUrl: null,
      loadingText: '正在进入驰拓AI',
      loadingSvgUrl: 'https://cdn.example.com/branding/loading.svg',
      logoUrl: null,
      name: '驰拓AI',
      primaryColor: '#12b981',
      slogan: '品牌口号不作为加载文案',
    });
  });

  it('injects the server brand into SPA config and renders only the dedicated loading text', async () => {
    const { GET } = await import('./route');
    const response = await GET(new Request('https://chat.example.com/'), {
      params: Promise.resolve({ variants: 'zh-CN__0' }),
    });
    const html = await response.text();

    expect(html).toContain('"brand":{"authTitle":"登录页文案不作为加载文案"');
    expect(html).toContain('"name":"驰拓AI"');
    expect(html).toContain('<title>驰拓AI chat.title</title>');
    expect(html).toContain('<meta property="og:site_name" content="驰拓AI" />');
    expect(html).not.toContain('<meta property="og:site_name" content="LobeHub" />');
    expect(html).not.toContain('apple-itunes-app');
    expect(html).not.toContain('<svg><title>LobeHub</title></svg>');

    const loadingBrandHtml = html.match(/<div id="loading-brand"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(loadingBrandHtml).toContain('正在进入驰拓AI');
    expect(loadingBrandHtml).toContain('src="https://cdn.example.com/branding/loading.svg"');
    expect(loadingBrandHtml).toContain('data-loading-svg="true"');
    expect(loadingBrandHtml).not.toContain('品牌口号不作为加载文案');
    expect(loadingBrandHtml).not.toContain('登录页文案不作为加载文案');
  });

  it('includes the mobile app banner while keeping the configured brand metadata', async () => {
    const { GET } = await import('./route');
    const response = await GET(new Request('https://chat.example.com/'), {
      params: Promise.resolve({ variants: 'zh-CN__1' }),
    });
    const html = await response.text();

    expect(html).toContain('<meta name="apple-itunes-app" content="app-id=123456789" />');
    expect(html).toContain('<title>玄果AI chat.title</title>');
    expect(html).toContain('<meta property="og:site_name" content="玄果AI" />');
  });

  it('keeps the upstream loading SVG when no admin loading SVG URL is configured', async () => {
    mockGetServerBrand.mockResolvedValueOnce({
      authTitle: '登录页文案不作为加载文案',
      copyrightText: 'Copyright',
      defaultSkillName: '驰拓助手',
      faviconUrl: null,
      loadingText: '正在进入驰拓AI',
      loadingSvgUrl: null,
      logoUrl: null,
      name: '驰拓AI',
      primaryColor: '#12b981',
      slogan: '品牌口号不作为加载文案',
    });

    const { GET } = await import('./route');
    const response = await GET(new Request('https://chat.example.com/'), {
      params: Promise.resolve({ variants: 'zh-CN__0' }),
    });
    const html = await response.text();

    expect(html).toContain('<svg><title>LobeHub</title></svg>');
    expect(html).not.toContain('data-loading-svg="true"');
  });
});
