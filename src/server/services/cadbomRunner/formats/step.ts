// STEP 适配器：pending-poc 桩（P13 §3.3——FreeCAD OCC B 级，未实测不列支持）
import { RunnerInput, RunnerResult, RUNNER_CORE_VERSION } from "../contract";
import { seal } from "../pipeline";

export function stepAdapter(input: RunnerInput): RunnerResult {
  return seal({
    job_id: input.job_id, status: "rejected",
    error: { code: "E422", message: "STEP pending-poc: FreeCAD/OCC capability not yet verified (P12 matrix B-level); fixtures F2 required",
      detail: "验收用例 S-1~S-3 待 PoC 批准后启用" },
    outputs: [], stats: {}, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    warnings: [], core_version: RUNNER_CORE_VERSION,
  });
}

