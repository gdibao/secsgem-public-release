import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import {
  type MobileConfigPublicationState,
  publishMobileConfigDraft,
  rollbackMobileConfigPublication,
  saveMobileConfigDraft,
} from '@/const/mobileConfigPublication';
import { appSettings } from '@/database/schemas';
import type { Transaction } from '@/database/type';
import { invalidateServerAppSettings } from '@/server/services/appSettings';

import { runRequiredAdminAuditMutation } from '../../lambda-routers/admin/audit';
import { systemWriteProcedure } from '../procedureShared';
import { loadMobileConfigPublication } from '../readers/mobilePublicationProcedures';

const MOBILE_CONFIG_PUBLICATION_LOCK_ID = 6_722_826_532;
const configInputSchema = z.object({
  config: z.unknown(),
  expectedDraftRevision: z.number().int().nonnegative(),
});
const expectedRevisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
const expectedPublicationSchema = expectedRevisionSchema.extend({
  expectedDraftRevision: z.number().int().nonnegative(),
});

const upsertSetting = async (tx: Transaction, key: string, value: unknown) =>
  tx
    .insert(appSettings)
    .values({ key, value: value as any })
    .onConflictDoUpdate({
      set: { updatedAt: new Date(), value: value as any },
      target: appSettings.key,
    });

const lockPublication = (tx: Transaction) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(${MOBILE_CONFIG_PUBLICATION_LOCK_ID})`);

const mapPublicationError = (error: unknown): never => {
  if (error instanceof Error && error.message === 'MOBILE_CONFIG_REVISION_CONFLICT') {
    throw new TRPCError({ code: 'CONFLICT', message: error.message });
  }
  if (error instanceof Error && error.message === 'MOBILE_CONFIG_REVISION_NOT_FOUND') {
    throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
  }
  throw error;
};

export const mobilePublicationWriteProcedures = {
  publishMobileConfig: systemWriteProcedure
    .input(expectedPublicationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const state = await runRequiredAdminAuditMutation<MobileConfigPublicationState>(ctx, {
          audit: (result) => ({
            action: 'settings.mobile.publish',
            payload: { revision: result.published.revision },
            resourceId: APP_SETTING_KEYS.mobileConfig,
            resourceType: 'app_setting',
          }),
          mutation: async (tx) => {
            await lockPublication(tx);
            const current = await loadMobileConfigPublication(tx);
            const next = publishMobileConfigDraft(
              current,
              input.expectedRevision,
              input.expectedDraftRevision,
            );
            await upsertSetting(tx, APP_SETTING_KEYS.mobileConfigPublication, next);
            await upsertSetting(tx, APP_SETTING_KEYS.mobileConfig, next.published.config);
            return next;
          },
        });
        await invalidateServerAppSettings();
        return state;
      } catch (error) {
        return mapPublicationError(error);
      }
    }),
  rollbackMobileConfig: systemWriteProcedure
    .input(expectedPublicationSchema.extend({ targetRevision: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const state = await runRequiredAdminAuditMutation<MobileConfigPublicationState>(ctx, {
          audit: (result) => ({
            action: 'settings.mobile.rollback',
            payload: {
              revision: result.published.revision,
              targetRevision: input.targetRevision,
            },
            resourceId: APP_SETTING_KEYS.mobileConfig,
            resourceType: 'app_setting',
          }),
          mutation: async (tx) => {
            await lockPublication(tx);
            const current = await loadMobileConfigPublication(tx);
            const next = rollbackMobileConfigPublication(
              current,
              input.targetRevision,
              input.expectedRevision,
              input.expectedDraftRevision,
            );
            await upsertSetting(tx, APP_SETTING_KEYS.mobileConfigPublication, next);
            await upsertSetting(tx, APP_SETTING_KEYS.mobileConfig, next.published.config);
            return next;
          },
        });
        await invalidateServerAppSettings();
        return state;
      } catch (error) {
        return mapPublicationError(error);
      }
    }),
  saveMobileConfigDraft: systemWriteProcedure
    .input(configInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const state = await runRequiredAdminAuditMutation<MobileConfigPublicationState>(ctx, {
          audit: (result) => ({
            action: 'settings.mobile.saveDraft',
            payload: { draftRevision: result.draft.revision },
            resourceId: APP_SETTING_KEYS.mobileConfigPublication,
            resourceType: 'app_setting',
          }),
          mutation: async (tx) => {
            await lockPublication(tx);
            const current = await loadMobileConfigPublication(tx);
            if (current.draft.revision !== input.expectedDraftRevision) {
              throw new Error('MOBILE_CONFIG_REVISION_CONFLICT');
            }
            const next = saveMobileConfigDraft(current, input.config);
            await upsertSetting(tx, APP_SETTING_KEYS.mobileConfigPublication, next);
            return next;
          },
        });
        await invalidateServerAppSettings();
        return state;
      } catch (error) {
        return mapPublicationError(error);
      }
    }),
} as const;
