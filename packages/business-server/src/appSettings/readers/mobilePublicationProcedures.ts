import { eq } from 'drizzle-orm';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import {
  createMobileConfigPublication,
  normalizeMobileConfigPublication,
} from '@/const/mobileConfigPublication';
import { appSettings } from '@/database/schemas';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { loadCachedMobileFeaturedAssistants } from '@/server/services/mobileFeaturedAssistants';

import { buildMobileSettings } from '../adminReadModel';
import { loadAppSettingsSectionSnapshot } from '../loader';

const publicDbProcedure = publicProcedure.use(serverDatabase);
const systemReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.systemRead);

const loadMobileConfigPublication = async (db: any) => {
  const [publicationRow, mobileSnapshot] = await Promise.all([
    db.query.appSettings.findFirst({
      columns: { updatedAt: true, value: true },
      where: eq(appSettings.key, APP_SETTING_KEYS.mobileConfigPublication),
    }),
    loadAppSettingsSectionSnapshot(db, 'mobile'),
  ]);
  const legacyConfig = buildMobileSettings(mobileSnapshot);
  if (!publicationRow) {
    return createMobileConfigPublication(legacyConfig, new Date(0).toISOString());
  }

  return normalizeMobileConfigPublication(
    publicationRow.value,
    legacyConfig,
    publicationRow.updatedAt?.toISOString(),
  );
};

export const mobilePublicationReadProcedures = {
  getMobileConfigPublication: systemReadProcedure.query(async ({ ctx }) =>
    loadMobileConfigPublication(ctx.serverDB),
  ),
  getPublicMobileConfigSnapshot: publicDbProcedure.query(async ({ ctx }) => {
    const { published } = await loadMobileConfigPublication(ctx.serverDB);
    const featuredAssistants = await loadCachedMobileFeaturedAssistants(ctx.serverDB, published);

    return {
      ...published,
      config: {
        ...published.config,
        discover: { ...published.config.discover, featuredAssistants },
      },
    };
  }),
} as const;

export { loadMobileConfigPublication };
