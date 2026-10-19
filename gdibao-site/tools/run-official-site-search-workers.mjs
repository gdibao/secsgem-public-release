#!/usr/bin/env node
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
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
const worksetPath = resolve(
  options.workset ||
    "work/industry-official-site-search-v2/baseline-workset.json",
);
const root = resolve(
  options.output || "work/industry-official-site-search-v2/machine-run",
);
const resultDir = `${root}/results`;
const failurePath = `${root}/failures.jsonl`;
const logPath = `${root}/events.jsonl`;
const statusPath = `${root}/status.json`;
const lockPath = `${root}/run.lock`;
const searchConcurrency = Math.max(
  1,
  Math.min(4, Number(options["search-concurrency"] || 2)),
);
const fetchConcurrency = Math.max(
  1,
  Math.min(24, Number(options["fetch-concurrency"] || 12)),
);
const workerConcurrency = Math.max(
  1,
  Math.min(16, Number(options.workers || 8)),
);
const searchDelayMs = Math.max(1200, Number(options["search-delay"] || 2200));
const domainDelayMs = Math.max(250, Number(options["domain-delay"] || 750));
const limit = Math.max(0, Number(options.limit || 0));
const candidateLimit = Math.max(1, Math.min(8, Number(options.candidates || 5)));
const retryFailures = options["retry-failures"] === "true";
const startedAt = new Date().toISOString();
await mkdir(resultDir, { recursive: true });

const lock = await open(lockPath, "wx").catch((error) => {
  if (error.code === "EEXIST") {
    throw new Error(`worker lock already exists: ${lockPath}`);
  }
  throw error;
});
await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt })}\n`);
await lock.close();

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}
const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const normalize = (value = "") =>
  String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "");
const legalStem = (value = "") =>
  normalize(value).replace(
    /(有限责任公司|股份有限公司|集团有限公司|有限公司|股份公司|集团公司|公司)$/u,
    "",
  );
let atomicSequence = 0;
const writeAtomicJson = async (path, value) => {
  atomicSequence += 1;
  const temporary = `${path}.${process.pid}.${atomicSequence}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};
const appendEvent = (path, event) =>
  appendFile(path, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);

