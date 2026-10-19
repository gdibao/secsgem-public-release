#!/usr/bin/env node
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
    return [key, value];
  }),
);
const sourceRoot = resolve(
  options.source || "work/industry-official-site-verification",
);
const searchRoot = resolve(
  options.search || "work/industry-official-site-search-v2",
);
const outputPath = resolve(
  options.output || `${searchRoot}/baseline-workset.json`,
);

const exists = async (path) => access(path).then(() => true, () => false);
const state = JSON.parse(await readFile(`${sourceRoot}/state.json`, "utf8"));
const ledgerLines = (await readFile(`${sourceRoot}/ledger.jsonl`, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const oldBlockedIds = new Set(
  ledgerLines
    .filter((event) => event.status === "search_blocked")
    .map((event) => event.id),
);
const seed = JSON.parse(
  await readFile(`${sourceRoot}/seed-directory.json`, "utf8"),
);
const seedById = new Map(seed.companies.map((entry) => [entry.stable_id, entry]));
const resultFiles = new Set(
  (await readdir(`${searchRoot}/results`))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5)),
);

const records = [];
for (const entry of Object.values(state.entries).sort(
  (left, right) => left.id.localeCompare(right.id, "en"),
)) {
  const seedEntry = seedById.get(entry.id);
  if (!seedEntry) throw new Error(`baseline seed missing ${entry.id}`);
  const oldSearchPath = `${sourceRoot}/cache/${entry.id}.json`;
  const hasOldSearch = await exists(oldSearchPath);
  const oldSearch = hasOldSearch
    ? JSON.parse(await readFile(oldSearchPath, "utf8"))
    : null;
  const deepResultPath = `${searchRoot}/results/${entry.id}.json`;
  const deepResult = resultFiles.has(entry.id)
    ? JSON.parse(await readFile(deepResultPath, "utf8"))
    : null;
  records.push({
    id: entry.id,
    company: entry.company,
    aliases: entry.aliases || [],
    baselineStatus: entry.status,
    ownershipVerified: entry.verification === "verified_official",
    canonicalUrl: entry.canonicalUrl || null,
    oldCoverage: hasOldSearch
      ? {
          kind: "search_request",
          checkedAt: oldSearch.checkedAt,
          query: oldSearch.query,
          candidateCount: oldSearch.candidates?.length || 0,
        }
      : oldBlockedIds.has(entry.id)
        ? {
            kind: "search_blocked",
            checkedAt: entry.checkedAt || null,
            query: `${entry.company} 官方网站`,
            candidateCount: 0,
          }
      : entry.seedWebsite
        ? {
            kind: "historical_url_probe",
            checkedAt: entry.checkedAt || null,
            query: null,
            candidateCount: 1,
          }
        : {
            kind: "ledger_only",
            checkedAt: entry.checkedAt || null,
            query: null,
            candidateCount: 0,
          },
    deepCoverage: deepResult
      ? {
          outcome: deepResult.outcome,
          completedAt: deepResult.completedAt,
          queryCount: deepResult.queries?.length || 0,
          candidateCount: deepResult.candidates?.length || 0,
          resultPath: deepResultPath,
        }
      : null,
    sourceRole: seedEntry.role || null,
    sourceDomains: seedEntry.domains || [],
  });
}

if (records.length !== seed.companies.length) {
  throw new Error(
    `baseline mismatch state=${records.length} seed=${seed.companies.length}`,
  );
}
const count = (predicate) => records.filter(predicate).length;
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baselineGeneratedAt: seed.generatedAt,
  baselineTotal: records.length,
  counts: {
    ownershipVerified: count((entry) => entry.ownershipVerified),
    accessible: count((entry) => entry.baselineStatus === "verified_accessible"),
    unreachable: count((entry) => entry.baselineStatus === "verified_unreachable"),
    oldSearchRequest: count(
      (entry) => entry.oldCoverage.kind === "search_request",
    ),
    oldHistoricalUrlProbe: count(
      (entry) => entry.oldCoverage.kind === "historical_url_probe",
    ),
    oldBlockedOrLedgerOnly: count(
      (entry) => ["search_blocked", "ledger_only"].includes(entry.oldCoverage.kind),
    ),
    deepDisposition: count((entry) => entry.deepCoverage),
    deepPending: count((entry) => !entry.deepCoverage),
    reusedOwnershipVerified: count((entry) => entry.ownershipVerified),
    machineTarget: count(
      (entry) => !entry.ownershipVerified && !entry.deepCoverage,
    ),
  },
  invariants: {
    stateMatchesSeed: records.length === seed.companies.length,
    accessiblePlusNotAccessible:
      count((entry) => entry.baselineStatus === "verified_accessible") +
        count((entry) => entry.baselineStatus !== "verified_accessible") ===
      records.length,
    ownershipBreakdown:
      count((entry) => entry.baselineStatus === "verified_accessible") +
        count((entry) => entry.baselineStatus === "verified_unreachable") ===
      count((entry) => entry.ownershipVerified),
  },
  records,
};
await mkdir(resolve(outputPath, ".."), { recursive: true });
const temporary = `${outputPath}.tmp`;
await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`);
await rename(temporary, outputPath);
console.log(JSON.stringify({ outputPath, ...output.counts, invariants: output.invariants }, null, 2));
