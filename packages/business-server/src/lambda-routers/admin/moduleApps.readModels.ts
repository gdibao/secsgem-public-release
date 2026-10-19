import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import {
  moduleAppArtifacts,
  moduleAppAuditLogs,
  moduleAppBuilds,
  moduleAppInstallations,
  moduleAppLicenses,
  moduleAppOrders,
  moduleAppPackages,
  moduleAppPackageUploads,
  moduleAppPaymentAttempts,
  moduleAppPaymentDiscrepancies,
  moduleAppPaymentEvents,
  moduleAppPaymentRefunds,
  moduleAppPayoutBatches,
  moduleAppPayoutEntries,
  moduleAppPublishers,
  moduleAppRecords,
  moduleAppRevenueEntries,
  moduleAppRuns,
  moduleApps,
  moduleAppSchedules,
  moduleAppWorkflowRuns,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

type CursorInput = number | string | undefined;
type CreatedCursor = { createdAt: string; id: string };
type ApplicationSort = 'catalog' | 'name_asc' | 'updated_desc';
type CatalogApplicationCursor = { displayName: string; id: string; sortOrder: number };
type NameApplicationCursor = { displayName: string; id: string };
type UpdatedApplicationCursor = { id: string; updatedAt: string };
type ApplicationCursor =
  CatalogApplicationCursor | NameApplicationCursor | UpdatedApplicationCursor;

const normalizeLimit = (limit = 50) => Math.max(1, Math.min(200, Math.floor(limit)));

const escapeLike = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&');

const encodeCursor = (kind: string, value: ApplicationCursor | CreatedCursor) =>
  Buffer.from(JSON.stringify({ kind, value, version: 1 })).toString('base64url');

const decodeCursor = <T>(cursor: CursorInput, kind: string): null | T => {
  if (!cursor || typeof cursor === 'number') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      kind?: unknown;
      value?: unknown;
      version?: unknown;
    };
    if (parsed.kind !== kind || parsed.version !== 1 || !parsed.value) {
      throw new Error('Invalid cursor envelope');
    }
    return parsed.value as T;
  } catch {
    throw new Error('MODULE_APP_ADMIN_CURSOR_INVALID');
  }
};

const legacyOffset = (cursor: CursorInput) =>
  typeof cursor === 'number' ? Math.max(0, Math.floor(cursor)) : 0;

const createdCursorCondition = (
  cursor: null | CreatedCursor,
  createdAt: AnyPgColumn,
  id: AnyPgColumn,
) => {
  if (!cursor) return undefined;
  const date = new Date(cursor.createdAt);
  if (Number.isNaN(date.valueOf()) || !cursor.id) {
    throw new Error('MODULE_APP_ADMIN_CURSOR_INVALID');
  }
  return or(lt(createdAt, date), and(eq(createdAt, date), lt(id, cursor.id)));
};

const nextCreatedCursor = (kind: string, item: { createdAt: Date; id: string } | undefined) =>
  item ? encodeCursor(kind, { createdAt: item.createdAt.toISOString(), id: item.id }) : null;

const applicationCursorKind = (sort: ApplicationSort) =>
  sort === 'catalog' ? 'applications' : `applications:${sort}`;

const getApplicationSort = (sort?: ApplicationSort): ApplicationSort => sort ?? 'catalog';

const groupIds = <T>(items: T[], key: (item: T) => null | string | undefined) => {
  const grouped = new Map<string, string[]>();
  for (const item of items) {
    const group = key(item);
    if (!group || !('id' in (item as object))) continue;
    grouped.set(group, [...(grouped.get(group) ?? []), String((item as { id: string }).id)]);
  }
  return grouped;
};

export class ModuleAppAdminReadModel {
  constructor(private readonly db: LobeChatDatabase) {}

