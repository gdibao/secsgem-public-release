import { Buffer } from 'node:buffer';

import type {
  DesktopBuildAssetManifest,
  DesktopBuildProfilePayload,
  DesktopReleaseChannel,
  DesktopReleaseStatus,
} from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { desktopBuildProfileRevisions, desktopBuildProfiles, desktopReleases } from '../schemas';
import type {
  DesktopBuildProfileItem,
  DesktopReleaseArtifactManifest,
  DesktopReleaseItem,
} from '../schemas/desktopBuild';
import type { LobeChatDatabase, Transaction } from '../type';

const ERROR_SUMMARY_LIMIT = 1024;
const DEFAULT_PROFILE_PAGE_SIZE = 50;
const MAX_PROFILE_PAGE_SIZE = 100;
const PROFILE_CURSOR_MAX_LENGTH = 512;
const PROFILE_CURSOR_VERSION = 2;
const RERUN_DELIVERY_UNKNOWN_SUMMARY =
  'GitHub rerun delivery could not be confirmed. Retry the release.';
const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_CURSOR_CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

interface DesktopBuildProfileCursor {
  createdAt: string;
  id: string;
}

const profileCursorError = (): never => {
  throw new Error('DESKTOP_BUILD_PROFILE_CURSOR_INVALID');
};

const parseProfileCursorCreatedAt = (value: unknown) => {
  if (typeof value !== 'string' || !PROFILE_CURSOR_CREATED_AT_PATTERN.test(value)) {
    return profileCursorError();
  }

  // Validate the calendar portion without using a JavaScript Date as the cursor key.
  const millisecondTimestamp = `${value.slice(0, 23)}Z`;
  const date = new Date(millisecondTimestamp);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== millisecondTimestamp) {
    return profileCursorError();
  }

  return value;
};

const decodeProfileCursor = (value: string): DesktopBuildProfileCursor => {
  if (value.length === 0 || value.length > PROFILE_CURSOR_MAX_LENGTH || !/^[\w-]+$/.test(value)) {
    return profileCursorError();
  }

  let decoded: unknown;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return profileCursorError();
    decoded = JSON.parse(bytes.toString('utf8'));
  } catch {
    return profileCursorError();
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return profileCursorError();
  }

  const record = decoded as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'createdAt,id,v' ||
    record.v !== PROFILE_CURSOR_VERSION ||
    typeof record.id !== 'string' ||
    !PROFILE_ID_PATTERN.test(record.id)
  ) {
    return profileCursorError();
  }

  return { createdAt: parseProfileCursorCreatedAt(record.createdAt), id: record.id };
};

export const isDesktopBuildProfileCursor = (value: string) => {
  try {
    decodeProfileCursor(value);
    return true;
  } catch {
    return false;
  }
};

const encodeProfileCursor = ({ createdAt, id }: DesktopBuildProfileCursor) =>
  Buffer.from(
    JSON.stringify({
      createdAt,
      id,
      v: PROFILE_CURSOR_VERSION,
    }),
  ).toString('base64url');

const profileCreatedAtCursor = sql<string>`to_char(
  ${desktopBuildProfiles.createdAt} AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
)`.as('profile_created_at_cursor');

const isTerminalReleaseStatus = (status: DesktopReleaseStatus) =>
  status === 'failed' || status === 'succeeded';

const canTransitionRelease = (current: DesktopReleaseStatus, next: DesktopReleaseStatus) => {
  if (current === next) return true;
  if (isTerminalReleaseStatus(current)) return false;
  if (next === 'failed') return true;

  return (
    (current === 'building' && next === 'publishing') ||
    (current === 'publishing' && next === 'succeeded')
  );
};

const boundedErrorSummary = (value: string | undefined) =>
  value === undefined ? undefined : value.slice(0, ERROR_SUMMARY_LIMIT);

export class DesktopBuildModel {
  constructor(private readonly db: LobeChatDatabase) {}

  private lockProfile = async (profileId: string, tx: Transaction) => {
    const [profile] = await tx
      .select()
      .from(desktopBuildProfiles)
      .where(eq(desktopBuildProfiles.id, profileId))
      .for('update');

    if (!profile) throw new Error('DESKTOP_BUILD_PROFILE_NOT_FOUND');
    return profile;
  };

