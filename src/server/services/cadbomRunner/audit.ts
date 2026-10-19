// 审计事件（best-effort：失败不阻断作业；P13 §4.1 双路径审计字段一致）
// 隔离验收环境：写本地 JSONL（隔离挂载 /data/cadbom/audit/audit.jsonl）；
// 试点部署后切换为 admin_audit_logs 一行（resourceType=cadbomRunnerJob，沿用 fd61046d 通道）。
import fs from "node:fs";
import path from "node:path";

const AUDIT_DIR = process.env.CADBOM_AUDIT_DIR || "/data/cadbom/audit";
const AUDIT_FILE = path.join(AUDIT_DIR, "audit.jsonl");

export interface AuditEvent {
  ts: string;
  action: "job_submit" | "job_done" | "job_failed" | "job_rejected" | "cache_hit";
  job_id: string;
  operation: string;
  format_in: string;
  input_sha256: string;
  result_hash?: string;
  status?: string;
  requested_by: string;
  tenant_id: string;
  // Agent 路径归因（P13 §4.1：Agent 记录必须可回溯到授权用户）
  agent_identity?: string;
  delegation_id?: string;
}

export function audit(ev: AuditEvent): void {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(ev) + "\n");
  } catch {
    // best-effort：审计失败不阻断（P13 §4.1 与 fd61046d 口径一致）
  }
}

export function readAudit(): AuditEvent[] {
  try {
    return fs.readFileSync(AUDIT_FILE, "utf-8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

