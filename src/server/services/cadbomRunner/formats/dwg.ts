// DWG 适配器：硬编码 E422（P13 §3.2——ezdxf 官方否定原生 DWG；ODA 旁路未实装）
import { RunnerInput, RunnerResult, RUNNER_CORE_VERSION } from "../contract";
import { seal } from "../pipeline";

export function dwgAdapter(input: RunnerInput): RunnerResult {
  return seal({
    job_id: input.job_id, status: "rejected",
    error: { code: "E422", message: "DWG not supported: ezdxf cannot read/convert DWG (official FAQ); ODAFileConverter bypass not approved/installed",
      detail: "P12 cadbom-capability §3 DWG 行 D 级；启用需单独 G3/G6 批准" },
    outputs: [], stats: {}, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    warnings: [], core_version: RUNNER_CORE_VERSION,
  });
}

