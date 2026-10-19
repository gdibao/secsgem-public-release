#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const statePath = resolve(process.argv[2] || "work/industry-official-site-verification/state.json");
const outputPath = resolve(process.argv[3] || "gdibao-site/assets/industry-official-status.js");
const normalize = (value = "") => String(value)
  .normalize("NFKC")
  .toLocaleLowerCase("zh-CN")
  .replace(/[\s·•・,，.。/\\|\-_—–'‘’"“”()（）\[\]【】]/gu, "");

const state = JSON.parse(await readFile(statePath, "utf8"));
const records = Object.values(state.entries)
  .filter((entry) => entry.verification === "verified_official")
  .sort((left, right) => left.company.localeCompare(right.company, "zh-CN"));
const byName = {};
for (const entry of records) {
  byName[normalize(entry.company)] = {
    status: entry.status,
    url: entry.canonicalUrl || entry.seedWebsite || null,
    checkedAt: entry.checkedAt,
  };
}
const output = {
  generatedAt: new Date().toISOString(),
  verifiedOwnership: records.length,
  accessible: records.filter((entry) => entry.status === "verified_accessible").length,
  unreachable: records.filter((entry) => entry.status === "verified_unreachable").length,
  byName,
};
await writeFile(outputPath, `window.GDIBAO_OFFICIAL_STATUS=${JSON.stringify(output)};\n`);
console.log(JSON.stringify({
  outputPath,
  verifiedOwnership: output.verifiedOwnership,
  accessible: output.accessible,
  unreachable: output.unreachable,
}, null, 2));
