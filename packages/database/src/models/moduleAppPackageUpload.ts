import type {
  ModuleAppPackageScanStatus,
  ModuleAppPackageSubmitInput,
  ModuleAppPackageUploadStatus,
  ModuleAppPackageValidationIssue,
} from '@lobechat/types';
import {
  MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE,
  MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES,
  MODULE_APP_PACKAGE_MAX_DAILY_UPLOADS,
  MODULE_APP_PACKAGE_MAX_OPEN_UPLOADS,
  MODULE_APP_PACKAGE_MAX_RETAINED_BYTES,
  MODULE_APP_PACKAGE_MAX_SCAN_ISSUES,
  MODULE_APP_PACKAGE_UPLOAD_TTL_MS,
  moduleAppPackageSubmitSchema,
} from '@lobechat/types';
import { and, count, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { moduleAppPackages, moduleAppPackageUploads } from '../schemas';
import type { LobeChatDatabase } from '../type';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_CLAIM_LEASE_MS = 5 * 60 * 1000;
const OPEN_STATUSES: ModuleAppPackageUploadStatus[] = ['issued', 'processing'];

type UploadLimits = {
  maxDailyUploads: number;
  maxOpenUploads: number;
  maxRetainedBytes: number;
  uploadTtlMs: number;
};

type ModelOptions = {
  limits?: Partial<UploadLimits>;
  now?: () => Date;
};

const DEFAULT_LIMITS: UploadLimits = {
  maxDailyUploads: MODULE_APP_PACKAGE_MAX_DAILY_UPLOADS,
  maxOpenUploads: MODULE_APP_PACKAGE_MAX_OPEN_UPLOADS,
  maxRetainedBytes: MODULE_APP_PACKAGE_MAX_RETAINED_BYTES,
  uploadTtlMs: MODULE_APP_PACKAGE_UPLOAD_TTL_MS,
};

const boundedIssues = (issues: ModuleAppPackageValidationIssue[] = []) =>
  issues.slice(0, MODULE_APP_PACKAGE_MAX_SCAN_ISSUES);

export class ModuleAppPackageUploadModel {
  private readonly db: LobeChatDatabase;
  private readonly limits: UploadLimits;
  private readonly now: () => Date;

  constructor(db: LobeChatDatabase, options: ModelOptions = {}) {
    this.db = db;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.now = options.now ?? (() => new Date());
  }

  createSession = async (params: {
    declaredSizeBytes: number;
    fileName: string;
    mimeType: string;
    storageKey: string;
    userId: string;
  }) => {
    const now = this.now();

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${params.userId}))`);

      const [[openResult], [dailyResult], [storageResult]] = await Promise.all([
        tx
          .select({ value: count() })
          .from(moduleAppPackageUploads)
          .where(
            and(
              eq(moduleAppPackageUploads.userId, params.userId),
              inArray(moduleAppPackageUploads.status, OPEN_STATUSES),
            ),
          ),
        tx
          .select({ value: count() })
          .from(moduleAppPackageUploads)
          .where(
            and(
              eq(moduleAppPackageUploads.userId, params.userId),
              gte(moduleAppPackageUploads.createdAt, new Date(now.getTime() - DAY_MS)),
            ),
          ),
        tx
          .select({
            value: sql<number>`COALESCE(SUM(COALESCE(${moduleAppPackageUploads.actualSizeBytes}, ${moduleAppPackageUploads.declaredSizeBytes})), 0)`,
          })
          .from(moduleAppPackageUploads)
          .where(
            and(
              eq(moduleAppPackageUploads.userId, params.userId),
              isNull(moduleAppPackageUploads.storageReleasedAt),
            ),
          ),
      ]);

      if (Number(openResult?.value ?? 0) >= this.limits.maxOpenUploads) {
        throw new Error('MODULE_APP_PACKAGE_OPEN_UPLOAD_LIMIT');
      }
      if (Number(dailyResult?.value ?? 0) >= this.limits.maxDailyUploads) {
        throw new Error('MODULE_APP_PACKAGE_DAILY_UPLOAD_LIMIT');
      }
      if (
        Number(storageResult?.value ?? 0) + params.declaredSizeBytes >
        this.limits.maxRetainedBytes
      ) {
        throw new Error('MODULE_APP_PACKAGE_STORAGE_QUOTA_EXCEEDED');
      }

      const [session] = await tx
        .insert(moduleAppPackageUploads)
        .values({
          declaredSizeBytes: params.declaredSizeBytes,
          expiresAt: new Date(now.getTime() + this.limits.uploadTtlMs),
          fileName: params.fileName,
          mimeType: params.mimeType,
          scanReport: [],
          scanStatus: 'pending',
          status: 'issued',
          storageKey: params.storageKey,
          userId: params.userId,
        })
        .returning();

      return session;
    });
  };

  claimSession = async (params: {
    fileName: string;
    storageKey: string;
    uploadId: string;
    userId: string;
  }) => {
    const now = this.now();
    const [claimed] = await this.db
      .update(moduleAppPackageUploads)
      .set({ status: 'processing', updatedAt: now })
      .where(
        and(
          eq(moduleAppPackageUploads.id, params.uploadId),
          eq(moduleAppPackageUploads.userId, params.userId),
          eq(moduleAppPackageUploads.storageKey, params.storageKey),
          eq(moduleAppPackageUploads.fileName, params.fileName),
          eq(moduleAppPackageUploads.status, 'issued'),
          gt(moduleAppPackageUploads.expiresAt, now),
          isNull(moduleAppPackageUploads.storageReleasedAt),
        ),
      )
      .returning();

    if (claimed) return claimed;

    const existing = await this.db.query.moduleAppPackageUploads.findFirst({
      where: eq(moduleAppPackageUploads.id, params.uploadId),
    });

    if (
      !existing ||
      existing.userId !== params.userId ||
      existing.storageKey !== params.storageKey ||
      existing.fileName !== params.fileName
    ) {
      throw new Error('MODULE_APP_PACKAGE_UPLOAD_FORBIDDEN');
    }
    if (existing.expiresAt <= now) throw new Error('MODULE_APP_PACKAGE_UPLOAD_EXPIRED');

    throw new Error('MODULE_APP_PACKAGE_UPLOAD_CONFLICT');
  };

  recordActualSize = async (params: { actualSizeBytes: number; uploadId: string }) => {
    const session = await this.db.query.moduleAppPackageUploads.findFirst({
      where: eq(moduleAppPackageUploads.id, params.uploadId),
    });

    if (!session || session.status !== 'processing') {
      throw new Error('MODULE_APP_PACKAGE_UPLOAD_CONFLICT');
    }
    if (
      params.actualSizeBytes < 1 ||
      params.actualSizeBytes > session.declaredSizeBytes ||
      params.actualSizeBytes > MODULE_APP_PACKAGE_MAX_ARCHIVE_BYTES
    ) {
      throw new Error('MODULE_APP_PACKAGE_ACTUAL_SIZE_EXCEEDED');
    }

    const [updated] = await this.db
      .update(moduleAppPackageUploads)
      .set({ actualSizeBytes: params.actualSizeBytes, updatedAt: this.now() })
      .where(
        and(
          eq(moduleAppPackageUploads.id, params.uploadId),
          eq(moduleAppPackageUploads.status, 'processing'),
        ),
      )
      .returning();

    if (!updated) throw new Error('MODULE_APP_PACKAGE_UPLOAD_CONFLICT');
    return updated;
  };

  completeSubmission = async (params: {
    submission: ModuleAppPackageSubmitInput;
    uploadId: string;
    userId: string;
    validationReport?: ModuleAppPackageValidationIssue[];
  }) => {
    const parsed = moduleAppPackageSubmitSchema.parse(params.submission);
    const now = this.now();

    return this.db.transaction(async (tx) => {
      const session = await tx.query.moduleAppPackageUploads.findFirst({
        where: and(
          eq(moduleAppPackageUploads.id, params.uploadId),
          eq(moduleAppPackageUploads.userId, params.userId),
          eq(moduleAppPackageUploads.status, 'processing'),
        ),
      });
      if (
        !session ||
        session.actualSizeBytes !== parsed.archive.sizeBytes ||
        session.storageKey !== parsed.archive.storageKey ||
        session.fileName !== parsed.archive.fileName ||
        session.mimeType !== parsed.archive.mimeType
      ) {
        throw new Error('MODULE_APP_PACKAGE_UPLOAD_CONFLICT');
      }

      const [submission] = await tx
        .insert(moduleAppPackages)
        .values({
          archive: parsed.archive,
          fileManifest: parsed.fileManifest,
          manifestSnapshot: {
            ...parsed.manifest,
            app: { ...parsed.manifest.app, source: 'developer' as const },
          },
          reviewStatus: 'pending_review',
          submittedByUserId: params.userId,
          validationReport: params.validationReport ?? [],
        })
        .returning();

      const [updated] = await tx
        .update(moduleAppPackageUploads)
        .set({
          completedAt: now,
          packageId: submission.id,
          scanReport: boundedIssues(params.validationReport),
          scanStatus: 'clean',
          sha256: parsed.archive.sha256,
          status: 'submitted',
          updatedAt: now,
        })
        .where(
          and(
            eq(moduleAppPackageUploads.id, params.uploadId),
            eq(moduleAppPackageUploads.userId, params.userId),
            eq(moduleAppPackageUploads.status, 'processing'),
            isNull(moduleAppPackageUploads.packageId),
          ),
        )
        .returning({ id: moduleAppPackageUploads.id });

      if (!updated) throw new Error('MODULE_APP_PACKAGE_UPLOAD_CONFLICT');
      return submission;
    });
  };

  markFailed = async (params: {
    actualSizeBytes?: number;
    failureCode: string;
    scanReport?: ModuleAppPackageValidationIssue[];
    uploadId: string;
  }) => {
    const now = this.now();
    const [updated] = await this.db
      .update(moduleAppPackageUploads)
      .set({
        actualSizeBytes: params.actualSizeBytes,
        completedAt: now,
        failureCode: params.failureCode,
        scanReport: boundedIssues(params.scanReport),
        scanStatus: 'error',
        status: 'failed',
        updatedAt: now,
      })
      .where(eq(moduleAppPackageUploads.id, params.uploadId))
      .returning();

    return updated ?? null;
  };

  markRejected = async (params: {
    actualSizeBytes?: number;
    failureCode: string;
    scanReport?: ModuleAppPackageValidationIssue[];
    uploadId: string;
  }) => {
    const now = this.now();
    const [updated] = await this.db
      .update(moduleAppPackageUploads)
      .set({
        actualSizeBytes: params.actualSizeBytes,
        completedAt: now,
        failureCode: params.failureCode,
        scanReport: boundedIssues(params.scanReport),
        scanStatus: 'blocked',
        status: 'rejected',
        updatedAt: now,
      })
      .where(eq(moduleAppPackageUploads.id, params.uploadId))
      .returning();

    return updated ?? null;
  };

  markStorageReleased = async (params: {
    status: Extract<ModuleAppPackageUploadStatus, 'expired' | 'failed' | 'rejected'>;
    uploadId: string;
  }) => {
    const now = this.now();
    const [updated] = await this.db
      .update(moduleAppPackageUploads)
      .set({ completedAt: now, status: params.status, storageReleasedAt: now, updatedAt: now })
      .where(eq(moduleAppPackageUploads.id, params.uploadId))
      .returning();

    return updated ?? null;
  };

  getByPackageId = async (packageId: string) => {
    return (
      (await this.db.query.moduleAppPackageUploads.findFirst({
        where: eq(moduleAppPackageUploads.packageId, packageId),
      })) ?? null
    );
  };

  createLegacySession = async (params: {
    actualSizeBytes: number;
    failureCode?: string;
    fileName: string;
    mimeType: string;
    packageId: string;
    scanReport?: ModuleAppPackageValidationIssue[];
    scanStatus: ModuleAppPackageScanStatus;
    sha256: string;
    status: Extract<ModuleAppPackageUploadStatus, 'failed' | 'rejected' | 'submitted'>;
    storageKey: string;
    userId: null | string;
  }) => {
    const now = this.now();
    const [created] = await this.db
      .insert(moduleAppPackageUploads)
      .values({
        actualSizeBytes: params.actualSizeBytes,
        completedAt: now,
        declaredSizeBytes: params.actualSizeBytes,
        expiresAt: now,
        failureCode: params.failureCode,
        fileName: params.fileName,
        mimeType: params.mimeType,
        packageId: params.packageId,
        scanReport: boundedIssues(params.scanReport),
        scanStatus: params.scanStatus,
        sha256: params.sha256,
        status: params.status,
        storageKey: params.storageKey,
        userId: params.userId,
      })
      .onConflictDoNothing({ target: moduleAppPackageUploads.packageId })
      .returning();

    if (created) return created;

    const existing = await this.getByPackageId(params.packageId);
    if (!existing) throw new Error('MODULE_APP_PACKAGE_LEGACY_SESSION_CONFLICT');
    return existing;
  };

  prepareRejectedForCleanup = async (params: { failureCode: string; uploadId: string }) => {
    const now = this.now();
    const [updated] = await this.db
      .update(moduleAppPackageUploads)
      .set({
        completedAt: now,
        expiresAt: now,
        failureCode: params.failureCode,
        status: 'rejected',
        updatedAt: now,
      })
      .where(eq(moduleAppPackageUploads.id, params.uploadId))
      .returning();

    if (!updated) throw new Error('MODULE_APP_PACKAGE_UPLOAD_NOT_FOUND');
    return updated;
  };

  claimExpiredForCleanup = async (limit = MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE) => {
    const now = this.now();
    const staleClaimCutoff = new Date(now.getTime() - CLEANUP_CLAIM_LEASE_MS);
    const boundedLimit = Math.max(
      1,
      Math.min(Math.floor(limit), MODULE_APP_PACKAGE_CLEANUP_BATCH_SIZE),
    );

    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(moduleAppPackageUploads)
        .where(
          and(
            isNull(moduleAppPackageUploads.storageReleasedAt),
            lte(moduleAppPackageUploads.expiresAt, now),
            or(
              inArray(moduleAppPackageUploads.status, [
                'issued',
                'processing',
                'rejected',
                'failed',
              ]),
              and(
                eq(moduleAppPackageUploads.status, 'cleaning'),
                lte(moduleAppPackageUploads.updatedAt, staleClaimCutoff),
              ),
            ),
          ),
        )
        .orderBy(moduleAppPackageUploads.expiresAt)
        .limit(boundedLimit)
        .for('update', { skipLocked: true });

      if (candidates.length === 0) return [];

      return tx
        .update(moduleAppPackageUploads)
        .set({ status: 'cleaning', updatedAt: now })
        .where(
          and(
            inArray(
              moduleAppPackageUploads.id,
              candidates.map(({ id }) => id),
            ),
            isNull(moduleAppPackageUploads.storageReleasedAt),
          ),
        )
        .returning();
    });
  };
}
