import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);

export const V2217_APPEND_TAGS = [
  '0158_file_upload_reservations',
  '0159_task_activities',
  '0160_acceptance_check_assets',
  '0161_acceptance_comments',
];

export const V2218_APPEND_TAGS = [
  '0162_fts_capture_version',
  '0163_environments',
  '0164_document_comment_selection_anchor',
  '0165_expertise_rejection_provenance',
  '0166_device_architecture',
];

const LEGACY_CUTOFF_TAG = '0177_add_subscription_payments';
const REPAIR_MIGRATION_TAG = '0178_repair_migration_chain';
const LATEST_MERGED_MIGRATION_TAG = '0166_device_architecture';
const REPAIR_SOURCE_TAGS = [
  '0127_add_topic_comments',
  '0128_notifications_add_workspace_id',
  '0129_workspace_members_unique_active_owner',
  '0130_notifications_add_context',
];
const REPAIR_SOURCE_COUNT = 22;
const HISTORICAL_REPAIR_ENTRIES = [
  { idx: 127, tag: '0127_add_topic_comments', when: 1784716592911 },
  { idx: 128, tag: '0128_notifications_add_workspace_id', when: 1784898202325 },
  {
    idx: 129,
    tag: '0129_workspace_members_unique_active_owner',
    when: 1784941780510,
  },
  { idx: 130, tag: '0130_notifications_add_context', when: 1785044468256 },
];

const readJournal = (rootDirectory) => {
  const migrationsDirectory = path.join(rootDirectory, 'packages/database/migrations');
  const journalPath = path.join(migrationsDirectory, 'meta/_journal.json');

  if (!existsSync(journalPath)) {
    throw new Error(`Migration journal not found: ${journalPath}`);
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));

  if (!Array.isArray(journal.entries)) {
    throw new Error('Migration journal does not contain an entries array');
  }

  return { journal, migrationsDirectory };
};

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

/**
 * Validate the checked-in migration journal without connecting to a database.
 * Historical duplicate numeric prefixes are reported as warnings because the
 * journal tag and timestamp, rather than the filename prefix, identify a
 * migration to Drizzle.
 */
