import { inArray } from 'drizzle-orm';

import {
  MODULE_APP_RUNTIME_SETTING_KEYS,
  readModuleAppRuntimeEnvironment,
  type ResolvedModuleAppRuntimeConfig,
  resolveModuleAppRuntimeConfig,
} from '@/business/server/module-apps/runtimeConfig';
import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import { appSettings } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import type { LobeChatDatabase } from '@/database/type';
import { decryptAppSettingSecret } from '@/server/services/appSettings/secrets';

export const getServerModuleAppRuntimeConfig = async (
  db?: LobeChatDatabase,
): Promise<ResolvedModuleAppRuntimeConfig> => {
  const serverDB = db ?? (await getServerDB());
  const rows = await serverDB.query.appSettings.findMany({
    columns: { key: true, value: true },
    where: inArray(appSettings.key, [...MODULE_APP_RUNTIME_SETTING_KEYS]),
  });

  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  if (Object.hasOwn(values, APP_SETTING_KEYS.moduleAppRuntimeInternalToken)) {
    values[APP_SETTING_KEYS.moduleAppRuntimeInternalToken] = await decryptAppSettingSecret(
      APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
      values[APP_SETTING_KEYS.moduleAppRuntimeInternalToken],
    );
  }

  return resolveModuleAppRuntimeConfig({
    environment: readModuleAppRuntimeEnvironment(),
    requireEnvironmentParity: true,
    values,
  });
};
