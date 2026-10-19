import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { adminAuditLogs, notifications, topUpOrders } from '@/database/schemas';
import { invalidateFileS3RuntimeCache, S3 } from '@/server/modules/S3';
import {
  getServerFileS3Config,
  invalidateServerAppSettings,
  normalizeS3FilePath,
} from '@/server/services/appSettings';
import { invalidateServerBrand } from '@/server/services/brand';
import { ModuleAppPackageLifecycleService } from '@/server/services/moduleAppPackage/lifecycle';
import { invalidateNewapiInstancesCache } from '@/server/services/newapiInstance';

import { createAdminCommand } from '../../lambda-routers/admin/adminCommand';
import {
  recordAdminAudit,
  runRequiredAdminAuditExternalEffect,
  runRequiredAdminAuditMutation,
} from '../../lambda-routers/admin/audit';
import { syncExpiredSubscriptionsToFree } from '../../subscriptionMaintenance';
import { readSetting, SETTING_KEYS, systemWriteProcedure } from '../procedureShared';

const runMaintenanceCommand = createAdminCommand('setting.runMaintenance');
const S3_HEALTH_CHECK_CONTENT = 'comhub-s3-health-check';
const S3_HEALTH_CHECK_DIR = 'admin-s3-health-check';
const getAppUrlFallback = () => {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;

  return process.env.NODE_ENV === 'development'
    ? `http://localhost:${process.env.PORT || 3010}`
    : `http://localhost:${process.env.PORT || 3210}`;
};
const getAppOriginForCorsTest = () => {
  try {
    return new URL(getAppUrlFallback()).origin;
  } catch {
    throw new Error('APP_URL must be a valid URL before testing S3 CORS');
  }
};
const createS3HealthCheckKey = (filePath: string | undefined) => {
  const prefix = normalizeS3FilePath(filePath || 'files') || 'files';

  return `${prefix}/${S3_HEALTH_CHECK_DIR}/${Date.now()}-${randomUUID()}.txt`;
};
const readResponseSnippet = async (response: Response) => {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
};
const assertHttpOk = async (response: Response, code: string) => {
  if (response.ok) return;

  const body = await readResponseSnippet(response);
  throw new Error(`${code}: ${response.status}${body ? ` ${body}` : ''}`);
};

