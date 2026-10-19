import { randomUUID } from 'node:crypto';

import { type AuditEnvelopeStatus,createAuditEnvelope } from '@lobechat/types';

import { moduleAppAuditLogs } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

export const createModuleAppAuditEnvelopeMetadata = (params: {
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

export const writeModuleAppAuditLog = async (params: {
  actorUserId?: null | string;
  clientIp?: null | string;
  correlationId?: string;
  db: LobeChatDatabase | Transaction;
  eventType: string;
  metadata?: null | Record<string, unknown>;
  resourceId: string;
  resourceType: string;
  status?: AuditEnvelopeStatus;
  targetUserId?: null | string;
}) => {
  await params.db.insert(moduleAppAuditLogs).values({
    actorUserId: params.actorUserId ?? null,
    eventType: params.eventType,
    metadata: createModuleAppAuditEnvelopeMetadata(params),
    resourceId: params.resourceId,
    resourceType: params.resourceType,
  });
};
