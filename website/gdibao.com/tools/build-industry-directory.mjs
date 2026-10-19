import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(siteRoot, "..");

const inputs = {
  cseac: path.join(workspaceRoot, "cseac-kg/out/exhibitor-entities.jsonl"),
  relations: path.join(workspaceRoot, "cseac-kg/out/exhibitor-relations.jsonl"),
  qualified: path.join(workspaceRoot, "badge-apply/tools/vendors.json"),
  expanded: path.join(
    workspaceRoot,
    "work/vendor-expansion/companies-expanded.json",
  ),
};

const sourceDefinitions = [
  {
    id: "cseac-2026",
    label: "CSEAC 2026 展商名单",
    kind: "exhibition",
    verification: "source_listed",
  },
  {
    id: "existing-vendor-list-20260911",
    label: "既有半导体企业名单",
    kind: "directory",
    verification: "source_listed",
  },
  {
    id: "vendor-expansion-20260911",
    label: "历史扩展企业名单",
    kind: "research",
    verification: "unverified",
  },
];

const officialOverrides = new Map(
  [
    {
      name: "上海正帆科技股份有限公司",
      aliases: ["正帆科技", "GenTech"],
      role: "工程集成商",
      domains: ["gas", "chemical", "vacuum", "commissioning"],
      use: "面向集成电路等行业提供高纯气体、湿化学品供应及尾气处理等制程关键系统。",
      url: "https://www.gentechindustries.com/",
      region: "中国",
    },
    {
      name: "上海至纯洁净系统科技股份有限公司",
      aliases: ["至纯科技", "PNC"],
      role: "工程集成商",
      domains: ["gas", "chemical", "construction", "commissioning"],
      use: "为泛半导体工厂提供高纯工艺系统、湿法设备及相关工程服务。",
      url: "https://www.pncs.cn/",
      region: "中国",
    },
    {
      name: "吉姆西半导体科技（无锡）股份有限公司",
      aliases: ["吉姆西半导体", "GMC Semitech"],
      role: "设备与服务商",
      domains: ["chemical", "vacuum", "commissioning", "troubleshooting"],
      use: "半导体设备研发制造、设备再制造、供液系统、Local Scrubber 及工程技术服务。",
      url: "https://www.gmcstech.com/",
      region: "中国",
    },
    {
      name: "上海华虹宏力半导体制造有限公司",
      aliases: ["华虹宏力"],
      role: "晶圆制造终端用户",
      domains: [],
      use: "华虹集团旗下晶圆制造法人；作为 Fab 终端用户收录，不标记为配套集成商。",
      url: "https://www.huahong.com.cn/?id=36&m=channel",
      region: "中国",
    },
    {
      name: "华虹半导体（无锡）有限公司",
      aliases: ["华虹无锡"],
      role: "晶圆制造终端用户",
      domains: [],
      use: "华虹集团旗下无锡晶圆制造法人；作为 Fab 终端用户收录，不标记为配套集成商。",
      url: "https://www.huahong.com.cn/?id=36&m=channel",
      region: "中国",
    },
    {
      name: "长江存储科技有限责任公司",
      aliases: ["长江存储", "YMTC"],
      role: "存储制造终端用户",
      domains: [],
      use: "集芯片设计、晶圆制造、封装测试及系统方案于一体的存储器 IDM 企业。",
      url: "https://www.ymtc.com/cn/intro.html",
      region: "中国",
    },
  ].map((item) => [normalizeName(item.name), item]),
);

function normalizeName(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•・,，.。/\\|\-_—–'‘’"“”()（）\[\]【】]/g, "");
}

function looseName(value = "") {
  return normalizeName(value).replace(
    /(有限责任公司|股份有限公司|集团有限公司|有限公司|集团|公司)$/,
    "",
  );
}

function stableId(name) {
  return `co-${createHash("sha256").update(normalizeName(name)).digest("hex").slice(0, 16)}`;
}

function recordId(sourceId, index, name) {
  return `${sourceId}-${String(index + 1).padStart(5, "0")}-${createHash("sha256")
    .update(name)
    .digest("hex")
    .slice(0, 8)}`;
}

