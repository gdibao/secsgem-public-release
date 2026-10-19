#!/usr/bin/env python3
"""DXF 子进程协议（runner；ezdxf==1.4.5 锁版本）。R2 重写定稿版。
stdin: 一行 JSON {operation, options, input_b64}
stdout: 一行 JSON {stats, outputs:[{kind,name,sha256,size,mime,b64}], warnings} 或 {"error":{...}}
"""
import sys, json, base64, hashlib, io, pathlib

import ezdxf
from ezdxf import recover

MIME = {"dxf": "image/vnd.dxf", "svg": "image/svg+xml", "png": "image/png", "pdf": "application/pdf"}


def main():
    req = json.loads(sys.stdin.readline())
    op = req["operation"]
    opts = req.get("options") or {}
    data = base64.b64decode(req["input_b64"]) if "input_b64" in req else open(req["input_path"], "rb").read()
    try:
        if data.startswith(b"AutoCAD Binary DXF"):
            import tempfile, os
            with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tf:
                tf.write(data); tmp = tf.name
            doc = ezdxf.readfile(tmp)  # plain readfile supports binary DXF; recover does not
            from ezdxf.audit import Auditor
            auditor = Auditor(doc)
            os.unlink(tmp)
        else:
            doc, auditor = recover.read(io.BytesIO(data))
        msp = doc.modelspace()
        warnings = [f"recover_issues={len(auditor.errors)}"] if auditor.has_issues else []

        if op == "parse":
            stats = {"entity_count": len(msp), "layer_count": len(doc.layers), "version": doc.dxfversion}
            out = []
        elif op == "validate":
            from ezdxf.audit import Auditor
            a = Auditor(doc)
            a.run()
            stats = {"issue_count": len(a.issues)}
            out = [{"kind": "report", "name": "audit.json", "content": json.dumps([str(i) for i in a.issues])}]
        elif op == "convert":
            target = opts.get("target", "R2013")
            old = doc.dxfversion
            doc.dxfversion = {"R12": "AC1009", "R2000": "AC1015", "R2004": "AC1018", "R2007": "AC1021",
                              "R2010": "AC1024", "R2013": "AC1027", "R2018": "AC1032"}[target]
            buf = io.StringIO()
            doc.write(buf)
            if old != doc.dxfversion:
                warnings.append(f"version_change={old}->{doc.dxfversion}; semantics may be lost (P12 SS4-1)")
            stats = {"in_sha256": hashlib.sha256(data).hexdigest(), "out_version": doc.dxfversion}
            out = [{"kind": "file", "name": "converted.dxf", "content": buf.getvalue().encode(), "mime": MIME["dxf"]}]
        elif op == "render":
            import matplotlib
            matplotlib.use("Agg")
            matplotlib.rcParams["svg.hashsalt"] = "cadbom-runner-0.1.0"  # 确定性渲染
            from ezdxf.addons.drawing import matplotlib as mpl
            import tempfile, os
            tmp_svg = tempfile.NamedTemporaryFile(suffix=".svg", delete=False).name
            mpl.qsave(msp, tmp_svg, bg="#FFFFFF")
            svg = pathlib.Path(tmp_svg).read_bytes()
            os.unlink(tmp_svg)
            stats = {"rendered": True}
            out = [{"kind": "file", "name": "drawing.svg", "content": svg, "mime": MIME["svg"]}]
        elif op == "bom_extract":
            rows = [{"layer": e.dxf.layer, "type": e.dxftype()} for e in msp]
            csv = "\n".join(f"{r['layer']},{r['type']}" for r in rows)
            stats = {"entity_count": len(rows)}
            out = [{"kind": "file", "name": "bom.csv", "content": csv, "mime": "text/csv"}]
        else:
            print(json.dumps({"error": {"class": "ValueError", "message": f"bad op {op}"}}))
            sys.exit(1)

        outputs = []
        for o in out:
            content = o.get("content", "")
            b = content.encode() if isinstance(content, str) else content
            outputs.append({"kind": o.get("kind", "file"), "name": o["name"],
                            "sha256": hashlib.sha256(b).hexdigest(), "size": len(b),
                            "mime": o.get("mime", "application/octet-stream"),
                            "b64": base64.b64encode(b).decode()})
        print(json.dumps({"stats": stats, "outputs": outputs, "warnings": warnings}))
    except Exception as e:
        print(json.dumps({"error": {"class": type(e).__name__, "message": str(e)}}))
        sys.exit(1)


if __name__ == "__main__":
    main()

