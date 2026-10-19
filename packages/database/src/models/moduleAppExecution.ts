import { Buffer } from 'node:buffer';

import type {
  ModuleAppRecordInput,
  ModuleAppRunInput,
  ModuleAppRunStatus,
  ModuleAppScopeType,
} from '@lobechat/types';
import { and, count, desc, eq, isNull, ne, or } from 'drizzle-orm';

import {
  moduleAppActions,
  moduleAppArtifacts,
  moduleAppRecordEvents,
  moduleAppRecords,
  moduleAppRuns,
} from '../schemas';
import { ModuleAppInstallationModel } from './moduleAppInstallation';

const encodeHistoryCursor = (offset: number) =>
  Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');

const decodeHistoryCursor = (cursor?: string) => {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown;
    };
    if (
      !Number.isInteger(value.offset) ||
      Number(value.offset) < 0 ||
      Number(value.offset) > 1_000_000
    ) {
      throw new Error('invalid module app history cursor offset');
    }
    return Number(value.offset);
  } catch {
    throw new Error('MODULE_APP_HISTORY_CURSOR_INVALID');
  }
};

const recordScopeWhere = (params: {
  scopeType: ModuleAppScopeType;
  userId: string;
  workspaceId?: string;
}) =>
  params.scopeType === 'personal'
    ? and(
        eq(moduleAppRecords.scopeType, 'personal'),
        eq(moduleAppRecords.ownerUserId, params.userId),
        isNull(moduleAppRecords.workspaceId),
      )
    : and(
        eq(moduleAppRecords.scopeType, 'workspace'),
        eq(moduleAppRecords.workspaceId, params.workspaceId ?? ''),
      );

export class ModuleAppExecutionModel extends ModuleAppInstallationModel {
  listAdminRecords = async (params: { appId: string; cursor?: number; limit?: number }) => {
    const limit = params.limit ?? 50;
    const cursor = params.cursor ?? 0;
    const items = await this.db.query.moduleAppRecords.findMany({
      limit,
      offset: cursor,
      orderBy: [desc(moduleAppRecords.updatedAt)],
      where: eq(moduleAppRecords.appId, params.appId),
    });

    return { items, nextCursor: items.length === limit ? cursor + limit : null };
  };

  listAdminRuns = async (params: { appId: string; cursor?: number; limit?: number }) => {
    const limit = params.limit ?? 50;
    const cursor = params.cursor ?? 0;
    const items = await this.db.query.moduleAppRuns.findMany({
      limit,
      offset: cursor,
      orderBy: [desc(moduleAppRuns.createdAt)],
      where: eq(moduleAppRuns.appId, params.appId),
    });

    return { items, nextCursor: items.length === limit ? cursor + limit : null };
  };

  listAdminArtifacts = async (params: { appId: string; cursor?: number; limit?: number }) => {
    const limit = params.limit ?? 50;
    const cursor = params.cursor ?? 0;
    const items = await this.db.query.moduleAppArtifacts.findMany({
      limit,
      offset: cursor,
      orderBy: [desc(moduleAppArtifacts.createdAt)],
      where: eq(moduleAppArtifacts.appId, params.appId),
    });

    return { items, nextCursor: items.length === limit ? cursor + limit : null };
  };

  listRecords = async (params: {
    appId: string;
    collectionKey: string;
    limit: number;
    offset: number;
    scopeType: ModuleAppScopeType;
    userId: string;
    workspaceId?: string;
  }) => {
    const where = and(
      eq(moduleAppRecords.appId, params.appId),
      eq(moduleAppRecords.collectionKey, params.collectionKey),
      ne(moduleAppRecords.status, 'archived'),
      recordScopeWhere(params),
    );
    const [items, [total]] = await Promise.all([
      this.db.query.moduleAppRecords.findMany({
        limit: params.limit,
        offset: params.offset,
        orderBy: [desc(moduleAppRecords.updatedAt)],
        where,
      }),
      this.db.select({ value: count() }).from(moduleAppRecords).where(where),
    ]);

    return { items, total: Number(total?.value ?? 0) };
  };

