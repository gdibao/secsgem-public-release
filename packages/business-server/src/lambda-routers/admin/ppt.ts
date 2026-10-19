import { inArray } from 'drizzle-orm';
import { z } from 'zod';

import { appSettings } from '@/database/schemas';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';
import {
  APP_SETTING_KEYS,
  type AppSettingKey,
  invalidateServerAppSettings,
} from '@/server/services/appSettings';
import {
  decryptAppSettingSecret,
  encryptAppSettingSecret,
  maskAppSettingSecret,
} from '@/server/services/appSettings/secrets';
import { normalizeDocmeePptSettings } from '@/server/services/docmee/config';

import {
  APP_SETTING_WRITE_SURFACES,
  getAppSettingWriteSchema,
  normalizeAppSettingValue,
  PPT_WRITABLE_APP_SETTING_KEYS,
} from '../../appSettings/catalog';
import { runRequiredAdminAuditMutation } from './audit';

const systemReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.systemRead);
const systemWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.systemWrite);

const PPT_SETTING_KEYS = PPT_WRITABLE_APP_SETTING_KEYS;

const readSettings = async (db: any) => {
  const rows = await db.query.appSettings.findMany({
    where: inArray(appSettings.key, [...PPT_SETTING_KEYS]),
  });

  const raw = Object.fromEntries(rows.map((row: any) => [row.key, row.value]));
  raw[APP_SETTING_KEYS.docmeePptApiKey] = await decryptAppSettingSecret(
    APP_SETTING_KEYS.docmeePptApiKey,
    raw[APP_SETTING_KEYS.docmeePptApiKey],
  );

  return raw;
};

const saveSetting = async (db: any, key: AppSettingKey, value: unknown) => {
  const normalizedValue = normalizeAppSettingValue(key, value, APP_SETTING_WRITE_SURFACES.pptAdmin);

  await db
    .insert(appSettings)
    .values({ key, value: normalizedValue as any })
    .onConflictDoUpdate({
      set: { updatedAt: new Date(), value: normalizedValue as any },
      target: appSettings.key,
    });
};

const saveStoredSetting = async (db: any, key: AppSettingKey, value: unknown) => {
  await db
    .insert(appSettings)
    .values({ key, value: value as any })
    .onConflictDoUpdate({
      set: { updatedAt: new Date(), value: value as any },
      target: appSettings.key,
    });
};

const settingSchema = <T>(key: AppSettingKey) =>
  getAppSettingWriteSchema(key, APP_SETTING_WRITE_SURFACES.pptAdmin) as z.ZodType<T>;

const inputSchema = z.object({
  allowPdfExport: settingSchema<boolean>(APP_SETTING_KEYS.docmeePptAllowPdfExport).optional(),
  allowPptxDownload: settingSchema<boolean>(APP_SETTING_KEYS.docmeePptAllowPptxDownload).optional(),
  apiKey: settingSchema<string>(APP_SETTING_KEYS.docmeePptApiKey).optional(),
  auditEnabled: settingSchema<boolean>(APP_SETTING_KEYS.docmeePptAuditEnabled).optional(),
  baseUrl: settingSchema<string>(APP_SETTING_KEYS.docmeePptBaseUrl).optional(),
  clearApiKey: z.boolean().optional(),
  creatorVersion: settingSchema<'v1' | 'v2'>(APP_SETTING_KEYS.docmeePptCreatorVersion).optional(),
  dailyLimit: settingSchema<null | number>(APP_SETTING_KEYS.docmeePptDailyLimit).optional(),
  enabled: settingSchema<boolean>(APP_SETTING_KEYS.docmeePptEnabled).optional(),
  lang: settingSchema<string>(APP_SETTING_KEYS.docmeePptDefaultLang).optional(),
  themeColor: settingSchema<null | string>(APP_SETTING_KEYS.docmeePptThemeColor).optional(),
  tokenTtlMinutes: settingSchema<number>(APP_SETTING_KEYS.docmeePptTokenTtlMinutes).optional(),
});

