import { describe, expect, it } from 'vitest';

import {
  buildStaticLoadingBrandHtml,
  GENERIC_LOADING_TEXT,
  getBrandLoadingText,
} from './loadingBrand';

describe('loadingBrand', () => {
  it('uses configured admin loading text before falling back to generic copy', () => {
    expect(
      getBrandLoadingText({
        loadingText: 'Loading ComHub',
        name: 'Xuangguo AI',
        slogan: 'Login page copy',
      }),
    ).toBe('Loading ComHub');
    expect(getBrandLoadingText({ name: 'Xuangguo AI', slogan: 'Login page copy' })).toBe(
      GENERIC_LOADING_TEXT,
    );
    expect(getBrandLoadingText({ loadingText: '   ', name: 'Xuangguo AI' })).toBe(
      GENERIC_LOADING_TEXT,
    );
  });

  it('renders static loading as escaped text instead of a brand logo image', () => {
    const html = buildStaticLoadingBrandHtml('加载中');

    expect(html).toContain('加载中');
    expect(html).not.toContain('<img');
  });

  it('renders a configured loading SVG URL as an image while escaping attributes', () => {
    const html = buildStaticLoadingBrandHtml('Loading <ComHub>', '/branding/loading.svg?x="y"');

    expect(html).toContain('<img');
    expect(html).toContain('src="/branding/loading.svg?x=&quot;y&quot;"');
    expect(html).toContain('alt="Loading &lt;ComHub&gt;"');
    expect(html).toContain('data-loading-svg="true"');
    expect(html).not.toContain('<script');
  });
});
