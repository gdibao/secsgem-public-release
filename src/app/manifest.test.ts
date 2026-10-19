// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const mockGetServerBrand = vi.hoisted(() => vi.fn());
const mockGenerate = vi.hoisted(() => vi.fn((input) => input));

vi.mock('@lobechat/business-const', () => ({
  BRANDING_LOGO_URL: '',
  BRANDING_NAME: 'LobeHub',
}));

vi.mock('@/server/services/brand', () => ({
  getServerBrand: mockGetServerBrand,
}));

vi.mock('@/libs/metadata/manifest', () => ({
  manifestModule: { generate: mockGenerate },
}));

vi.mock('es-toolkit/compat', () => ({
  kebabCase: (value: string) => value.toLowerCase().replaceAll(/\s+/g, '-'),
}));

describe('manifest route', () => {
  it('uses the server-resolved brand name in the PWA manifest', async () => {
    mockGetServerBrand.mockResolvedValue({ name: '  XuanGuo AI  ', logoUrl: null });

    const { default: manifest } = await import('./manifest');
    await manifest();

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'xuanguo-ai',
        name: 'XuanGuo AI',
      }),
    );
  });
});
