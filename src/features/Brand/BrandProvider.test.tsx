import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BrandProvider } from './BrandProvider';

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'LobeHub',
}));

vi.mock('@/const/brand', () => ({
  DEFAULT_RUNTIME_BRAND: {
    authTitle: 'Agent teammates that grow with you',
    copyrightText: '2026 驰拓 AI. All rights reserved.',
    loadingText: 'Loading',
    logoUrl: null,
    name: '驰拓AI',
    primaryColor: '#12b981',
  },
}));

const i18n = vi.hoisted(() => ({
  options: undefined as
    | {
        interpolation?: {
          defaultVariables?: Record<string, string>;
        };
      }
    | undefined,
}));

vi.mock('i18next', () => ({ default: i18n }));

let swrData:
  | {
      authTitle: string;
      communityForkAndChatLabel?: null | string;
      copyrightText: string;
      faviconUrl: null;
      homeMessengerEnabled?: boolean;
      homeMessengerBannerTitle?: null | string;
      loadingText: null | string;
      loadingSvgUrl?: null | string;
      logoUrl: null | string;
      name: string;
      primaryColor: null;
      sidebarGenerationLabel?: null | string;
      sidebarMemberLabel?: null | string;
      sidebarMemberUrl?: null | string;
      slogan: null;
      defaultSkillName?: string;
    }
  | undefined;

vi.mock('swr', () => ({
  default: () => ({
    data: swrData,
  }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    admin: {
      settings: {
        getPublicBrand: {
          query: vi.fn(),
        },
      },
    },
  },
}));

describe('BrandProvider', () => {
  beforeEach(() => {
    i18n.options = undefined;
    document.body.innerHTML = '';
    document.title = '';
    swrData = {
      authTitle: 'Runtime auth title',
      communityForkAndChatLabel: 'Runtime fork',
      copyrightText: '2026 Runtime',
      faviconUrl: null,
      homeMessengerEnabled: false,
      homeMessengerBannerTitle: 'Runtime messenger',
      loadingText: 'Runtime loading',
      loadingSvgUrl: null,
      logoUrl: null,
      name: 'Runtime Brand',
      primaryColor: null,
      sidebarGenerationLabel: 'Runtime Generate',
      sidebarMemberLabel: 'Runtime Plans',
      sidebarMemberUrl: '/runtime-plans',
      slogan: null,
      defaultSkillName: 'Runtime Skill',
    };
  });

  it('does not replace an explicitly empty runtime logo with the legacy default logo', async () => {
    swrData = {
      ...swrData!,
      logoUrl: '',
    };

    render(
      <BrandProvider>
        <div>content</div>
      </BrandProvider>,
    );

    await waitFor(() => {
      expect(document.title).toBe('Runtime Brand');
    });

    expect(i18n.options?.interpolation?.defaultVariables?.brandName).toBe('Runtime Brand');
  });

  it('initializes i18n interpolation options when they are missing during SPA boot', async () => {
    render(
      <BrandProvider>
        <div>content</div>
      </BrandProvider>,
    );

    await waitFor(() => {
      expect(i18n.options?.interpolation?.defaultVariables?.brandName).toBe('Runtime Brand');
    });
  });

  it('keeps the original loading SVG during SPA boot', async () => {
    document.body.innerHTML =
      '<div id="loading-brand" aria-label="Loading" role="status"><svg data-testid="original-loading-svg"><path /></svg></div>';

    render(
      <BrandProvider>
        <div>content</div>
      </BrandProvider>,
    );

    await waitFor(() => {
      expect(i18n.options?.interpolation?.defaultVariables?.brandName).toBe('Runtime Brand');
    });

    const loadingBrand = document.getElementById('loading-brand');
    expect(loadingBrand?.querySelector('[data-testid="original-loading-svg"]')).not.toBeNull();
    expect(loadingBrand?.querySelector('span')).toBeNull();
  });

  it('uses the server-provided brand before the public brand request resolves', async () => {
    swrData = undefined;

    render(
      <BrandProvider
        initialBrand={{
          authTitle: 'Server auth title',
          communityForkAndChatLabel: null,
          copyrightText: '2026 Server',
          faviconUrl: null,
          homeMessengerEnabled: true,
          homeMessengerBannerTitle: null,
          loadingText: null,
          loadingSvgUrl: null,
          logoUrl: null,
          name: 'Server Brand',
          primaryColor: null,
          sidebarGenerationLabel: null,
          sidebarMemberLabel: null,
          sidebarMemberUrl: null,
          slogan: null,
        }}
      >
        <div>content</div>
      </BrandProvider>,
    );

    await waitFor(() => {
      expect(document.title).toBe('Server Brand');
      expect(i18n.options?.interpolation?.defaultVariables?.brandName).toBe('Server Brand');
    });
  });

  it('can preserve a route-specific document title while applying other brand effects', async () => {
    document.title = '登录 · Runtime Brand';

    render(
      <BrandProvider updateDocumentTitle={false}>
        <div>content</div>
      </BrandProvider>,
    );

    await waitFor(() => {
      expect(document.title).toBe('登录 · Runtime Brand');
      expect(i18n.options?.interpolation?.defaultVariables?.brandName).toBe('Runtime Brand');
    });
  });

  it('exposes the configured default skill name from the public brand config', async () => {
    render(
      <BrandProvider>
        <div>content</div>
      </BrandProvider>,
    );

    await waitFor(() => {
      expect(i18n.options?.interpolation?.defaultVariables?.defaultSkillName).toBe('Runtime Skill');
    });
  });
});
