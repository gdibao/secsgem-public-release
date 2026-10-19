import { timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { appSettings } from '@/database/schemas';
import { type getServerDB } from '@/database/server';
import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import { decryptAppSettingSecret } from '@/server/services/appSettings/secrets';

const readStringSetting = async (db: Awaited<ReturnType<typeof getServerDB>>, key: string) => {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  return typeof row?.value === 'string' ? row.value : null;
};

/**
 * Desktop release authentication precedence:
 * 1. DESKTOP_RELEASE_TOKEN, when configured.
 * 2. Only when the dedicated token is absent and
 *    ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE=1, decrypted database cron.secret.
 * 3. In that same opt-in legacy mode, CRON_SECRET only when cron.secret is not a string.
 * Invalid encrypted cron.secret values fail closed without using CRON_SECRET.
 */
export const resolveDesktopReleaseToken = async (
  db: Awaited<ReturnType<typeof getServerDB>>,
): Promise<null | string> => {
  if (process.env.DESKTOP_RELEASE_TOKEN) return process.env.DESKTOP_RELEASE_TOKEN;
  if (process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE !== '1') return null;

  const encryptedOrLegacySecret = await readStringSetting(db, APP_SETTING_KEYS.cronSecret);
  const decryptedSecret = await decryptAppSettingSecret(
    APP_SETTING_KEYS.cronSecret,
    encryptedOrLegacySecret,
  );

  return typeof decryptedSecret === 'string' ? decryptedSecret : (process.env.CRON_SECRET ?? null);
};

export const isDesktopReleaseAuthorized = (token: string, expected: string) => {
  const actual = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (actual.byteLength !== expectedBuffer.byteLength) return false;

  return timingSafeEqual(actual, expectedBuffer);
};
