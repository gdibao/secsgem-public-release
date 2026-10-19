// 确定性管线（P13 §1.3 S1–S6）：解析→校验→转换→输出哈希（seal/canonical_json）。
import { createHash } from "node:crypto";
import {
  RunnerInput, RunnerResult, RunnerOutputFile, RUNNER_CORE_VERSION,
  TIMEOUTS_MS, LIMITS, ErrorCode,
} from "./contract";
import { validateSchema, validateRules, sha256 } from "./validator";
import { dxfAdapter } from "./formats/dxf";

// ---------- 幂等缓存（S3，P13 §1.6：TTL 7d，命中也留痕）----------
interface CacheEntry { input_sha256: string; result: RunnerResult; ts: number }
const CACHE = new Map<string, CacheEntry>();

function cacheGet(job_id: string, input_sha256: string): { hit: boolean; conflict?: boolean; result?: RunnerResult } {
  const e = CACHE.get(job_id);
  if (!e) return { hit: false };
  if (Date.now() - e.ts > LIMITS.CACHE_TTL_MS) { CACHE.delete(job_id); return { hit: false }; }
  if (e.input_sha256 !== input_sha256) return { hit: false, conflict: true };
  return { hit: true, result: e.result };
}

// ---------- canonical_json + result_hash（P13 §2.3）----------
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson((obj as Record<string, unknown>)[k])).join(",") + "}";
}

export function seal(r: Omit<RunnerResult, "result_hash">): RunnerResult {
  const { result_hash, ...rest } = r as RunnerResult;   // 剥离既有 hash 后重算
  const hash = sha256(canonicalJson(rest)).toString();
  return { ...rest, result_hash: hash };
}

export const err = (code: ErrorCode, message: string, detail?: string) => ({ code, message, detail });

export function reject(job_id: string, e: { code: ErrorCode; message: string; detail?: string }): RunnerResult {
  const now = new Date().toISOString();
  return seal({ job_id, status: "rejected", error: err(e.code, e.message, e.detail), outputs: [], stats: {}, started_at: now, finished_at: now, warnings: [], core_version: RUNNER_CORE_VERSION });
}

// ---------- 主入口：runJob ----------

// ---------- 默认输入加载器（R2 修正：route 未传 loadInput 时兜底；三口共用） ----------
import path from "node:path";
import { readFile } from "node:fs/promises";
import { WORKSPACE_ROOTS } from "./validator";

async function defaultLoadInput(i: RunnerInput): Promise<Buffer | undefined> {
  const ref = i?.input_ref;
  if (!ref) return undefined;
  if (ref.kind === "inline_base64") {
    return Buffer.from((ref as { data?: string }).data || "", "base64");
  }
  if (ref.kind === "workspace_file") {
    const p = (ref as { path?: string }).path || "";
    const norm = path.normalize(p);
    const inside = WORKSPACE_ROOTS.some(r => norm.startsWith(r + "/") || norm.startsWith(r + path.sep));
    if (!inside || norm.includes("..")) throw new Error("E403 path escapes whitelist");
    return readFile(norm);
  }
  return undefined;
}

export async function runJob(input: unknown, loadInput?: (i: RunnerInput) => Promise<Buffer>): Promise<RunnerResult> {
  const started = new Date().toISOString();
  const pre = input as RunnerInput;
  // S1 schema
  const se = validateSchema(input);
  if (se) return pre?.job_id ? reject(pre.job_id, se) : seal({ job_id: "unknown", status: "rejected", error: err(se.code, se.message), outputs: [], stats: {}, started_at: started, finished_at: started, warnings: [], core_version: RUNNER_CORE_VERSION });
  // S2 规则（含哈希/大小/组合/路径）
  let inputBytes: Buffer | undefined;
  inputBytes = await (loadInput || defaultLoadInput)(pre);
  const re = validateRules(pre, inputBytes);
  if (re) return reject(pre.job_id, re);
  // S3 幂等
  const c = cacheGet(pre.job_id, pre.input_sha256);
  if (c.conflict) return reject(pre.job_id, err("E409", "same job_id different input_sha256"));
  if (c.hit && c.result) { c.result.warnings = [...c.result.warnings, "cache_hit=true"]; return c.result; }
  // S4/S5 执行（超时由 adapter 层约束）
  let result: RunnerResult;
  try {
    const timeoutMs = TIMEOUTS_MS[pre.operation];
    result = await withTimeout(dxfAdapter(pre, inputBytes!), timeoutMs);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code: ErrorCode = msg.includes("timeout") ? "E529" : "E501";
    result = seal({ job_id: pre.job_id, status: "failed", error: err(code, msg), outputs: [], stats: {}, started_at: started, finished_at: new Date().toISOString(), warnings: [], core_version: RUNNER_CORE_VERSION });
    CACHE.set(pre.job_id, { input_sha256: pre.input_sha256, result, ts: Date.now() });
    return result;
  }
  // S6 seal + 缓存
  const sealed = seal({ ...result, started_at: started, finished_at: new Date().toISOString() });
  CACHE.set(pre.job_id, { input_sha256: pre.input_sha256, result: sealed, ts: Date.now() });
  return sealed;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

// ---------- 确定性渲染锚点（DXF render 用，禁随机/时间戳）----------
export const RENDER_FIXED_SALT = "cadbom-runner-0.1.0";

