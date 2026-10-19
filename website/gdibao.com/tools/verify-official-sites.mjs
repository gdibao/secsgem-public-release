#!/usr/bin/env node
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const root = resolve(options.root || "work/industry-official-site-verification");
const seedPath = resolve(options.seed || `${root}/seed-directory.json`);
const statePath = `${root}/state.json`;
const checkpointPath = `${root}/checkpoint.json`;
const ledgerPath = `${root}/ledger.jsonl`;
const cacheDir = `${root}/cache`;
const batchSize = Math.max(1, Math.min(200, Number(options.batch || 50)));
const enableSearch = options.search === "true";
const reviewCandidates = options["review-candidates"] === "true";
const delayMs = Math.max(750, Number(options.delay || 1500));
await mkdir(cacheDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const cleanText = (value = "") => String(value).normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, "");
const matchText = (value = "") => cleanText(value).replace(/(有限责任公司|股份有限公司|集团有限公司|有限公司|股份公司|集团公司|公司)$/u, "");
const isPublicAddress = (address) => {
  if (!isIP(address)) return false;
  if (address === "::1" || address === "0.0.0.0" || address.startsWith("127.")) return false;
  if (address.startsWith("10.") || address.startsWith("192.168.") || address.startsWith("169.254.")) return false;
  const octets = address.split(".").map(Number);
  if (octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(address.replaceAll(":", ""))) return false;
  return true;
};
const validateUrl = async (value) => {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid_url");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("invalid_port");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error("non_public_address");
  url.hash = "";
  return url;
};
const fetchBounded = async (value, { search = false } = {}) => {
  let current = await validateUrl(value);
  const history = [];
  for (let redirect = 0; redirect < 6; redirect += 1) {
    current = await validateUrl(current.href);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        "User-Agent": "GDIBAO-Directory-Verification/1.0",
      },
    });
    history.push({ url: current.href, status: response.status });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location")) {
      current = await validateUrl(new URL(response.headers.get("location"), current).href);
      continue;
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    while (reader && size < (search ? 524288 : 131072)) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
      size += chunk.byteLength;
    }
    await reader?.cancel().catch(() => {});
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(0, search ? 524288 : 131072);
    return {
      url: current.href,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text: bytes.toString("utf8"),
      history,
    };
  }
  throw new Error("too_many_redirects");
};
const extractSearchCandidates = (html) => {
  const urls = [];
  const regex = /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"/gi;
  for (const match of html.matchAll(regex)) {
    const value = match[1].replaceAll("&amp;", "&");
    try {
      const url = new URL(value);
      if (/bing\.com|microsoft\.com|baidu\.com|wikipedia\.org|qcc\.com|tianyancha\.com|企查查|黄页/.test(url.hostname)) continue;
      if (!urls.includes(url.href)) urls.push(url.href);
    } catch { /* ignore malformed search result */ }
    if (urls.length >= 5) break;
  }
  return urls;
};
const writeAtomicJson = async (path, value) => {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const seed = JSON.parse(await readFile(seedPath, "utf8"));
let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch {
  state = {
    schemaVersion: 1,
    seedGeneratedAt: seed.generatedAt,
    entries: Object.fromEntries(seed.companies.map((company) => [company.stable_id, {
      id: company.stable_id,
      company: company.company,
      aliases: company.aliases || [],
      seedWebsite: company.website || null,
      canonicalUrl: company.website || null,
      evidenceUrl: company.evidence_url || null,
      evidenceSummary: company.evidence_summary || null,
      verification: company.verification,
      status: company.website ? "queued_existing_url" : "queued_search",
      checkedAt: null,
      attempts: 0,
    }])),
  };
  await writeAtomicJson(statePath, state);
}

// Older runs used verified_unreachable for every supplied URL. Preserve the
// distinction between an already-proven official site and an unproven lead.
for (const entry of Object.values(state.entries)) {
  if (entry.status === "verified_unreachable" && entry.verification !== "verified_official") {
    entry.status = "candidate_unreachable";
  }
}

const eligible = Object.values(state.entries).filter((entry) =>
  entry.status === "queued_existing_url" ||
  (enableSearch && ["queued_search", "retry_search"].includes(entry.status)) ||
  (reviewCandidates && entry.status === "candidate_review"),
).slice(0, batchSize);
for (const entry of eligible) {
  const timestamp = new Date().toISOString();
  entry.attempts += 1;
  try {
    if (reviewCandidates && entry.status === "candidate_review") {
      const candidate = entry.candidateUrl || entry.canonicalUrl || entry.seedWebsite;
      if (!candidate) {
        entry.status = "candidate_unconfirmed";
        entry.evidenceSummary = "候选记录缺少可复核 URL，未确认官方归属。";
      } else {
        const result = await fetchBounded(candidate);
        entry.canonicalUrl = result.url;
        entry.httpStatus = result.status;
        const legalName = cleanText(entry.company);
        const pageText = cleanText(result.text);
        const exactLegalNameMatched = legalName.length >= 6 && pageText.includes(legalName);
        entry.exactLegalNameMatched = exactLegalNameMatched;
        if (result.status >= 200 && result.status < 400 && exactLegalNameMatched) {
          entry.status = "verified_accessible";
          entry.verification = "verified_official";
          entry.evidenceUrl = result.url;
          entry.evidenceSummary = "候选官网首页明确出现完整企业法人名称，官方归属复核通过。";
        } else {
          entry.status = result.status >= 200 && result.status < 400
            ? "candidate_unconfirmed"
            : "candidate_unreachable";
          entry.evidenceSummary = result.status >= 200 && result.status < 400
            ? "候选页可访问，但未稳定出现完整企业法人名称，官方归属未确认。"
            : `候选页本次访问返回 HTTP ${result.status}，官方归属未确认。`;
        }
      }
    } else if (entry.seedWebsite) {
      const result = await fetchBounded(entry.seedWebsite);
      entry.canonicalUrl = result.url;
      entry.httpStatus = result.status;
      if (result.status >= 200 && result.status < 400) {
        const names = [entry.company, ...entry.aliases].map(matchText).filter((value) => value.length >= 4);
        const pageText = matchText(result.text);
        const contentMatched = names.some((name) => pageText.includes(name));
        entry.contentNameMatched = contentMatched;
        if (entry.verification === "verified_official") {
          entry.status = "verified_accessible";
          entry.evidenceSummary ||= "既有目录官方归属核验记录";
        } else if (contentMatched && entry.ownershipDocumented) {
          entry.status = "verified_accessible";
          entry.verification = "verified_official";
        } else {
          entry.status = "candidate_review";
          entry.evidenceSummary ||= contentMatched
            ? "官网候选页包含企业全称或别名，仍需核对官方归属证据。"
            : "官网候选可访问，但页面正文未稳定匹配企业名称，需人工核对。";
        }
      } else {
        entry.status = entry.verification === "verified_official"
          ? "verified_unreachable"
          : "candidate_unreachable";
      }
    } else {
      const query = `${entry.company} 官方网站`;
      const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`;
      const searchResult = await fetchBounded(searchUrl, { search: true });
      if ([403, 429].includes(searchResult.status) || /captcha|验证码|unusual traffic/i.test(searchResult.text)) {
        entry.status = "search_blocked";
        entry.error = `search_http_${searchResult.status}`;
      } else {
        const candidates = extractSearchCandidates(searchResult.text);
        await writeAtomicJson(`${cacheDir}/${entry.id}.json`, { checkedAt: timestamp, query, candidates });
        const names = [entry.company, ...entry.aliases].map(matchText).filter((value) => value.length >= 4);
        let matched = null;
        for (const candidate of candidates) {
          try {
            const page = await fetchBounded(candidate);
            const pageText = matchText(page.text);
            if (page.status >= 200 && page.status < 400 && names.some((name) => pageText.includes(name))) {
              matched = { url: page.url, status: page.status };
              break;
            }
          } catch { /* candidate remains unverified */ }
        }
        if (matched) {
          entry.status = "candidate_review";
          entry.candidateUrl = matched.url;
          entry.httpStatus = matched.status;
          entry.evidenceUrl = searchUrl;
          entry.evidenceSummary = "公开搜索候选页包含企业全称或别名，仍需人工核对官方归属。";
        } else {
          entry.status = candidates.length ? "ambiguous" : "not_found";
          entry.evidenceUrl = searchUrl;
          entry.evidenceSummary = candidates.length ? "搜索结果存在候选，但未满足确定性名称匹配。" : "本次公开搜索未找到可核候选。";
        }
      }
    }
    delete entry.error;
  } catch (error) {
    if (reviewCandidates && entry.status === "candidate_review") {
      entry.status = "candidate_unreachable";
    } else if (entry.seedWebsite) {
      entry.status = entry.verification === "verified_official"
        ? "verified_unreachable"
        : "candidate_unreachable";
    } else {
      entry.status = "retry_search";
    }
    entry.error = error.message || error.name || "request_failed";
  }
  entry.checkedAt = timestamp;
  await appendFile(ledgerPath, `${JSON.stringify({ ts: timestamp, id: entry.id, company: entry.company, status: entry.status, canonicalUrl: entry.canonicalUrl, candidateUrl: entry.candidateUrl, evidenceUrl: entry.evidenceUrl, httpStatus: entry.httpStatus, error: entry.error })}\n`);
  await writeAtomicJson(statePath, state);
  await sleep(delayMs);
}

const counts = {};
for (const entry of Object.values(state.entries)) counts[entry.status] = (counts[entry.status] || 0) + 1;
const checkpoint = {
  updatedAt: new Date().toISOString(),
  total: Object.keys(state.entries).length,
  processedThisRun: eligible.length,
  searchEnabled: enableSearch,
  candidateReviewEnabled: reviewCandidates,
  counts,
};
await writeAtomicJson(checkpointPath, checkpoint);
console.log(JSON.stringify(checkpoint, null, 2));