  getRecord = async (params: {
    appId: string;
    recordId: string;
    userId: string;
    workspaceId?: string;
  }) => {
    const personalAccess = and(
      eq(moduleAppRecords.scopeType, 'personal'),
      eq(moduleAppRecords.ownerUserId, params.userId),
      isNull(moduleAppRecords.workspaceId),
    );
    const scopedAccess = params.workspaceId
      ? or(
          personalAccess,
          and(
            eq(moduleAppRecords.scopeType, 'workspace'),
            eq(moduleAppRecords.workspaceId, params.workspaceId),
          ),
        )
      : personalAccess;

    return (
      (await this.db.query.moduleAppRecords.findFirst({
        where: and(
          eq(moduleAppRecords.id, params.recordId),
          eq(moduleAppRecords.appId, params.appId),
          ne(moduleAppRecords.status, 'archived'),
          scopedAccess,
        ),
      })) ?? null
    );
  };

  createRecord = async (params: ModuleAppRecordInput & { recordKey?: string; userId: string }) => {
    const installation = await this.requireActiveInstallation(params);
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(moduleAppRecords)
        .values({
          appId: params.appId,
          collectionKey: params.collectionKey,
          createdBy: params.userId,
          data: params.data,
          installationId: installation.id,
          ownerUserId: params.scopeType === 'personal' ? params.userId : undefined,
          recordKey: params.recordKey,
          scopeType: params.scopeType,
          title: params.title,
          updatedBy: params.userId,
          workspaceId: params.scopeType === 'workspace' ? params.workspaceId : undefined,
        })
        .returning();

      await tx.insert(moduleAppRecordEvents).values({
        actorUserId: params.userId,
        afterSnapshot: record,
        appId: params.appId,
        beforeSnapshot: {},
        eventType: 'created',
        metadata: {},
        recordId: record.id,
        scopeType: params.scopeType,
        workspaceId: params.scopeType === 'workspace' ? params.workspaceId : undefined,
      });

      return record;
    });
  };

  updateRecord = async (params: ModuleAppRecordInput & { userId: string }) => {
    if (!params.recordId) throw new Error('MODULE_APP_RECORD_ID_REQUIRED');
    const recordId = params.recordId;

    const existing = await this.db.query.moduleAppRecords.findFirst({
      where: and(
        eq(moduleAppRecords.id, recordId),
        eq(moduleAppRecords.appId, params.appId),
        recordScopeWhere(params),
      ),
    });

    if (!existing) throw new Error('MODULE_APP_RECORD_NOT_FOUND');
    await this.assertInstallationActive(existing.installationId);

    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .update(moduleAppRecords)
        .set({
          data: params.data,
          title: params.title,
          updatedAt: new Date(),
          updatedBy: params.userId,
        })
        .where(eq(moduleAppRecords.id, recordId))
        .returning();

      await tx.insert(moduleAppRecordEvents).values({
        actorUserId: params.userId,
        afterSnapshot: record,
        appId: params.appId,
        beforeSnapshot: existing,
        eventType: 'updated',
        metadata: {},
        recordId: record.id,
        scopeType: record.scopeType,
        workspaceId: record.workspaceId,
      });

      return record;
    });
  };

  archiveRecord = async (params: { appId: string; recordId: string; userId: string }) => {
    const existing = await this.db.query.moduleAppRecords.findFirst({
      where: and(
        eq(moduleAppRecords.id, params.recordId),
        eq(moduleAppRecords.appId, params.appId),
      ),
    });

    if (!existing) throw new Error('MODULE_APP_RECORD_NOT_FOUND');
    await this.assertInstallationActive(existing.installationId);

    await this.db.transaction(async (tx) => {
      const [record] = await tx
        .update(moduleAppRecords)
        .set({
          status: 'archived',
          updatedAt: new Date(),
          updatedBy: params.userId,
        })
        .where(eq(moduleAppRecords.id, params.recordId))
        .returning();

      await tx.insert(moduleAppRecordEvents).values({
        actorUserId: params.userId,
        afterSnapshot: record,
        appId: params.appId,
        beforeSnapshot: existing,
        eventType: 'archived',
        metadata: {},
        recordId: record.id,
        scopeType: record.scopeType,
        workspaceId: record.workspaceId,
      });
    });

    return { ok: true as const };
  };

  createRun = async (params: ModuleAppRunInput & { userId: string }) => {
    const installation = await this.requireActiveInstallation(params);
    const action = await this.db.query.moduleAppActions.findFirst({
      where: and(
        eq(moduleAppActions.appId, params.appId),
        eq(moduleAppActions.actionKey, params.actionId),
        eq(moduleAppActions.versionId, installation.versionId),
      ),
    });

    const [run] = await this.db
      .insert(moduleAppRuns)
      .values({
        actionId: action?.id,
        appId: params.appId,
        inputSnapshot: params.input,
        installationId: installation.id,
        recordId: params.recordId,
        scopeType: params.scopeType,
        status: 'running',
        userId: params.userId,
        versionId: action?.versionId,
        workspaceId: params.scopeType === 'workspace' ? params.workspaceId : undefined,
      })
      .returning();

    return run;
  };

  updateRun = async (params: {
    billing?: Record<string, unknown>;
    durationMs?: number;
    errorMessage?: string;
    errorType?: string;
    output?: Record<string, unknown>;
    runId: string;
    status: ModuleAppRunStatus;
  }) => {
    const existing = await this.db.query.moduleAppRuns.findFirst({
      columns: { installationId: true },
      where: eq(moduleAppRuns.id, params.runId),
    });
    if (!existing) throw new Error('MODULE_APP_RUN_NOT_FOUND');
    await this.assertInstallationActive(existing.installationId);
    await this.db
      .update(moduleAppRuns)
      .set({
        billingSnapshot: params.billing,
        durationMs: params.durationMs,
        errorMessage: params.errorMessage,
        errorType: params.errorType,
        outputSnapshot: params.output,
        status: params.status,
        updatedAt: new Date(),
      })
      .where(eq(moduleAppRuns.id, params.runId));

    return { ok: true as const };
  };

  createArtifact = async (params: {
    appId: string;
    expiresAt?: Date | null;
    fileName: string;
    mimeType: string;
    recordId?: null | string;
    runId: string;
    scopeType: ModuleAppScopeType;
    sizeBytes: number;
    storageKey: string;
    userId: string;
    workspaceId?: string;
  }) => {
    const installation = await this.requireActiveInstallation(params);
    const run = await this.db.query.moduleAppRuns.findFirst({
      columns: { installationId: true },
      where: and(eq(moduleAppRuns.id, params.runId), eq(moduleAppRuns.appId, params.appId)),
    });
    if (!run || run.installationId !== installation.id) {
      throw new Error('MODULE_APP_ARTIFACT_RUN_SCOPE_MISMATCH');
    }
    const [row] = await this.db
      .insert(moduleAppArtifacts)
      .values({
        appId: params.appId,
        expiresAt: params.expiresAt ?? null,
        fileName: params.fileName,
        installationId: installation.id,
        mimeType: params.mimeType,
        recordId: params.recordId ?? null,
        runId: params.runId,
        scopeType: params.scopeType,
        sizeBytes: params.sizeBytes,
        storageKey: params.storageKey,
        userId: params.userId,
        workspaceId: params.scopeType === 'workspace' ? params.workspaceId : undefined,
      })
      .returning({ id: moduleAppArtifacts.id });

    if (!row) throw new Error('MODULE_APP_ARTIFACT_CREATE_FAILED');

    return row;
  };

  listRuns = async (params: {
    cursor?: string;
    installationId: string;
    limit?: number;
    userId: string;
    workspaceId?: string;
  }) => {
    await this.assertInstallationAccess(params);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const cursor = decodeHistoryCursor(params.cursor);
    const items = await this.db.query.moduleAppRuns.findMany({
      limit: limit + 1,
      offset: cursor,
      orderBy: [desc(moduleAppRuns.createdAt), desc(moduleAppRuns.id)],
      where: eq(moduleAppRuns.installationId, params.installationId),
    });
    const hasMore = items.length > limit;

    return {
      items: hasMore ? items.slice(0, limit) : items,
      nextCursor: hasMore ? encodeHistoryCursor(cursor + limit) : null,
    };
  };

  listArtifacts = async (params: {
    cursor?: string;
    installationId: string;
    limit?: number;
    userId: string;
    workspaceId?: string;
  }) => {
    await this.assertInstallationAccess(params);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const cursor = decodeHistoryCursor(params.cursor);
    const items = await this.db.query.moduleAppArtifacts.findMany({
      limit: limit + 1,
      offset: cursor,
      orderBy: [desc(moduleAppArtifacts.createdAt), desc(moduleAppArtifacts.id)],
      where: (artifacts, { and, eq, exists }) =>
        and(
          eq(artifacts.installationId, params.installationId),
          exists(
            this.db
              .select({ id: moduleAppRuns.id })
              .from(moduleAppRuns)
              .where(
                and(
                  eq(moduleAppRuns.id, artifacts.runId),
                  eq(moduleAppRuns.installationId, params.installationId),
                ),
              ),
          ),
        ),
    });
    const hasMore = items.length > limit;

    return {
      items: hasMore ? items.slice(0, limit) : items,
      nextCursor: hasMore ? encodeHistoryCursor(cursor + limit) : null,
    };
  };
}
