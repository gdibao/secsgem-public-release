// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);
const migrationTag = '0129_workspace_device_and_ai_infra_surrogate_pk';

const readMigration = () => readFileSync(path.join(migrationsDir, `${migrationTag}.sql`), 'utf8');

describe('ComHub v2.2.7 workspace/device/aiInfra migration chain', () => {
  it('appends the upstream structural migration as a later ComHub migration', () => {
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as {
      entries: { idx: number; tag: string; when: number }[];
    };

    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags).toContain(migrationTag);
    expect(tags).not.toContain('0111_workspace_device_and_ai_infra_surrogate_pk');
    expect(tags.filter((tag) => tag === migrationTag)).toHaveLength(1);

    const entryIndex = journal.entries.findIndex((entry) => entry.tag === migrationTag);
    const entry = journal.entries[entryIndex];
    const previousEntries = journal.entries.slice(0, entryIndex);

    expect(entry.idx).toBeGreaterThan(Math.max(...previousEntries.map((item) => item.idx)));
    expect(entry.when).toBeGreaterThan(Math.max(...previousEntries.map((item) => item.when)));

    const migrations = readMigrationFiles({ migrationsFolder: migrationsDir });
    const migration = migrations.find((item) => item.folderMillis === entry.when);

    expect(migration?.folderMillis).toBe(entry.when);
    expect(migration?.sql[0]).toContain('ComHub carry-forward of upstream v2.2.7');
  });

  it('contains the v2.2.7 aiInfra, device, and workspace structural changes', () => {
    expect(existsSync(path.join(migrationsDir, `${migrationTag}.sql`))).toBe(true);

    const sql = readMigration();

    expect(sql).toContain('UPDATE "ai_providers" SET "_id" = gen_random_uuid()');
    expect(sql).toContain('UPDATE "ai_models" SET "_id" = gen_random_uuid()');
    expect(sql).toContain('ALTER TABLE "ai_providers" ALTER COLUMN "_id" SET NOT NULL');
    expect(sql).toContain('ALTER TABLE "ai_models" ALTER COLUMN "_id" SET NOT NULL');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ai_providers_id_user_id_pk"');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ai_models_id_provider_id_user_id_pk"');
    expect(sql).toContain('ADD CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("_id")');
    expect(sql).toContain('ADD CONSTRAINT "ai_models_pkey" PRIMARY KEY ("_id")');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_id_user_id_unique"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_id_user_id_workspace_id_unique"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_id_provider_id_user_id_unique"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_id_provider_id_user_id_workspace_id_unique"',
    );
    expect(sql).toContain('DROP INDEX IF EXISTS "devices_user_id_device_id_unique"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "frozen" boolean DEFAULT false');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "frozen_reason" text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "frozen_at" timestamp with time zone');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "devices_workspace_id_device_id_unique"',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "devices_user_id_device_id_unique"');
  });

  it('keeps the carry-forward chain after the legacy cutoff', () => {
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const cutoffTag = '0177_add_subscription_payments';
    const carryForwardTag = '0178_repair_migration_chain';
    const cutoffIndex = journal.entries.findIndex((entry) => entry.tag === cutoffTag);
    const carryForwardIndex = journal.entries.findIndex((entry) => entry.tag === carryForwardTag);

    expect(cutoffIndex).toBeGreaterThanOrEqual(0);
    expect(carryForwardIndex).toBeGreaterThan(cutoffIndex);

    expect(journal.entries[carryForwardIndex + 1]?.tag).toBe(
      '0149_goals_recovery_and_document_evidence',
    );

    const legacyEntries = journal.entries.slice(0, carryForwardIndex);
    const carryForwardEntries = journal.entries.slice(carryForwardIndex);
    const legacyMaxWhen = Math.max(...legacyEntries.map((entry) => entry.when));
    const latestMergedEntry = journal.entries.find(
      (entry) => entry.tag === '0166_device_architecture',
    );
    const legacyIndexes = new Set(legacyEntries.map((entry) => entry.idx));

    const historicalRepairEntries = journal.entries.slice(cutoffIndex + 1, carryForwardIndex);
    expect(historicalRepairEntries).toHaveLength(22);
    expect(historicalRepairEntries.slice(0, 4)).toEqual([
      {
        idx: 127,
        version: '7',
        when: 1784716592911,
        tag: '0127_add_topic_comments',
        breakpoints: true,
      },
      {
        idx: 128,
        version: '7',
        when: 1784898202325,
        tag: '0128_notifications_add_workspace_id',
        breakpoints: true,
      },
      {
        idx: 129,
        version: '7',
        when: 1784941780510,
        tag: '0129_workspace_members_unique_active_owner',
        breakpoints: true,
      },
      {
        idx: 130,
        version: '7',
        when: 1785044468256,
        tag: '0130_notifications_add_context',
        breakpoints: true,
      },
    ]);

    expect(carryForwardEntries[0].when).toBeGreaterThan(legacyMaxWhen);
    expect(latestMergedEntry).toBeDefined();
    expect(carryForwardEntries[0].when).toBeGreaterThan(latestMergedEntry!.when);
    expect(legacyIndexes.has(carryForwardEntries[0].idx)).toBe(false);
    const repairSql = readFileSync(path.join(migrationsDir, `${carryForwardTag}.sql`), 'utf8');
    expect(repairSql).not.toContain('-- Source: 0149_');
    for (const entry of historicalRepairEntries) {
      expect(repairSql).toContain(`-- Source: ${entry.tag}.sql`);
      expect(repairSql).toContain(`-- Historical created_at: ${entry.when}`);
      expect(repairSql).toContain(`WHERE "created_at" = ${entry.when}`);
    }
  });
});