function safeAliases(values, canonicalName) {
  const canonical = normalizeName(canonicalName);
  return [...new Set((values || []).map((value) => String(value).trim()))]
    .filter(Boolean)
    .filter((value) => normalizeName(value) !== canonical)
    .filter((value) => !value.includes("@"))
    .filter((value) => !/^https?:\/\//i.test(value))
    .filter((value) => !/^(?:\+?86[- ]?)?1\d{10}$/.test(value.replace(/\s/g, "")))
    .slice(0, 12);
}

function roleFromCategory(category = "") {
  if (category === "EU最终用户" || category === "晶圆")
    return "晶圆制造终端用户";
  if (category === "封测") return "封装测试终端用户";
  if (category === "高校与机构" || category === "研究所")
    return "研究与行业机构";
  if (category === "EPCSI软件") return "工程集成与软件服务";
  if (/材料|零部件|仪器仪表/.test(category)) return "材料与部件厂商";
  if (/设备|OEM|自动化/.test(category)) return "设备制造商";
  return "待分类";
}

function domainsFromCategory(category = "") {
  if (category === "厂务设备") return ["fab"];
  if (category === "仪器仪表") return ["instrument"];
  if (category === "自动化与FA") return ["plc", "instrument", "ot"];
  if (category === "EPCSI软件") return ["fab", "cad", "construction"];
  return [];
}

function domesticFromName(name) {
  return /(有限公司|股份有限公司|研究所|大学|学院)$/.test(name)
    ? "中国"
    : "待核";
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const [entitiesText, relationsText, qualifiedText, expandedText] =
  await Promise.all(Object.values(inputs).map((input) => readFile(input, "utf8")));
const cseac = parseJsonLines(entitiesText).filter(
  (record) => record.type === "Company",
);
const relations = parseJsonLines(relationsText);
const qualified = JSON.parse(qualifiedText);
const expanded = JSON.parse(expandedText);

const locations = new Map(
  relations
    .filter((relation) => relation.type === "LOCATED_IN")
    .map((relation) => [normalizeName(relation.from), String(relation.to).trim()]),
);
const companies = new Map();
const exhibitions = [];

function mergeRecord({
  aliases,
  category,
  name,
  recordId: sourceRecordId,
  sourceId,
  verification,
}) {
  if (!name || typeof name !== "string") return;
  const key = normalizeName(name);
  if (!key) return;
  const current = companies.get(key) || {
    id: stableId(name),
    name: name.trim(),
    aliases: [],
    categories: [],
    role: "待分类",
    domains: [],
    region: locations.get(key) || domesticFromName(name.trim()),
    verification: "unverified",
    sourceRefs: [],
  };
  current.aliases = safeAliases(
    [...current.aliases, ...(aliases || [])],
    current.name,
  );
  if (category && !current.categories.includes(category))
    current.categories.push(category);
  const mappedRole = roleFromCategory(category);
  if (current.role === "待分类" && mappedRole !== "待分类")
    current.role = mappedRole;
  current.domains = [
    ...new Set([...current.domains, ...domainsFromCategory(category)]),
  ];
  if (verification === "source_listed")
    current.verification = "source_listed";
  current.sourceRefs.push({ sourceId, recordId: sourceRecordId });
  companies.set(key, current);
}

cseac.forEach((record, index) => {
  const sourceRecordId = recordId("cseac", index, record.name);
  mergeRecord({
    name: record.name,
    aliases: record.aliases,
    category: record.category || "待分类",
    sourceId: "cseac-2026",
    recordId: sourceRecordId,
    verification: "source_listed",
  });
  exhibitions.push({
    id: `ex-${sourceRecordId}`,
    companyId: stableId(record.name),
    event: "CSEAC 2026",
    booth: record.booth || "",
    category: record.category || "待分类",
    sourceId: "cseac-2026",
  });
});

qualified.forEach((record, index) =>
  mergeRecord({
    name: record.company,
    aliases: record.aliases,
    category: record.category || "待分类",
    sourceId: "existing-vendor-list-20260911",
    recordId: recordId("vendor", index, record.company),
    verification: "source_listed",
  }),
);

expanded.forEach((record, index) =>
  mergeRecord({
    name: record.name,
    aliases: record.aliases,
    category: record.category || "待分类",
    sourceId: "vendor-expansion-20260911",
    recordId: recordId("expansion", index, record.name),
    verification: "unverified",
  }),
);

for (const [key, override] of officialOverrides) {
  const company = companies.get(key);
  if (!company) continue;
  company.aliases = safeAliases(
    [...company.aliases, ...override.aliases],
    company.name,
  );
  company.role = override.role;
  company.domains = override.domains;
  company.use = override.use;
  company.url = override.url;
  company.region = override.region;
  company.verification = "verified_official";
}

const companyList = [...companies.values()]
  .map((company) => ({
    ...company,
    aliases: company.aliases.sort((a, b) => a.localeCompare(b, "zh-CN")),
    categories: company.categories.sort((a, b) => a.localeCompare(b, "zh-CN")),
    domains: company.domains.sort(),
    sourceRefs: company.sourceRefs.sort((a, b) =>
      `${a.sourceId}:${a.recordId}`.localeCompare(`${b.sourceId}:${b.recordId}`),
    ),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

const looseGroups = new Map();
for (const company of companyList) {
  const key = looseName(company.name);
  if (!key) continue;
  looseGroups.set(key, [...(looseGroups.get(key) || []), company.id]);
}
const possibleDuplicateGroups = [...looseGroups.values()].filter(
  (ids) => ids.length > 1,
).length;

const output = {
  schemaVersion: 1,
  generatedAt: "2026-09-24T00:00:00Z",
  sources: sourceDefinitions,
  stats: {
    rawRecords: cseac.length + qualified.length + expanded.length,
    uniqueCompanies: companyList.length,
    exhibitions: exhibitions.length,
    possibleDuplicateGroups,
    verifiedOfficial: companyList.filter(
      (company) => company.verification === "verified_official",
    ).length,
    sourceListed: companyList.filter(
      (company) => company.verification === "source_listed",
    ).length,
    unverified: companyList.filter(
      (company) => company.verification === "unverified",
    ).length,
    awaitingDomainClassification: companyList.filter(
      (company) => company.domains.length === 0,
    ).length,
  },
  companies: companyList,
  exhibitions: exhibitions.sort((a, b) =>
    `${a.event}:${a.booth}:${a.companyId}`.localeCompare(
      `${b.event}:${b.booth}:${b.companyId}`,
    ),
  ),
};

const serialized = `window.GDIBAO_INDUSTRY_DIRECTORY = ${JSON.stringify(output)};\n`;
await writeFile(
  path.join(siteRoot, "assets/industry-directory-data.js"),
  serialized,
  "utf8",
);

console.log(JSON.stringify(output.stats, null, 2));