const semaphore = (size) => {
  let active = 0;
  const waiting = [];
  const acquire = async () => {
    if (active < size) {
      active += 1;
      return;
    }
    await new Promise((resolvePromise) => waiting.push(resolvePromise));
    active += 1;
  };
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return async (operation) => {
    await acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  };
};
const withSearchSlot = semaphore(searchConcurrency);
const withFetchSlot = semaphore(fetchConcurrency);
const nextAllowedAt = new Map();
const rateLimit = async (key, delay) => {
  const now = Date.now();
  const allowed = Math.max(now, nextAllowedAt.get(key) || 0);
  nextAllowedAt.set(key, allowed + delay);
  if (allowed > now) await sleep(allowed - now);
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
  return !/^(fc|fd|fe8|fe9|fea|feb)/i.test(address.replaceAll(":", ""));
};
const validateUrl = async (value) => {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("invalid_url");
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("invalid_port");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error("non_public_address");
  url.hash = "";
  return url;
};
const fetchBounded = async (value, limit = 262144) => {
  let current = await validateUrl(value);
  const history = [];
  for (let redirect = 0; redirect < 6; redirect += 1) {
    current = await validateUrl(current.href);
    await rateLimit(current.hostname, domainDelayMs);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(18000),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        "User-Agent": "GDIBAO-Directory-Verification/3.0",
      },
    });
    history.push({ url: current.href, status: response.status });
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      current = await validateUrl(new URL(location, current).href);
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
const fetchWithRetry = async (value, limit, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchBounded(value, limit);
      if (
        ![408, 425, 429, 500, 502, 503, 504].includes(response.status) ||
        attempt === attempts
      )
        return response;
      lastError = new Error(`retryable_http_${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await sleep(1000 * 2 ** (attempt - 1));
  }
  throw lastError || new Error("request_failed");
};

const excludedHosts =
  /(^|\.)(bing|baidu|google|wikipedia|zhihu|douyin|bilibili|weibo|qcc|tianyancha|aiqicha|51sole|gongkong|cnverify|made-in-china|yellowpages|linkedin|facebook|instagram|youtube|douban|sohu|163|qq)\./i;
const extractCandidates = (html, base) => {
  const output = [];
  const patterns = [
    /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"/gi,
    /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"#]+)"/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try {
        const url = new URL(match[1].replaceAll("&amp;", "&"), base);
        if (excludedHosts.test(url.hostname)) continue;
        url.hash = "";
        if (!output.includes(url.href)) output.push(url.href);
      } catch {}
      if (output.length >= 10) break;
    }
    if (output.length >= 10) break;
  }
  return output;
};
const queryPlan = (record) => {
  const alias = record.aliases.find(
    (value) => legalStem(value).length >= 3 && normalize(value) !== normalize(record.company),
  );
  const keyword = record.sourceDomains[0] || record.sourceRole || "半导体";
  return [...new Set([
    `"${record.company}" 官网`,
    /[A-Za-z]/.test(record.company) && !/[\u3400-\u9fff]/.test(record.company)
      ? `"${record.company}" official website ${keyword}`
      : `"${record.company}" 官方网站 ${keyword}`,
    alias ? `"${alias}" ${keyword} 官网` : `"${record.company}" 公司介绍`,
  ])].map((query, index) => ({
    channel: index === 1 ? "bing-global" : "bing-cn",
    query,
    url:
      index === 1
        ? `https://www.bing.com/search?ensearch=1&q=${encodeURIComponent(query)}`
        : `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
  }));
};
const extractEvidenceLinks = (html, baseUrl) => {
  const base = new URL(baseUrl);
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1].replaceAll("&amp;", "&"), base);
      if (url.hostname !== base.hostname) continue;
      const label = match[2].replace(/<[^>]+>/g, " ");
      if (!/(about|company|contact|legal|imprint|profile|关于|公司|联系|简介|企业)/i.test(`${url.pathname} ${label}`))
        continue;
      url.hash = "";
      if (!links.includes(url.href)) links.push(url.href);
    } catch {}
    if (links.length >= 3) break;
  }
  return links;
};

const workset = JSON.parse(await readFile(worksetPath, "utf8"));
if (workset.baselineTotal !== 1955 || !workset.invariants?.stateMatchesSeed)
  throw new Error("workset baseline invariant failed");
const completed = new Set();
for (const name of (await readdir(resultDir)).filter((value) => value.endsWith(".json"))) {
  const id = name.slice(0, -5);
  if (!retryFailures) {
    completed.add(id);
    continue;
  }
  const previous = JSON.parse(await readFile(`${resultDir}/${name}`, "utf8"));
  if (!["rate_limited", "search_failed", "worker_error"].includes(previous.outcome))
    completed.add(id);
}
let queue = workset.records.filter(
  (record) => !record.ownershipVerified && !record.deepCoverage && !completed.has(record.id),
);
if (limit) queue = queue.slice(0, limit);
const targetAtStart = queue.length;
let processed = 0;
let active = 0;
const outcomes = {};
const startedMs = Date.now();

const writeStatus = async (state = "running") => {
  const elapsedSeconds = Math.max(1, (Date.now() - startedMs) / 1000);
  const ratePerHour = (processed / elapsedSeconds) * 3600;
  await writeAtomicJson(statusPath, {
    schemaVersion: 1,
    state,
    pid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    baselineTotal: workset.baselineTotal,
    reusedOwnershipVerified: workset.counts.reusedOwnershipVerified,
    reusedDeepDisposition: workset.counts.deepDisposition,
    targetAtStart,
    processedThisRun: processed,
    active,
    remainingThisRun: Math.max(0, targetAtStart - processed - active),
    outcomes,
    concurrency: {
      workers: workerConcurrency,
      search: searchConcurrency,
      fetch: fetchConcurrency,
      searchDelayMs,
      perDomainDelayMs: domainDelayMs,
    },
    throughputPerHour: Number(ratePerHour.toFixed(2)),
    etaHours:
      ratePerHour > 0
        ? Number(((targetAtStart - processed) / ratePerHour).toFixed(2))
        : null,
  });
};

const processRecord = async (record) => {
  const result = {
    schemaVersion: 3,
    id: record.id,
    company: record.company,
    aliases: record.aliases,
    startedAt: new Date().toISOString(),
    oldCoverage: record.oldCoverage,
    queries: [],
    candidates: [],
  };
  const discovered = new Map();
  for (const item of queryPlan(record)) {
    if (stopping) break;
    const requestedAt = new Date().toISOString();
    try {
      const response = await withSearchSlot(async () => {
        await rateLimit(new URL(item.url).hostname, searchDelayMs);
        return fetchWithRetry(item.url, 524288);
      });
      const blocked =
        [403, 429].includes(response.status) ||
        /captcha|验证码|unusual traffic|challenge-form/i.test(response.text);
      const candidates = blocked ? [] : extractCandidates(response.text, response.url);
      result.queries.push({ ...item, requestedAt, httpStatus: response.status, blocked, candidates });
      for (const candidate of candidates) {
        const queries = discovered.get(candidate) || [];
        queries.push(item.query);
        discovered.set(candidate, queries);
      }
      if (blocked) await sleep(searchDelayMs * 4);
    } catch (error) {
      result.queries.push({ ...item, requestedAt, error: error.message || error.name, candidates: [] });
    }
  }
  for (const [candidateUrl, sourceQueries] of [...discovered.entries()].slice(0, candidateLimit)) {
    if (stopping) break;
    const evidence = { candidateUrl, sourceQueries, checkedAt: new Date().toISOString(), pages: [] };
    try {
      const first = await withFetchSlot(() => fetchWithRetry(candidateUrl));
      const inspectedPages = [];
      const inspectPage = (page) => {
        const plain = page.text.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
          .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ");
        const normalized = normalize(plain);
        const exactLegalNameMatched = normalized.includes(normalize(record.company));
        const matchedAliases = record.aliases.filter(
          (alias) => legalStem(alias).length >= 4 && normalized.includes(legalStem(alias)),
        );
        const companyIndex = normalized.indexOf(normalize(record.company));
        const ownershipMarkers = ["版权所有", "copyright", "主办单位", "网站所有者", "legalnotice", "imprint"];
        const ownershipSignal =
          exactLegalNameMatched &&
          ownershipMarkers.some((marker) => {
            const markerIndex = normalized.indexOf(normalize(marker));
            return markerIndex >= 0 && Math.abs(markerIndex - companyIndex) <= 160;
          });
        return {
          url: page.url,
          status: page.status,
          exactLegalNameMatched,
          matchedAliases,
          ownershipSignal,
        };
      };
      inspectedPages.push(inspectPage(first));
      for (const evidenceUrl of extractEvidenceLinks(first.text, first.url)) {
        try {
          const page = await withFetchSlot(() => fetchWithRetry(evidenceUrl));
          inspectedPages.push(inspectPage(page));
        } catch (error) {
          inspectedPages.push({ url: evidenceUrl, error: error.message || error.name });
        }
      }
      evidence.pages = inspectedPages;
      const exactLegalNameMatched = inspectedPages.some((page) => page.exactLegalNameMatched);
      const matchedAliases = [...new Set(inspectedPages.flatMap((page) => page.matchedAliases || []))];
      const ownershipSignal = inspectedPages.some((page) => page.ownershipSignal);
      evidence.finalUrl = first.url;
      evidence.httpStatus = first.status;
      evidence.exactLegalNameMatched = exactLegalNameMatched;
      evidence.matchedAliases = matchedAliases;
      evidence.ownershipSignal = ownershipSignal;
      evidence.decision =
        first.status < 200 || first.status >= 400
          ? "reject_http_status"
          : ownershipSignal
            ? "high_confidence_ownership_signal"
            : exactLegalNameMatched
              ? "needs_review_exact_name"
            : matchedAliases.length
              ? "needs_review_alias_only"
              : "reject_name_not_found";
    } catch (error) {
      evidence.decision = "fetch_failed";
      evidence.error = error.message || error.name;
    }
    result.candidates.push(evidence);
  }
  const high = result.candidates.filter((item) => item.decision === "high_confidence_ownership_signal");
  const review = result.candidates.filter((item) =>
    ["needs_review_exact_name", "needs_review_alias_only"].includes(item.decision),
  );
  const blocked = result.queries.some((item) => item.blocked);
  const failedQueries = result.queries.filter((item) => item.error).length;
  result.completedAt = new Date().toISOString();
  result.outcome = high.length
    ? "high_confidence_candidate"
    : review.length
      ? "needs_review"
      : blocked
        ? "rate_limited"
        : failedQueries === result.queries.length
          ? "search_failed"
          : discovered.size
            ? "ambiguous"
            : "no_result";
  result.reviewCandidates = [...high, ...review].map((item) => item.finalUrl || item.candidateUrl);
  result.note = "机器结果不自动认证或发布；高置信候选仍需规则抽样与官方主体证据审查。";
  await writeAtomicJson(`${resultDir}/${record.id}.json`, result);
  await appendEvent(logPath, {
    event: "company_completed",
    id: record.id,
    outcome: result.outcome,
    queryCount: result.queries.length,
    candidateCount: result.candidates.length,
  });
  if (["rate_limited", "search_failed"].includes(result.outcome)) {
    await appendEvent(failurePath, { id: record.id, outcome: result.outcome });
  }
  return result.outcome;
};

await appendEvent(logPath, {
  event: "run_started",
  pid: process.pid,
  targetAtStart,
  searchConcurrency,
  fetchConcurrency,
  workerConcurrency,
});
await writeStatus();
let cursor = 0;
const workers = Array.from({ length: workerConcurrency }, async () => {
  while (!stopping) {
    const index = cursor;
    cursor += 1;
    if (index >= queue.length) break;
    const record = queue[index];
    active += 1;
    try {
      const outcome = await processRecord(record);
      outcomes[outcome] = (outcomes[outcome] || 0) + 1;
    } catch (error) {
      outcomes.worker_error = (outcomes.worker_error || 0) + 1;
      await appendEvent(failurePath, {
        id: record.id,
        outcome: "worker_error",
        error: error.message || error.name,
      });
    } finally {
      active -= 1;
      processed += 1;
      await writeStatus();
    }
  }
});
await Promise.all(workers);
const finalState = stopping ? "stopped" : "completed";
await writeStatus(finalState);
await appendEvent(logPath, { event: `run_${finalState}`, processed, outcomes });
await rm(lockPath, { force: true });
console.log(JSON.stringify(JSON.parse(await readFile(statusPath, "utf8")), null, 2));