  private lockRelease = async (releaseId: string, tx: Transaction) => {
    const [release] = await tx
      .select()
      .from(desktopReleases)
      .where(eq(desktopReleases.id, releaseId))
      .for('update');

    if (!release) throw new Error('DESKTOP_RELEASE_NOT_FOUND');
    return release;
  };

  private assertLockedIdentity = async (
    profile: DesktopBuildProfileItem,
    payload: DesktopBuildProfilePayload,
    tx: Transaction,
  ) => {
    if (!profile.firstStableReleaseAt) return;

    const release = await tx.query.desktopReleases.findFirst({
      orderBy: [
        asc(desktopReleases.completedAt),
        asc(desktopReleases.createdAt),
        asc(desktopReleases.id),
      ],
      where: and(
        eq(desktopReleases.profileId, profile.id),
        eq(desktopReleases.channel, 'stable'),
        eq(desktopReleases.status, 'succeeded'),
      ),
    });
    if (!release) throw new Error('DESKTOP_BUILD_STABLE_RELEASE_NOT_FOUND');

    const revision = await tx.query.desktopBuildProfileRevisions.findFirst({
      where: eq(desktopBuildProfileRevisions.id, release.frozenRevisionId),
    });
    if (!revision) throw new Error('DESKTOP_BUILD_RELEASE_REVISION_NOT_FOUND');

    if (
      revision.payload.applicationId !== payload.applicationId ||
      revision.payload.protocolScheme !== payload.protocolScheme
    ) {
      throw new Error('DESKTOP_BUILD_IDENTITY_LOCKED');
    }
  };

  private resolveWorkflowCallbackMetadata = (
    release: DesktopReleaseItem,
    input: { workflowRunAttempt: number; workflowRunId: string; workflowRunUrl: string },
  ) => {
    const hasWorkflowRunId = release.workflowRunId !== null;
    const hasWorkflowRunUrl = release.workflowRunUrl !== null;
    if (
      hasWorkflowRunId !== hasWorkflowRunUrl ||
      (release.workflowRunAttempt !== null && !hasWorkflowRunId) ||
      (release.workflowRunAttemptPending && release.workflowRunAttempt === null)
    ) {
      throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_METADATA_INVALID');
    }
    if (
      (hasWorkflowRunId && release.workflowRunId !== input.workflowRunId) ||
      (hasWorkflowRunUrl && release.workflowRunUrl !== input.workflowRunUrl)
    ) {
      throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_MISMATCH');
    }

    if (isTerminalReleaseStatus(release.status)) {
      if (!hasWorkflowRunId || release.workflowRunAttempt === null) {
        throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_ATTEMPT_MISMATCH');
      }
      if (
        release.workflowRunAttemptPending ||
        release.workflowRunAttempt !== input.workflowRunAttempt
      ) {
        throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_ATTEMPT_MISMATCH');
      }
      return {};
    }

    if (!hasWorkflowRunId) {
      if (input.workflowRunAttempt !== 1) {
        throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_ATTEMPT_MISMATCH');
      }
      return {
        workflowRunAttempt: input.workflowRunAttempt,
        workflowRunId: input.workflowRunId,
        workflowRunUrl: input.workflowRunUrl,
      };
    }

    if (release.workflowRunAttempt === null) {
      return { workflowRunAttempt: input.workflowRunAttempt };
    }

    const expectedAttempt = release.workflowRunAttemptPending
      ? release.workflowRunAttempt + 1
      : release.workflowRunAttempt;
    if (input.workflowRunAttempt !== expectedAttempt) {
      throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_ATTEMPT_MISMATCH');
    }

    return release.workflowRunAttemptPending
      ? { workflowRunAttempt: input.workflowRunAttempt, workflowRunAttemptPending: false }
      : {};
  };