export const adminPptRouter = router({
  getSettings: systemReadProcedure.query(async ({ ctx }) => {
    const raw = await readSettings(ctx.serverDB);
    const settings = normalizeDocmeePptSettings(raw);

    return {
      ...settings,
      apiKey: '',
      apiKeyConfigured: Boolean(settings.apiKey),
      apiKeyMasked: maskAppSettingSecret(settings.apiKey),
    };
  }),

  saveSettings: systemWriteProcedure.input(inputSchema).mutation(async ({ ctx, input }) => {
    const raw = await readSettings(ctx.serverDB);
    const previous = normalizeDocmeePptSettings(raw);
    const next = {
      ...previous,
      ...('allowPdfExport' in input ? { allowPdfExport: input.allowPdfExport } : {}),
      ...('allowPptxDownload' in input ? { allowPptxDownload: input.allowPptxDownload } : {}),
      ...('auditEnabled' in input ? { auditEnabled: input.auditEnabled } : {}),
      ...('baseUrl' in input ? { baseUrl: input.baseUrl } : {}),
      ...('creatorVersion' in input ? { creatorVersion: input.creatorVersion } : {}),
      ...('dailyLimit' in input ? { dailyLimit: input.dailyLimit } : {}),
      ...('enabled' in input ? { enabled: input.enabled } : {}),
      ...('lang' in input ? { lang: input.lang } : {}),
      ...('themeColor' in input ? { themeColor: input.themeColor } : {}),
      ...('tokenTtlMinutes' in input ? { tokenTtlMinutes: input.tokenTtlMinutes } : {}),
    };
    const trimmedApiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const unchangedMaskedApiKey =
      Boolean(trimmedApiKey) && trimmedApiKey === maskAppSettingSecret(previous.apiKey);
    let storedApiKey: null | string | undefined;

    if (input.clearApiKey) {
      storedApiKey = normalizeAppSettingValue(
        APP_SETTING_KEYS.docmeePptApiKey,
        null,
        APP_SETTING_WRITE_SURFACES.pptAdmin,
      ) as null;
    } else if (trimmedApiKey && !unchangedMaskedApiKey) {
      const normalizedApiKey = normalizeAppSettingValue(
        APP_SETTING_KEYS.docmeePptApiKey,
        input.apiKey,
        APP_SETTING_WRITE_SURFACES.pptAdmin,
      ) as string;
      storedApiKey = await encryptAppSettingSecret(
        APP_SETTING_KEYS.docmeePptApiKey,
        normalizedApiKey,
      );
    }

    await runRequiredAdminAuditMutation(ctx, {
      audit: () => ({
        action: 'ppt.settings.save',
        payload: {
          apiKeyChanged: input.clearApiKey || (Boolean(trimmedApiKey) && !unchangedMaskedApiKey),
          enabled: next.enabled,
        },
        resourceType: 'app_setting',
      }),
      mutation: async (tx) => {
        await Promise.all([
          saveSetting(tx, APP_SETTING_KEYS.docmeePptAllowPdfExport, next.allowPdfExport),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptAllowPptxDownload, next.allowPptxDownload),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptAuditEnabled, next.auditEnabled),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptBaseUrl, next.baseUrl),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptCreatorVersion, next.creatorVersion),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptDailyLimit, next.dailyLimit),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptDefaultLang, next.lang),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptEnabled, next.enabled),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptThemeColor, next.themeColor),
          saveSetting(tx, APP_SETTING_KEYS.docmeePptTokenTtlMinutes, next.tokenTtlMinutes),
          ...(storedApiKey !== undefined
            ? [saveStoredSetting(tx, APP_SETTING_KEYS.docmeePptApiKey, storedApiKey)]
            : []),
        ]);
      },
    });

    await invalidateServerAppSettings();

    return { ok: true };
  }),
});
