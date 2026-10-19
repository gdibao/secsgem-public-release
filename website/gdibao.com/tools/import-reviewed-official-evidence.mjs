#!/usr/bin/env node
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
    return [key, value];
  }),
);
const inputPath = resolve(options.input || "");
const statePath = resolve(
  options.state || "work/industry-official-site-verification/state.json",
);
const ledgerPath = resolve(
  options.ledger || "work/industry-official-site-verification/ledger.jsonl",
);
const searchRoot = resolve(
  options.search || "work/industry-official-site-search-v2",
);
const dryRun = options["dry-run"] === "true";

if (!options.input) throw new Error("--input is required");

const writeAtomicJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};
const normalize = (value = "") =>
  String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "");
const allowedStatuses = new Set([
  "verified_accessible",
  "verified_unreachable",
]);

const input = JSON.parse(await readFile(inputPath, "utf8"));
const records = Array.isArray(input) ? input : input.records;
if (!Array.isArray(records) || records.length === 0) {
  throw new Error("input must contain a non-empty records array");
}

const state = JSON.parse(await readFile(statePath, "utf8"));
const now = new Date().toISOString();
const prepared = [];
for (const record of records) {
  const entry = state.entries[record.id];
  if (!entry) throw new Error(`unknown stable id: ${record.id}`);
  if (normalize(entry.company) !== normalize(record.company)) {
    throw new Error(`company mismatch for ${record.id}`);
  }
  if (!allowedStatuses.has(record.status)) {
    throw new Error(`invalid status for ${record.id}: ${record.status}`);
  }
  const canonicalUrl = new URL(record.canonicalUrl);
  const evidenceUrl = new URL(record.evidenceUrl);
  if (!["http:", "https:"].includes(canonicalUrl.protocol)) {
    throw new Error(`invalid canonical URL for ${record.id}`);
  }
  if (!["http:", "https:"].includes(evidenceUrl.protocol)) {
    throw new Error(`invalid evidence URL for ${record.id}`);
  }
  if (!Array.isArray(record.queries) || record.queries.length === 0) {
    throw new Error(`missing search queries for ${record.id}`);
  }
  if (!record.evidenceSummary || !record.ownershipEvidence) {
    throw new Error(`missing ownership evidence for ${record.id}`);
  }
  const checkedAt = record.checkedAt || now;
  prepared.push({
    record: {
      ...record,
      canonicalUrl: canonicalUrl.href,
      evidenceUrl: evidenceUrl.href,
      checkedAt,
    },
    entry,
  });
}

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        records: prepared.map(({ record }) => ({
          id: record.id,
          company: record.company,
          status: record.status,
          canonicalUrl: record.canonicalUrl,
          queryCount: record.queries.length,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

await mkdir(`${searchRoot}/results`, { recursive: true });
for (const { record, entry } of prepared) {
  const previousStatus = entry.status;
  entry.seedWebsite ||= record.canonicalUrl;
  entry.canonicalUrl = record.canonicalUrl;
  entry.evidenceUrl = record.evidenceUrl;
  entry.evidenceSummary = record.evidenceSummary;
  entry.ownershipEvidence = record.ownershipEvidence;
  entry.verification = "verified_official";
  entry.status = record.status;
  entry.checkedAt = record.checkedAt;
  entry.attempts = (entry.attempts || 0) + 1;

  const result = {
    schemaVersion: 2,
    id: record.id,
    company: record.company,
    aliases: entry.aliases || [],
    priorStatus: previousStatus,
    startedAt: record.queries[0]?.requestedAt || record.checkedAt,
    completedAt: record.checkedAt,
    queries: record.queries,
    candidates: record.candidates || [],
    outcome: record.status,
    canonicalUrl: record.canonicalUrl,
    ownershipEvidence: record.ownershipEvidence,
    note: "人工复核搜索证据已确认官网归属；发布状态仍区分当前可达与不可达。",
  };
  await writeAtomicJson(`${searchRoot}/results/${record.id}.json`, result);
  await appendFile(
    `${searchRoot}/ledger.jsonl`,
    `${JSON.stringify({
      ts: record.checkedAt,
      id: record.id,
      company: record.company,
      priorStatus: previousStatus,
      outcome: record.status,
      queryCount: record.queries.length,
      candidateCount: (record.candidates || []).length,
      canonicalUrl: record.canonicalUrl,
      event: "reviewed_search_evidence_imported",
    })}\n`,
  );
  await appendFile(
    ledgerPath,
    `${JSON.stringify({
      ts: record.checkedAt,
      id: record.id,
      company: record.company,
      priorStatus: previousStatus,
      status: record.status,
      canonicalUrl: record.canonicalUrl,
      evidenceUrl: record.evidenceUrl,
      event: "official_site_verified_from_reviewed_search",
    })}\n`,
  );
}

state.updatedAt = now;
await writeAtomicJson(statePath, state);
console.log(
  JSON.stringify(
    {
      imported: prepared.length,
      statePath,
      searchRoot,
      updatedAt: now,
    },
    null,
    2,
  ),
);
