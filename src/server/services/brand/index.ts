import { eq } from 'drizzle-orm';

import { DEFAULT_RUNTIME_BRAND } from '@/const/brand';
import { appSettings } from '@/database/schemas';
import { replaceLegacyBrandTokens } from '@/features/Brand/brandText';
import type { getServerDB } from '@/database/server';

type ServerDB = Awaited<ReturnType<typeof getServerDB>>;

export interface ServerBrandConfig {
  authTitle: string | null;
  communityForkAndChatLabel: string | null;
  copyrightText: string | null;
  defaultSkillName: string | null;
  faviconUrl: string | null;
  homeMessengerBannerTitle: string | null;
  homeMessengerEnabled: boolean;
  loadingSvgUrl: string | null;
  loadingText: string | null;
  logoUrl: string | null;
  name: string | null;
  primaryColor: string | null;
  sidebarGenerationLabel: string | null;
  sidebarMemberLabel: string | null;
  sidebarMemberUrl: string | null;
  slogan: string | null;
}

const KEYS = {
  authTitle: 'brand.authTitle',
  communityForkAndChatLabel: 'community.forkAndChat.label',
  copyrightText: 'brand.copyrightText',
  favicon: 'brand.faviconUrl',
  defaultSkillName: 'defaultSkill.name',
  homeMessengerEnabled: 'home.messenger.enabled',
  homeMessengerBannerTitle: 'home.messengerBanner.title',
  loadingText: 'brand.loadingText',
  loadingSvgUrl: 'brand.loadingSvgUrl',
  logo: 'brand.logoUrl',
  name: 'brand.name',
  primary: 'brand.primaryColor',
  sidebarGenerationLabel: 'sidebar.generation.label',
  sidebarMemberLabel: 'sidebar.member.label',
  sidebarMemberUrl: 'sidebar.member.url',
  slogan: 'brand.slogan',
} as const;

let cached: { at: number; data: ServerBrandConfig } | null = null;
const TTL_MS = 30_000;

const readString = async (db: ServerDB, key: string) => {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  const v = row?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const readOptionalString = async (db: ServerDB, key: string) => {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  const v = row?.value;
  return typeof v === 'string' ? v : null;
};

const readBoolean = async (db: ServerDB, key: string, fallback: boolean) => {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  const v = row?.value;
  return typeof v === 'boolean' ? v : fallback;
};

/**
 * Server-side brand fetch with a tiny in-memory TTL cache. Used by Next.js
 * SSR routes (manifest / metadata / SignIn) to render admin-configured brand
 * before any client-side React executes. Failures are swallowed and return
 * a fully-null config so callers can fall back to build-time `BRANDING_NAME`.
 */
export const getServerBrand = async (): Promise<ServerBrandConfig> => {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  try {
    const { getServerDB } = await import('@/database/server');
    const db = await getServerDB();
    const [
      name,
      logoUrl,
      faviconUrl,
      primaryColor,
      slogan,
      loadingText,
      loadingSvgUrl,
      authTitle,
      copyrightText,
      defaultSkillName,
      homeMessengerEnabled,
      homeMessengerBannerTitle,
      communityForkAndChatLabel,
      sidebarMemberLabel,
      sidebarMemberUrl,
      sidebarGenerationLabel,
    ] = await Promise.all([
      readString(db, KEYS.name),
      readOptionalString(db, KEYS.logo),
      readString(db, KEYS.favicon),
      readString(db, KEYS.primary),
      readString(db, KEYS.slogan),
      readString(db, KEYS.loadingText),
      readString(db, KEYS.loadingSvgUrl),
      readString(db, KEYS.authTitle),
      readString(db, KEYS.copyrightText),
      readString(db, KEYS.defaultSkillName),
      readBoolean(db, KEYS.homeMessengerEnabled, true),
      readString(db, KEYS.homeMessengerBannerTitle),
      readString(db, KEYS.communityForkAndChatLabel),
      readString(db, KEYS.sidebarMemberLabel),
      readString(db, KEYS.sidebarMemberUrl),
      readString(db, KEYS.sidebarGenerationLabel),
    ]);
    const brandName = replaceLegacyBrandTokens(
      name ?? DEFAULT_RUNTIME_BRAND.name,
      DEFAULT_RUNTIME_BRAND.name,
    );
    const normalizeText = (value: string | null, fallback: string) =>
      replaceLegacyBrandTokens(value ?? fallback, brandName);
    const normalizeOptionalText = (value: string | null) =>
      value ? replaceLegacyBrandTokens(value, brandName) : null;
    const data: ServerBrandConfig = {
      authTitle: normalizeText(authTitle, DEFAULT_RUNTIME_BRAND.authTitle),
      communityForkAndChatLabel: normalizeOptionalText(communityForkAndChatLabel),
      copyrightText: normalizeText(copyrightText, DEFAULT_RUNTIME_BRAND.copyrightText),
      defaultSkillName: normalizeText(defaultSkillName, brandName),
      faviconUrl,
      homeMessengerEnabled,
      homeMessengerBannerTitle: homeMessengerBannerTitle
        ? replaceLegacyBrandTokens(homeMessengerBannerTitle, brandName)
        : null,
      loadingText: normalizeText(loadingText, DEFAULT_RUNTIME_BRAND.loadingText),
      loadingSvgUrl,
      logoUrl:
        logoUrl && ['/images/brand/qingyou-ai-logo.png', '/avatars/lobe-ai.png'].includes(logoUrl)
          ? DEFAULT_RUNTIME_BRAND.logoUrl
          : (logoUrl ?? DEFAULT_RUNTIME_BRAND.logoUrl),
      name: brandName,
      primaryColor: primaryColor ?? DEFAULT_RUNTIME_BRAND.primaryColor,
      sidebarGenerationLabel: normalizeOptionalText(sidebarGenerationLabel),
      sidebarMemberLabel: normalizeOptionalText(sidebarMemberLabel),
      sidebarMemberUrl,
      slogan: normalizeText(slogan, DEFAULT_RUNTIME_BRAND.authTitle),
    };
    cached = { at: Date.now(), data };
    return data;
  } catch {
    const data: ServerBrandConfig = {
      authTitle: DEFAULT_RUNTIME_BRAND.authTitle,
      communityForkAndChatLabel: null,
      copyrightText: DEFAULT_RUNTIME_BRAND.copyrightText,
      defaultSkillName: DEFAULT_RUNTIME_BRAND.name,
      faviconUrl: null,
      homeMessengerEnabled: true,
      homeMessengerBannerTitle: null,
      loadingText: DEFAULT_RUNTIME_BRAND.loadingText,
      loadingSvgUrl: null,
      logoUrl: DEFAULT_RUNTIME_BRAND.logoUrl,
      name: DEFAULT_RUNTIME_BRAND.name,
      primaryColor: DEFAULT_RUNTIME_BRAND.primaryColor,
      sidebarGenerationLabel: null,
      sidebarMemberLabel: null,
      sidebarMemberUrl: null,
      slogan: DEFAULT_RUNTIME_BRAND.authTitle,
    };
    cached = { at: Date.now(), data };
    return data;
  }
};

/** Force a refresh on the next call (e.g. after admin saves brand settings). */
export const invalidateServerBrand = (): void => {
  cached = null;
};
