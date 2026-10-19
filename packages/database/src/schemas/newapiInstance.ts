import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { amountNumeric, createdAt, updatedAt } from './_helpers';

export type NewapiModelType =
  'chat' | 'embedding' | 'tts' | 'asr' | 'stt' | 'image' | 'video' | 'text2music' | 'realtime';

export const NEWAPI_MODEL_TYPES = [
  'chat',
  'embedding',
  'tts',
  'asr',
  'stt',
  'image',
  'video',
  'text2music',
  'realtime',
] as const satisfies NewapiModelType[];

export type AdminNewapiProviderType =
  | 'newapi'
  | 'sub2api'
  | 'openai-compatible'
  | 'openai'
  | 'claude'
  | 'deepseek'
  | 'aliyun'
  | 'opencode-go'
  | 'siliconflow';

export interface AdminNewapiPricingPolicy {
  lobeHubOfficialPricingEnabled?: boolean;
  modelBankFallbackEnabled?: boolean;
  upstreamSyncEnabled?: boolean;
}

export type AdminNewapiInstanceMetadata = Record<string, unknown> & {
  pricingPolicy?: AdminNewapiPricingPolicy;
};

/**
 * Admin-managed NewAPI gateway instances. Each row represents a single upstream
 * NewAPI deployment. Requests route across enabled instances in ascending
 * `priority` order with failover to the next instance on 5xx / network errors.
 *
 * api_key stores an encrypted admin secret for newly written rows. Legacy
 * plaintext rows are still supported by the server-side compatibility reader
 * and are masked when returned to admin clients.
 */
export const adminNewapiInstances = pgTable(
  'admin_newapi_instances',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    name: text('name').notNull(),
    providerType: text('provider_type')
      .$type<AdminNewapiProviderType>()
      .notNull()
      .default('newapi'),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key').notNull(),

    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(0),

    groupKey: text('group_key').notNull().default('default'),
    groupName: text('group_name'),
    groupMultiplier: amountNumeric('group_multiplier'),
    usageScope: jsonb('usage_scope').$type<NewapiModelType[]>(),

    description: text('description'),
    fetchOnClient: boolean('fetch_on_client').notNull().default(false),

    metadata: jsonb('metadata').$type<AdminNewapiInstanceMetadata>(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('admin_newapi_instances_enabled_priority_idx').on(table.enabled, table.priority),
    index('admin_newapi_instances_group_enabled_priority_idx').on(
      table.groupKey,
      table.enabled,
      table.priority,
    ),
  ],
);

export type NewAdminNewapiInstance = typeof adminNewapiInstances.$inferInsert;
export type AdminNewapiInstanceItem = typeof adminNewapiInstances.$inferSelect;

/**
 * Per-instance model catalog. (instance_id, model_id, model_type) is a composite
 * primary key so the same model id can appear across instances (for failover)
 * and within one instance under different model types (rare, but allowed).
 */
export const adminNewapiInstanceModels = pgTable(
  'admin_newapi_instance_models',
  {
    instanceId: uuid('instance_id')
      .references(() => adminNewapiInstances.id, { onDelete: 'cascade' })
      .notNull(),

    modelId: varchar('model_id', { length: 128 }).notNull(),
    modelType: varchar('model_type', { length: 20 }).notNull(),

    displayName: text('display_name'),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.instanceId, table.modelId, table.modelType] }),
    index('admin_newapi_instance_models_type_idx').on(table.modelType, table.enabled),
  ],
);

export type NewAdminNewapiInstanceModel = typeof adminNewapiInstanceModels.$inferInsert;
export type AdminNewapiInstanceModelItem = typeof adminNewapiInstanceModels.$inferSelect;

/**
 * Shape for `plan_catalog.model_rules`. Each model type has an independent
 * allowlist/blocklist policy; missing types default to allow (no restriction).
 */
export interface PlanModelRule {
  allowlist?: string[];
  blocklist?: string[];
  mode: 'allowlist' | 'blocklist';
}

export type PlanModelRules = Partial<Record<NewapiModelType, PlanModelRule>>;
