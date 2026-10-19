#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const [dataPath, resourcesPath, outputPath, statusPath] = process.argv.slice(2);
if (!dataPath || !resourcesPath || !outputPath) {
  throw new Error("usage: export-industry-directory-seed.mjs DATA_JS RESOURCES_JS OUTPUT_JSON");
}

const dataSource = await readFile(dataPath, "utf8");
const context = { window: {} };
vm.runInNewContext(dataSource, context, { filename: dataPath });
const directory = context.window.GDIBAO_INDUSTRY_DIRECTORY;
if (!directory?.companies) throw new Error("directory data not found");

const uiSource = await readFile(resourcesPath, "utf8");
const match = uiSource.match(/const resources = (\[[\s\S]*?\n  \]);\n\n  const directory/);
if (!match) throw new Error("official resource list not found");
const resources = vm.runInNewContext(`(${match[1]})`, {}, { filename: resourcesPath });

const lookupKey = (value = "") =>
  String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•・,，.。/\\|\-_—–'‘’"“”()（）\[\]【】]/g, "");
const legalKey = (value = "") =>
  String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .trim()
    .replace(/[\s·•・,，.。/\\|\-_—–'‘’"“”]/g, "");

const companies = directory.companies.map((item) => ({
  stable_id: item.id,
  company: item.name,
  company_norm: legalKey(item.name),
  aliases: item.aliases || [],
  role: item.role,
  domains: item.domains || [],
  region: item.region || "地区待核",
  verification: item.verification || "unverified",
  website: item.url || null,
  evidence_url: item.url || null,
  evidence_summary: item.url ? "既有目录官方归属核验记录" : null,
  source_kind: "seed",
}));
const index = new Map();
companies.forEach((company) =>
  [company.company, ...company.aliases].forEach((name) => {
    const key = lookupKey(name);
    if (key && !index.has(key)) index.set(key, company);
  }),
);
resources.forEach((item, position) => {
  const existing = index.get(lookupKey(item.cn)) || index.get(lookupKey(item.name));
  if (existing) {
    existing.role = item.role;
    existing.domains = item.domains;
    existing.verification = "verified_official";
    existing.website = item.url;
    existing.evidence_url = item.url;
    existing.evidence_summary = item.use;
    return;
  }
  const company = {
    stable_id: `official-${String(position + 1).padStart(3, "0")}`,
    company: item.cn,
    company_norm: legalKey(item.cn),
    aliases: item.name === item.cn ? [] : [item.name],
    role: item.role,
    domains: item.domains,
    region: "海外/国际",
    verification: "verified_official",
    website: item.url,
    evidence_url: item.url,
    evidence_summary: item.use,
    source_kind: "seed",
  };
  companies.push(company);
  index.set(lookupKey(company.company), company);
});

if (statusPath) {
  const statusSource = await readFile(statusPath, "utf8");
  const statusContext = { window: {} };
  vm.runInNewContext(statusSource, statusContext, { filename: statusPath });
  const statuses = statusContext.window.GDIBAO_OFFICIAL_STATUS?.byName || {};
  for (const company of companies) {
    const status = statuses[lookupKey(company.company)];
    if (!status) continue;
    company.verification = "verified_official";
    company.website = status.url || company.website;
    company.evidence_url = status.url || company.evidence_url;
    company.evidence_summary ||= "企业画像与官网页面主体归属核验记录";
  }
}

const seen = new Set();
for (const company of companies) {
  if (!company.company_norm || seen.has(company.company_norm)) {
    throw new Error(`duplicate conservative legal key: ${company.company}`);
  }
  seen.add(company.company_norm);
}
await writeFile(
  outputPath,
  `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), companies }, null, 2)}\n`,
);
console.log(JSON.stringify({ companies: companies.length, verified: companies.filter((item) => item.verification === "verified_official" && item.website).length }));
