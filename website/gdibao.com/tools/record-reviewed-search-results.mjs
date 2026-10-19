#!/usr/bin/env node
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
    return [key, value];
  }),
);
if (!options.input) throw new Error("--input is required");
const inputPath = resolve(options.input);
const statePath = resolve(
  options.state || "work/industry-official-site-verification/state.json",
);
const searchRoot = resolve(
  options.search || "work/industry-official-site-search-v2",
);
const input = JSON.parse(await readFile(inputPath, "utf8"));
const records = Array.isArray(input) ? input : input.records;
const state = JSON.parse(await readFile(statePath, "utf8"));
if (!Array.isArray(records) || records.length === 0) {
  throw new Error("input must contain a non-empty records array");
}
await mkdir(`${searchRoot}/results`, { recursive: true });

for (const record of records) {
  const entry = state.entries[record.id];
  if (!entry || entry.company !== record.company) {
    throw new Error(`unknown or mismatched company: ${record.id}`);
  }
  if (!Array.isArray(record.queries) || record.queries.length === 0) {
    throw new Error(`missing queries: ${record.id}`);
  }
  if (!["ambiguous", "no_result", "rate_limited"].includes(record.outcome)) {
    throw new Error(`invalid non-publishing outcome: ${record.id}`);
  }
  const completedAt = record.completedAt || new Date().toISOString();
  const result = {
    schemaVersion: 2,
    id: record.id,
    company: record.company,
    aliases: entry.aliases || [],
    priorStatus: entry.status,
    startedAt: record.queries[0].requestedAt || completedAt,
    completedAt,
    queries: record.queries,
    candidates: record.candidates || [],
    outcome: record.outcome,
    reviewCandidates: record.reviewCandidates || [],
    note:
      record.note ||
      "已执行补充搜索，但没有取得足以发布官网的法人或集团归属证据。",
  };
  const path = `${searchRoot}/results/${record.id}.json`;
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`);
  await rename(temporary, path);
  await appendFile(
    `${searchRoot}/ledger.jsonl`,
    `${JSON.stringify({
      ts: completedAt,
      id: record.id,
      company: record.company,
      priorStatus: entry.status,
      outcome: record.outcome,
      queryCount: record.queries.length,
      candidateCount: result.candidates.length,
      event: "reviewed_search_unresolved_recorded",
    })}\n`,
  );
}

console.log(JSON.stringify({ recorded: records.length, searchRoot }, null, 2));
