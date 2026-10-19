import { hasAdminCapability } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { APP_SETTINGS_SECTIONS } from '@/const/appSettingsRegistry';
import { appSettingRevisions } from '@/database/schemas';
import {
  ADMIN_CAPABILITIES,
  adminAnyCapabilityProcedure,
  adminCapabilityProcedure,
} from '@/libs/trpc/lambda';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';
import { buildAppSettingsGovernance } from '@/server/services/appSettings/governance';
import { getAllEnabledModels } from '@/server/services/newapiInstance';

import { buildAdminSettingsReadModel, buildAdminSettingsSectionReadModel } from '../adminReadModel';
import { loadAllAppSettingsSnapshot, loadAppSettingsSectionSnapshot } from '../loader';
import { SETTING_KEYS, toString, validateDefaultAgentModelUsability } from '../procedureShared';

const systemReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.systemRead);
const settingsSectionReadProcedure = adminAnyCapabilityProcedure([
  ADMIN_CAPABILITIES.systemRead,
  ADMIN_CAPABILITIES.moduleAppRead,
]);

const getSettingsRevisions = async (db: Parameters<typeof loadAllAppSettingsSnapshot>[0]) => {
  const rows = await db.query.appSettingRevisions.findMany();
  const persisted = new Map(rows.map((row) => [row.section, row.revision]));

  return Object.fromEntries(
    APP_SETTINGS_SECTIONS.map((section) => [section, persisted.get(section) ?? 0]),
  );
};

export const adminSettingsReadProcedures = {
  getGovernance: systemReadProcedure.query(async ({ ctx }) => {
    const rows = await ctx.serverDB.query.appSettings.findMany({
      columns: {
        key: true,
        updatedAt: true,
        value: true,
      },
    });

    return buildAppSettingsGovernance(rows);
  }),
  getSection: settingsSectionReadProcedure
    .input(z.object({ section: z.enum(APP_SETTINGS_SECTIONS) }))
    .query(async ({ ctx, input }) => {
      if (
        input.section !== 'module-runtime' &&
        !hasAdminCapability(ctx.adminRole, ADMIN_CAPABILITIES.systemRead)
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `${ADMIN_CAPABILITIES.systemRead} capability required`,
        });
      }

      const needsEnabledModels =
        input.section === 'ai-runtime-defaults' ||
        input.section === 'model-policy' ||
        input.section === 'system-defaults' ||
        input.section === 'user-defaults';
      const [snapshot, enabledModels, revisionRow] = await Promise.all([
        loadAppSettingsSectionSnapshot(ctx.serverDB, input.section),
        needsEnabledModels ? getAllEnabledModels(ctx.serverDB) : Promise.resolve([]),
        ctx.serverDB.query.appSettingRevisions.findFirst({
          where: eq(appSettingRevisions.section, input.section),
        }),
      ]);

      return {
        ...(await buildAdminSettingsSectionReadModel(input.section, snapshot, {
          defaultAgentConfig: getServerDefaultAgentConfig(),
          enabledModels,
        })),
        __revision: revisionRow?.revision ?? 0,
      };
    }),
  getAll: systemReadProcedure.query(async ({ ctx }) => {
    const [snapshot, enabledModels, revisions] = await Promise.all([
      loadAllAppSettingsSnapshot(ctx.serverDB),
      getAllEnabledModels(ctx.serverDB),
      getSettingsRevisions(ctx.serverDB),
    ]);

    return {
      ...(await buildAdminSettingsReadModel(snapshot, {
        defaultAgentConfig: getServerDefaultAgentConfig(),
        enabledModels,
      })),
      __revisions: revisions,
    };
  }),
  validateDefaultAgentSettings: systemReadProcedure
    .input(
      z.object({
        model: z.string().optional(),
        modelType: z.enum(['chat', 'image', 'video']).optional(),
        provider: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const modelType = input.modelType ?? 'chat';
      const keys =
        modelType === 'image'
          ? {
              modelKey: SETTING_KEYS.defaultImageModel,
              providerKey: SETTING_KEYS.defaultImageProvider,
            }
          : modelType === 'video'
            ? {
                modelKey: SETTING_KEYS.defaultVideoModel,
                providerKey: SETTING_KEYS.defaultVideoProvider,
              }
            : {
                modelKey: SETTING_KEYS.defaultAgentModel,
                providerKey: SETTING_KEYS.defaultAgentProvider,
              };

      await validateDefaultAgentModelUsability(
        ctx.serverDB,
        {
          [keys.modelKey]: toString(input.model),
          [keys.providerKey]: toString(input.provider),
        },
        { ...keys, modelType },
      );

      return { ok: true };
    }),
} as const;
