import { describe, expect, it, vi } from 'vitest';

vi.mock('@/database/server', () => {
  throw new Error('database module failed during initialization');
});

vi.mock('@/database/schemas', () => ({
  appSettings: { key: 'app_settings.key' },
}));

vi.mock('@/const/brand', () => ({
  DEFAULT_RUNTIME_BRAND: {
    authTitle: 'Default auth title',
    copyrightText: '2026 Default. All rights reserved.',
    loadingText: 'Loading',
    logoUrl: null,
    name: 'Default Brand',
    primaryColor: '#12b981',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
}));

describe('getServerBrand lazy database loading', () => {
  it('falls back to the default brand when the database module fails during initialization', async () => {
    const { getServerBrand, invalidateServerBrand } = await import('../index');

    invalidateServerBrand();

    await expect(getServerBrand()).resolves.toEqual({
      authTitle: 'Default auth title',
      communityForkAndChatLabel: null,
      copyrightText: '2026 Default. All rights reserved.',
      defaultSkillName: 'Default Brand',
      faviconUrl: null,
      homeMessengerEnabled: true,
      homeMessengerBannerTitle: null,
      loadingSvgUrl: null,
      loadingText: 'Loading',
      logoUrl: null,
      name: 'Default Brand',
      primaryColor: '#12b981',
      sidebarGenerationLabel: null,
      sidebarMemberLabel: null,
      sidebarMemberUrl: null,
      slogan: 'Default auth title',
    });
  });
});
