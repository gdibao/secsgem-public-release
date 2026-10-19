import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FaviconProvider, useFaviconSetters } from './FaviconProvider';

const mockBrand = vi.hoisted(() => ({
  faviconUrl: 'https://cdn.example.com/app.ico' as null | string,
}));

vi.mock('@/features/Brand', () => ({
  useBrand: () => ({ faviconUrl: mockBrand.faviconUrl }),
}));

const SetDefaultFavicon = () => {
  const { setFavicon } = useFaviconSetters();

  useEffect(() => {
    setFavicon('default');
  }, [setFavicon]);

  return null;
};

describe('FaviconProvider', () => {
  beforeEach(() => {
    mockBrand.faviconUrl = 'https://cdn.example.com/app.ico';
  });

  it('keeps the admin configured favicon when dynamic favicon state changes', async () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.ico?v=1">';

    render(
      <FaviconProvider>
        <SetDefaultFavicon />
      </FaviconProvider>,
    );

    await waitFor(() => {
      expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
        'https://cdn.example.com/app.ico',
      );
    });
  });

  it('applies the admin configured favicon after the brand config is loaded', async () => {
    mockBrand.faviconUrl = null;
    document.head.innerHTML = '<link rel="icon" href="/favicon.ico?v=1">';

    const view = render(<FaviconProvider>content</FaviconProvider>);

    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toContain('/favicon');

    mockBrand.faviconUrl = 'https://cdn.example.com/loaded.ico';
    view.rerender(
      <FaviconProvider>
        <span>content</span>
      </FaviconProvider>,
    );

    await waitFor(() => {
      expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
        'https://cdn.example.com/loaded.ico',
      );
    });
  });
});