  private transitionRelease = async ({
    artifacts,
    errorSummary,
    publishedDownloadUrl,
    publishedServerUrl,
    release,
    status,
    tx,
    revisionlessFailedPreStaging,
    workflowRunAttempt,
    workflowRunId,
    workflowRunUrl,
  }: {
    artifacts?: DesktopReleaseArtifactManifest;
    errorSummary?: string;
    publishedDownloadUrl?: string;
    publishedServerUrl?: string;
    release: DesktopReleaseItem;
    status: DesktopReleaseStatus;
    tx: Transaction;
    workflowRunAttempt?: number;
    workflowRunId?: string;
    workflowRunUrl?: string;
    revisionlessFailedPreStaging?: boolean;
  }) => {
    const workflowMetadata =
      workflowRunAttempt === undefined
        ? (() => {
            if (
              (workflowRunId && release.workflowRunId && release.workflowRunId !== workflowRunId) ||
              (workflowRunUrl &&
                release.workflowRunUrl &&
                release.workflowRunUrl !== workflowRunUrl)
            ) {
              throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_MISMATCH');
            }
            return {
              ...(workflowRunId && !release.workflowRunId ? { workflowRunId } : {}),
              ...(workflowRunUrl && !release.workflowRunUrl ? { workflowRunUrl } : {}),
            };
          })()
        : this.resolveWorkflowCallbackMetadata(release, {
            workflowRunAttempt,
            workflowRunId: workflowRunId!,
            workflowRunUrl: workflowRunUrl!,
          });

    if (release.status === status) {
      if (release.status !== 'building' || Object.keys(workflowMetadata).length === 0)
        return release;

      const [updated] = await tx
        .update(desktopReleases)
        .set({ ...workflowMetadata, updatedAt: new Date() })
        .where(eq(desktopReleases.id, release.id))
        .returning();
      if (!updated) throw new Error('DESKTOP_RELEASE_NOT_FOUND');
      return updated;
    }
    if (isTerminalReleaseStatus(release.status)) throw new Error('DESKTOP_RELEASE_TERMINAL');
    if (!canTransitionRelease(release.status, status)) {
      throw new Error('DESKTOP_RELEASE_INVALID_TRANSITION');
    }

    let profile: DesktopBuildProfileItem | undefined;
    if (release.channel === 'stable' && status === 'succeeded') {
      // Release rows are locked before their parent profile throughout release transitions.
      profile = await this.lockProfile(release.profileId, tx);
      const revision = await tx.query.desktopBuildProfileRevisions.findFirst({
        where: eq(desktopBuildProfileRevisions.id, release.frozenRevisionId),
      });
      if (!revision) throw new Error('DESKTOP_BUILD_RELEASE_REVISION_NOT_FOUND');
      await this.assertLockedIdentity(profile, revision.payload, tx);
    }

    const now = new Date();
    const [updated] = await tx
      .update(desktopReleases)
      .set({
        ...(artifacts === undefined ? {} : { artifacts }),
        ...(errorSummary === undefined ? {} : { errorSummary: boundedErrorSummary(errorSummary) }),
        ...(status === 'succeeded' && publishedDownloadUrl !== undefined
          ? { publishedDownloadUrl }
          : {}),
        ...(status === 'succeeded' && publishedServerUrl !== undefined
          ? { publishedServerUrl }
          : {}),
        ...workflowMetadata,
        ...(revisionlessFailedPreStaging ? { revisionlessFailedPreStaging: true } : {}),
        ...(status === 'failed' || status === 'succeeded' ? { completedAt: now } : {}),
        status,
        updatedAt: now,
      })
      .where(eq(desktopReleases.id, release.id))
      .returning();
    if (!updated) throw new Error('DESKTOP_RELEASE_NOT_FOUND');

    if (profile && !profile.firstStableReleaseAt) {
      await tx
        .update(desktopBuildProfiles)
        .set({ firstStableReleaseAt: now, updatedAt: now })
        .where(
          and(
            eq(desktopBuildProfiles.id, updated.profileId),
            isNull(desktopBuildProfiles.firstStableReleaseAt),
          ),
        );
    }

    return updated;
  };

