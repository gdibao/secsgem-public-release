import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { topUpOrders } from './commercial';
import * as liveSchema from './index';
import {
  moduleAppActions,
  moduleAppArtifactCleanupJobs,
  moduleAppArtifacts,
  moduleAppAuditLogs,
  moduleAppBuilds,
  moduleAppDataRows,
  moduleAppDataSchemas,
  moduleAppEntitlements,
  moduleAppInstallations,
  moduleAppInstallationSecrets,
  moduleAppInstallationVersionRefs,
  moduleAppOrders,
  moduleAppPackages,
  moduleAppPackageUploads,
  moduleAppPages,
  moduleAppPaymentAttempts,
  moduleAppPayoutEntries,
  moduleAppRecordEvents,
  moduleAppRecords,
  moduleAppRuns,
  moduleApps,
  moduleAppSchedules,
  moduleAppSubscriptions,
  moduleAppVersions,
  moduleAppWebhookDeliveries,
  moduleAppWebhooks,
  moduleAppWorkflowNodes,
  moduleAppWorkflowRuns,
} from './moduleApp';

describe('module app schema exports', () => {
  it('exports all P1 tables', () => {
    expect(moduleApps).toBeDefined();
    expect(moduleAppVersions).toBeDefined();
    expect(moduleAppPages).toBeDefined();
    expect(moduleAppActions).toBeDefined();
    expect(moduleAppEntitlements).toBeDefined();
    expect(moduleAppInstallations).toBeDefined();
    expect(moduleAppRecords).toBeDefined();
    expect(moduleAppRecordEvents).toBeDefined();
    expect(moduleAppRuns).toBeDefined();
    expect(moduleAppArtifacts).toBeDefined();
    expect(moduleAppArtifactCleanupJobs).toBeDefined();
    expect(moduleAppAuditLogs).toBeDefined();
    expect(moduleAppPackages).toBeDefined();
    expect(moduleAppPackageUploads).toBeDefined();
    expect(moduleAppBuilds).toBeDefined();
    expect(moduleAppInstallationSecrets).toBeDefined();
    expect(moduleAppInstallationVersionRefs).toBeDefined();
    expect(moduleAppDataSchemas).toBeDefined();
    expect(moduleAppDataRows).toBeDefined();
    expect(moduleAppWorkflowRuns).toBeDefined();
    expect(moduleAppWorkflowNodes).toBeDefined();
    expect(moduleAppWorkflowNodes.installationId).toBeDefined();
    expect(moduleAppSchedules).toBeDefined();
    expect(moduleAppWebhooks).toBeDefined();
    expect(moduleAppWebhookDeliveries).toBeDefined();
  });

  it('registers the durable artifact cleanup outbox', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0172_module_app_artifact_cleanup_jobs.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const config = getTableConfig(moduleAppArtifactCleanupJobs);

    expect(config.name).toBe('module_app_artifact_cleanup_jobs');
    expect(config.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'module_app_artifact_cleanup_jobs_storage_key_unique',
        'module_app_artifact_cleanup_jobs_status_updated_idx',
      ]),
    );
    expect(migration).toContain(
      "CHECK (\"status\" IN ('pending', 'processing', 'released', 'failed'))",
    );
    expect(journal.entries.some(({ tag }) => tag === '0172_module_app_artifact_cleanup_jobs')).toBe(
      true,
    );
  });

  it('keeps database ownership constraints in the generated migration', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0131_add_module_apps.sql'),
      'utf8',
    );

    expect(migration).toContain('module_app_installations_scope_owner_check');
    expect(migration).toContain('module_app_records_scope_owner_check');
    expect(migration).toContain(`WHERE "scope_type" = 'personal' AND "user_id" IS NOT NULL`);
    expect(migration).toContain(`WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL`);
    expect(migration).toContain(`"owner_user_id" IS NOT NULL`);
    expect(migration).toContain(`AND "workspace_id" IS NULL`);
  });

  it('registers the module app migration in the journal', () => {
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(journal.entries.some(({ tag }) => tag === '0131_add_module_apps')).toBe(true);
  });

  it('registers the module app package review migration', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0132_add_module_app_packages.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_packages"');
    expect(migration).toContain('"submitted_by_user_id" text');
    expect(migration).toContain('module_app_packages_review_status_created_at_idx');
    expect(journal.entries.some(({ tag }) => tag === '0132_add_module_app_packages')).toBe(true);
  });

  it('registers the module app source migration', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0133_add_module_app_source.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'admin' NOT NULL`);
    expect(migration).toContain('module_apps_source_check');
    expect(migration).toContain(`IN ('system', 'admin', 'user', 'developer')`);
    expect(journal.entries.some(({ tag }) => tag === '0133_add_module_app_source')).toBe(true);
  });

  it('registers platform plugin table decommission migration without live schema exports', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0134_drop_platform_plugin_tables.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const tableNames = Object.values(liveSchema).flatMap((value): string[] => {
      try {
        const name = getTableName(value as any);

        return typeof name === 'string' ? [name] : [];
      } catch {
        return [];
      }
    });

    expect(migration).toContain('DROP TABLE IF EXISTS "platform_plugin_audit_logs"');
    expect(migration).toContain('DROP TABLE IF EXISTS "platform_plugins"');
    expect(journal.entries.some(({ tag }) => tag === '0134_drop_platform_plugin_tables')).toBe(
      true,
    );
    expect(tableNames.filter((name) => name.startsWith('platform_plugin'))).toEqual([]);
  });

  it('registers the module app package upload session migration', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0135_add_module_app_package_uploads.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_package_uploads"');
    expect(migration).toContain('module_app_package_uploads_storage_key_unique');
    expect(migration).toContain('module_app_package_uploads_user_status_created_at_idx');
    expect(migration).toContain('module_app_package_uploads_status_expires_at_idx');
    expect(journal.entries.some(({ tag }) => tag === '0135_add_module_app_package_uploads')).toBe(
      true,
    );
  });

  it('registers immutable build and encrypted installation secret persistence', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0136_add_module_app_build_runtime.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_builds"');
    expect(migration).toContain('module_app_builds_version_id_unique');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_installation_secrets"');
    expect(migration).toContain('"encrypted_value" text NOT NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "runtime_artifact_sha256" text');
    expect(journal.entries.some(({ tag }) => tag === '0136_add_module_app_build_runtime')).toBe(
      true,
    );
  });

  it('registers installation-bound managed data and workflow persistence', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0137_add_module_app_data_workflows.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "installation_id" uuid');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_data_schemas"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_data_rows"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_workflow_runs"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_workflow_nodes"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_schedules"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_webhooks"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "module_app_webhook_deliveries"');
    expect(migration).toContain('module_app_migration_quarantine');
    expect(journal.entries.some(({ tag }) => tag === '0137_add_module_app_data_workflows')).toBe(
      true,
    );
  });

  it('registers module app commerce accounts, reservations, and ledger persistence', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0138_add_module_app_commerce.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "workspace_credit_accounts"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "workspace_credit_ledger_entries"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "credit_reservations"');
    expect(migration).toContain('"idempotency_key" text NOT NULL UNIQUE');
    expect(migration).toContain('credit_ledger_entries_module_app_reservation_unique_idx');
    expect(journal.entries.some(({ tag }) => tag === '0138_add_module_app_commerce')).toBe(true);
  });

  it('registers an idempotent module app build lease migration', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0144_add_module_app_build_leases.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain(
      "FROM pg_constraint WHERE conname = 'module_app_builds_attempt_count_check'",
    );
    expect(migration).toContain(
      'ALTER TABLE "module_app_builds" ADD CONSTRAINT "module_app_builds_attempt_count_check"',
    );
    expect(journal.entries.some(({ tag }) => tag === '0144_add_module_app_build_leases')).toBe(
      true,
    );
  });

  it('registers an idempotent module app order idempotency migration', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0145_add_module_app_order_idempotency.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "idempotency_key" text');
    expect(migration).toContain('SET "idempotency_key" = "id"::text');
    expect(migration).toContain('ALTER COLUMN "idempotency_key" SET NOT NULL');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "module_app_orders_purchaser_idempotency_unique"',
    );
    expect(journal.entries.some(({ tag }) => tag === '0145_add_module_app_order_idempotency')).toBe(
      true,
    );
  });

  it('registers hardened subscription, refund, and payout transitions', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0147_harden_commercial_transactions.sql'),
      'utf8',
    );
    const payoutIndex = getTableConfig(moduleAppPayoutEntries).indexes.find(
      (index) => index.config.name === 'module_app_payout_entries_revenue_unique',
    );

    expect(moduleAppOrders.refundReference).toBeDefined();
    expect(moduleApps.currentPublishedVersionId).toBeDefined();
    expect(moduleAppSubscriptions.trialEndsAt).toBeDefined();
    expect(payoutIndex?.config.where).toBeDefined();
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "refund_reference" text');
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone',
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "current_published_version_id" uuid');
    expect(migration).toContain(
      'module_apps_current_published_version_id_module_app_versions_id_fk',
    );
    expect(migration).toContain('DROP INDEX IF EXISTS "module_app_payout_entries_revenue_unique"');
    expect(migration).toContain(`WHERE "status" <> 'reversed'`);
  });

  it('registers installation version retention and artifact deletion protection', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0168_module_app_installation_lifecycle.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "module_app_installation_version_refs"',
    );
    expect(migration).toContain('module_app_installation_version_refs_unique');
    expect(migration).toContain('sync_module_app_installation_version_refs');
    expect(migration).toContain('"build_id" uuid');
    expect(migration).toContain('"package_id" uuid');
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(4);
    expect(migration).toContain('module_app_installations_lifecycle_check');
    expect(
      journal.entries.some(({ tag }) => tag === '0168_module_app_installation_lifecycle'),
    ).toBe(true);
  });

  it('enforces catalog version ownership and natural-key uniqueness', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0169_harden_module_app_catalog_consistency.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const versionIndexes = getTableConfig(moduleAppVersions).indexes.map(
      (index) => index.config.name,
    );
    const pageConfig = getTableConfig(moduleAppPages);
    const actionConfig = getTableConfig(moduleAppActions);

    expect(versionIndexes).toEqual(
      expect.arrayContaining([
        'module_app_versions_app_id_published_version_unique',
        'module_app_versions_one_draft_per_app_unique',
      ]),
    );
    expect(pageConfig.foreignKeys.map((key) => key.getName())).toContain(
      'module_app_pages_version_app_fk',
    );
    expect(actionConfig.foreignKeys.map((key) => key.getName())).toContain(
      'module_app_actions_version_app_fk',
    );
    expect(migration).toContain('module_app_pages_version_id_page_key_unique');
    expect(migration).toContain('module_app_actions_version_id_action_key_unique');
    expect(migration).toContain('multiple drafts for an application');
    expect(
      journal.entries.some(({ tag }) => tag === '0169_harden_module_app_catalog_consistency'),
    ).toBe(true);
  });

  it('persists installation grants and data purge state', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0170_module_app_installation_grants.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(moduleAppInstallations.grantSnapshot).toBeDefined();
    expect(moduleAppInstallations.dataPurgedAt).toBeDefined();
    expect(migration).toContain('"grant_snapshot" jsonb');
    expect(migration).toContain('"data_purged_at" timestamp with time zone');
    expect(journal.entries.some(({ tag }) => tag === '0170_module_app_installation_grants')).toBe(
      true,
    );
  });

  it('registers a rerunnable unified payment provider migration', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0173_unify_payment_providers.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "module_app_payment_attempts_method_check"',
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "checkout" jsonb');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "idempotency_key" text');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "top_up_orders_user_idempotency_unique"',
    );
    expect(moduleAppPaymentAttempts.checkout).toBeDefined();
    expect(topUpOrders.checkout).toBeDefined();
    expect(topUpOrders.idempotencyKey).toBeDefined();
    expect(
      getTableConfig(topUpOrders).indexes.find(
        (index) => index.config.name === 'top_up_orders_user_idempotency_unique',
      )?.config.where,
    ).toBeDefined();
    expect(journal.entries.some(({ tag }) => tag === '0173_unify_payment_providers')).toBe(true);
  });
});
