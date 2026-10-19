import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';

import { moduleAppArtifactCleanupJobs } from '../schemas';
import type { LobeChatDatabase } from '../type';

const CLAIM_LEASE_MS = 10 * 60 * 1000;
const MAX_BATCH_SIZE = 100;
export const MODULE_APP_ARTIFACT_CLEANUP_MAX_ATTEMPTS = 10;

export class ModuleAppArtifactCleanupModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly now = () => new Date(),
  ) {}

  claimPending = async (limit = MAX_BATCH_SIZE) => {
    const now = this.now();
    const staleClaimCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_BATCH_SIZE));

    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: moduleAppArtifactCleanupJobs.id })
        .from(moduleAppArtifactCleanupJobs)
        .where(
          and(
            lte(
              moduleAppArtifactCleanupJobs.attemptCount,
              MODULE_APP_ARTIFACT_CLEANUP_MAX_ATTEMPTS - 1,
            ),
            or(
              eq(moduleAppArtifactCleanupJobs.status, 'pending'),
              and(
                eq(moduleAppArtifactCleanupJobs.status, 'processing'),
                lte(moduleAppArtifactCleanupJobs.claimedAt, staleClaimCutoff),
              ),
            ),
          ),
        )
        .orderBy(moduleAppArtifactCleanupJobs.createdAt)
        .limit(boundedLimit)
        .for('update', { skipLocked: true });

      if (candidates.length === 0) return [];

      return tx
        .update(moduleAppArtifactCleanupJobs)
        .set({
          attemptCount: sql`${moduleAppArtifactCleanupJobs.attemptCount} + 1`,
          claimedAt: now,
          lastError: null,
          status: 'processing',
          updatedAt: now,
        })
        .where(
          inArray(
            moduleAppArtifactCleanupJobs.id,
            candidates.map(({ id }) => id),
          ),
        )
        .returning();
    });
  };

  markReleased = async (id: string) => {
    const now = this.now();
    const [row] = await this.db
      .update(moduleAppArtifactCleanupJobs)
      .set({
        claimedAt: null,
        lastError: null,
        releasedAt: now,
        status: 'released',
        updatedAt: now,
      })
      .where(
        and(
          eq(moduleAppArtifactCleanupJobs.id, id),
          eq(moduleAppArtifactCleanupJobs.status, 'processing'),
        ),
      )
      .returning({ id: moduleAppArtifactCleanupJobs.id });

    return Boolean(row);
  };

  markFailure = async (params: { error: string; id: string; retryable: boolean }) => {
    const now = this.now();
    const [row] = await this.db
      .update(moduleAppArtifactCleanupJobs)
      .set({
        claimedAt: null,
        lastError: params.error.slice(0, 500),
        status: params.retryable ? 'pending' : 'failed',
        updatedAt: now,
      })
      .where(
        and(
          eq(moduleAppArtifactCleanupJobs.id, params.id),
          eq(moduleAppArtifactCleanupJobs.status, 'processing'),
        ),
      )
      .returning({ id: moduleAppArtifactCleanupJobs.id });

    return Boolean(row);
  };
}