  getRuntimeScheduleDiagnostics = async (now = new Date()) => {
    const claimableCondition = and(
      eq(moduleAppSchedules.enabled, true),
      lte(moduleAppSchedules.nextRunAt, now),
      or(isNull(moduleAppSchedules.claimExpiresAt), lte(moduleAppSchedules.claimExpiresAt, now)),
    );
    const scheduledRunCondition = like(
      moduleAppWorkflowRuns.idempotencyKey,
      'module-app-schedule:%',
    );
    const failureWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      [enabledSchedules],
      [claimableSchedules],
      [activeClaims],
      [staleClaims],
      [oldestClaimable],
      [lastScheduledRun],
      [failedScheduledRuns],
    ] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(moduleAppSchedules)
        .where(eq(moduleAppSchedules.enabled, true)),
      this.db.select({ count: count() }).from(moduleAppSchedules).where(claimableCondition),
      this.db
        .select({ count: count() })
        .from(moduleAppSchedules)
        .where(
          and(eq(moduleAppSchedules.enabled, true), gt(moduleAppSchedules.claimExpiresAt, now)),
        ),
      this.db
        .select({ count: count() })
        .from(moduleAppSchedules)
        .where(
          and(
            eq(moduleAppSchedules.enabled, true),
            isNotNull(moduleAppSchedules.claimToken),
            lte(moduleAppSchedules.claimExpiresAt, now),
          ),
        ),
      this.db
        .select({ nextRunAt: moduleAppSchedules.nextRunAt })
        .from(moduleAppSchedules)
        .where(claimableCondition)
        .orderBy(asc(moduleAppSchedules.nextRunAt))
        .limit(1),
      this.db
        .select({ createdAt: moduleAppWorkflowRuns.createdAt })
        .from(moduleAppWorkflowRuns)
        .where(scheduledRunCondition)
        .orderBy(desc(moduleAppWorkflowRuns.createdAt))
        .limit(1),
      this.db
        .select({ count: count() })
        .from(moduleAppWorkflowRuns)
        .where(
          and(
            scheduledRunCondition,
            eq(moduleAppWorkflowRuns.status, 'failed'),
            gte(moduleAppWorkflowRuns.updatedAt, failureWindowStart),
          ),
        ),
    ]);

    return {
      activeClaims: Number(activeClaims?.count ?? 0),
      claimableSchedules: Number(claimableSchedules?.count ?? 0),
      enabledSchedules: Number(enabledSchedules?.count ?? 0),
      failedScheduledRuns24h: Number(failedScheduledRuns?.count ?? 0),
      lastScheduledRunAt: lastScheduledRun?.createdAt ?? null,
      oldestClaimableAt: oldestClaimable?.nextRunAt ?? null,
      staleClaims: Number(staleClaims?.count ?? 0),
    };
  };

  listApplications = async (
    input: {
      appId?: string;
      category?: string;
      cursor?: CursorInput;
      limit?: number;
      publisherId?: string;
      query?: string;
      sort?: ApplicationSort;
      status?: 'draft' | 'published' | 'unpublished';
    } = {},
  ) => {
    const limit = normalizeLimit(input.limit);
    const sort = getApplicationSort(input.sort);
    const cursorKind = applicationCursorKind(sort);
    const catalogCursor =
      sort === 'catalog' ? decodeCursor<CatalogApplicationCursor>(input.cursor, cursorKind) : null;
    const nameCursor =
      sort === 'name_asc' ? decodeCursor<NameApplicationCursor>(input.cursor, cursorKind) : null;
    const updatedCursor =
      sort === 'updated_desc'
        ? decodeCursor<UpdatedApplicationCursor>(input.cursor, cursorKind)
        : null;
    const query = input.query?.trim();
    const queryPattern = query ? `%${escapeLike(query)}%` : undefined;
    const conditions: Array<SQL | undefined> = [
      input.appId ? eq(moduleApps.id, input.appId) : undefined,
      input.category ? eq(moduleApps.category, input.category) : undefined,
      input.publisherId ? eq(moduleApps.publisherId, input.publisherId) : undefined,
      input.status ? eq(moduleApps.status, input.status) : undefined,
      queryPattern
        ? or(ilike(moduleApps.displayName, queryPattern), ilike(moduleApps.slug, queryPattern))
        : undefined,
      catalogCursor
        ? or(
            gt(moduleApps.sortOrder, catalogCursor.sortOrder),
            and(
              eq(moduleApps.sortOrder, catalogCursor.sortOrder),
              gt(moduleApps.displayName, catalogCursor.displayName),
            ),
            and(
              eq(moduleApps.sortOrder, catalogCursor.sortOrder),
              eq(moduleApps.displayName, catalogCursor.displayName),
              gt(moduleApps.id, catalogCursor.id),
            ),
          )
        : undefined,
      nameCursor
        ? or(
            gt(moduleApps.displayName, nameCursor.displayName),
            and(
              eq(moduleApps.displayName, nameCursor.displayName),
              gt(moduleApps.id, nameCursor.id),
            ),
          )
        : undefined,
      updatedCursor
        ? (() => {
            const updatedAt = new Date(updatedCursor.updatedAt);
            if (Number.isNaN(updatedAt.valueOf()) || !updatedCursor.id) {
              throw new Error('MODULE_APP_ADMIN_CURSOR_INVALID');
            }
            return or(
              lt(moduleApps.updatedAt, updatedAt),
              and(eq(moduleApps.updatedAt, updatedAt), lt(moduleApps.id, updatedCursor.id)),
            );
          })()
        : undefined,
    ];
    const rows = await this.db
      .select({
        app: moduleApps,
        publisherName: moduleAppPublishers.displayName,
        publisherStatus: moduleAppPublishers.status,
      })
      .from(moduleApps)
      .leftJoin(moduleAppPublishers, eq(moduleAppPublishers.id, moduleApps.publisherId))
      .where(and(...conditions.filter((value): value is SQL => Boolean(value))))
      .orderBy(
        ...(sort === 'catalog'
          ? [asc(moduleApps.sortOrder), asc(moduleApps.displayName), asc(moduleApps.id)]
          : sort === 'name_asc'
            ? [asc(moduleApps.displayName), asc(moduleApps.id)]
            : [desc(moduleApps.updatedAt), desc(moduleApps.id)]),
      )
      .limit(limit + 1)
      .offset(legacyOffset(input.cursor));
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(({ app, publisherName, publisherStatus }) => ({
      ...app,
      publisherName,
      publisherStatus,
    }));
    const last = hasMore ? items.at(-1) : undefined;
    const nextCursor = !last
      ? null
      : sort === 'catalog'
        ? encodeCursor(cursorKind, {
            displayName: last.displayName,
            id: last.id,
            sortOrder: last.sortOrder,
          })
        : sort === 'name_asc'
          ? encodeCursor(cursorKind, { displayName: last.displayName, id: last.id })
          : encodeCursor(cursorKind, {
              id: last.id,
              updatedAt: last.updatedAt.toISOString(),
            });
    return {
      items,
      nextCursor,
    };
  };

  listArtifacts = async (input: { appId: string; cursor?: CursorInput; limit?: number }) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'artifacts');
    const rows = await this.db.query.moduleAppArtifacts.findMany({
      limit: limit + 1,
      offset: legacyOffset(input.cursor),
      orderBy: [desc(moduleAppArtifacts.createdAt), desc(moduleAppArtifacts.id)],
      where: and(
        eq(moduleAppArtifacts.appId, input.appId),
        createdCursorCondition(cursor, moduleAppArtifacts.createdAt, moduleAppArtifacts.id),
      ),
    });
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? nextCreatedCursor('artifacts', items.at(-1)) : null,
    };
  };

  listAuditEvents = async (input: { appId: string; cursor?: CursorInput; limit?: number }) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'audit-events');
    const rows = await this.db.query.moduleAppAuditLogs.findMany({
      limit: limit + 1,
      offset: legacyOffset(input.cursor),
      orderBy: [desc(moduleAppAuditLogs.createdAt), desc(moduleAppAuditLogs.id)],
      where: and(
        eq(moduleAppAuditLogs.resourceType, 'moduleApp'),
        eq(moduleAppAuditLogs.resourceId, input.appId),
        createdCursorCondition(cursor, moduleAppAuditLogs.createdAt, moduleAppAuditLogs.id),
      ),
    });
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? nextCreatedCursor('audit-events', items.at(-1)) : null,
    };
  };

  listInstalls = async (input: { appId: string; cursor?: CursorInput; limit?: number }) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'installs');
    const rows = await this.db.query.moduleAppInstallations.findMany({
      limit: limit + 1,
      offset: legacyOffset(input.cursor),
      orderBy: [desc(moduleAppInstallations.createdAt), desc(moduleAppInstallations.id)],
      where: and(
        eq(moduleAppInstallations.appId, input.appId),
        createdCursorCondition(cursor, moduleAppInstallations.createdAt, moduleAppInstallations.id),
      ),
    });
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? nextCreatedCursor('installs', items.at(-1)) : null,
    };
  };

  listRecords = async (input: { appId: string; cursor?: CursorInput; limit?: number }) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'records');
    const rows = await this.db.query.moduleAppRecords.findMany({
      limit: limit + 1,
      offset: legacyOffset(input.cursor),
      orderBy: [desc(moduleAppRecords.updatedAt), desc(moduleAppRecords.id)],
      where: and(
        eq(moduleAppRecords.appId, input.appId),
        createdCursorCondition(cursor, moduleAppRecords.updatedAt, moduleAppRecords.id),
      ),
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor('records', { createdAt: last.updatedAt.toISOString(), id: last.id })
          : null,
    };
  };

  listRevenue = async (
    input: {
      appId?: string;
      cursor?: CursorInput;
      limit?: number;
      publisherId?: string;
      publisherUserId?: string;
      status?: 'pending' | 'reversed' | 'settled';
    } = {},
  ) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'revenue');
    const rows = await this.db.query.moduleAppRevenueEntries.findMany({
      limit: limit + 1,
      offset: legacyOffset(input.cursor),
      orderBy: [desc(moduleAppRevenueEntries.createdAt), desc(moduleAppRevenueEntries.id)],
      where: and(
        input.appId ? eq(moduleAppRevenueEntries.appId, input.appId) : undefined,
        input.publisherId ? eq(moduleAppRevenueEntries.publisherId, input.publisherId) : undefined,
        input.publisherUserId
          ? eq(moduleAppRevenueEntries.publisherUserId, input.publisherUserId)
          : undefined,
        input.status ? eq(moduleAppRevenueEntries.status, input.status) : undefined,
        createdCursorCondition(
          cursor,
          moduleAppRevenueEntries.createdAt,
          moduleAppRevenueEntries.id,
        ),
      ),
    });
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? nextCreatedCursor('revenue', items.at(-1)) : null,
    };
  };

  listRuns = async (input: { appId: string; cursor?: CursorInput; limit?: number }) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'runs');
    const rows = await this.db.query.moduleAppRuns.findMany({
      limit: limit + 1,
      offset: legacyOffset(input.cursor),
      orderBy: [desc(moduleAppRuns.createdAt), desc(moduleAppRuns.id)],
      where: and(
        eq(moduleAppRuns.appId, input.appId),
        createdCursorCondition(cursor, moduleAppRuns.createdAt, moduleAppRuns.id),
      ),
    });
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? nextCreatedCursor('runs', items.at(-1)) : null,
    };
  };

  listPackages = async (
    input: {
      appId?: string;
      buildStatus?: 'building' | 'failed' | 'queued' | 'ready';
      cursor?: CursorInput;
      limit?: number;
      publisherId?: string;
      reviewStatus?: 'approved' | 'pending_review' | 'rejected';
      submittedByUserId?: string;
    } = {},
  ) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'packages');
    const conditions: Array<SQL | undefined> = [
      input.appId ? eq(moduleAppPackages.appId, input.appId) : undefined,
      input.publisherId ? eq(moduleAppPackages.publisherId, input.publisherId) : undefined,
      input.reviewStatus ? eq(moduleAppPackages.reviewStatus, input.reviewStatus) : undefined,
      input.submittedByUserId
        ? eq(moduleAppPackages.submittedByUserId, input.submittedByUserId)
        : undefined,
      input.buildStatus ? eq(moduleAppBuilds.status, input.buildStatus) : undefined,
      createdCursorCondition(cursor, moduleAppPackages.createdAt, moduleAppPackages.id),
    ];
    const rows = await this.db
      .select({
        buildFailureCode: moduleAppBuilds.failureCode,
        buildStatus: moduleAppBuilds.status,
        packageRow: moduleAppPackages,
        scanStatus: moduleAppPackageUploads.scanStatus,
      })
      .from(moduleAppPackages)
      .leftJoin(
        moduleAppPackageUploads,
        eq(moduleAppPackageUploads.packageId, moduleAppPackages.id),
      )
      .leftJoin(moduleAppBuilds, eq(moduleAppBuilds.packageId, moduleAppPackages.id))
      .where(and(...conditions.filter((value): value is SQL => Boolean(value))))
      .orderBy(desc(moduleAppPackages.createdAt), desc(moduleAppPackages.id))
      .limit(limit + 1)
      .offset(legacyOffset(input.cursor));
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      ...row.packageRow,
      buildFailureCode: row.buildFailureCode,
      buildStatus: row.buildStatus,
      scanStatus: row.scanStatus ?? 'pending',
    }));
    return {
      items,
      nextCursor: hasMore ? nextCreatedCursor('packages', items.at(-1)) : null,
    };
  };

  listPublishers = async (
    input: {
      cursor?: CursorInput;
      limit?: number;
      status?: 'pending' | 'suspended' | 'verified';
      userId?: string;
    } = {},
  ) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'publishers');
    const conditions: Array<SQL | undefined> = [
      input.status ? eq(moduleAppPublishers.status, input.status) : undefined,
      input.userId ? eq(moduleAppPublishers.userId, input.userId) : undefined,
      createdCursorCondition(cursor, moduleAppPublishers.createdAt, moduleAppPublishers.id),
    ];
    const rows = await this.db.query.moduleAppPublishers.findMany({
      limit: limit + 1,
      offset: legacyOffset(input.cursor),
      orderBy: [desc(moduleAppPublishers.createdAt), desc(moduleAppPublishers.id)],
      where: and(...conditions.filter((value): value is SQL => Boolean(value))),
    });
    const items = rows.slice(0, limit);
    const appRows = items.length
      ? await this.db
          .select({ id: moduleApps.id, publisherId: moduleApps.publisherId })
          .from(moduleApps)
          .where(
            inArray(
              moduleApps.publisherId,
              items.map((item) => item.id),
            ),
          )
      : [];
    const appCounts = new Map<string, number>();
    for (const app of appRows) {
      if (app.publisherId)
        appCounts.set(app.publisherId, (appCounts.get(app.publisherId) ?? 0) + 1);
    }
    return {
      items: items.map((item) => ({ ...item, appCount: appCounts.get(item.id) ?? 0 })),
      nextCursor: rows.length > limit ? nextCreatedCursor('publishers', items.at(-1)) : null,
    };
  };

  listPayouts = async (
    input: {
      cursor?: CursorInput;
      limit?: number;
      publisherId?: string;
      status?: 'eligible' | 'failed' | 'paid' | 'pending' | 'processing' | 'reversed';
    } = {},
  ) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'payouts');
    const conditions: Array<SQL | undefined> = [
      input.publisherId ? eq(moduleAppPayoutBatches.publisherId, input.publisherId) : undefined,
      input.status ? eq(moduleAppPayoutBatches.status, input.status) : undefined,
      createdCursorCondition(cursor, moduleAppPayoutBatches.createdAt, moduleAppPayoutBatches.id),
    ];
    const rows = await this.db
      .select({ batch: moduleAppPayoutBatches, publisherName: moduleAppPublishers.displayName })
      .from(moduleAppPayoutBatches)
      .innerJoin(
        moduleAppPublishers,
        eq(moduleAppPublishers.id, moduleAppPayoutBatches.publisherId),
      )
      .where(and(...conditions.filter((value): value is SQL => Boolean(value))))
      .orderBy(desc(moduleAppPayoutBatches.createdAt), desc(moduleAppPayoutBatches.id))
      .limit(limit + 1)
      .offset(legacyOffset(input.cursor));
    const page = rows.slice(0, limit);
    const batchIds = page.map((row) => row.batch.id);
    const [entries, audits] = batchIds.length
      ? await Promise.all([
          this.db.query.moduleAppPayoutEntries.findMany({
            where: inArray(moduleAppPayoutEntries.batchId, batchIds),
          }),
          this.db.query.moduleAppAuditLogs.findMany({
            orderBy: [asc(moduleAppAuditLogs.createdAt), asc(moduleAppAuditLogs.id)],
            where: and(
              eq(moduleAppAuditLogs.resourceType, 'moduleAppPayout'),
              inArray(moduleAppAuditLogs.resourceId, batchIds),
            ),
          }),
        ])
      : [[], []];
    const revenueIds = new Map<string, string[]>();
    for (const entry of entries) {
      revenueIds.set(entry.batchId, [
        ...(revenueIds.get(entry.batchId) ?? []),
        entry.revenueEntryId,
      ]);
    }
    const auditIds = groupIds(audits, (item) => item.resourceId);
    const items = page.map(({ batch, publisherName }) => ({
      ...batch,
      auditEventIds: auditIds.get(batch.id) ?? [],
      publisherName,
      revenueEntryIds: revenueIds.get(batch.id) ?? [],
    }));
    return {
      items,
      nextCursor: rows.length > limit ? nextCreatedCursor('payouts', items.at(-1)) : null,
    };
  };

  listPaymentDiagnostics = async (
    input: {
      appId?: string;
      cursor?: CursorInput;
      discrepancyStatus?: 'open' | 'resolved';
      limit?: number;
      orderId?: string;
      paymentStatus?: 'created' | 'failed' | 'paid' | 'pending' | 'refunded';
      refundStatus?: 'failed' | 'requested' | 'succeeded';
    } = {},
  ) => {
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor<CreatedCursor>(input.cursor, 'payments');
    const conditions: Array<SQL | undefined> = [
      input.appId ? eq(moduleAppOrders.appId, input.appId) : undefined,
      input.orderId ? eq(moduleAppPaymentAttempts.orderId, input.orderId) : undefined,
      input.paymentStatus ? eq(moduleAppPaymentAttempts.status, input.paymentStatus) : undefined,
      input.refundStatus
        ? inArray(
            moduleAppPaymentAttempts.orderId,
            this.db
              .select({ orderId: moduleAppPaymentRefunds.orderId })
              .from(moduleAppPaymentRefunds)
              .where(eq(moduleAppPaymentRefunds.status, input.refundStatus)),
          )
        : undefined,
      input.discrepancyStatus
        ? inArray(
            moduleAppPaymentAttempts.orderId,
            this.db
              .select({ orderId: moduleAppPaymentDiscrepancies.orderId })
              .from(moduleAppPaymentDiscrepancies)
              .where(eq(moduleAppPaymentDiscrepancies.status, input.discrepancyStatus)),
          )
        : undefined,
      createdCursorCondition(
        cursor,
        moduleAppPaymentAttempts.createdAt,
        moduleAppPaymentAttempts.id,
      ),
    ];
    const rows = await this.db
      .select({
        appId: moduleAppOrders.appId,
        appName: moduleApps.displayName,
        attempt: moduleAppPaymentAttempts,
        orderStatus: moduleAppOrders.status,
      })
      .from(moduleAppPaymentAttempts)
      .innerJoin(moduleAppOrders, eq(moduleAppOrders.id, moduleAppPaymentAttempts.orderId))
      .innerJoin(moduleApps, eq(moduleApps.id, moduleAppOrders.appId))
      .where(and(...conditions.filter((value): value is SQL => Boolean(value))))
      .orderBy(desc(moduleAppPaymentAttempts.createdAt), desc(moduleAppPaymentAttempts.id))
      .limit(limit + 1)
      .offset(legacyOffset(input.cursor));
    const page = rows.slice(0, limit);
    const orderIds = page.map((row) => row.attempt.orderId);
    if (orderIds.length === 0) return { items: [], nextCursor: null };

    const [events, refunds, discrepancies, licenses, revenues, runs] = await Promise.all([
      this.db.query.moduleAppPaymentEvents.findMany({
        orderBy: [asc(moduleAppPaymentEvents.createdAt), asc(moduleAppPaymentEvents.id)],
        where: inArray(moduleAppPaymentEvents.orderId, orderIds),
      }),
      this.db.query.moduleAppPaymentRefunds.findMany({
        orderBy: [asc(moduleAppPaymentRefunds.createdAt), asc(moduleAppPaymentRefunds.id)],
        where: inArray(moduleAppPaymentRefunds.orderId, orderIds),
      }),
      this.db.query.moduleAppPaymentDiscrepancies.findMany({
        orderBy: [
          asc(moduleAppPaymentDiscrepancies.createdAt),
          asc(moduleAppPaymentDiscrepancies.id),
        ],
        where: inArray(moduleAppPaymentDiscrepancies.orderId, orderIds),
      }),
      this.db.query.moduleAppLicenses.findMany({
        orderBy: [asc(moduleAppLicenses.createdAt), asc(moduleAppLicenses.id)],
        where: inArray(moduleAppLicenses.orderId, orderIds),
      }),
      this.db.query.moduleAppRevenueEntries.findMany({
        orderBy: [asc(moduleAppRevenueEntries.createdAt), asc(moduleAppRevenueEntries.id)],
        where: inArray(moduleAppRevenueEntries.orderId, orderIds),
      }),
      this.db.query.moduleAppRuns.findMany({
        orderBy: [desc(moduleAppRuns.createdAt), desc(moduleAppRuns.id)],
        where: inArray(moduleAppRuns.appId, Array.from(new Set(page.map((row) => row.appId)))),
      }),
    ]);
    const revenueIds = revenues.map((item) => item.id);
    const payoutEntries = revenueIds.length
      ? await this.db.query.moduleAppPayoutEntries.findMany({
          where: inArray(moduleAppPayoutEntries.revenueEntryId, revenueIds),
        })
      : [];
    const relatedIds = [
      ...orderIds,
      ...page.map((row) => row.attempt.id),
      ...events.map((item) => item.id),
      ...refunds.map((item) => item.id),
      ...discrepancies.map((item) => item.id),
      ...licenses.map((item) => item.id),
      ...revenues.map((item) => item.id),
      ...runs.map((item) => item.id),
    ];
    const audits = await this.db.query.moduleAppAuditLogs.findMany({
      orderBy: [asc(moduleAppAuditLogs.createdAt), asc(moduleAppAuditLogs.id)],
      where: inArray(moduleAppAuditLogs.resourceId, relatedIds),
    });
    const eventIds = groupIds(events, (item) => item.orderId);
    const refundIds = groupIds(refunds, (item) => item.orderId);
    const discrepancyIds = groupIds(discrepancies, (item) => item.orderId);
    const licenseIds = groupIds(licenses, (item) => item.orderId);
    const revenueEntryIds = groupIds(revenues, (item) => item.orderId);
    const payoutIdsByRevenue = new Map<string, string[]>();
    for (const entry of payoutEntries) {
      payoutIdsByRevenue.set(entry.revenueEntryId, [
        ...(payoutIdsByRevenue.get(entry.revenueEntryId) ?? []),
        entry.batchId,
      ]);
    }
    const latestRunByApp = new Map<string, string>();
    for (const run of runs)
      if (!latestRunByApp.has(run.appId)) latestRunByApp.set(run.appId, run.id);
    const auditIdsByResource = groupIds(audits, (item) => item.resourceId);

    const items = page.map(({ appId, appName, attempt, orderStatus }) => {
      const orderRevenueIds = revenueEntryIds.get(attempt.orderId) ?? [];
      const auditResourceIds = [
        attempt.orderId,
        attempt.id,
        ...(eventIds.get(attempt.orderId) ?? []),
        ...(refundIds.get(attempt.orderId) ?? []),
        ...(discrepancyIds.get(attempt.orderId) ?? []),
        ...(licenseIds.get(attempt.orderId) ?? []),
        ...orderRevenueIds,
        ...(latestRunByApp.get(appId) ? [latestRunByApp.get(appId)!] : []),
      ];
      return {
        appId,
        appName,
        auditEventIds: auditResourceIds.flatMap((id) => auditIdsByResource.get(id) ?? []),
        createdAt: attempt.createdAt,
        currency: attempt.currency,
        discrepancyIds: discrepancyIds.get(attempt.orderId) ?? [],
        discrepancyStatus: discrepancies.findLast((item) => item.orderId === attempt.orderId)
          ?.status,
        id: attempt.id,
        licenseIds: licenseIds.get(attempt.orderId) ?? [],
        method: attempt.method,
        orderId: attempt.orderId,
        orderStatus,
        outTradeNo: attempt.outTradeNo,
        paymentEventIds: eventIds.get(attempt.orderId) ?? [],
        paymentStatus: attempt.status,
        payoutBatchIds: Array.from(
          new Set(orderRevenueIds.flatMap((id) => payoutIdsByRevenue.get(id) ?? [])),
        ),
        provider: attempt.provider,
        providerTransactionId: attempt.providerTransactionId,
        refundIds: refundIds.get(attempt.orderId) ?? [],
        refundStatus: refunds.findLast((item) => item.orderId === attempt.orderId)?.status,
        revenueEntryIds: orderRevenueIds,
        latestAppRuntimeInvocationId: latestRunByApp.get(appId) ?? null,
        totalAmount: attempt.totalAmount,
      };
    });
    return {
      items,
      nextCursor: rows.length > limit ? nextCreatedCursor('payments', items.at(-1)) : null,
    };
  };
}
