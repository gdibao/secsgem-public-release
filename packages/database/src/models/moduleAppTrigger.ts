import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm';

import {
  moduleAppInstallations,
  moduleAppSchedules,
  moduleAppVersions,
  moduleAppWebhookDeliveries,
  moduleAppWebhooks,
} from '../schemas';
import type { LobeChatDatabase } from '../type';

export class ModuleAppTriggerModel {
  constructor(private readonly db: LobeChatDatabase) {}

  getWebhookContext = async (webhookId: string) => {
    const [row] = await this.db
      .select({
        installationId: moduleAppWebhooks.installationId,
        replayWindowSeconds: moduleAppWebhooks.replayWindowSeconds,
        runtimeManifest: moduleAppVersions.runtimeManifest,
        secretHash: moduleAppWebhooks.secretHash,
        status: moduleAppWebhooks.status,
        webhookId: moduleAppWebhooks.id,
        workflowKey: moduleAppWebhooks.workflowKey,
        workflowVersion: moduleAppWebhooks.workflowVersion,
      })
      .from(moduleAppWebhooks)
      .innerJoin(
        moduleAppInstallations,
        eq(moduleAppInstallations.id, moduleAppWebhooks.installationId),
      )
      .innerJoin(moduleAppVersions, eq(moduleAppVersions.id, moduleAppInstallations.versionId))
      .where(eq(moduleAppWebhooks.id, webhookId))
      .limit(1);
    return row ?? null;
  };

  acceptWebhookDelivery = async (input: {
    deliveryId: string;
    payloadSha256: string;
    receivedAt: Date;
    webhookId: string;
  }) =>
    this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(moduleAppWebhookDeliveries)
        .values({
          deliveryId: input.deliveryId,
          payloadSha256: input.payloadSha256,
          receivedAt: input.receivedAt,
          webhookId: input.webhookId,
        })
        .onConflictDoNothing({
          target: [moduleAppWebhookDeliveries.webhookId, moduleAppWebhookDeliveries.deliveryId],
        })
        .returning({ id: moduleAppWebhookDeliveries.id });
      if (!created) {
        const existing = await tx.query.moduleAppWebhookDeliveries.findFirst({
          where: and(
            eq(moduleAppWebhookDeliveries.webhookId, input.webhookId),
            eq(moduleAppWebhookDeliveries.deliveryId, input.deliveryId),
          ),
        });
        if (existing?.status !== 'failed') return { duplicate: true };
        await tx
          .update(moduleAppWebhookDeliveries)
          .set({ payloadSha256: input.payloadSha256, receivedAt: input.receivedAt, status: 'accepted' })
          .where(eq(moduleAppWebhookDeliveries.id, existing.id));
        return { duplicate: false };
      }
      await tx
        .update(moduleAppWebhooks)
        .set({ lastDeliveryAt: input.receivedAt, updatedAt: input.receivedAt })
        .where(eq(moduleAppWebhooks.id, input.webhookId));
      return { duplicate: false };
    });

  updateWebhookDelivery = async (input: {
    deliveryId: string;
    status: 'failed' | 'processed';
    webhookId: string;
  }) => {
    const [delivery] = await this.db
      .update(moduleAppWebhookDeliveries)
      .set({ status: input.status })
      .where(
        and(
          eq(moduleAppWebhookDeliveries.webhookId, input.webhookId),
          eq(moduleAppWebhookDeliveries.deliveryId, input.deliveryId),
        ),
      )
      .returning();
    if (!delivery) throw new Error('MODULE_APP_WEBHOOK_DELIVERY_NOT_FOUND');
    return delivery;
  };

  createSchedule = async (input: {
    createdBy?: string;
    installationId: string;
    nextRunAt: Date;
    schedule: string;
    scheduleKey: string;
    timezone: string;
    workflowKey: string;
    workflowVersion: number;
  }) => {
    const [schedule] = await this.db.insert(moduleAppSchedules).values(input).returning();
    if (!schedule) throw new Error('MODULE_APP_SCHEDULE_CREATE_FAILED');
    return schedule;
  };

  claimDueSchedules = async (input: { leaseMs: number; limit: number; now: Date }) => {
    const limit = Math.min(100, Math.max(1, input.limit));
    const leaseMs = Math.min(300_000, Math.max(100, input.leaseMs));
    const claimExpiresAt = new Date(input.now.getTime() + leaseMs);
    const claimToken = randomUUID();

    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select({
          id: moduleAppSchedules.id,
          installationId: moduleAppSchedules.installationId,
          runtimeManifest: moduleAppVersions.runtimeManifest,
          schedule: moduleAppSchedules.schedule,
          scheduledFor: moduleAppSchedules.nextRunAt,
          timezone: moduleAppSchedules.timezone,
          workflowKey: moduleAppSchedules.workflowKey,
          workflowVersion: moduleAppSchedules.workflowVersion,
        })
        .from(moduleAppSchedules)
        .innerJoin(
          moduleAppInstallations,
          eq(moduleAppInstallations.id, moduleAppSchedules.installationId),
        )
        .innerJoin(moduleAppVersions, eq(moduleAppVersions.id, moduleAppInstallations.versionId))
        .where(
          and(
            eq(moduleAppSchedules.enabled, true),
            lte(moduleAppSchedules.nextRunAt, input.now),
            or(
              isNull(moduleAppSchedules.claimExpiresAt),
              lte(moduleAppSchedules.claimExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(asc(moduleAppSchedules.nextRunAt), asc(moduleAppSchedules.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      if (candidates.length === 0) return [];

      await tx
        .update(moduleAppSchedules)
        .set({ claimExpiresAt, claimToken, updatedAt: input.now })
        .where(inArray(moduleAppSchedules.id, candidates.map((item) => item.id)));

      return candidates.map((candidate) => ({ ...candidate, claimExpiresAt, claimToken }));
    });
  };

  completeScheduleClaim = async (input: {
    claimToken: string;
    claimExpiresAt: Date;
    nextRunAt: Date;
    scheduleId: string;
  }) => {
    const [schedule] = await this.db
      .update(moduleAppSchedules)
      .set({ claimExpiresAt: null, claimToken: null, nextRunAt: input.nextRunAt, updatedAt: new Date() })
      .where(
        and(
          eq(moduleAppSchedules.id, input.scheduleId),
          eq(moduleAppSchedules.claimToken, input.claimToken),
          eq(moduleAppSchedules.claimExpiresAt, input.claimExpiresAt),
        ),
      )
      .returning();
    if (!schedule) throw new Error('MODULE_APP_SCHEDULE_STALE_CLAIM');
    return schedule;
  };

  releaseScheduleClaim = async (input: {
    claimToken: string;
    claimExpiresAt: Date;
    retryAt: Date;
    scheduleId: string;
  }) => {
    const [schedule] = await this.db
      .update(moduleAppSchedules)
      .set({ claimExpiresAt: null, claimToken: null, nextRunAt: input.retryAt, updatedAt: input.retryAt })
      .where(
        and(
          eq(moduleAppSchedules.id, input.scheduleId),
          eq(moduleAppSchedules.claimToken, input.claimToken),
          eq(moduleAppSchedules.claimExpiresAt, input.claimExpiresAt),
        ),
      )
      .returning();
    if (!schedule) throw new Error('MODULE_APP_SCHEDULE_STALE_CLAIM');
    return schedule;
  };

  getWebhook = (input: { installationId: string; webhookId: string }) =>
    this.db.query.moduleAppWebhooks.findFirst({
      where: and(
        eq(moduleAppWebhooks.id, input.webhookId),
        eq(moduleAppWebhooks.installationId, input.installationId),
      ),
    });
}
