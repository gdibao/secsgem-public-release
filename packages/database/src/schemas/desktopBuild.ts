import type {
  DesktopBuildAssetManifest,
  DesktopBuildProfilePayload,
  DesktopBuildProfileRevisionState,
  DesktopReleaseChannel,
  DesktopReleaseStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export interface DesktopReleaseArtifact {
  arch?: 'arm64' | 'ia32' | 'x64';
  contentType: string;
  fileName: string;
  kind: 'installer' | 'blockmap' | 'updateManifest';
  sha256: string;
  size: number;
  storageKey?: string;
}

export type DesktopReleaseArtifactManifest = DesktopReleaseArtifact[];

export const desktopBuildProfiles = pgTable(
  'desktop_build_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    name: text('name').notNull(),
    status: text('status').$type<'active' | 'archived'>().default('active').notNull(),
    currentRevision: integer('current_revision').default(0).notNull(),
    currentDraftRevisionId: uuid('current_draft_revision_id').references(
      (): AnyPgColumn => desktopBuildProfileRevisions.id,
      { onDelete: 'set null' },
    ),
    firstStableReleaseAt: timestamptz('first_stable_release_at'),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: text('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('desktop_build_profiles_status_updated_at_idx').on(table.status, table.updatedAt),
    check('desktop_build_profiles_status_check', sql`${table.status} IN ('active', 'archived')`),
    check('desktop_build_profiles_current_revision_check', sql`${table.currentRevision} >= 0`),
  ],
);

export const desktopBuildProfileRevisions = pgTable(
  'desktop_build_profile_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    profileId: uuid('profile_id')
      .references(() => desktopBuildProfiles.id, { onDelete: 'restrict' })
      .notNull(),
    revision: integer('revision').notNull(),
    state: text('state').$type<DesktopBuildProfileRevisionState>().notNull(),
    payload: jsonb('payload').$type<DesktopBuildProfilePayload>().notNull(),
    assetManifest: jsonb('asset_manifest').$type<DesktopBuildAssetManifest>().notNull(),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('desktop_build_profile_revisions_profile_revision_unique').on(
      table.profileId,
      table.revision,
    ),
    index('desktop_build_profile_revisions_profile_state_created_at_idx').on(
      table.profileId,
      table.state,
      table.createdAt,
    ),
    check('desktop_build_profile_revisions_revision_check', sql`${table.revision} > 0`),
    check(
      'desktop_build_profile_revisions_state_check',
      sql`${table.state} IN ('draft', 'frozen')`,
    ),
  ],
);

export const desktopReleases = pgTable(
  'desktop_releases',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    profileId: uuid('profile_id')
      .references(() => desktopBuildProfiles.id, { onDelete: 'restrict' })
      .notNull(),
    frozenRevisionId: uuid('frozen_revision_id')
      .references(() => desktopBuildProfileRevisions.id, { onDelete: 'restrict' })
      .notNull(),
    channel: text('channel').$type<DesktopReleaseChannel>().notNull(),
    version: varchar('version', { length: 64 }).notNull(),
    releaseNotes: text('release_notes').notNull(),
    status: text('status').$type<DesktopReleaseStatus>().default('queued').notNull(),
    artifacts: jsonb('artifacts').$type<DesktopReleaseArtifactManifest>().default([]).notNull(),
    errorSummary: varchar('error_summary', { length: 1024 }),
    workflowRunAttempt: integer('workflow_run_attempt'),
    workflowRunAttemptPending: boolean('workflow_run_attempt_pending').default(false).notNull(),
    workflowRunId: varchar('workflow_run_id', { length: 64 }),
    workflowRunUrl: varchar('workflow_run_url', { length: 2048 }),
    publishedDownloadUrl: varchar('published_download_url', { length: 2048 }),
    publishedServerUrl: varchar('published_server_url', { length: 2048 }),
    revisionlessFailedPreStaging: boolean('revisionless_failed_pre_staging')
      .default(false)
      .notNull(),
    dispatchedAt: timestamptz('dispatched_at'),
    dispatchedByUserId: text('dispatched_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamptz('completed_at'),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('desktop_releases_channel_version_unique').on(table.channel, table.version),
    index('desktop_releases_profile_created_at_idx').on(table.profileId, table.createdAt),
    index('desktop_releases_status_created_at_idx').on(table.status, table.createdAt),
    check('desktop_releases_channel_check', sql`${table.channel} IN ('canary', 'stable')`),
    check(
      'desktop_releases_status_check',
      sql`${table.status} IN ('queued', 'building', 'publishing', 'succeeded', 'failed')`,
    ),
  ],
);

export type DesktopBuildProfileItem = typeof desktopBuildProfiles.$inferSelect;
export type DesktopBuildProfileRevisionItem = typeof desktopBuildProfileRevisions.$inferSelect;
export type DesktopReleaseItem = typeof desktopReleases.$inferSelect;
