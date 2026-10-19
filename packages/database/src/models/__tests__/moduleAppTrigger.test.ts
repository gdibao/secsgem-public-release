// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  moduleAppInstallations,
  moduleApps,
  moduleAppSchedules,
  moduleAppVersions,
  moduleAppWebhookDeliveries,
  moduleAppWebhooks,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppTriggerModel } from '../moduleAppTrigger';

const USER_ID = 'module-app-trigger-user';
const serverDB: LobeChatDatabase = await getTestDB();

const createInstallation = async () => {
  const [app] = await serverDB.insert(moduleApps).values({
    appType: 'workflow_app',
    category: 'business',
    description: 'Trigger test.',
    displayName: 'Triggers',
    icon: 'Webhook',
    slug: `triggers-${crypto.randomUUID()}`,
  }).returning();
  const [version] = await serverDB.insert(moduleAppVersions).values({
    appId: app.id,
    version: '1.0.0',
  }).returning();
  const [installation] = await serverDB.insert(moduleAppInstallations).values({
    appId: app.id,
    scopeType: 'personal',
    userId: USER_ID,
    versionId: version.id,
  }).returning();
  return installation;
};

beforeEach(async () => {
  await serverDB.delete(moduleAppWebhookDeliveries);
  await serverDB.delete(moduleAppWebhooks);
  await serverDB.delete(moduleAppSchedules);
  await serverDB.delete(moduleAppInstallations);
  await serverDB.delete(moduleAppVersions);
  await serverDB.delete(moduleApps);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: USER_ID });
});

describe('ModuleAppTriggerModel', () => {
  it('deduplicates webhook deliveries and persists bounded schedules', async () => {
    const installation = await createInstallation();
    const [webhook] = await serverDB.insert(moduleAppWebhooks).values({
      installationId: installation.id,
      secretHash: 'a'.repeat(64),
      webhookKey: 'candidate_created',
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    }).returning();
    const model = new ModuleAppTriggerModel(serverDB);
    const delivery = {
      deliveryId: 'delivery-1',
      payloadSha256: 'b'.repeat(64),
      receivedAt: new Date('2026-07-11T05:00:00.000Z'),
      webhookId: webhook.id,
    };
    await expect(model.acceptWebhookDelivery(delivery)).resolves.toEqual({ duplicate: false });
    await expect(model.acceptWebhookDelivery(delivery)).resolves.toEqual({ duplicate: true });
    expect(await serverDB.query.moduleAppWebhookDeliveries.findMany()).toHaveLength(1);

    await expect(model.createSchedule({
      installationId: installation.id,
      nextRunAt: new Date('2026-07-12T01:00:00.000Z'),
      schedule: '0 9 * * *',
      scheduleKey: 'daily_review',
      timezone: 'Asia/Shanghai',
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    })).resolves.toMatchObject({ scheduleKey: 'daily_review' });
  });

  it('claims due schedules once and allows reclaim only after lease expiry', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppTriggerModel(serverDB);
    await model.createSchedule({
      installationId: installation.id,
      nextRunAt: new Date('2026-07-12T00:00:00.000Z'),
      schedule: '*/15 * * * *',
      scheduleKey: 'lease_test',
      timezone: 'UTC',
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    });

    await expect(
      model.claimDueSchedules({
        leaseMs: 30_000,
        limit: 10,
        now: new Date('2026-07-12T00:00:00.000Z'),
      }),
    ).resolves.toHaveLength(1);
    const firstClaim = await model.claimDueSchedules({
      leaseMs: 30_000,
      limit: 10,
      now: new Date('2026-07-12T00:00:00.000Z'),
    });
    expect(firstClaim).toEqual([]);
    await expect(
      model.claimDueSchedules({
        leaseMs: 30_000,
        limit: 10,
        now: new Date('2026-07-12T00:00:31.000Z'),
      }),
    ).resolves.toHaveLength(1);
  });

  it('completes a schedule only for its active claim and clears the lease', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppTriggerModel(serverDB);
    const schedule = await model.createSchedule({
      installationId: installation.id,
      nextRunAt: new Date('2026-07-12T00:00:00.000Z'),
      schedule: '*/15 * * * *',
      scheduleKey: 'complete_test',
      timezone: 'UTC',
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    });
    const [claim] = await model.claimDueSchedules({
      leaseMs: 30_000,
      limit: 10,
      now: new Date('2026-07-12T00:00:00.000Z'),
    });

    await expect(model.completeScheduleClaim({
      claimExpiresAt: claim.claimExpiresAt,
      claimToken: 'wrong-token',
      nextRunAt: new Date('2026-07-12T00:15:00.000Z'),
      scheduleId: schedule.id,
    })).rejects.toThrow('MODULE_APP_SCHEDULE_STALE_CLAIM');
    await expect(model.completeScheduleClaim({
      claimExpiresAt: claim.claimExpiresAt,
      claimToken: claim.claimToken,
      nextRunAt: new Date('2026-07-12T00:15:00.000Z'),
      scheduleId: schedule.id,
    })).resolves.toMatchObject({
      claimExpiresAt: null,
      claimToken: null,
      nextRunAt: new Date('2026-07-12T00:15:00.000Z'),
    });
  });

  it('releases a schedule claim for retry and rejects stale claim mutations', async () => {
    const installation = await createInstallation();
    const model = new ModuleAppTriggerModel(serverDB);
    const schedule = await model.createSchedule({
      installationId: installation.id,
      nextRunAt: new Date('2026-07-12T00:00:00.000Z'),
      schedule: '*/15 * * * *',
      scheduleKey: 'release_test',
      timezone: 'UTC',
      workflowKey: 'candidate_review',
      workflowVersion: 1,
    });
    const [claim] = await model.claimDueSchedules({
      leaseMs: 30_000,
      limit: 10,
      now: new Date('2026-07-12T00:00:00.000Z'),
    });

    await expect(model.releaseScheduleClaim({
      claimExpiresAt: claim.claimExpiresAt,
      claimToken: claim.claimToken,
      retryAt: new Date('2026-07-12T00:00:01.000Z'),
      scheduleId: schedule.id,
    })).resolves.toMatchObject({
      claimExpiresAt: null,
      claimToken: null,
      nextRunAt: new Date('2026-07-12T00:00:01.000Z'),
    });
    await expect(model.completeScheduleClaim({
      claimExpiresAt: claim.claimExpiresAt,
      claimToken: claim.claimToken,
      nextRunAt: new Date('2026-07-12T00:15:00.000Z'),
      scheduleId: schedule.id,
    })).rejects.toThrow('MODULE_APP_SCHEDULE_STALE_CLAIM');
  });
});
