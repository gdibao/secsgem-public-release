import { and, eq, lt } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { syncExpiredSubscriptionsToFree } from '@/business/server/subscriptionMaintenance';
import { adminAuditLogs, appSettings, topUpOrders } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import { decryptAppSettingSecret } from '@/server/services/appSettings/secrets';
import { ModuleAppArtifactCleanupService } from '@/server/services/moduleAppArtifactCleanup';
import { ModuleAppPackageLifecycleService } from '@/server/services/moduleAppPackage/lifecycle';

/**
 * POST /api/admin/maintenance
 *
 * Authenticated by Bearer token from app_settings 'cron.secret', then env CRON_SECRET.
 * Invalid encrypted database values fail closed and never use the environment fallback.
 * Performs scheduled cleanup tasks:
 *   1. Prune admin audit logs older than `auditRetentionDays` (default 365, range 7..3650).
 *   2. Mark `pending` top-up orders older than `pendingOrderExpiryDays` as `expired`
 *      (default 7, range 1..365).
 *   3. Expire ended active subscriptions and create unlimited free-plan fallbacks.
 *
 * Body (optional):
 *   {
 *     auditRetentionDays?: number,
 *     pendingOrderExpiryDays?: number,
 *     skipAudit?: boolean,
 *     skipModuleAppArtifacts?: boolean,
 *     skipModuleAppUploads?: boolean,
 *     skipOrders?: boolean,
 *   }
 *
 * Defaults can also be sourced from app_settings keys:
 *   - cron.auditRetentionDays (number)
 *   - cron.pendingOrderExpiryDays (number)
 */
const readNumberSetting = async (
  db: Awaited<ReturnType<typeof getServerDB>>,
  key: string,
): Promise<number | null> => {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  const v = row?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export const POST = async (req: NextRequest) => {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();

  const db = await getServerDB();
  const dbSecretRow = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, 'cron.secret'),
  });
  let decryptedDbSecret: unknown;
  try {
    decryptedDbSecret = await decryptAppSettingSecret(
      APP_SETTING_KEYS.cronSecret,
      dbSecretRow?.value,
    );
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dbSecret = typeof decryptedDbSecret === 'string' ? decryptedDbSecret : null;
  const expected = dbSecret ?? process.env.CRON_SECRET;

  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    auditRetentionDays?: number;
    pendingOrderExpiryDays?: number;
    skipAudit?: boolean;
    skipModuleAppArtifacts?: boolean;
    skipModuleAppUploads?: boolean;
    skipOrders?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const result: {
    auditLogsDeleted?: number;
    auditCutoff?: string;
    pendingOrdersExpired?: number;
    pendingOrdersCutoff?: string;
    moduleAppArtifactCleanupClaimed?: number;
    moduleAppArtifactCleanupFailed?: number;
    moduleAppArtifactCleanupRetrying?: number;
    moduleAppArtifactsReleased?: number;
    moduleAppUploadCleanupFailed?: number;
    moduleAppUploadsExpired?: number;
    subscriptionSnapshotsExpired?: number;
    freeSnapshotsCreated?: number;
    ok: true;
  } = { ok: true };

  // 1. Audit log retention
  if (!body.skipAudit) {
    const dbDefault = await readNumberSetting(db, 'cron.auditRetentionDays');
    const auditRetentionDays = Math.max(
      7,
      Math.min(3650, body.auditRetentionDays ?? dbDefault ?? 365),
    );
    const cutoff = new Date(Date.now() - auditRetentionDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(adminAuditLogs)
      .where(lt(adminAuditLogs.createdAt, cutoff))
      .returning({ id: adminAuditLogs.id });
    result.auditLogsDeleted = deleted.length;
    result.auditCutoff = cutoff.toISOString();
  }

  // 2. Pending top-up order expiry
  if (!body.skipOrders) {
    const dbDefault = await readNumberSetting(db, 'cron.pendingOrderExpiryDays');
    const pendingOrderExpiryDays = Math.max(
      1,
      Math.min(365, body.pendingOrderExpiryDays ?? dbDefault ?? 7),
    );
    const cutoff = new Date(Date.now() - pendingOrderExpiryDays * 24 * 60 * 60 * 1000);
    const expired = await db
      .update(topUpOrders)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(topUpOrders.status, 'pending'), lt(topUpOrders.createdAt, cutoff)))
      .returning({ id: topUpOrders.id });
    result.pendingOrdersExpired = expired.length;
    result.pendingOrdersCutoff = cutoff.toISOString();
  }

  if (!body.skipModuleAppUploads) {
    const cleanup = await new ModuleAppPackageLifecycleService({ db }).cleanupExpiredUploads({
      limit: 100,
    });
    result.moduleAppUploadCleanupFailed = cleanup.failed;
    result.moduleAppUploadsExpired = cleanup.expired;
  }

  if (!body.skipModuleAppArtifacts) {
    const cleanup = await new ModuleAppArtifactCleanupService({ db }).cleanupPending(100);
    result.moduleAppArtifactCleanupClaimed = cleanup.claimed;
    result.moduleAppArtifactCleanupFailed = cleanup.failed;
    result.moduleAppArtifactCleanupRetrying = cleanup.retrying;
    result.moduleAppArtifactsReleased = cleanup.released;
  }

  const subscriptionResult = await syncExpiredSubscriptionsToFree(db);
  result.subscriptionSnapshotsExpired = subscriptionResult.expiredSnapshots;
  result.freeSnapshotsCreated = subscriptionResult.freeSnapshotsCreated;

  return NextResponse.json(result);
};
