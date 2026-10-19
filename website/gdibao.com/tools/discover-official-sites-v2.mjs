#!/usr/bin/env node
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
const resultDir = `${outputRoot}/results`;
const ledgerPath = `${outputRoot}/ledger.jsonl`;
const checkpointPath = `${outputRoot}/checkpoint.json`;
const batchSize = Math.max(1, Math.min(50, Number(options.batch || 10)));
const delayMs = Math.max(1500, Number(options.delay || 2500));
const candidateLimit = Math.max(
  1,
  Math.min(10, Number(options.candidates || 5)),
);
await mkdir(resultDir, { recursive: true });

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const cleanText = (value = "") =>
  String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "");
const matchText = (value = "") =>
  cleanText(value).replace(
    /(有限责任公司|股份有限公司|集团有限公司|有限公司|股份公司|集团公司|公司)$/u,
    "",
  );
const writeAtomicJson = async (path, value) => {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};
const isPublicAddress = (address) => {
  if (!isIP(address)) return false;
  if (
    address === "::1" ||
    address === "0.0.0.0" ||
    address.startsWith("127.") ||
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    address.startsWith("169.254.")
  )
    return false;
  const octets = address.split(".").map(Number);
  if (
    octets.length === 4 &&
    octets[0] === 172 &&
    octets[1] >= 16 &&
    octets[1] <= 31
  )
    return false;
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(address.replaceAll(":", "")))
    return false;
  return true;
};
const validateUrl = async (value) => {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("invalid_url");
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("invalid_port");
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new Error("non_public_address");
  url.hash = "";
  return url;
};
const fetchBounded = async (value, limit = 196608) => {
  let current = await validateUrl(value);
  const history = [];
  for (let redirect = 0; redirect < 6; redirect += 1) {
    current = await validateUrl(current.href);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        "User-Agent": "GDIBAO-Directory-Verification/2.0",
      },
    });
    history.push({ url: current.href, status: response.status });
    if (
      [301, 302, 303, 307, 308].includes(response.status) &&
      response.headers.get("location")
    ) {
      current = await validateUrl(
        new URL(response.headers.get("location"), current).href,
      );
      continue;
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    while (reader && size < limit) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
      size += chunk.byteLength;
    }
    await reader?.cancel().catch(() => {});
    return {
      url: current.href,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
        .subarray(0, limit)
        .toString("utf8"),
      history,
    };
  }
  throw new Error("too_many_redirects");
};

const excludedHosts =
  /(^|\.)(baidu|google|microsoft|wikipedia|zhihu|douyin|bilibili|weibo|qcc|tianyancha|aiqicha|1688|made-in-china|yellowpages|linkedin|facebook|instagram|youtube|douban|iqiyi|youku)\./i;
const isSearchRedirect = (url) =>
  (/bing\.com$/i.test(url.hostname) && url.pathname.startsWith("/ck/")) ||
  (/sogou\.com$/i.test(url.hostname) && url.pathname === "/link");
