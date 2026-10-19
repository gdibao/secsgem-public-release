#!/usr/bin/env node
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const root = resolve(options.root || "work/industry-official-site-verification");
const statePath = join(root, "state.json");
const ledgerPath = join(root, "ledger.jsonl");
const profilesRoot = resolve(options.profiles || "cseac-kg/data/profiles");

const normalize = (value = "") => String(value)
  .normalize("NFKC")
  .toLocaleLowerCase("zh-CN")
  .replace(/[\s·•・,，.。()（）/／\\《》<>“”"'‘’\-_]+/gu, "");
const writeAtomicJson = async (path, value) => {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};
const walk = async (directory) => {
  const output = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) output.push(...await walk(path));
    else if (item.isFile() && item.name.endsWith(".md")) output.push(path);
  }
  return output;
};

await mkdir(root, { recursive: true });
const state = JSON.parse(await readFile(statePath, "utf8"));
const byName = new Map();
for (const entry of Object.values(state.entries)) {
  for (const value of [entry.company, ...(entry.aliases || [])]) {
    const key = normalize(value);
    if (!key) continue;
    const bucket = byName.get(key) || [];
    bucket.push(entry);
    byName.set(key, bucket);
  }
}

let profilesWithWebsite = 0;
let matched = 0;
let ambiguous = 0;
let unmatched = 0;
let documented = 0;
const unmatchedProfiles = [];
for (const path of await walk(profilesRoot)) {
  const text = await readFile(path, "utf8");
  const website = text.match(/^- 官网：(https?:\/\/\S+)/mu)?.[1]?.replace(/[。；;,，]+$/u, "");
  if (!website) continue;
  profilesWithWebsite += 1;
  const heading = text.match(/^#\s+(.+)$/mu)?.[1] || basename(path, ".md");
  const candidates = [heading.replace(/企业画像$/u, ""), basename(path, ".md")];
  const matches = [...new Set(candidates.flatMap((name) => byName.get(normalize(name)) || []))];
  if (matches.length !== 1) {
    if (matches.length > 1) ambiguous += 1;
    else unmatched += 1;
    unmatchedProfiles.push({ path, heading, website, matchCount: matches.length });
    continue;
  }
  const entry = matches[0];
  const subjectSection = text.match(/^## 主体核实[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/mu)?.[1]?.trim() || "";
  const ownershipDocumented = Boolean(subjectSection)
    && /经核实|官方.*(?:列示|披露|显示)|主体.*(?:一致|对应)/u.test(subjectSection)
    && !/主体不一致|疑似同名/u.test(subjectSection);
  if (ownershipDocumented) documented += 1;
  if (!entry.seedWebsite || entry.verification !== "verified_official") {
    entry.seedWebsite = website;
    entry.canonicalUrl = website;
    entry.sourceEvidencePath = path;
    entry.ownershipDocumented = ownershipDocumented;
    entry.evidenceUrl = website;
    entry.evidenceSummary = ownershipDocumented
      ? subjectSection.slice(0, 500)
      : "既有企业画像记录了官网候选，官方归属仍需逐项复核。";
    entry.status = "queued_existing_url";
    entry.checkedAt = null;
    entry.attempts ||= 0;
    matched += 1;
    await appendFile(ledgerPath, `${JSON.stringify({
      ts: new Date().toISOString(),
      id: entry.id,
      company: entry.company,
      status: entry.status,
      canonicalUrl: website,
      evidencePath: path,
      ownershipDocumented,
      event: "existing_profile_imported",
    })}\n`);
  }
}

await writeAtomicJson(statePath, state);
await writeAtomicJson(join(root, "existing-evidence-import.json"), {
  generatedAt: new Date().toISOString(),
  profilesWithWebsite,
  matched,
  documented,
  ambiguous,
  unmatched,
  unmatchedProfiles,
});
console.log(JSON.stringify({ profilesWithWebsite, matched, documented, ambiguous, unmatched }, null, 2));
