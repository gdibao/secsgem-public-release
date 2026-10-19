# CAD/BOM runner MCP tool（适配器 C；并入现有 MCP 进程组）
# P13 §2：参数=runner.input 子集，自动补 tenant/requested_by；缺省字段不得静默补值（补值须回显）；
# K6：workspace_file 引用必须回显路径+哈希待用户确认后执行——MCP 侧先返回 confirmation_required。
import json, sys

def handle(req: dict) -> dict:
    """cadbom.run MCP tool 入口。
    入参（runner.input 子集）：operation/format_in/format_out/job_id/input_sha256/
    input_ref{kind,path,sha256}/options
    自动补：tenant_id="pilot"、requested_by="mcp:"+caller（回显于结果）。
    """
    missing = [k for k in ("operation", "format_in", "input_sha256") if k not in req]
    if missing:
        return {"error": {"code": "E400", "message": f"missing fields: {missing}"}}
    enriched = {**req, "tenant_id": "pilot", "requested_by": "mcp:" + req.get("caller", "agent")}
    # K6：workspace_file 必须确认
    if req.get("input_ref", {}).get("kind") == "workspace_file":
        return {"confirmation_required": True,
                "echo": {"path": req["input_ref"].get("path"), "sha256": req.get("input_sha256")},
                "message": "确认对以上路径执行？确认后携带 confirmed=true 重发"}
    if req.get("confirmed") is not True and req.get("input_ref", {}).get("kind") == "workspace_file":
        return {"error": {"code": "E403", "message": "unconfirmed workspace_file reference (K6)"}}
    # 实际执行走 REST（单一核心入口，MCP 不复制逻辑）
    import urllib.request
    r = urllib.request.Request("http://127.0.0.1:18080/api/runner/v1/jobs",
                               data=json.dumps(enriched).encode(),
                               headers={"content-type": "application/json",
                                        "x-agent-identity": "mcp", "x-delegation-id": req.get("delegation_id", "none")})
    return json.loads(urllib.request.urlopen(r).read())

if __name__ == "__main__":
    print(json.dumps(handle(json.loads(sys.stdin.readline()))))

