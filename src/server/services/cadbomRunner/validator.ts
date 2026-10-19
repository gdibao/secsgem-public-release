// 唯一校验器（P13 §1.2）：三适配器共用；规则 1–6。
import { createHash } from "node:crypto";
import path from "node:path";
import {
  RunnerInput, ErrorCode, OPERATIONS, FORMATS_IN, FORMATS_OUT,
  SUPPORTED_COMBOS, DXF_TARGET_VERSIONS, LIMITS, Operation, FormatIn,
} from "./contract";

export interface VErr { code: ErrorCode; message: string; detail?: string }

export const sha256 = (buf: Buffer | string) =>
  createHash("sha256").update(buf).digest("hex");

// 规则 6：workspace_file 路径必须落在租户白名单目录内
export const WORKSPACE_ROOTS = [
  "/data/cadbom/inbox",           // 隔离环境挂载点
  "/home/kaifa/cadbom-inbox",
];

export function validateSchema(input: unknown): VErr | null {
  const i = input as RunnerInput;
  if (!i || typeof i !== "object") return { code: "E400", message: "input must be object" };
  const need = (v: unknown, name: string, t: string) => {
    if (typeof v !== t || (t === "string" && !(v as string).length))
      return { code: "E400" as ErrorCode, message: `missing/invalid field: ${name}` };
    return null;
  };
  for (const [f, t] of [["job_id", "string"], ["operation", "string"], ["format_in", "string"],
    ["input_sha256", "string"], ["requested_by", "string"], ["tenant_id", "string"], ["created_at", "string"]] as const) {
    const e = need((i as Record<string, unknown>)[f], f, t); if (e) return e;
  }
  if (!(OPERATIONS as readonly string[]).includes(i.operation)) return { code: "E400", message: "bad operation" };
  if (!(FORMATS_IN as readonly string[]).includes(i.format_in)) return { code: "E400", message: "bad format_in" };
  if (!i.input_ref || !["inline_base64", "workspace_file"].includes(i.input_ref.kind))
    return { code: "E400", message: "bad input_ref.kind" };
  if (i.operation === "convert" && !i.format_out) return { code: "E400", message: "convert requires format_out" };
  if (i.format_out && !(FORMATS_OUT as readonly string[]).includes(i.format_out))
    return { code: "E400", message: "bad format_out" };
  if (!/^[0-9a-f]{64}$/.test(i.input_sha256)) return { code: "E400", message: "input_sha256 must be sha256 hex" };
  return null;
}

export function validateRules(input: RunnerInput, inputBytes?: Buffer): VErr | null {
  // 规则 4：operation×format 组合白名单（DWG/STEP/IFC 未实测不列支持 → E422）
  const combos = SUPPORTED_COMBOS[input.operation] || [];
  if (!combos.includes(input.format_in))
    return { code: "E422", message: `operation ${input.operation} not supported for ${input.format_in}`,
      detail: input.format_in === "dwg" ? "DWG 旁路（ODAFileConverter）未批准/未实装" : "pending-poc（P12 矩阵 B/D 级）" };
  // 规则 5：options 枚举
  if (input.options) {
    const allowed = new Set(["target", "layer", "dpi"]);
    for (const k of Object.keys(input.options))
      if (!allowed.has(k)) return { code: "E423", message: `unknown option: ${k}` };
    if (input.options.target && !(DXF_TARGET_VERSIONS as readonly string[]).includes(String(input.options.target)))
      return { code: "E423", message: "bad DXF target version" };
  }
  // 规则 3：哈希一致性
  if (inputBytes) {
    const actual = sha256(inputBytes);
    if (actual !== input.input_sha256) return { code: "E401", message: "input_sha256 mismatch", detail: actual };
  }
  // 规则 2：大小上限
  if (inputBytes) {
    const max = input.input_ref.kind === "inline_base64" ? LIMITS.INLINE_MAX_BYTES : LIMITS.FILE_MAX_BYTES;
    if (inputBytes.length > max) return { code: "E413", message: "input too large" };
  }
  // 规则 6：路径逃逸
  if (input.input_ref.kind === "workspace_file" && input.input_ref.path) {
    const norm = path.normalize(input.input_ref.path);
    const inside = WORKSPACE_ROOTS.some(r => norm.startsWith(r + "/") || norm.startsWith(r + path.sep));
    if (!inside || norm.includes("..")) return { code: "E403", message: "path escapes whitelist", detail: norm };
  }
  return null;
}