export const runtimeSettingsWriteProcedures = {
  refreshRuntimeCaches: systemWriteProcedure.mutation(async ({ ctx }) => {
    await invalidateServerAppSettings();
    invalidateNewapiInstancesCache();
    invalidateFileS3RuntimeCache();
    invalidateServerBrand();

    const results = [
      { domain: 'app-settings', status: 'refreshed' },
      { domain: 'newapi-instances', status: 'refreshed' },
      { domain: 's3-runtime', status: 'refreshed' },
      { domain: 'brand', status: 'refreshed' },
    ] as const;
    const refreshed = results.map(({ domain }) => domain);
    await recordAdminAudit(ctx, {
      action: 'settings.refreshRuntimeCaches',
      payload: {
        operation: 'refreshRuntimeCaches',
        refreshed,
        requestedDomains: refreshed,
        results,
        status: 'success',
      },
      resourceType: 'app_setting',
    });

    return { ok: true, refreshed };
  }),
  testS3Storage: systemWriteProcedure.mutation(async ({ ctx }) => {
    const config = await getServerFileS3Config(ctx.serverDB);

    if (!config.accessKeyId || !config.secretAccessKey || !config.endpoint || !config.bucket) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'S3_CONFIG_INCOMPLETE',
      });
    }

    return runRequiredAdminAuditExternalEffect(ctx, {
      audit: (status) => ({
        action: 'settings.testS3Storage',
        payload: { operation: 's3_storage_health_check', terminalStatus: status },
        resourceType: 's3_storage',
      }),
      effect: async () => {
        try {
          const s3 = new S3(config.accessKeyId, config.secretAccessKey, config.endpoint, {
            bucket: config.bucket,
            forcePathStyle: config.enablePathStyle,
            internalEndpoint: config.internalEndpoint,
            previewUrlExpireIn: config.previewUrlExpireIn,
            region: config.region,
            setAcl: config.setAcl,
          });

          if (typeof fetch !== 'function') {
            throw new Error('FETCH_NOT_AVAILABLE');
          }

          const origin = getAppOriginForCorsTest();
          const healthCheckKey = createS3HealthCheckKey(config.filePath);
          let deleted = false;

          try {
            await s3.testConnection();

            const preSignedUrl = await s3.createPreSignedUrl(healthCheckKey);
            let corsPreflight: Response | undefined;
            let presignedUpload: Response | undefined;
            let publicEndpointCheckSkipped = false;

            try {
              corsPreflight = await fetch(preSignedUrl, {
                headers: {
                  'Access-Control-Request-Headers': 'content-type',
                  'Access-Control-Request-Method': 'PUT',
                  'Origin': origin,
                },
                method: 'OPTIONS',
              });

              presignedUpload = await fetch(preSignedUrl, {
                body: S3_HEALTH_CHECK_CONTENT,
                headers: {
                  'Content-Type': 'text/plain',
                  'Origin': origin,
                },
                method: 'PUT',
              });
            } catch (error) {
              if (!config.internalEndpoint || config.internalEndpoint === config.endpoint)
                throw error;

              // A split endpoint is intentionally browser-only. If the server
              // cannot resolve/reach that public URL, verify the same object
              // write through the internal client and report CORS separately.
              publicEndpointCheckSkipped = true;
              await s3.uploadContent(healthCheckKey, S3_HEALTH_CHECK_CONTENT);
            }

            if (!publicEndpointCheckSkipped) {
              await assertHttpOk(corsPreflight!, 'S3_CORS_PREFLIGHT_FAILED');
              await assertHttpOk(presignedUpload!, 'S3_PRESIGNED_UPLOAD_FAILED');
            }

            const storedContent = await s3.getFileContent(healthCheckKey);
            if (storedContent !== S3_HEALTH_CHECK_CONTENT) {
              throw new Error('S3_OBJECT_READ_MISMATCH');
            }

            await s3.deleteFile(healthCheckKey);
            deleted = true;

            return {
              bucket: config.bucket,
              checks: {
                bucketAccess: { ok: true },
                corsPreflight: publicEndpointCheckSkipped
                  ? {
                      ok: true,
                      reason: 'PUBLIC_ENDPOINT_NOT_REACHABLE_FROM_SERVER',
                      skipped: true,
                    }
                  : {
                      allowHeaders: corsPreflight!.headers.get('access-control-allow-headers'),
                      allowMethods: corsPreflight!.headers.get('access-control-allow-methods'),
                      allowOrigin: corsPreflight!.headers.get('access-control-allow-origin'),
                      ok: true,
                      status: corsPreflight!.status,
                    },
                objectDelete: { ok: true },
                objectRead: {
                  bytes: new TextEncoder().encode(storedContent).byteLength,
                  ok: true,
                },
                presignedUpload: publicEndpointCheckSkipped
                  ? {
                      ok: true,
                      reason: 'PUBLIC_ENDPOINT_NOT_REACHABLE_FROM_SERVER',
                      skipped: true,
                    }
                  : {
                      allowOrigin: presignedUpload!.headers.get('access-control-allow-origin'),
                      ok: true,
                      status: presignedUpload!.status,
                    },
              },
              endpoint: config.endpoint,
              filePath: config.filePath,
              ok: true,
              origin,
              publicDomain: config.publicDomain || null,
            };
          } finally {
            if (!deleted) {
              try {
                await s3.deleteFile(healthCheckKey);
              } catch {
                console.error('[admin-s3] health check cleanup failed');
              }
            }
          }
        } catch (error) {
          throw new TRPCError({
            cause: error,
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : 'S3_CONNECTION_FAILED',
          });
        }
      },
    });
  }),
  runMaintenance: systemWriteProcedure
    .input(
      z.object({
        auditRetentionDays: z.number().int().min(7).max(3650).optional(),
        command: runMaintenanceCommand.schema,
        notificationRetentionDays: z.number().int().min(1).max(3650).optional(),
        pendingOrderExpiryDays: z.number().int().min(1).max(365).optional(),
        skipAudit: z.boolean().optional(),
        skipModuleAppUploads: z.boolean().optional(),
        skipNotifications: z.boolean().optional(),
        skipOrders: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const command = runMaintenanceCommand.validate(input.command);
      const { command: _command, ...opts } = input;
      const correlationId = randomUUID();
      const result = await runRequiredAdminAuditExternalEffect<any>(ctx, {
        audit: (status, result) => ({
          action: command.auditAction,
          payload:
            status === 'started'
              ? { phase: 'started' }
              : { ...result, phase: 'external', terminalStatus: status },
          resourceType: 'maintenance',
        }),
        correlationId,
        effect: async () => {
          const databaseResult = await runRequiredAdminAuditMutation<any>(ctx, {
            audit: (result) => ({
              action: command.auditAction,
              payload: { ...result, phase: 'database' },
              resourceType: 'maintenance',
            }),
            correlationId,
            mutation: async (tx) => {
              const databaseResult: {
                auditCutoff?: string;
                auditLogsDeleted?: number;
                freeSnapshotsCreated?: number;
                notificationRetentionCutoff?: string;
                notificationsDeleted?: number;
                pendingOrdersCutoff?: string;
                pendingOrdersExpired?: number;
                subscriptionSnapshotsExpired?: number;
              } = {};

              if (!opts.skipAudit) {
                const dbVal = await readSetting(tx, SETTING_KEYS.cronAuditRetentionDays);
                const days = Math.max(
                  7,
                  Math.min(
                    3650,
                    opts.auditRetentionDays ?? (typeof dbVal === 'number' ? dbVal : 365),
                  ),
                );
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                const deleted = await tx
                  .delete(adminAuditLogs)
                  .where(lt(adminAuditLogs.createdAt, cutoff))
                  .returning({ id: adminAuditLogs.id });
                databaseResult.auditCutoff = cutoff.toISOString();
                databaseResult.auditLogsDeleted = deleted.length;
              }

              if (!opts.skipOrders) {
                const dbVal = await readSetting(tx, SETTING_KEYS.cronPendingOrderExpiryDays);
                const days = Math.max(
                  1,
                  Math.min(
                    365,
                    opts.pendingOrderExpiryDays ?? (typeof dbVal === 'number' ? dbVal : 7),
                  ),
                );
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                const expired = await tx
                  .update(topUpOrders)
                  .set({ status: 'expired', updatedAt: new Date() })
                  .where(and(eq(topUpOrders.status, 'pending'), lt(topUpOrders.createdAt, cutoff)))
                  .returning({ id: topUpOrders.id });
                databaseResult.pendingOrdersCutoff = cutoff.toISOString();
                databaseResult.pendingOrdersExpired = expired.length;
              }

              if (!opts.skipNotifications) {
                const dbVal = await readSetting(tx, SETTING_KEYS.notificationRetentionDays);
                const days = Math.max(
                  1,
                  Math.min(
                    3650,
                    opts.notificationRetentionDays ?? (typeof dbVal === 'number' ? dbVal : 90),
                  ),
                );
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                const deleted = await tx
                  .delete(notifications)
                  .where(
                    and(eq(notifications.isArchived, true), lt(notifications.updatedAt, cutoff)),
                  )
                  .returning({ id: notifications.id });
                databaseResult.notificationRetentionCutoff = cutoff.toISOString();
                databaseResult.notificationsDeleted = deleted.length;
              }

              const subscriptionResult = await syncExpiredSubscriptionsToFree(tx);
              databaseResult.subscriptionSnapshotsExpired = subscriptionResult.expiredSnapshots;
              databaseResult.freeSnapshotsCreated = subscriptionResult.freeSnapshotsCreated;

              return databaseResult;
            },
          });

          if (opts.skipModuleAppUploads) return databaseResult;

          // Storage deletion cannot roll back. The durable started and database-result audits
          // above remain available if this lifecycle reports a recovery-required terminal failure.
          const cleanup = await new ModuleAppPackageLifecycleService({
            db: ctx.serverDB,
          }).cleanupExpiredUploads({ limit: 100 });

          return {
            ...databaseResult,
            moduleAppUploadCleanupFailed: cleanup.failed,
            moduleAppUploadsExpired: cleanup.expired,
          };
        },
        terminalStatus: (result) =>
          result.moduleAppUploadCleanupFailed > 0 ? 'failed' : 'succeeded',
      });

      return { ok: true, ...result };
    }),
} as const;