  listProfiles = async (params: { cursor?: string; limit?: number } = {}) => {
    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_PROFILE_PAGE_SIZE, 1),
      MAX_PROFILE_PAGE_SIZE,
    );
    const cursor = params.cursor === undefined ? null : decodeProfileCursor(params.cursor);
    const cursorCreatedAt = cursor ? sql`${cursor.createdAt}::timestamptz` : undefined;
    const rows = await this.db.query.desktopBuildProfiles.findMany({
      extras: { createdAtCursor: profileCreatedAtCursor },
      limit: limit + 1,
      orderBy: [desc(desktopBuildProfiles.createdAt), desc(desktopBuildProfiles.id)],
      where: cursor
        ? or(
            lt(desktopBuildProfiles.createdAt, cursorCreatedAt!),
            and(
              eq(desktopBuildProfiles.createdAt, cursorCreatedAt!),
              lt(desktopBuildProfiles.id, cursor.id),
            ),
          )
        : undefined,
    });
    const items = rows.slice(0, limit);
    const lastItem = items.at(-1);

    return {
      items,
      nextCursor:
        rows.length > limit && lastItem
          ? encodeProfileCursor({
              createdAt: lastItem.createdAtCursor,
              id: lastItem.id,
            })
          : null,
    };
  };

  getProfile = (profileId: string) =>
    this.db.query.desktopBuildProfiles.findFirst({
      where: eq(desktopBuildProfiles.id, profileId),
    });

  getRevision = (revisionId: string) =>
    this.db.query.desktopBuildProfileRevisions.findFirst({
      where: eq(desktopBuildProfileRevisions.id, revisionId),
    });

  getRelease = (releaseId: string) =>
    this.db.query.desktopReleases.findFirst({
      where: eq(desktopReleases.id, releaseId),
    });

  getRevisionsByIds = (revisionIds: string[]) => {
    const ids = [...new Set(revisionIds)].slice(0, MAX_PROFILE_PAGE_SIZE);
    if (ids.length === 0) return Promise.resolve([]);

    return this.db.query.desktopBuildProfileRevisions.findMany({
      limit: ids.length,
      where: inArray(desktopBuildProfileRevisions.id, ids),
    });
  };

  saveDraft = async (
    input: {
      actorUserId: string;
      assets: DesktopBuildAssetManifest;
      createIfMissing?: boolean;
      expectedRevision?: number;
      name: string;
      payload: DesktopBuildProfilePayload;
      profileId?: string;
    },
    tx?: Transaction,
  ) => {
    const save = async (tx: Transaction) => {
      let profile: DesktopBuildProfileItem;

      if (input.profileId) {
        let existingProfile: DesktopBuildProfileItem | undefined;
        try {
          existingProfile = await this.lockProfile(input.profileId, tx);
        } catch (error) {
          if (!(
            input.createIfMissing && (error as Error).message === 'DESKTOP_BUILD_PROFILE_NOT_FOUND'
          )) {
            throw error;
          }
        }

        if (!existingProfile) {
          if (input.expectedRevision !== undefined && input.expectedRevision !== 0) {
            throw new Error('DESKTOP_BUILD_PROFILE_REVISION_CONFLICT');
          }
          const [created] = await tx
            .insert(desktopBuildProfiles)
            .values({
              createdByUserId: input.actorUserId,
              id: input.profileId,
              name: input.name,
              updatedByUserId: input.actorUserId,
            })
            .returning();
          if (!created) throw new Error('DESKTOP_BUILD_PROFILE_CREATE_FAILED');
          profile = created;
        } else {
          if (existingProfile.status === 'archived')
            throw new Error('DESKTOP_BUILD_PROFILE_ARCHIVED');
          if (
            input.expectedRevision !== undefined &&
            existingProfile.currentRevision !== input.expectedRevision
          ) {
            throw new Error('DESKTOP_BUILD_PROFILE_REVISION_CONFLICT');
          }
          await this.assertLockedIdentity(existingProfile, input.payload, tx);
          profile = existingProfile;
        }
      } else {
        throw new Error('DESKTOP_BUILD_PROFILE_ID_REQUIRED');
      }

      const revisionNumber = profile.currentRevision + 1;
      const [revision] = await tx
        .insert(desktopBuildProfileRevisions)
        .values({
          assetManifest: input.assets,
          createdByUserId: input.actorUserId,
          payload: input.payload,
          profileId: profile.id,
          revision: revisionNumber,
          state: 'draft',
        })
        .returning();
      if (!revision) throw new Error('DESKTOP_BUILD_REVISION_CREATE_FAILED');

      const [updatedProfile] = await tx
        .update(desktopBuildProfiles)
        .set({
          currentDraftRevisionId: revision.id,
          currentRevision: revisionNumber,
          name: input.name,
          updatedAt: new Date(),
          updatedByUserId: input.actorUserId,
        })
        .where(eq(desktopBuildProfiles.id, profile.id))
        .returning();
      if (!updatedProfile) throw new Error('DESKTOP_BUILD_PROFILE_UPDATE_FAILED');

      return { profileId: profile.id, revision: revisionNumber, revisionId: revision.id };
    };

    return tx ? save(tx) : this.db.transaction(save);
  };

  archiveProfile = async (input: { actorUserId: string; profileId: string }, tx?: Transaction) => {
    const archive = async (tx: Transaction) => {
      const profile = await this.lockProfile(input.profileId, tx);
      if (profile.status === 'archived') return profile;

      const [updated] = await tx
        .update(desktopBuildProfiles)
        .set({ status: 'archived', updatedAt: new Date(), updatedByUserId: input.actorUserId })
        .where(eq(desktopBuildProfiles.id, profile.id))
        .returning();
      if (!updated) throw new Error('DESKTOP_BUILD_PROFILE_NOT_FOUND');
      return updated;
    };

    return tx ? archive(tx) : this.db.transaction(archive);
  };

  freezeDraftForRelease = async (
    input: {
      actorUserId: string;
      channel: DesktopReleaseChannel;
      expectedDraftRevisionId: string;
      frozenRevisionId?: string;
      profileId: string;
      releaseId?: string;
      releaseNotes: string;
      version: string;
    },
    tx?: Transaction,
  ) => {
    const freeze = async (tx: Transaction) => {
      const profile = await this.lockProfile(input.profileId, tx);
      if (profile.status === 'archived') throw new Error('DESKTOP_BUILD_PROFILE_ARCHIVED');
      if (!profile.currentDraftRevisionId) throw new Error('DESKTOP_BUILD_DRAFT_NOT_FOUND');
      if (profile.currentDraftRevisionId !== input.expectedDraftRevisionId) {
        throw new Error('DESKTOP_BUILD_DRAFT_CHANGED');
      }

      const draft = await tx.query.desktopBuildProfileRevisions.findFirst({
        where: and(
          eq(desktopBuildProfileRevisions.id, profile.currentDraftRevisionId),
          eq(desktopBuildProfileRevisions.profileId, profile.id),
          eq(desktopBuildProfileRevisions.state, 'draft'),
        ),
      });
      if (!draft) throw new Error('DESKTOP_BUILD_DRAFT_NOT_FOUND');
      await this.assertLockedIdentity(profile, draft.payload, tx);

      const revisionNumber = profile.currentRevision + 1;
      const [revision] = await tx
        .insert(desktopBuildProfileRevisions)
        .values({
          assetManifest: draft.assetManifest,
          createdByUserId: input.actorUserId,
          ...(input.frozenRevisionId ? { id: input.frozenRevisionId } : {}),
          payload: draft.payload,
          profileId: profile.id,
          revision: revisionNumber,
          state: 'frozen',
        })
        .returning();
      if (!revision) throw new Error('DESKTOP_BUILD_FROZEN_REVISION_CREATE_FAILED');

      const [release] = await tx
        .insert(desktopReleases)
        .values({
          channel: input.channel,
          createdByUserId: input.actorUserId,
          frozenRevisionId: revision.id,
          ...(input.releaseId ? { id: input.releaseId } : {}),
          profileId: profile.id,
          releaseNotes: input.releaseNotes,
          status: 'queued',
          version: input.version,
        })
        .returning();
      if (!release) throw new Error('DESKTOP_RELEASE_CREATE_FAILED');

      const [updatedProfile] = await tx
        .update(desktopBuildProfiles)
        .set({ currentRevision: revisionNumber, updatedAt: new Date() })
        .where(eq(desktopBuildProfiles.id, profile.id))
        .returning();
      if (!updatedProfile) throw new Error('DESKTOP_BUILD_PROFILE_UPDATE_FAILED');

      return { release, revision };
    };

    return tx ? freeze(tx) : this.db.transaction(freeze);
  };

  listReleases = (params: { limit?: number; profileId?: string } = {}) => {
    const { profileId } = params;
    const limit = Math.min(params.limit ?? 50, 50);

    return this.db.query.desktopReleases.findMany({
      ...(profileId ? { where: eq(desktopReleases.profileId, profileId) } : {}),
      limit,
      orderBy: [desc(desktopReleases.createdAt), desc(desktopReleases.id)],
    });
  };

  bindReleaseWorkflowRun = async (
    input: {
      releaseId: string;
      workflowRunAttempt: number;
      workflowRunId: string;
      workflowRunUrl: string;
    },
    tx?: Transaction,
  ) => {
    const bind = async (transaction: Transaction) => {
      const release = await this.lockRelease(input.releaseId, transaction);
      if (!Number.isInteger(input.workflowRunAttempt) || input.workflowRunAttempt <= 0) {
        throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_ATTEMPT_MISMATCH');
      }
      if (
        (release.workflowRunId && release.workflowRunId !== input.workflowRunId) ||
        (release.workflowRunUrl && release.workflowRunUrl !== input.workflowRunUrl)
      ) {
        throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_MISMATCH');
      }
      if (
        release.workflowRunId === input.workflowRunId &&
        release.workflowRunUrl === input.workflowRunUrl &&
        release.workflowRunAttempt === input.workflowRunAttempt &&
        !release.workflowRunAttemptPending
      ) {
        return release;
      }
      if (release.status !== 'building') {
        throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_BIND_NOT_ALLOWED');
      }

      const workflowMetadata = this.resolveWorkflowCallbackMetadata(release, input);

      const [updated] = await transaction
        .update(desktopReleases)
        .set({
          ...workflowMetadata,
          updatedAt: new Date(),
        })
        .where(eq(desktopReleases.id, release.id))
        .returning();
      if (!updated) throw new Error('DESKTOP_RELEASE_NOT_FOUND');
      return updated;
    };

    return tx ? bind(tx) : this.db.transaction(bind);
  };

  markReleaseDispatched = async (input: { actorUserId?: string; releaseId: string }) => {
    return this.db.transaction(async (tx) => {
      const release = await this.lockRelease(input.releaseId, tx);
      if (release.status === 'building') return release;
      if (isTerminalReleaseStatus(release.status)) throw new Error('DESKTOP_RELEASE_TERMINAL');
      if (release.status !== 'queued') throw new Error('DESKTOP_RELEASE_INVALID_TRANSITION');

      const now = new Date();
      const [updated] = await tx
        .update(desktopReleases)
        .set({
          dispatchedAt: now,
          dispatchedByUserId: input.actorUserId,
          status: 'building',
          updatedAt: now,
        })
        .where(eq(desktopReleases.id, release.id))
        .returning();
      if (!updated) throw new Error('DESKTOP_RELEASE_NOT_FOUND');
      return updated;
    });
  };

  prepareReleaseRetry = async (input: { actorUserId?: string; releaseId: string }) => {
    return this.db.transaction(async (tx) => {
      const release = await this.lockRelease(input.releaseId, tx);
      if (release.status !== 'failed') throw new Error('DESKTOP_RELEASE_RETRY_NOT_ALLOWED');

      const hasWorkflowRunId = Boolean(release.workflowRunId);
      const hasWorkflowRunUrl = Boolean(release.workflowRunUrl);
      if (hasWorkflowRunId !== hasWorkflowRunUrl) {
        throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_METADATA_INVALID');
      }
      if (
        (release.workflowRunAttempt !== null && !hasWorkflowRunId) ||
        (release.workflowRunAttemptPending && release.workflowRunAttempt === null)
      ) {
        throw new Error('DESKTOP_RELEASE_WORKFLOW_RUN_METADATA_INVALID');
      }

      const rerunExistingWorkflow = hasWorkflowRunId && release.workflowRunAttempt !== null;

      const now = new Date();
      const [updated] = await tx
        .update(desktopReleases)
        .set({
          artifacts: [],
          completedAt: null,
          dispatchedAt: rerunExistingWorkflow ? release.dispatchedAt : now,
          dispatchedByUserId: input.actorUserId,
          errorSummary: null,
          status: 'building',
          updatedAt: now,
          workflowRunAttemptPending: rerunExistingWorkflow,
          ...(!rerunExistingWorkflow && hasWorkflowRunId
            ? { workflowRunAttempt: null, workflowRunId: null, workflowRunUrl: null }
            : {}),
        })
        .where(eq(desktopReleases.id, release.id))
        .returning();
      if (!updated) throw new Error('DESKTOP_RELEASE_NOT_FOUND');
      return updated;
    });
  };

  expirePendingReleaseRetry = async (input: {
    releaseId: string;
    requestedBefore: Date;
    workflowRunAttempt: number;
  }) => {
    return this.db.transaction(async (tx) => {
      const release = await this.lockRelease(input.releaseId, tx);
      if (
        release.status !== 'building' ||
        !release.workflowRunAttemptPending ||
        release.workflowRunAttempt !== input.workflowRunAttempt ||
        release.updatedAt.getTime() > input.requestedBefore.getTime()
      ) {
        return null;
      }

      const now = new Date();
      const [updated] = await tx
        .update(desktopReleases)
        .set({
          completedAt: now,
          errorSummary: boundedErrorSummary(RERUN_DELIVERY_UNKNOWN_SUMMARY),
          status: 'failed',
          updatedAt: now,
          workflowRunAttemptPending: false,
        })
        .where(eq(desktopReleases.id, release.id))
        .returning();
      if (!updated) throw new Error('DESKTOP_RELEASE_NOT_FOUND');
      return updated;
    });
  };

  markReleaseResult = async (
    input: {
      artifacts?: DesktopReleaseArtifactManifest;
      errorSummary?: string;
      releaseId: string;
      status: DesktopReleaseStatus;
      workflowRunId?: string;
      workflowRunUrl?: string;
    },
    tx?: Transaction,
  ) => {
    if (input.status === 'queued') throw new Error('DESKTOP_RELEASE_INVALID_TRANSITION');

    const transition = async (transaction: Transaction) => {
      const release = await this.lockRelease(input.releaseId, transaction);
      return this.transitionRelease({ ...input, release, tx: transaction });
    };

    return tx ? transition(tx) : this.db.transaction(transition);
  };

  markReleaseCallback = async (
    input: {
      errorSummary?: string;
      profileRevisionId?: string;
      publishedDownloadUrl?: string;
      publishedServerUrl?: string;
      releaseId: string;
      status: DesktopReleaseStatus;
      workflowRunAttempt: number;
      workflowRunId: string;
      workflowRunUrl: string;
    },
    tx?: Transaction,
  ) => {
    if (input.status === 'queued') throw new Error('DESKTOP_RELEASE_INVALID_TRANSITION');
    if (!input.workflowRunId || !input.workflowRunUrl) {
      throw new Error('DESKTOP_RELEASE_CALLBACK_WORKFLOW_REQUIRED');
    }
    if (!Number.isInteger(input.workflowRunAttempt) || input.workflowRunAttempt <= 0) {
      throw new Error('DESKTOP_RELEASE_CALLBACK_WORKFLOW_REQUIRED');
    }
    const publishedDownloadUrlProvided = input.publishedDownloadUrl !== undefined;
    const publishedServerUrlProvided = input.publishedServerUrl !== undefined;
    const hasCompletePublication =
      Boolean(input.publishedDownloadUrl?.trim()) && Boolean(input.publishedServerUrl?.trim());
    if (
      input.status === 'succeeded'
        ? !hasCompletePublication
        : publishedDownloadUrlProvided || publishedServerUrlProvided
    ) {
      throw new Error('DESKTOP_RELEASE_PUBLICATION_METADATA_INVALID');
    }

    const transition = async (transaction: Transaction) => {
      const release = await this.lockRelease(input.releaseId, transaction);
      if (input.profileRevisionId) {
        if (release.frozenRevisionId !== input.profileRevisionId) {
          throw new Error('DESKTOP_RELEASE_REVISION_MISMATCH');
        }
      } else if (!this.isRevisionlessFailedCallbackAllowed(release, input)) {
        throw new Error('DESKTOP_RELEASE_CALLBACK_REVISION_REQUIRED');
      }

      const updated = await this.transitionRelease({
        ...input,
        release,
        revisionlessFailedPreStaging:
          !input.profileRevisionId &&
          release.status === 'building' &&
          release.workflowRunId === null &&
          release.workflowRunUrl === null,
        tx: transaction,
      });
      return {
        ...updated,
        transitionedToSucceeded: release.status === 'publishing' && input.status === 'succeeded',
      };
    };

    return tx ? transition(tx) : this.db.transaction(transition);
  };

  private isRevisionlessFailedCallbackAllowed = (
    release: DesktopReleaseItem,
    input: { status: DesktopReleaseStatus; workflowRunId: string; workflowRunUrl: string },
  ) =>
    input.status === 'failed' &&
    ((release.status === 'building' &&
      release.workflowRunId === null &&
      release.workflowRunUrl === null) ||
      (release.status === 'building' &&
        release.revisionlessFailedPreStaging &&
        release.workflowRunId === input.workflowRunId &&
        release.workflowRunUrl === input.workflowRunUrl) ||
      (release.status === 'failed' &&
        release.revisionlessFailedPreStaging &&
        release.workflowRunId === input.workflowRunId &&
        release.workflowRunUrl === input.workflowRunUrl));
}
