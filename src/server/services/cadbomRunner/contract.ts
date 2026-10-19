// CAD/BOM Runner 核心合同 v1（P13 §1：19 字段 / 11 错误码 / 超时 / 幂等）
// 状态：R2 构建（分支 pilot/cadbom-runner-r1），仅隔离验收，不切产。
export const RUNNER_CORE_VERSION = "0.1.0";

export const OPERATIONS = ["parse", "validate", "convert", "bom_extract", "render"] as const;
export type Operation = (typeof OPERATIONS)[number];

export const FORMATS_IN = ["dxf", "dwg", "step", "ifc"] as const;
export type FormatIn = (typeof FORMATS_IN)[number];

export const FORMATS_OUT = ["dxf", "step", "svg", "png", "pdf", "bom_csv"] as const;
export type FormatOut = (typeof FORMATS_OUT)[number];

// ---------- 输出文件条目 ----------
export interface RunnerOutputFile {
  kind: "file" | "report";
  name: string;
  sha256: string;
  size: number;
  mime: string;
}

// ---------- 输入 schema（10 字段）----------
export interface RunnerInput {
  job_id: string;            // 1 UUID，幂等键
  operation: Operation;      // 2
  format_in: FormatIn;       // 3
  format_out?: FormatOut;    // 4 convert 必填
  input_ref: {               // 5
    kind: "inline_base64" | "workspace_file";
    path?: string;
    sha256?: string;
  };
  input_sha256: string;      // 6
  options?: Record<string, string | number | boolean>; // 7 受控选项
  requested_by: string;      // 8
  tenant_id: string;         // 9
  created_at: string;        // 10 RFC3339
}

// ---------- 输出 schema（9 字段 + result_hash）----------
export interface RunnerResult {
  job_id: string;                                  // 1
  status: "queued" | "validating" | "running" | "done" | "failed" | "rejected"; // 2
  error: { code: ErrorCode; message: string; detail?: string } | null; // 3
  outputs: RunnerOutputFile[];                     // 4
  stats: Record<string, unknown>;                  // 5
  started_at: string;                              // 6
  finished_at: string;                             // 7
  warnings: string[];                              // 8
  core_version: string;                            // 9
  result_hash: string;                             // 结果哈希（canonical_json）
}

// ---------- 错误码（11 个，P13 §1.5）----------
export const ERROR_CODES = {
  E400: "schema 非法",
  E401: "哈希不一致",
  E403: "路径越界",
  E409: "幂等冲突",
  E413: "超限",
  E422: "组合不支持",
  E423: "options 非法",
  E500: "核心内部错误",
  E501: "格式级解析失败",
  E502: "外部工具失败",
  E529: "超时",
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

// ---------- 超时（P13 §1.6）----------
export const TIMEOUTS_MS: Record<Operation, number> = {
  parse: 30_000,
  validate: 30_000,
  convert: 120_000,
  bom_extract: 60_000,
  render: 60_000,
};

// ---------- 组合白名单（P13 §3：未实测不列支持）----------
export const SUPPORTED_COMBOS: Record<Operation, FormatIn[]> = {
  parse: ["dxf"],
  validate: ["dxf"],
  convert: ["dxf"],
  bom_extract: ["dxf"],
  render: ["dxf"],
};

export const DXF_TARGET_VERSIONS = ["R12", "R2000", "R2004", "R2007", "R2010", "R2013", "R2018"] as const;

export const LIMITS = {
  INLINE_MAX_BYTES: 10 * 1024 * 1024,
  FILE_MAX_BYTES: 200 * 1024 * 1024,
  CACHE_TTL_MS: 7 * 24 * 3600 * 1000,
};

