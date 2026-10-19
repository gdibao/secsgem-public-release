import { APP_SETTING_KEYS } from '@/server/services/appSettings';

export type DocmeePptSettings = {
  allowPdfExport: boolean;
  allowPptxDownload: boolean;
  apiKey: null | string;
  auditEnabled: boolean;
  baseUrl: string;
  creatorVersion: 'v1' | 'v2';
  dailyLimit: null | number;
  enabled: boolean;
  lang: string;
  themeColor: null | string;
  tokenTtlMinutes: number;
};

export type DocmeePlanCapability = {
  creditCost: number;
  enabled: boolean;
  monthlyQuota: null | number;
};

export const DEFAULT_DOCMEE_PPT_SETTINGS: DocmeePptSettings = {
  allowPdfExport: true,
  allowPptxDownload: true,
  apiKey: null,
  auditEnabled: true,
  baseUrl: 'https://docmee.cn',
  creatorVersion: 'v2',
  dailyLimit: null,
  enabled: false,
  lang: 'zh',
  themeColor: null,
  tokenTtlMinutes: 60,
};

const toBool = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

const toPositiveInt = (value: unknown, fallback: number, max: number) => {
  const n = Number(value);

  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : fallback;
};

const toOptionalPositiveInt = (value: unknown) => {
  const n = Number(value);

  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

const toString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const normalizeDocmeePptSettings = (raw: Record<string, unknown>): DocmeePptSettings => {
  const apiKey = toString(raw[APP_SETTING_KEYS.docmeePptApiKey]);
  const baseUrl = toString(raw[APP_SETTING_KEYS.docmeePptBaseUrl]);
  const creatorVersion = raw[APP_SETTING_KEYS.docmeePptCreatorVersion] === 'v1' ? 'v1' : 'v2';
  const themeColor = toString(raw[APP_SETTING_KEYS.docmeePptThemeColor]);

  return {
    allowPdfExport: toBool(
      raw[APP_SETTING_KEYS.docmeePptAllowPdfExport],
      DEFAULT_DOCMEE_PPT_SETTINGS.allowPdfExport,
    ),
    allowPptxDownload: toBool(
      raw[APP_SETTING_KEYS.docmeePptAllowPptxDownload],
      DEFAULT_DOCMEE_PPT_SETTINGS.allowPptxDownload,
    ),
    apiKey: apiKey || null,
    auditEnabled: toBool(
      raw[APP_SETTING_KEYS.docmeePptAuditEnabled],
      DEFAULT_DOCMEE_PPT_SETTINGS.auditEnabled,
    ),
    baseUrl: baseUrl || DEFAULT_DOCMEE_PPT_SETTINGS.baseUrl,
    creatorVersion,
    dailyLimit: toOptionalPositiveInt(raw[APP_SETTING_KEYS.docmeePptDailyLimit]),
    enabled: toBool(raw[APP_SETTING_KEYS.docmeePptEnabled], false),
    lang: toString(raw[APP_SETTING_KEYS.docmeePptDefaultLang]) || DEFAULT_DOCMEE_PPT_SETTINGS.lang,
    themeColor: themeColor || null,
    tokenTtlMinutes: toPositiveInt(
      raw[APP_SETTING_KEYS.docmeePptTokenTtlMinutes],
      DEFAULT_DOCMEE_PPT_SETTINGS.tokenTtlMinutes,
      24 * 60,
    ),
  };
};

export const normalizeDocmeePlanCapability = (
  metadata: null | Record<string, unknown> | undefined,
): DocmeePlanCapability => ({
  creditCost: Math.max(0, Number(metadata?.pptCreditCost ?? 0) || 0),
  enabled: metadata?.pptEnabled === true,
  monthlyQuota: toOptionalPositiveInt(metadata?.pptMonthlyQuota),
});