const extractSearchCandidates = (html, baseUrl) => {
  const urls = [];
  const patterns = [
    /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"/gi,
    /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"#]+)"/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try {
        const url = new URL(
          match[1].replaceAll("&amp;", "&"),
          baseUrl,
        );
        if (!isSearchRedirect(url) && excludedHosts.test(url.hostname)) continue;
        url.hash = "";
        if (!urls.includes(url.href)) urls.push(url.href);
      } catch {
        // Ignore malformed result links.
      }
      if (urls.length >= 10) break;
    }
    if (urls.length >= 10) break;
  }
  return urls;
};
const isLatinName = (value) => /[A-Za-z]/.test(value) && !/[\u3400-\u9fff]/.test(value);
const queryPlan = (entry, seed) => {
  const aliases = [...new Set([...(entry.aliases || []), ...(seed.aliases || [])])]
    .filter((value) => matchText(value).length >= 3)
    .filter((value) => cleanText(value) !== cleanText(entry.company));
  const keyword = seed.role || seed.domains?.[0] || "半导体";
  const queryValues = [
    `${entry.company} 官方网站`,
    isLatinName(entry.company)
      ? `"${entry.company}" official website semiconductor`
      : `${entry.company} 官网`,
    aliases.length
      ? `${aliases[0]} ${keyword} 官网`
      : `${entry.company} ${keyword} 公司介绍`,
  ];
  const unique = [...new Set(queryValues)];
  return unique.map((query, index) => {
    const channel =
      index === 1 && isLatinName(entry.company) ? "bing-global" : "sogou";
    const url =
      channel === "bing-global"
        ? `https://www.bing.com/search?ensearch=1&q=${encodeURIComponent(query)}`
        : `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;
    return { channel, query, url };
  });
};

const state = JSON.parse(await readFile(`${sourceRoot}/state.json`, "utf8"));
const seed = JSON.parse(await readFile(`${sourceRoot}/seed-directory.json`, "utf8"));
const seedById = new Map(
  seed.companies.map((company) => [company.stable_id, company]),
);
const completed = new Set(
  (await readdir(resultDir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5)),
);
const pendingStatuses = new Set([
  "ambiguous",
  "candidate_unconfirmed",
  "candidate_unreachable",
  "not_found",
  "search_blocked",
  "verified_unreachable",
]);
const eligible = Object.values(state.entries)
  .filter((entry) => pendingStatuses.has(entry.status) && !completed.has(entry.id))
  .sort(
    (left, right) =>
      left.company.localeCompare(right.company, "zh-CN") ||
      left.id.localeCompare(right.id, "en"),
  )
  .slice(0, batchSize);

let stopForRateLimit = false;
for (const entry of eligible) {
  const startedAt = new Date().toISOString();
  const seedEntry = seedById.get(entry.id) || {};
  const queries = queryPlan(entry, seedEntry);
  const queryEvidence = [];
  const candidateSources = new Map();
  for (const queryItem of queries) {
    const { channel, query, url } = queryItem;
    const requestedAt = new Date().toISOString();
    try {
      const response = await fetchBounded(url, 524288);
      const blocked =
        [403, 429].includes(response.status) ||
        /captcha|验证码|unusual traffic/i.test(response.text);
      const candidates = blocked
        ? []
        : extractSearchCandidates(response.text, response.url);
      queryEvidence.push({
        channel,
        query,
        url,
        requestedAt,
        httpStatus: response.status,
        blocked,
        candidates,
      });
      candidates.forEach((candidate) => {
        const current = candidateSources.get(candidate) || [];
        current.push(query);
        candidateSources.set(candidate, current);
      });
      if (blocked) {
        stopForRateLimit = true;
        break;
      }
    } catch (error) {
      queryEvidence.push({
        channel,
        query,
        url,
        requestedAt,
        error: error.message || error.name || "request_failed",
        candidates: [],
      });
    }
    await sleep(delayMs);
  }

  const names = [entry.company, ...(entry.aliases || []), ...(seedEntry.aliases || [])]
    .map((value) => ({ raw: value, match: matchText(value) }))
    .filter((item) => item.match.length >= 4);
  const candidateEvidence = [];
  for (const [candidateUrl, sourceQueries] of [...candidateSources.entries()].slice(
    0,
    candidateLimit,
  )) {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchBounded(candidateUrl);
      const pageText = matchText(response.text);
      const finalHost = new URL(response.url).hostname;
      const matchedNames = names
        .filter((name) => pageText.includes(name.match))
        .map((name) => name.raw);
      const exactLegalNameMatched = pageText.includes(cleanText(entry.company));
      candidateEvidence.push({
        candidateUrl,
        finalUrl: response.url,
        sourceQueries,
        checkedAt,
        httpStatus: response.status,
        exactLegalNameMatched,
        matchedNames,
        decision:
          excludedHosts.test(finalHost) || isSearchRedirect(new URL(response.url))
            ? "reject_non_official_host"
            : response.status < 200 || response.status >= 400
            ? "reject_http_status"
            : exactLegalNameMatched
              ? "ownership_candidate_exact_legal_name"
              : matchedNames.length
                ? "ownership_candidate_alias_only"
                : "reject_name_not_found",
      });
    } catch (error) {
      candidateEvidence.push({
        candidateUrl,
        sourceQueries,
        checkedAt,
        decision: "reject_fetch_error",
        error: error.message || error.name || "request_failed",
      });
    }
    await sleep(delayMs);
  }
  const exactCandidates = candidateEvidence.filter(
    (candidate) =>
      candidate.decision === "ownership_candidate_exact_legal_name",
  );
  const aliasCandidates = candidateEvidence.filter(
    (candidate) => candidate.decision === "ownership_candidate_alias_only",
  );
  const blocked = queryEvidence.some((query) => query.blocked);
  const result = {
    schemaVersion: 2,
    id: entry.id,
    company: entry.company,
    aliases: entry.aliases || [],
    priorStatus: entry.status,
    startedAt,
    completedAt: new Date().toISOString(),
    queries: queryEvidence,
    candidates: candidateEvidence,
    outcome: blocked
      ? "rate_limited"
      : exactCandidates.length
        ? "candidate_exact_legal_name"
        : aliasCandidates.length
          ? "candidate_alias_only"
          : candidateSources.size
            ? "ambiguous"
            : "no_result",
    reviewCandidates: [...exactCandidates, ...aliasCandidates].map(
      (candidate) => candidate.finalUrl || candidate.candidateUrl,
    ),
    note:
      "候选不自动发布；必须以官方公司介绍、法人或集团隶属页面完成归属交叉核验。",
  };
  await writeAtomicJson(`${resultDir}/${entry.id}.json`, result);
  await appendFile(
    ledgerPath,
    `${JSON.stringify({
      ts: result.completedAt,
      id: result.id,
      company: result.company,
      priorStatus: result.priorStatus,
      outcome: result.outcome,
      queryCount: result.queries.length,
      candidateCount: result.candidates.length,
      reviewCandidateCount: result.reviewCandidates.length,
    })}\n`,
  );
  if (stopForRateLimit) break;
}

const resultFiles = (await readdir(resultDir)).filter((name) =>
  name.endsWith(".json"),
);
const outcomeCounts = {};
for (const name of resultFiles) {
  const result = JSON.parse(await readFile(`${resultDir}/${name}`, "utf8"));
  outcomeCounts[result.outcome] = (outcomeCounts[result.outcome] || 0) + 1;
}
const checkpoint = {
  updatedAt: new Date().toISOString(),
  sourceTotal: Object.keys(state.entries).length,
  targetTotal: Object.values(state.entries).filter((entry) =>
    pendingStatuses.has(entry.status),
  ).length,
  completed: resultFiles.length,
  remaining:
    Object.values(state.entries).filter((entry) =>
      pendingStatuses.has(entry.status),
    ).length - resultFiles.length,
  processedThisRun: resultFiles.length - completed.size,
  stoppedForRateLimit: stopForRateLimit,
  outcomeCounts,
};
await writeAtomicJson(checkpointPath, checkpoint);
console.log(JSON.stringify(checkpoint, null, 2));
