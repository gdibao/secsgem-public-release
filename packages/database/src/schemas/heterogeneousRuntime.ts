import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

export const persistentHeterogeneousProviders = ['codex', 'dsh', 'openclaw', 'hermes'] as const;

export type PersistentHeterogeneousProvider = (typeof persistentHeterogeneousProviders)[number];

export const isPersistentHeterogeneousProvider = (
  value: string,
): value is PersistentHeterogeneousProvider =>
  persistentHeterogeneousProviders.includes(value as PersistentHeterogeneousProvider);

/**
 * Durable ownership for one official heterogeneous runtime in a Fab scope.
 *
 * The references are opaque server-side identifiers or persistent-volume
 * paths. They must never contain provider credentials or signed URLs.
 */
export const heterogeneousRuntimeTenants = pgTable(
  'heterogeneous_runtime_tenants',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 })
      .$type<PersistentHeterogeneousProvider>()
      .notNull(),
    /** Server-derived opaque partition. It is never accepted from a client. */
    partitionKey: text('partition_key').notNull(),
    /** Official app-server / ACP / cell / profile identity, when provisioned. */
    runtimeRef: text('runtime_ref'),
    workspaceRef: text('workspace_ref').notNull(),
    stateRef: text('state_ref').notNull(),
    /** Reference into the platform secret store, never the secret itself. */
    credentialRef: text('credential_ref'),
    status: varchar('status', { length: 32 }).notNull().default('provisioning'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('heterogeneous_runtime_tenants_partition_key_unique').on(t.partitionKey),
    uniqueIndex('heterogeneous_runtime_tenants_personal_unique')
      .on(t.userId, t.provider)
      .where(sql`${t.workspaceId} IS NULL`),
    uniqueIndex('heterogeneous_runtime_tenants_workspace_unique')
      .on(t.userId, t.workspaceId, t.provider)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('heterogeneous_runtime_tenants_workspace_idx').on(t.workspaceId),
    check(
      'heterogeneous_runtime_tenants_provider_supported',
      sql`${t.provider} IN ('codex', 'dsh', 'openclaw', 'hermes')`,
    ),
    check('heterogeneous_runtime_tenants_partition_not_empty', sql`length(${t.partitionKey}) > 0`),
    check(
      'heterogeneous_runtime_tenants_workspace_ref_not_empty',
      sql`length(${t.workspaceRef}) > 0`,
    ),
    check('heterogeneous_runtime_tenants_state_ref_not_empty', sql`length(${t.stateRef}) > 0`),
  ],
);

/** Native official thread/session identifiers, always scoped through a tenant row. */
export const heterogeneousRuntimeSessions = pgTable(
  'heterogeneous_runtime_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    tenantId: uuid('tenant_id')
      .references(() => heterogeneousRuntimeTenants.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    nativeSessionId: text('native_session_id').notNull(),
    nativeThreadId: text('native_thread_id'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('heterogeneous_runtime_sessions_tenant_native_unique').on(
      t.tenantId,
      t.nativeSessionId,
    ),
    index('heterogeneous_runtime_sessions_tenant_topic_status_idx').on(
      t.tenantId,
      t.topicId,
      t.status,
    ),
    index('heterogeneous_runtime_sessions_topic_idx').on(t.topicId),
    check(
      'heterogeneous_runtime_sessions_native_session_not_empty',
      sql`length(${t.nativeSessionId}) > 0`,
    ),
  ],
);

export type HeterogeneousRuntimeTenantItem = typeof heterogeneousRuntimeTenants.$inferSelect;
export type NewHeterogeneousRuntimeTenant = typeof heterogeneousRuntimeTenants.$inferInsert;
export type HeterogeneousRuntimeSessionItem = typeof heterogeneousRuntimeSessions.$inferSelect;
export type NewHeterogeneousRuntimeSession = typeof heterogeneousRuntimeSessions.$inferInsert;
