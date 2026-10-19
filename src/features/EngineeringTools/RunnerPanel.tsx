// UI 出口（适配器 A）：RunnerPanel 表单+任务面板（P13 §2）
"use client";
import { useState } from "react";

/** 表单字段与 REST body 一一对应（表单校验后组 JSON，仍过同一校验器）；
 *  用户即操作人——表单提交本身就是确认动作（P13 §4.2 K1/K2 由部署层拦截写路径）。 */
export default function RunnerPanel({ fileSha256, fileName }: { fileSha256: string; fileName: string }) {
  const [operation, setOperation] = useState("parse");
  const [formatOut, setFormatOut] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      // K2 确认：覆盖既有文件时由服务端写前备份；此处弹确认
      if (operation === "convert" && !confirm(`对 ${fileName} 执行 ${operation}？输出将写入项目成果区`)) return;
      const res = await fetch("/api/runner/v1/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          job_id: crypto.randomUUID(), operation, format_in: "dxf",
          format_out: operation === "convert" || operation === "render" ? formatOut || "svg" : undefined,
          input_ref: { kind: "workspace_file", path: fileName },
          input_sha256: fileSha256, requested_by: "current-user", tenant_id: "pilot",
          created_at: new Date().toISOString(),
        }),
      });
      setResult(await res.json());
    } finally { setBusy(false); }
  }

  return (
    <div className="runner-panel">
      <select value={operation} onChange={e => setOperation(e.target.value)}>
        <option value="parse">parse</option><option value="validate">validate</option>
        <option value="convert">convert</option><option value="bom_extract">bom_extract</option>
        <option value="render">render</option>
      </select>
      {(operation === "convert" || operation === "render") && (
        <select value={formatOut} onChange={e => setFormatOut(e.target.value)}>
          <option value="svg">svg</option><option value="dxf">dxf</option><option value="bom_csv">bom_csv</option>
        </select>
      )}
      <button disabled={busy} onClick={submit}>{busy ? "运行中…" : "执行"}</button>
      {result && (
        <pre>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

