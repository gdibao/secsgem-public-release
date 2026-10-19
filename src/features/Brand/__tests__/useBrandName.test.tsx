import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useBrandName } from '../useBrandName';

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'LobeHub',
}));

vi.mock('@/const/brand', () => ({
  DEFAULT_RUNTIME_BRAND: {
    authTitle: 'Agent teammates that grow with you',
    copyrightText: '© 2026 驰拓 AI. All rights reserved.',
    logoUrl: null,
    name: '驰拓AI',
    primaryColor: '#12b981',
  },
}));

const mockUseBrand = vi.fn();
vi.mock('../BrandProvider', () => ({
  useBrand: () => mockUseBrand(),
}));

describe('useBrandName', () => {
  it('returns admin-configured brand name when present', () => {
    mockUseBrand.mockReturnValue({
      authTitle: 'Agent teammates that grow with you',
      copyrightText: '© 2026 Acme',
      faviconUrl: null,
      logoUrl: null,
      name: 'Acme Inc',
      primaryColor: null,
      slogan: null,
    });
    const { result } = renderHook(() => useBrandName());
    expect(result.current).toBe('Acme Inc');
  });

  it('falls back to BRANDING_NAME when admin value is empty', () => {
    mockUseBrand.mockReturnValue({
      authTitle: 'Agent teammates that grow with you',
      copyrightText: '© 2026 Acme',
      faviconUrl: null,
      logoUrl: null,
      name: '   ',
      primaryColor: null,
      slogan: null,
    });
    const { result } = renderHook(() => useBrandName());
    expect(result.current).toBe('LobeHub');
  });

  it('falls back to BRANDING_NAME when admin value is empty string', () => {
    mockUseBrand.mockReturnValue({
      authTitle: 'Agent teammates that grow with you',
      copyrightText: '© 2026 Acme',
      faviconUrl: null,
      logoUrl: null,
      name: '',
      primaryColor: null,
      slogan: null,
    });
    const { result } = renderHook(() => useBrandName());
    expect(result.current).toBe('LobeHub');
  });
});
