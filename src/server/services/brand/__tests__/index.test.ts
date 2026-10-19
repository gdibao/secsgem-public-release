import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerBrand, invalidateServerBrand } from '../index';

const findFirstMock = vi.fn();
vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(async () => ({
    query: { appSettings: { findFirst: findFirstMock } },
  })),
}));
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

describe('getServerBrand', () => {
  beforeEach(() => {
    invalidateServerBrand();
    findFirstMock.mockReset();
  });
  afterEach(() => {
    invalidateServerBrand();
  });

  it('returns the configured brand keys when present', async () => {
    findFirstMock.mockImplementation(async (args: any) => {
      const k = args.where.b;
      const map: Record<string, boolean | string> = {
        'brand.authTitle': 'Welcome to Acme',
        'community.forkAndChat.label': 'Start chatting',
        'brand.copyrightText': '2026 Acme',
        'defaultSkill.name': 'Acme Skill',
        'brand.faviconUrl': 'https://x/favicon.ico',
        'home.messenger.enabled': false,
        'home.messengerBanner.title': 'Chat with Acme everywhere',
        'brand.loadingText': 'Loading Acme',
        'brand.loadingSvgUrl': '/branding/acme-loading.svg',
        'brand.logoUrl': 'https://x/logo.svg',
        'brand.name': 'Acme',
        'brand.primaryColor': '#ff00aa',
        'sidebar.generation.label': 'Create',
        'sidebar.member.label': 'Plans',
        'sidebar.member.url': '/plans',
        'brand.slogan': 'Better than ever',
      };
      return k in map ? { value: map[k] } : null;
    });

    const out = await getServerBrand();
    expect(out).toEqual({
      authTitle: 'Welcome to Acme',
      communityForkAndChatLabel: 'Start chatting',
      copyrightText: '2026 Acme',
      defaultSkillName: 'Acme Skill',
      faviconUrl: 'https://x/favicon.ico',
      homeMessengerEnabled: false,
      homeMessengerBannerTitle: 'Chat with Acme everywhere',
      loadingText: 'Loading Acme',
      loadingSvgUrl: '/branding/acme-loading.svg',
      logoUrl: 'https://x/logo.svg',
      name: 'Acme',
      primaryColor: '#ff00aa',
      sidebarGenerationLabel: 'Create',
      sidebarMemberLabel: 'Plans',
      sidebarMemberUrl: '/plans',
      slogan: 'Better than ever',
    });
  });

  it('uses the default runtime brand when keys are missing', async () => {
    findFirstMock.mockResolvedValue(null);
    const out = await getServerBrand();
    expect(out).toEqual({
      authTitle: 'Default auth title',
      communityForkAndChatLabel: null,
      copyrightText: '2026 Default. All rights reserved.',
      defaultSkillName: 'Default Brand',
      faviconUrl: null,
      homeMessengerEnabled: true,
      homeMessengerBannerTitle: null,
      loadingText: 'Loading',
      loadingSvgUrl: null,
      logoUrl: null,
      name: 'Default Brand',
      primaryColor: '#12b981',
      sidebarGenerationLabel: null,
      sidebarMemberLabel: null,
      sidebarMemberUrl: null,
      slogan: 'Default auth title',
    });
  });

  it('treats whitespace-only names as unset and trims configured names', async () => {
    findFirstMock.mockImplementation(async (args: any) => {
      const key = args.where.b;
      if (key === 'brand.name') return { value: '  Runtime Brand  ' };
      return null;
    });

    const configured = await getServerBrand();
    expect(configured.name).toBe('Runtime Brand');

    invalidateServerBrand();
    findFirstMock.mockImplementation(async (args: any) => {
      const key = args.where.b;
      if (key === 'brand.name') return { value: '   ' };
      return null;
    });

    const blank = await getServerBrand();
    expect(blank.name).toBe('Default Brand');
  });

  it('preserves an empty configured logo as unset instead of restoring the legacy default logo', async () => {
    findFirstMock.mockImplementation(async (args: any) => {
      const k = args.where.b;
      const map: Record<string, string> = {
        'brand.logoUrl': '',
        'brand.name': 'Runtime Brand',
      };
      return k in map ? { value: map[k] } : null;
    });

    const out = await getServerBrand();

    expect(out.logoUrl).toBe('');
    expect(out.name).toBe('Runtime Brand');
  });

  it('caches the result for the configured TTL', async () => {
    findFirstMock.mockResolvedValue({ value: 'CachedName' });
    await getServerBrand();
    await getServerBrand();
    await getServerBrand();
    // Each call queries 16 keys; only the first call should hit the DB.
    expect(findFirstMock).toHaveBeenCalledTimes(16);
  });

  it('invalidate forces a fresh fetch', async () => {
    findFirstMock.mockResolvedValue({ value: 'CachedName' });
    await getServerBrand();
    invalidateServerBrand();
    await getServerBrand();
    expect(findFirstMock).toHaveBeenCalledTimes(32);
  });

  it('falls back to the default runtime brand on database errors', async () => {
    findFirstMock.mockRejectedValue(new Error('boom'));
    const out = await getServerBrand();
    expect(out).toEqual({
      authTitle: 'Default auth title',
      communityForkAndChatLabel: null,
      copyrightText: '2026 Default. All rights reserved.',
      defaultSkillName: 'Default Brand',
      faviconUrl: null,
      homeMessengerEnabled: true,
      homeMessengerBannerTitle: null,
      loadingText: 'Loading',
      loadingSvgUrl: null,
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
