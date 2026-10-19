// DXF 适配器（ezdxf 1.4.5 锁版本；P13 §3.1 / P14 §2.2；C-1 桥接）
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RunnerInput, RunnerResult, RunnerOutputFile, RUNNER_CORE_VERSION, TIMEOUTS_MS, ErrorCode } from "../contract";
import { seal, RENDER_FIXED_SALT, err } from "../pipeline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, "dxf_worker.py");
const PY = process.env.CADBOM_PYTHON || "python3";

export function dxfAdapter(input: RunnerInput, inputBytes: Buffer): Promise<RunnerResult> {
  const RUNNER_URL = process.env.CADBOM_RUNNER_URL;
  if (RUNNER_URL) return dxfViaHttp(input, inputBytes, RUNNER_URL);
  return dxfViaSpawn(input, inputBytes);
}

// C-1 桥接：CADBOM_RUNNER_URL 存在时经 runner 容器 HTTP 通道执行（stdio 协议原样封 POST /run）
async function dxfViaHttp(input: RunnerInput, inputBytes: Buffer, runnerUrl: string): Promise<RunnerResult> {
  const started = new Date().toISOString();
  try {
    const res = await fetch(runnerUrl + "/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: input.operation, options: { ...input.options, _salt: RENDER_FIXED_SALT },
        input_b64: inputBytes.toString("base64"),
      }),
      signal: AbortSignal.timeout(TIMEOUTS_MS[input.operation] || 60_000),
    });
    const resp = (await res.json()) as { stats?: Record<string, unknown>; outputs?: Array<Record<string, unknown>>; warnings?: string[]; error?: { class?: string; message?: string } };
    if (resp.error) throw new Error(`E501 ${resp.error.class || "WorkerError"}: ${resp.error.message}`);
    const outputs: RunnerOutputFile[] = (resp.outputs || []).map(o => ({
      kind: o.kind as RunnerOutputFile["kind"], name: o.name as string, sha256: o.sha256 as string,
      size: o.size as number, mime: o.mime as string,
    }));
    return seal({
      job_id: input.job_id, status: "done", error: null,
      outputs, stats: resp.stats as Record<string, unknown>,
      started_at: started, finished_at: new Date().toISOString(),
      warnings: (resp.warnings as string[]) || [], core_version: RUNNER_CORE_VERSION,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code: ErrorCode = msg.includes("timeout") ? "E529" : "E501";
    return seal({ job_id: input.job_id, status: "failed", error: err(code, msg), outputs: [], stats: {}, started_at: started, finished_at: new Date().toISOString(), warnings: [], core_version: RUNNER_CORE_VERSION });
  }
}

// 原 spawn 路径回退（CADBOM_RUNNER_URL 缺失时）
function dxfViaSpawn(input: RunnerInput, inputBytes: Buffer): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    // ezdxf 1.4.5 版本锁断言：worker 导入失败或版本不符即 E502
    const proc = spawn(PY, [WORKER], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => (stdout += d));
    proc.stderr.on("data", d => (stderr += d));
    proc.on("error", e => reject(new Error(`E502 spawn: ${e.message}`)));
    proc.on("close", code => {
      let resp: Record<string, unknown>;
      try { resp = JSON.parse(stdout.trim().split("\n").pop() || "{}"); }
      catch { return reject(new Error(`E502 worker bad output: ${(stderr || stdout).slice(0, 200)}`)); }
      if (code !== 0 || resp.error) {
        const e = resp.error as { class?: string; message?: string } | undefined;
        return reject(new Error(`E501 ${e?.class || "WorkerError"}: ${e?.message || stderr.slice(0, 200)}`));
      }
      const outputs: RunnerOutputFile[] = (resp.outputs as Array<Record<string, unknown>>).map(o => ({
        kind: o.kind as RunnerOutputFile["kind"], name: o.name as string, sha256: o.sha256 as string,
        size: o.size as number, mime: o.mime as string,
      }));
      resolve(seal({
        job_id: input.job_id, status: "done", error: null,
        outputs, stats: resp.stats as Record<string, unknown>,
        started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        warnings: (resp.warnings as string[]) || [], core_version: RUNNER_CORE_VERSION,
      }));
    });
    proc.stdin.write(JSON.stringify({
      operation: input.operation, options: { ...input.options, _salt: RENDER_FIXED_SALT },
      input_b64: inputBytes.toString("base64"),
    }) + "\n");
    proc.stdin.end();
  });
}
