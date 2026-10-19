import { randomUUID } from 'node:crypto';

import type { ModuleAppBuildProfile } from '@lobechat/types';
import { and, asc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { moduleAppBuilds, moduleAppPackages, moduleAppVersions } from '../schemas';
import type { LobeChatDatabase } from '../type';

export type ClaimedModuleAppBuild = {
  attemptCount: number;
  buildProfile: ModuleAppBuildProfile;
  claimExpiresAt: Date;
  claimToken: string;
  id: string;
  manifestSnapshot: typeof moduleAppPackages.$inferSelect.manifestSnapshot;
  sourceSha256: string;
  sourceStorageKey: string;
  status: 'building';
  workerId: string;
};

export class ModuleAppBuildModel {
  constructor(private readonly db: LobeChatDatabase) {}

  create = async (input: {
    buildProfile: ModuleAppBuildProfile;
    packageId: string;
    sourceSha256: string;
    versionId: string;
  }) => {
    const [created] = await this.db
      .insert(moduleAppBuilds)
      .values(input)
      .returning();

    if (!created) throw new Error('MODULE_APP_BUILD_CREATE_FAILED');
    return created;
  };

  claimNext = async (input: {
    leaseDurationMs: number;
    workerId: string;
  }): Promise<ClaimedModuleAppBuild | null> => {
    const databaseNow = sql<Date>`NOW()`;
    const claimExpiresAt = sql<Date>`NOW() + (${input.leaseDurationMs} * INTERVAL '1 millisecond')`;
    const claimToken = randomUUID();

    return this.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({
          archive: moduleAppPackages.archive,
          id: moduleAppBuilds.id,
          manifestSnapshot: moduleAppPackages.manifestSnapshot,
        })
        .from(moduleAppBuilds)
        .innerJoin(moduleAppPackages, eq(moduleAppPackages.id, moduleAppBuilds.packageId))
        .where(
          or(
            and(
              eq(moduleAppBuilds.status, 'queued'),
              lte(moduleAppBuilds.nextAttemptAt, databaseNow),
              lt(moduleAppBuilds.attemptCount, 4),
            ),
            and(
              eq(moduleAppBuilds.status, 'building'),
              or(
                isNull(moduleAppBuilds.claimToken),
                isNull(moduleAppBuilds.claimExpiresAt),
                lte(moduleAppBuilds.claimExpiresAt, databaseNow),
              ),
              lt(moduleAppBuilds.attemptCount, 4),
            ),
          ),
        )
        .orderBy(asc(moduleAppBuilds.nextAttemptAt), asc(moduleAppBuilds.createdAt), asc(moduleAppBuilds.id))
        .limit(1)
        .for('update', { skipLocked: true });

      if (!candidate) return null;

      const [claimed] = await tx
        .update(moduleAppBuilds)
        .set({
          attemptCount: sql`${moduleAppBuilds.attemptCount} + 1`,
          claimedAt: databaseNow,
          claimExpiresAt,
          claimToken,
          failureCode: null,
          status: 'building',
          updatedAt: databaseNow,
          workerId: input.workerId,
        })
        .where(eq(moduleAppBuilds.id, candidate.id))
        .returning();

      return claimed
        ? {
            ...claimed,
            claimExpiresAt: claimed.claimExpiresAt,
            claimToken,
            manifestSnapshot: candidate.manifestSnapshot,
            sourceStorageKey: candidate.archive.storageKey,
          } as ClaimedModuleAppBuild
        : null;
    });
  };

  renewLease = async (input: {
    buildId: string;
    claimToken: string;
    leaseDurationMs: number;
  }) => {
    const databaseNow = sql<Date>`NOW()`;
    const claimExpiresAt = sql<Date>`NOW() + (${input.leaseDurationMs} * INTERVAL '1 millisecond')`;
    const [renewed] = await this.db
      .update(moduleAppBuilds)
      .set({ claimExpiresAt, updatedAt: databaseNow })
      .where(
        and(
          eq(moduleAppBuilds.id, input.buildId),
          eq(moduleAppBuilds.status, 'building'),
          eq(moduleAppBuilds.claimToken, input.claimToken),
        ),
      )
      .returning();
    if (!renewed) throw new Error('MODULE_APP_BUILD_LEASE_LOST');
    return renewed;
  };

  retry = async (input: {
    buildId: string;
    claimToken: string;
    failureCode: string;
    retryDelayMs: number;
  }) => {
    const databaseNow = sql<Date>`NOW()`;
    const [retried] = await this.db
      .update(moduleAppBuilds)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        claimedAt: null,
        failureCode: input.failureCode,
        nextAttemptAt: sql<Date>`NOW() + (${input.retryDelayMs} * INTERVAL '1 millisecond')`,
        status: 'queued',
        updatedAt: databaseNow,
        workerId: null,
      })
      .where(
        and(
          eq(moduleAppBuilds.id, input.buildId),
          eq(moduleAppBuilds.status, 'building'),
          eq(moduleAppBuilds.claimToken, input.claimToken),
          lt(moduleAppBuilds.attemptCount, 4),
        ),
      )
      .returning();
    if (retried) return retried;

    const [exhausted] = await this.db
      .update(moduleAppBuilds)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        claimedAt: null,
        completedAt: databaseNow,
        failureCode: 'MODULE_APP_BUILD_RETRY_EXHAUSTED',
        status: 'failed',
        updatedAt: databaseNow,
        workerId: null,
      })
      .where(
        and(
          eq(moduleAppBuilds.id, input.buildId),
          eq(moduleAppBuilds.status, 'building'),
          eq(moduleAppBuilds.claimToken, input.claimToken),
          eq(moduleAppBuilds.attemptCount, 4),
        ),
      )
      .returning();
    if (!exhausted) throw new Error('MODULE_APP_BUILD_LEASE_LOST');
    return exhausted;
  };

  complete = async (input: {
    artifactKey: string;
    artifactSha256: string;
    buildId: string;
    claimToken: string;
  }) => {
    const databaseNow = sql<Date>`NOW()`;

    return this.db.transaction(async (tx) => {
      const [completed] = await tx
        .update(moduleAppBuilds)
        .set({
          artifactKey: input.artifactKey,
          artifactSha256: input.artifactSha256,
          claimExpiresAt: null,
          claimToken: null,
          claimedAt: null,
          completedAt: databaseNow,
          failureCode: null,
          status: 'ready',
          updatedAt: databaseNow,
          workerId: null,
        })
        .where(
          and(
            eq(moduleAppBuilds.id, input.buildId),
            eq(moduleAppBuilds.status, 'building'),
            eq(moduleAppBuilds.claimToken, input.claimToken),
          ),
        )
        .returning();

      if (!completed) {
        const existing = await tx.query.moduleAppBuilds.findFirst({
          where: eq(moduleAppBuilds.id, input.buildId),
        });
        if (existing?.status === 'ready') throw new Error('MODULE_APP_BUILD_IMMUTABLE');
        throw new Error(existing ? 'MODULE_APP_BUILD_LEASE_LOST' : 'MODULE_APP_BUILD_NOT_FOUND');
      }

      await tx
        .update(moduleAppVersions)
        .set({
          runtimeArtifactKey: input.artifactKey,
          runtimeArtifactSha256: input.artifactSha256,
        })
        .where(eq(moduleAppVersions.id, completed.versionId));

      return completed;
    });
  };

  fail = async (input: { buildId: string; claimToken: string; failureCode: string }) => {
    const databaseNow = sql<Date>`NOW()`;
    const [failed] = await this.db
      .update(moduleAppBuilds)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        claimedAt: null,
        completedAt: databaseNow,
        failureCode: input.failureCode,
        status: 'failed',
        updatedAt: databaseNow,
        workerId: null,
      })
      .where(
        and(
          eq(moduleAppBuilds.id, input.buildId),
          eq(moduleAppBuilds.status, 'building'),
          eq(moduleAppBuilds.claimToken, input.claimToken),
        ),
      )
      .returning();

    if (!failed) throw new Error('MODULE_APP_BUILD_LEASE_LOST');
    return failed;
  };

  failExpiredExhausted = async () => {
    const databaseNow = sql<Date>`NOW()`;
    return this.db
      .update(moduleAppBuilds)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        claimedAt: null,
        completedAt: databaseNow,
        failureCode: 'MODULE_APP_BUILD_RETRY_EXHAUSTED',
        status: 'failed',
        updatedAt: databaseNow,
        workerId: null,
      })
      .where(
        and(
          eq(moduleAppBuilds.status, 'building'),
          eq(moduleAppBuilds.attemptCount, 4),
          lte(moduleAppBuilds.claimExpiresAt, databaseNow),
        ),
      )
      .returning();
  };

  getByVersionId = (versionId: string) =>
    this.db.query.moduleAppBuilds.findFirst({ where: eq(moduleAppBuilds.versionId, versionId) });

  getById = (buildId: string) =>
    this.db.query.moduleAppBuilds.findFirst({ where: eq(moduleAppBuilds.id, buildId) });
}
