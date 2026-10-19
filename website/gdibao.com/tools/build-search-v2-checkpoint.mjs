#!/usr/bin/env node
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
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
const outputRoot = resolve(
  options.output || "work/industry-official-site-search-v2",
);
const initialTargetTotal = Number(options.initial || 1759);
const pendingStatuses = new Set([
  "ambiguous",
  "candidate_unconfirmed",
  "candidate_unreachable",
  "not_found",
  "search_blocked",
  "verified_unreachable",
]);

const state = JSON.parse(await readFile(`${sourceRoot}/state.json`, "utf8"));
const resultFiles = (await readdir(`${outputRoot}/results`)).filter((name) =>
  name.endsWith(".json"),
);
const outcomeCounts = {};
for (const name of resultFiles) {
  const result = JSON.parse(
    await readFile(`${outputRoot}/results/${name}`, "utf8"),
  );
  outcomeCounts[result.outcome] = (outcomeCounts[result.outcome] || 0) + 1;
}
const entries = Object.values(state.entries);
const checkpoint = {
  updatedAt: new Date().toISOString(),
  sourceTotal: entries.length,
  initialTargetTotal,
  evidenceFiles: resultFiles.length,
  remainingPending: entries.filter((entry) => pendingStatuses.has(entry.status))
    .length,
  verifiedAccessible: entries.filter(
    (entry) => entry.status === "verified_accessible",
  ).length,
  verifiedUnreachable: entries.filter(
    (entry) => entry.status === "verified_unreachable",
  ).length,
  outcomeCounts,
  note:
    "evidenceFiles 是第二轮已有证据文件数；remainingPending 是当前仍需核验数，二者不应与旧流程单次搜索覆盖混为一谈。",
};
const path = `${outputRoot}/checkpoint.json`;
const temporary = `${path}.tmp`;
await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`);
await rename(temporary, path);
console.log(JSON.stringify(checkpoint, null, 2));