export const verifyMigrationChain = ({
  rootDirectory = path.resolve(scriptDirectory, '..'),
} = {}) => {
  const { journal, migrationsDirectory } = readJournal(rootDirectory);
  const entries = journal.entries;
  const errors = [];
  const warnings = [];
  const tags = new Map();
  const whens = new Map();
  const indexes = new Map();
  const duplicateIndexes = [];
  const files = [];

  if (journal.dialect !== 'postgresql') {
    errors.push(`Expected a PostgreSQL journal, received ${String(journal.dialect)}`);
  }

  for (const [position, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object') {
      errors.push(`Entry ${position} is not an object`);
      continue;
    }

    const { idx, tag, when } = entry;
    if (!Number.isInteger(idx) || !Number.isInteger(when) || typeof tag !== 'string' || !tag) {
      errors.push(`Entry ${position} has invalid idx, tag, or when`);
      continue;
    }

    if (tags.has(tag)) {
      errors.push(`Duplicate migration tag: ${tag}`);
    } else {
      tags.set(tag, position);
    }

    if (whens.has(when)) {
      errors.push(`Duplicate migration timestamp ${when}: ${tag} and ${whens.get(when)}`);
    } else {
      whens.set(when, tag);
    }

    if (indexes.has(idx)) {
      duplicateIndexes.push({ firstTag: indexes.get(idx), idx, tag });
    } else {
      indexes.set(idx, tag);
    }

    const sqlPath = path.join(migrationsDirectory, `${tag}.sql`);
    if (!existsSync(sqlPath)) {
      errors.push(`SQL file missing for ${tag}: ${sqlPath}`);
      continue;
    }

    const sql = readFileSync(sqlPath, 'utf8');
    if (!sql.trim()) {
      errors.push(`SQL file is empty for ${tag}`);
    }
    files.push({ path: sqlPath, sha256: sha256(sql), tag, when });
  }

  if (duplicateIndexes.length > 0) {
    warnings.push(
      `Historical duplicate idx values found (${duplicateIndexes.length}); preserving journal order because migration tags and timestamps identify Drizzle migrations`,
    );
  }

  const legacyCutoffIndex = entries.findIndex((entry) => entry.tag === LEGACY_CUTOFF_TAG);
  const repairIndex = entries.findIndex((entry) => entry.tag === REPAIR_MIGRATION_TAG);

  if (legacyCutoffIndex < 0) {
    errors.push(`Missing legacy migration cutoff: ${LEGACY_CUTOFF_TAG}`);
  }
  if (repairIndex < 0) {
    errors.push(`Missing repair migration: ${REPAIR_MIGRATION_TAG}`);
  }

  if (legacyCutoffIndex >= 0 && repairIndex >= 0) {
    if (repairIndex <= legacyCutoffIndex) {
      errors.push(
        `${REPAIR_MIGRATION_TAG} must be appended after ${LEGACY_CUTOFF_TAG} in the journal`,
      );
    }
    const firstPostRepairTag = '0149_goals_recovery_and_document_evidence';
    const firstPostRepairIndex = entries.findIndex((entry) => entry.tag === firstPostRepairTag);
    if (firstPostRepairIndex !== repairIndex + 1) {
      errors.push(`${REPAIR_MIGRATION_TAG} must be immediately before ${firstPostRepairTag}`);
    }

    const historicalRepairEntries = entries.slice(legacyCutoffIndex + 1, repairIndex);
    if (historicalRepairEntries.length !== REPAIR_SOURCE_COUNT) {
      errors.push(
        `Expected ${REPAIR_SOURCE_COUNT} historical carry-forward entries before ${REPAIR_MIGRATION_TAG}, got ${historicalRepairEntries.length}`,
      );
    }

    HISTORICAL_REPAIR_ENTRIES.forEach((expected, index) => {
      const actual = historicalRepairEntries[index];
      if (
        !actual ||
        actual.tag !== expected.tag ||
        actual.idx !== expected.idx ||
        actual.when !== expected.when
      ) {
        errors.push(
          `Historical repair entry ${index + 1} changed: expected ${expected.tag} (${expected.idx}, ${expected.when}), got ${actual?.tag ?? '<missing>'} (${actual?.idx ?? '<missing>'}, ${actual?.when ?? '<missing>'})`,
        );
      }
    });

    const actualRepairSourceTags = historicalRepairEntries
      .slice(0, REPAIR_SOURCE_TAGS.length)
      .map((entry) => entry.tag);
    if (actualRepairSourceTags.join('\u0000') !== REPAIR_SOURCE_TAGS.join('\u0000')) {
      errors.push(
        `Repair source migrations are not contiguous: expected ${REPAIR_SOURCE_TAGS.join(', ')}, got ${actualRepairSourceTags.join(', ')}`,
      );
    }

    const repairSqlPath = path.join(migrationsDirectory, `${REPAIR_MIGRATION_TAG}.sql`);
    if (existsSync(repairSqlPath)) {
      const repairSql = readFileSync(repairSqlPath, 'utf8');
      historicalRepairEntries.forEach((entry) => {
        const sourceMarker = `-- Source: ${entry.tag}.sql`;
        const timestampMarker = `-- Historical created_at: ${entry.when}`;
        const guardMarker = `WHERE "created_at" = ${entry.when}`;
        if (!repairSql.includes(sourceMarker)) {
          errors.push(`Repair migration is missing source marker: ${sourceMarker}`);
        }
        if (!repairSql.includes(timestampMarker) || !repairSql.includes(guardMarker)) {
          errors.push(`Repair migration is missing historical guard: ${entry.tag}`);
        }
      });
    }

    const repairEntry = entries[repairIndex];
    const previousEntries = entries.slice(0, repairIndex);
    const previousMaxWhen = Math.max(...previousEntries.map((entry) => entry.when));
    const latestMergedMigration = entries.find(
      (entry) => entry.tag === LATEST_MERGED_MIGRATION_TAG,
    );
    // Keep this timestamp above every historical entry so the repair also runs
    // on databases that reached a later appended migration before the gap was
    // detected. Journal order still places it before the 0149+ migrations.
    if (repairEntry.when <= previousMaxWhen) {
      errors.push(
        `${REPAIR_MIGRATION_TAG} timestamp ${repairEntry.when} is not after the historical maximum ${previousMaxWhen}`,
      );
    }
    if (latestMergedMigration && repairEntry.when <= latestMergedMigration.when) {
      errors.push(
        `${REPAIR_MIGRATION_TAG} timestamp ${repairEntry.when} must be after ${LATEST_MERGED_MIGRATION_TAG} timestamp ${latestMergedMigration.when}`,
      );
    }
    if (previousEntries.some((entry) => entry.idx === repairEntry.idx)) {
      errors.push(`Repair migration idx ${repairEntry.idx} collides with the historical journal`);
    }
    if (new Set(historicalRepairEntries.map((entry) => entry.tag)).size !== REPAIR_SOURCE_COUNT) {
      errors.push('Historical carry-forward migration tags must be unique');
    }
  }

  const verifyAppend = (version, expectedTags) => {
    const appendStart = entries.findIndex((entry) => entry.tag === expectedTags[0]);
    if (appendStart < 0) {
      errors.push(`Missing ${version} append migration: ${expectedTags[0]}`);
      return;
    }

    const appendEntries = entries.slice(appendStart, appendStart + expectedTags.length);
    const actualAppendTags = appendEntries.map((entry) => entry.tag);

    if (actualAppendTags.join('\u0000') !== expectedTags.join('\u0000')) {
      errors.push(
        `${version} migrations are not contiguous: expected ${expectedTags.join(', ')}, got ${actualAppendTags.join(', ')}`,
      );
    }

    const previousEntries = entries
      .slice(0, appendStart)
      .filter((entry) => entry.tag !== REPAIR_MIGRATION_TAG);
    const previousMaxWhen = Math.max(...previousEntries.map((entry) => entry.when));

    appendEntries.forEach((entry, index) => {
      if (entry.when <= previousMaxWhen) {
        errors.push(
          `${version} migration ${entry.tag} timestamp ${entry.when} is not after the legacy cutoff ${previousMaxWhen}`,
        );
      }
      if (index > 0 && entry.when <= appendEntries[index - 1].when) {
        errors.push(`${version} migration timestamps are not strictly increasing at ${entry.tag}`);
      }
    });
  };

  verifyAppend('v2.2.17', V2217_APPEND_TAGS);
  verifyAppend('v2.2.18', V2218_APPEND_TAGS);

  const summary = {
    appendTags: V2217_APPEND_TAGS,
    entryCount: entries.length,
    fileCount: files.length,
    legacyDuplicateIndexCount: duplicateIndexes.length,
    migrationFiles: files,
    v2218AppendTags: V2218_APPEND_TAGS,
  };

  return { errors, warnings, summary };
};

const isMainModule = path.resolve(process.argv[1] ?? '') === scriptPath;

if (isMainModule) {
  try {
    const result = verifyMigrationChain();

    for (const warning of result.warnings) console.warn(`[migration-check] warning: ${warning}`);
    for (const error of result.errors) console.error(`[migration-check] error: ${error}`);

    if (result.errors.length > 0) {
      process.exitCode = 1;
    } else {
      console.log(
        `[migration-check] OK: ${result.summary.entryCount} journal entries and ${result.summary.fileCount} SQL files; v2.2.17 and v2.2.18 appends verified`,
      );
    }
  } catch (error) {
    console.error(
      `[migration-check] error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
