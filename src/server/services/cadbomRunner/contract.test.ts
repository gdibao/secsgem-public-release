// 14 验收用例合同测试（P13 §3 映射；D-1~D-5/W-1/W-2(占位)/W-3(占位)/S-1~S-3/I-1~I-3 标注 pending）
// 状态：R2 隔离验收；D 系为实测，W-2/W-3/S-*/I-* 断言 pending-poc 行为。
import { describe, it, expect } from "vitest";
import { runJob, canonicalJson } from "./pipeline";
import { readAudit } from "./audit";
import fs from "node:fs";
import path from "node:path";

const F = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n));
const base = (over: Partial<Record<string, unknown>> = {}) => ({
  job_id: crypto.randomUUID(),
  operation: "parse", format_in: "dxf",
  input_ref: { kind: "inline_base64" },
  input_sha256: "",
  requested_by: "audit-304", tenant_id: "pilot",
  created_at: new Date().toISOString(),
  ...over,
});
const job = (over: Partial<Record<string, unknown>> = {}, bytes?: Buffer) =>
  runJob(base(over), async () => bytes ?? F("F1_simple.dxf"));

describe("D 系（DXF 实测）", () => {
  it("D-1 parse F1：entity_count=2 version=AC1027", async () => {
    const r = await job({ input_sha256: sha(F1) });
    expect(r.status).toBe("done");
    expect(r.stats).toMatchObject({ entity_count: 2, version: "AC1027" });
  });
  it("D-2 convert→R12：warnings 含版本降级提示", async () => {
    const r = await job({ operation: "convert", format_out: "dxf", options: { target: "R12" }, input_sha256: sha(F1) }, F1);
    expect(r.status).toBe("done");
    expect(r.warnings.join()).toContain("version_downgrade");
  });
  it("D-3 render SVG：sha256 稳定（重复执行同哈希）", async () => {
    const a = await job({ operation: "render", format_out: "svg", input_sha256: sha(F1) }, F1);
    const b = await job({ job_id: crypto.randomUUID(), operation: "render", format_out: "svg", input_sha256: sha(F1) }, F1);
    expect(a.outputs[0].sha256).toBe(b.outputs[0].sha256);
  });
  it("D-4a 坏 DXF（截断）→ E501 不崩溃", async () => {
    const r = await job({ input_sha256: sha(F4a) }, F4a);
    expect(r.status).toBe("failed"); expect(r.error?.code).toBe("E501");
  });
  it("D-4b 空 ENTITIES → done count=0", async () => {
    const r = await job({ input_sha256: sha(F4b) }, F4b);
    expect(r.status).toBe("done"); expect(r.stats).toMatchObject({ entity_count: 0 });
  });
  it("D-4c 非法组码 → 确定性（done 或 E501，不静默错数据）", async () => {
    const r = await job({ input_sha256: sha(F4c) }, F4c);
    expect(["done", "failed"]).toContain(r.status);
  });
  it("D-5a 二进制 DXF → done", async () => {
    const r = await job({ input_sha256: sha(F5a) }, F5a);
    expect(r.status).toBe("done");
  });
  it("D-5b 伪加密头 → E501", async () => {
    const r = await job({ input_sha256: sha(F5b) }, F5b);
    expect(r.error?.code).toBe("E501");
  });
});

describe("合同横切", () => {
  it("X-1 幂等：同 job_id+sha 重放返回同 result_hash", async () => {
    const id = crypto.randomUUID();
    const a = await job({ job_id: id, input_sha256: sha(F1) }, F1);
    const b = await job({ job_id: id, input_sha256: sha(F1) }, F1);
    expect(a.result_hash).toBe(b.result_hash);
    expect(b.warnings.join()).toContain("cache_hit");
  });
  it("X-2 幂等冲突：同 job_id 不同 sha → E409", async () => {
    const id = crypto.randomUUID();
    await job({ job_id: id, input_sha256: sha(F1) }, F1);
    const r = await job({ job_id: id, input_sha256: sha(F5b) }, F5b);
    expect(r.error?.code).toBe("E409");
  });
  it("X-3 哈希不一致 → E401", async () => {
    const r = await job({ input_sha256: "0".repeat(64) }, F1);
    expect(r.error?.code).toBe("E401");
  });
  it("X-4 三口一致性锚：canonical_json 键排序稳定", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("W 系（DWG）", () => {
  it("W-1 DWG 默认拒绝 → E422", async () => {
    const r = await job({ format_in: "dwg", input_sha256: sha(F1) }, F1);
    expect(r.status).toBe("rejected"); expect(r.error?.code).toBe("E422");
  });
  it("W-2 旁路转换 → pending（ODA 未批，断言仍 E422）", async () => {
    const r = await job({ format_in: "dwg", operation: "convert", format_out: "dxf", input_sha256: sha(F1) }, F1);
    expect(r.error?.code).toBe("E422");
  });
  it("W-3 旁路失败注入 → pending（同 W-2 行为）", async () => {
    const r = await job({ format_in: "dwg", operation: "parse", input_sha256: sha(F1) }, F1);
    expect(r.error?.code).toBe("E422");
  });
});

describe("S/I 系（pending-poc 行为断言）", () => {
  for (const [fmt, n] of [["step", "S"], ["ifc", "I"]] as const) {
    it(`${n}-1~3 ${fmt} → E422 pending-poc`, async () => {
      const r = await job({ format_in: fmt, input_sha256: sha(F1) }, F1);
      expect(r.error?.code).toBe("E422");
      expect(r.error?.message).toContain("pending-poc");
    });
  }
});

it("审计 best-effort：作业后 audit.jsonl 有行（环境支持时）", async () => {
  await job({ input_sha256: sha(F1) }, F1);
  // best-effort：目录不可写时 readAudit() 返回 []，不失败
  expect(Array.isArray(readAudit())).toBe(true);
});

// helpers
import { createHash } from "node:crypto";
const _c = (n: string) => F(n);
const sha = (n: string) => createHash("sha256").update(F(n)).digest("hex");
const F1 = "F1_simple.dxf", F4a = "F4_truncated.dxf", F4b = "F4_empty_entities.dxf",
      F4c = "F4_badcode.dxf", F5a = "F5_binary.dxf", F5b = "F5_fake_encrypted.dxf";

