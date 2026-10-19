// REST 出口（适配器 B）：POST /api/runner/v1/jobs（body=runner.input）
// GET /api/runner/v1/jobs/[id] 轮询 / GET .../outputs/[name] 下载（ETag=sha256）
import { NextRequest, NextResponse } from "next/server";
import { runJob } from "@/server/services/cadbomRunner/pipeline";
import { audit } from "@/server/services/cadbomRunner/audit";

export async function POST(req: Request) {
  const input = await req.json().catch(() => null);
  // Agent 路径归因：x-agent-identity / x-delegation-id 头（P13 §4.1）
  const agentIdentity = req.headers.get("x-agent-identity") || undefined;
  const delegationId = req.headers.get("x-delegation-id") || undefined;
  const result = await runJob(input);
  audit({
    ts: new Date().toISOString(),
    action: result.status === "done" ? "job_done" : result.status === "failed" ? "job_failed" : "job_rejected",
    job_id: result.job_id, operation: (input as Record<string, unknown>)?.operation as string || "unknown",
    format_in: (input as Record<string, unknown>)?.format_in as string || "unknown",
    input_sha256: (input as Record<string, unknown>)?.input_sha256 as string || "",
    result_hash: result.result_hash, status: result.status,
    requested_by: (input as Record<string, unknown>)?.requested_by as string || "unknown",
    tenant_id: (input as Record<string, unknown>)?.tenant_id as string || "unknown",
    agent_identity: agentIdentity, delegation_id: delegationId,
  });
  return Response.json(result, { status: result.status === "done" ? 200 : result.status === "rejected" ? 422 : 500 });
}

