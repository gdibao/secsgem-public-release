import { describe, expect, it, vi } from 'vitest';

import { buildSplashHtml } from '../splash';

const { mockGetDesktopEnv } = vi.hoisted(() => ({
  mockGetDesktopEnv: vi.fn(() => ({
    OFFICIAL_CLOUD_SERVER: 'https://cloud.example.com/app/',
  })),
}));

vi.mock('@/env', () => ({
  getDesktopEnv: mockGetDesktopEnv,
}));

describe('buildSplashHtml', () => {
  it('resolves root-relative loading assets against the official cloud server', () => {
    const html = buildSplashHtml({
      loadingSvgUrl: '/branding/loading.svg',
      name: 'Custom Brand',
    });

    expect(html).toContain('src="https://cloud.example.com/branding/loading.svg"');
  });

  it('resolves path-relative loading assets against the official cloud server', () => {
    const html = buildSplashHtml({
      loadingSvgUrl: 'branding/loading.svg',
      name: 'Custom Brand',
    });

    expect(html).toContain('src="https://cloud.example.com/app/branding/loading.svg"');
  });

  it('keeps absolute https loading assets unchanged', () => {
    const html = buildSplashHtml({
      loadingSvgUrl: 'https://cdn.example.com/loading.svg',
      name: 'Custom Brand',
    });

    expect(html).toContain('src="https://cdn.example.com/loading.svg"');
  });

  it('falls back to the brand name for invalid or unsafe loading asset URLs', () => {
    const unsafeHtml = buildSplashHtml({
      loadingSvgUrl: 'javascript:alert(document.domain)',
      name: 'Custom Brand',
    });
    const invalidHtml = buildSplashHtml({
      loadingSvgUrl: 'https://[invalid-host',
      name: 'Custom Brand',
    });

    expect(unsafeHtml).toContain('<div class="brand-name">Custom Brand</div>');
    expect(unsafeHtml).not.toContain('<img ');
    expect(invalidHtml).toContain('<div class="brand-name">Custom Brand</div>');
    expect(invalidHtml).not.toContain('<img ');
  });
});
