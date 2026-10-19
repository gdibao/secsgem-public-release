'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import i18n from 'i18next';
import { createContext, type FC, type ReactNode, use, useEffect, useMemo } from 'react';
import useSWR from 'swr';

import { DEFAULT_RUNTIME_BRAND } from '@/const/brand';
import { lambdaClient } from '@/libs/trpc/client';

import { replaceLegacyBrandTokens } from './brandText';

export interface BrandConfig {
  authTitle: string;
  communityForkAndChatLabel: string | null;
  copyrightText: string;
  defaultSkillName: string;
  faviconUrl: string | null;
  homeMessengerBannerTitle: string | null;
  homeMessengerEnabled: boolean;
  loadingSvgUrl: string | null;
  loadingText: string | null;
  logoUrl: string | null;
  name: string;
  primaryColor: string | null;
  sidebarGenerationLabel: string | null;
  sidebarMemberLabel: string | null;
  sidebarMemberUrl: string | null;
  slogan: string | null;
}

type BrandInput = Partial<{ [K in keyof BrandConfig]: BrandConfig[K] | null }>;

const DEFAULT_BRAND: BrandConfig = {
  authTitle: DEFAULT_RUNTIME_BRAND.authTitle,
  communityForkAndChatLabel: null,
  copyrightText: DEFAULT_RUNTIME_BRAND.copyrightText,
  defaultSkillName: DEFAULT_RUNTIME_BRAND.name || BRANDING_NAME,
  faviconUrl: null,
  homeMessengerEnabled: true,
  homeMessengerBannerTitle: null,
  loadingText: DEFAULT_RUNTIME_BRAND.loadingText,
  loadingSvgUrl: null,
  logoUrl: DEFAULT_RUNTIME_BRAND.logoUrl,
  name: DEFAULT_RUNTIME_BRAND.name || BRANDING_NAME,
  primaryColor: DEFAULT_RUNTIME_BRAND.primaryColor,
  sidebarGenerationLabel: '生成',
  sidebarMemberLabel: '会员',
  sidebarMemberUrl: '/settings/plans',
  slogan: DEFAULT_RUNTIME_BRAND.authTitle,
};

const BrandContext = createContext<BrandConfig>(DEFAULT_BRAND);

const normalizeBrand = (brand?: BrandInput | null): BrandConfig => {
  const rawName = (brand?.name && brand.name.trim()) || DEFAULT_BRAND.name;
  const name = replaceLegacyBrandTokens(rawName, DEFAULT_RUNTIME_BRAND.name);
  const normalizeText = (value: string | null | undefined, fallback: string) =>
    value && value.trim() ? replaceLegacyBrandTokens(value.trim(), name) : fallback;
  const normalizeOptionalText = (value: string | null | undefined) =>
    value && value.trim() ? replaceLegacyBrandTokens(value.trim(), name) : null;

  return {
    authTitle: normalizeText(brand?.authTitle, DEFAULT_BRAND.authTitle),
    communityForkAndChatLabel: normalizeOptionalText(brand?.communityForkAndChatLabel),
    copyrightText: normalizeText(brand?.copyrightText, DEFAULT_BRAND.copyrightText),
    defaultSkillName: normalizeText(
      brand?.defaultSkillName,
      name || DEFAULT_BRAND.defaultSkillName,
    ),
    faviconUrl: brand?.faviconUrl ?? DEFAULT_BRAND.faviconUrl,
    homeMessengerEnabled:
      typeof brand?.homeMessengerEnabled === 'boolean'
        ? brand.homeMessengerEnabled
        : DEFAULT_BRAND.homeMessengerEnabled,
    homeMessengerBannerTitle: brand?.homeMessengerBannerTitle
      ? replaceLegacyBrandTokens(brand.homeMessengerBannerTitle.trim(), name)
      : DEFAULT_BRAND.homeMessengerBannerTitle,
    loadingText: normalizeText(brand?.loadingText, DEFAULT_BRAND.loadingText || ''),
    loadingSvgUrl:
      (brand?.loadingSvgUrl && brand.loadingSvgUrl.trim()) || DEFAULT_BRAND.loadingSvgUrl,
    logoUrl:
      brand?.logoUrl &&
      ['/images/brand/qingyou-ai-logo.png', '/avatars/lobe-ai.png'].includes(brand.logoUrl)
        ? DEFAULT_BRAND.logoUrl
        : (brand?.logoUrl ?? DEFAULT_BRAND.logoUrl),
    name,
    primaryColor: brand?.primaryColor ?? DEFAULT_BRAND.primaryColor,
    sidebarGenerationLabel:
      normalizeOptionalText(brand?.sidebarGenerationLabel) || DEFAULT_BRAND.sidebarGenerationLabel,
    sidebarMemberLabel:
      normalizeOptionalText(brand?.sidebarMemberLabel) || DEFAULT_BRAND.sidebarMemberLabel,
    sidebarMemberUrl:
      (brand?.sidebarMemberUrl && brand.sidebarMemberUrl.trim()) || DEFAULT_BRAND.sidebarMemberUrl,
    slogan: normalizeText(brand?.slogan, DEFAULT_BRAND.slogan),
  };
};

const fetchBrand = async (): Promise<BrandConfig> => {
  try {
    const r = await lambdaClient.admin.settings.getPublicBrand.query();
    return normalizeBrand(r);
  } catch {
    return DEFAULT_BRAND;
  }
};

const applyDocumentBrand = (b: BrandConfig, updateDocumentTitle: boolean) => {
  if (typeof document === 'undefined') return;
  if (updateDocumentTitle && b.name) document.title = b.name;
  if (b.faviconUrl) {
    let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = b.faviconUrl;
  }
  if (b.primaryColor) {
    document.documentElement.style.setProperty('--brand-primary', b.primaryColor);
  }
};

export const BrandProvider: FC<{
  children: ReactNode;
  initialBrand?: BrandInput;
  updateDocumentTitle?: boolean;
}> = ({ children, initialBrand, updateDocumentTitle = true }) => {
  const { data } = useSWR<BrandConfig>('brand-config', fetchBrand, {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
  });
  const value = useMemo<BrandConfig>(
    () => data ?? normalizeBrand(initialBrand),
    [data, initialBrand],
  );

  useEffect(() => {
    applyDocumentBrand(value, updateDocumentTitle);
    i18n.options ??= {};
    i18n.options.interpolation = {
      ...i18n.options.interpolation,
      defaultVariables: {
        ...i18n.options.interpolation?.defaultVariables,
        brandName: value.name,
        defaultSkillName: value.defaultSkillName,
      },
    };
  }, [value, updateDocumentTitle]);

  return <BrandContext value={value}>{children}</BrandContext>;
};

export const useBrand = (): BrandConfig => use(BrandContext);
