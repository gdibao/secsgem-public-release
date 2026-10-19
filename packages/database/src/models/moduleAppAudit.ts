import { randomUUID } from 'node:crypto';

import { type AuditEnvelopeStatus,createAuditEnvelope } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { moduleAppAuditLogs } from '../schemas';
import { ModuleAppExecutionModel } from './moduleAppExecution';

const createAuditEnvelopeMetadata = (params: {
  actorUserId?: null | string;
  clientIp?: null | string;
  correlationId?: string;
  eventType: string;
  metadata?: null | Record<string, unknown>;
  resourceId: string;
  resourceType: string;
  status?: AuditEnvelopeStatus;
  targetUserId?: null | string;
}): Record<string, unknown> => {
  const correlationId = params.correlationId ?? randomUUID();

  return {
    ...createAuditEnvelope({
      audit: {
        action: params.eventType,
        actorUserId: params.actorUserId ?? null,
        clientIp: params.clientIp ?? null,
        correlationId,
        resourceId: params.resourceId,
        resourceType: params.resourceType,
        status: params.status ?? 'succeeded',
        targetUserId: params.targetUserId ?? null,
      },
      payload: params.metadata,
    }),
    action: params.eventType,
    correlationId,
    resourceId: params.resourceId,
    resourceType: params.resourceType,
    status: params.status ?? 'succeeded',
  };
};

export class ModuleAppAuditModel extends ModuleAppExecutionModel {
  listAdminAuditEvents = async (params: { appId: string; cursor?: number; limit?: number }) => {
    const limit = params.limit ?? 50;
    const cursor = params.cursor ?? 0;
    const items = await this.db.query.moduleAppAuditLogs.findMany({
      limit,
      offset: cursor,
      orderBy: [desc(moduleAppAuditLogs.createdAt)],
      where: and(
        eq(moduleAppAuditLogs.resourceType, 'moduleApp'),
        eq(moduleAppAuditLogs.resourceId, params.appId),
      ),
    });

    return { items, nextCursor: items.length === limit ? cursor + limit : null };
  };

  writeAuditLog = async (params: {
    actorUserId?: null | string;
    clientIp?: null | string;
    correlationId?: string;
    eventType: string;
    metadata?: null | Record<string, unknown>;
    resourceId: string;
    resourceType: string;
    status?: AuditEnvelopeStatus;
    targetUserId?: null | string;
  }) => {
    await this.db.insert(moduleAppAuditLogs).values({
      actorUserId: params.actorUserId ?? null,
      eventType: params.eventType,
      metadata: createAuditEnvelopeMetadata(params),
      resourceId: params.resourceId,
      resourceType: params.resourceType,
    });

    return { ok: true as const };
  };
}
