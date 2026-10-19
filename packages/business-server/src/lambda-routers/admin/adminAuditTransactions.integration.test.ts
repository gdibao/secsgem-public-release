// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { adminAuditLogs, appSettings, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { recordAdminAudit, runRequiredAdminAuditMutation } from './audit';

const serverDB: LobeChatDatabase = await getTestDB();
const actorUserId = 'admin-audit-integration-actor';
const missingActorUserId = 'admin-audit-integration-missing-actor';
const auditFailureKey = 'admin-audit-integration-audit-failure';
const businessFailureKey = 'admin-audit-integration-business-failure';
const auditActions = ['integration.audit.failure', 'integration.business.failure'];

afterEach(async () => {
  await serverDB.delete(adminAuditLogs).where(inArray(adminAuditLogs.action, auditActions));
  await serverDB
    .delete(appSettings)
    .where(inArray(appSettings.key, [auditFailureKey, businessFailureKey]));
  await serverDB.delete(users).where(eq(users.id, actorUserId));
});

describe('required admin audit real database transactions', () => {
  it('rolls back a business write when the audit insert violates a real foreign key', async () => {
    await expect(
      runRequiredAdminAuditMutation(
        { serverDB, userId: missingActorUserId },
        {
          audit: () => ({ action: 'integration.audit.failure', resourceType: 'app_setting' }),
          mutation: async (tx) => {
            await tx.insert(appSettings).values({ key: auditFailureKey, value: { enabled: true } });
            return { ok: true };
          },
        },
      ),
    ).rejects.toBeTruthy();

    await expect(
      serverDB.query.appSettings.findFirst({ where: eq(appSettings.key, auditFailureKey) }),
    ).resolves.toBeUndefined();
  });

  it('rolls back an inserted audit row when the surrounding business transaction fails', async () => {
    await serverDB.insert(users).values({ id: actorUserId });

    await expect(
      serverDB.transaction(async (tx) => {
        await recordAdminAudit(
          { serverDB: tx, userId: actorUserId },
          { action: 'integration.business.failure', resourceType: 'app_setting' },
          { correlationId: 'integration-business-failure', status: 'started' },
        );
        await tx.insert(appSettings).values({ key: businessFailureKey, value: { enabled: true } });
        throw new Error('business transaction failed');
      }),
    ).rejects.toThrow('business transaction failed');

    await expect(
      serverDB.query.adminAuditLogs.findFirst({
        where: eq(adminAuditLogs.action, 'integration.business.failure'),
      }),
    ).resolves.toBeUndefined();
    await expect(
      serverDB.query.appSettings.findFirst({ where: eq(appSettings.key, businessFailureKey) }),
    ).resolves.toBeUndefined();
  });
});
