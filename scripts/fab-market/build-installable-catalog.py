#!/usr/bin/env python3
"""Build a deterministic, security-gated local skill catalog from existing files.

The source trees are read-only. Output is written to a staging directory and can
be atomically published after the generated report has been reviewed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


MAX_FILES = 200
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PACKAGE_BYTES = 25 * 1024 * 1024
TEXT_SUFFIXES = {
    ".c", ".cfg", ".conf", ".css", ".csv", ".go", ".html", ".ini", ".java",
    ".js", ".json", ".jsx", ".md", ".mjs", ".py", ".rb", ".rs", ".sh",
    ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
}
SCRIPT_SUFFIXES = {".bat", ".cmd", ".js", ".mjs", ".ps1", ".py", ".rb", ".sh", ".ts"}
LOCK_FILES = {
    "Cargo.lock", "bun.lock", "bun.lockb", "composer.lock", "Gemfile.lock",
    "package-lock.json", "pnpm-lock.yaml", "poetry.lock", "uv.lock", "yarn.lock",
}
DEPENDENCY_FILES = {
    "Cargo.toml", "Gemfile", "package.json", "pyproject.toml", "requirements.txt",
}
HARD_SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
)
SENSITIVE_EXAMPLE_PATTERNS = (
    re.compile(r"(?i)(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9_./+=-]{20,}"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
)
DANGEROUS_SCRIPT_PATTERNS = (
    re.compile(r"\brm\s+-rf\s+/(?:\s|$)"),
    re.compile(r"(?:curl|wget)[^\n|]{0,500}\|\s*(?:ba)?sh\b"),
    re.compile(r"/dev/tcp/|\bnc\s+[^\n]*\s-e\b"),
    re.compile(r"\b(?:os\.system|shell\s*=\s*True)\b"),
)


@dataclass(frozen=True)
class SourceRoot:
    path: Path
    source: str


def parse_frontmatter(content: str) -> dict[str, object]:
    if not content.startswith("---\n"):
        return {}
    end = content.find("\n---", 4)
    if end < 0:
        return {}
    result: dict[str, object] = {}
    for line in content[4:end].splitlines():
        match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$", line)
        if not match:
            continue
        key, value = match.groups()
        if value.startswith("[") and value.endswith("]"):
            result[key] = [part.strip().strip("'\"") for part in value[1:-1].split(",") if part.strip()]
        else:
            result[key] = value.strip("'\"")
    return result


def safe_relative(path: Path, root: Path) -> str:
    relative = PurePosixPath(path.relative_to(root).as_posix())
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError(f"unsafe path: {relative}")
    return str(relative)


def text_for_scan(path: Path) -> str:
    if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in DEPENDENCY_FILES | LOCK_FILES:
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def permission_declaration(files: list[Path], texts: dict[Path, str]) -> list[str]:
    permissions: set[str] = set()
    joined = "\n".join(texts.values()).lower()
    if any(path.suffix.lower() in SCRIPT_SUFFIXES for path in files):
        permissions.add("code-execution")
    if re.search(r"```(?:ba)?sh|\b(?:bash|powershell|cmd|terminal|shell)\b", joined):
        permissions.add("shell")
    if re.search(r"https?://|\bcurl\b|\bwget\b|\brequests\.", joined):
        permissions.add("network")
    if re.search(r"\b(?:read|open|load|parse)\b[^\n]{0,80}\bfile", joined):
        permissions.add("filesystem-read")
    if re.search(r"\b(?:write|save|create|delete|modify)\b[^\n]{0,80}\bfile", joined):
        permissions.add("filesystem-write")
    return sorted(permissions)


def deterministic_zip(package_root: Path, files: list[Path], package_manifest: bytes, license_bytes: bytes) -> bytes:
    entries = [(safe_relative(path, package_root), path.read_bytes()) for path in files]
    entries.append(("FAB_PACKAGE.json", package_manifest))
    if not any(path.name.upper().startswith("LICENSE") for path in files):
        entries.append(("LICENSE", license_bytes))
    return deterministic_zip_entries(entries)


def deterministic_zip_entries(entries: list[tuple[str, bytes]]) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as handle:
        tmp_name = handle.name
    try:
        with zipfile.ZipFile(tmp_name, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for relative, payload in sorted(entries):
                info = zipfile.ZipInfo(relative, (2026, 1, 1, 0, 0, 0))
                info.external_attr = (0o644 & 0xFFFF) << 16
                archive.writestr(info, payload)
        return Path(tmp_name).read_bytes()
    finally:
        Path(tmp_name).unlink(missing_ok=True)


def audit_skill(
    skill_dir: Path,
    source: SourceRoot,
    licenses: dict[str, bytes],
) -> tuple[dict[str, object] | None, dict[str, object]]:
    skill_md = skill_dir / "SKILL.md"
    content = skill_md.read_text(encoding="utf-8", errors="replace")
    frontmatter = parse_frontmatter(content)
    identifier = re.sub(r"[^a-z0-9._-]+", "-", str(frontmatter.get("name") or skill_dir.name).lower()).strip("-")
    errors: list[str] = []
    warnings: list[str] = []
    for key in ("name", "description", "version", "license"):
        if not frontmatter.get(key):
            errors.append(f"missing-{key}")
    license_id = str(frontmatter.get("license") or "")
    if license_id and license_id not in licenses:
        errors.append(f"unsupported-license:{license_id}")
    files: list[Path] = []
    total_bytes = 0
    texts: dict[Path, str] = {}
    for path in sorted(skill_dir.rglob("*")):
        if path.is_symlink():
            errors.append(f"symlink:{safe_relative(path, skill_dir)}")
            continue
        if not path.is_file():
            continue
        relative = safe_relative(path, skill_dir)
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            errors.append(f"file-too-large:{relative}")
        total_bytes += size
        files.append(path)
        text = text_for_scan(path)
        if text:
            texts[path] = text
            if any(pattern.search(text) for pattern in HARD_SECRET_PATTERNS):
                errors.append(f"possible-secret:{relative}")
            elif any(pattern.search(text) for pattern in SENSITIVE_EXAMPLE_PATTERNS):
                warnings.append(f"sensitive-example:{relative}")
            if path.suffix.lower() in SCRIPT_SUFFIXES and any(
                pattern.search(text) for pattern in DANGEROUS_SCRIPT_PATTERNS
            ):
                errors.append(f"unsafe-script:{relative}")
    if len(files) > MAX_FILES:
        errors.append("too-many-files")
    if total_bytes > MAX_PACKAGE_BYTES:
        errors.append("package-too-large")

    names = {path.name for path in files}
    dependency_files = sorted(names & DEPENDENCY_FILES)
    lock_files = sorted(names & LOCK_FILES)
    if dependency_files and not lock_files:
        warnings.append("dependencies-not-locked")
    permissions = permission_declaration(files, texts)
    if "code-execution" in permissions or "shell" in permissions or "filesystem-write" in permissions:
        warnings.append("requires-explicit-permission")

    status = "blocked" if errors else ("needs-config" if warnings or permissions else "installable")
    audit = {
        "errors": sorted(set(errors)),
        "identifier": identifier,
        "permissions": permissions,
        "source": source.source,
        "sourcePath": str(skill_dir),
        "status": status,
        "warnings": sorted(set(warnings)),
    }
    if errors:
        return None, audit

    package_meta = {
        "dependencies": dependency_files,
        "format": "fab-skill-package-v1",
        "identifier": identifier,
        "license": frontmatter["license"],
        "permissions": permissions,
        "source": source.source,
        "version": frontmatter["version"],
    }
    package_manifest = json.dumps(package_meta, ensure_ascii=False, indent=2, sort_keys=True).encode()
    payload = deterministic_zip(skill_dir, files, package_manifest, licenses[license_id])
    sha256 = hashlib.sha256(payload).hexdigest()
    entry = {
        "author": frontmatter.get("author") or source.source,
        "description": frontmatter["description"],
        "dependencies": dependency_files,
        "fileCount": len(files) + 1 + int(not any(path.name.upper().startswith("LICENSE") for path in files)),
        "id": identifier,
        "installable": status in {"installable", "needs-config"},
        "license": frontmatter["license"],
        "name": frontmatter["name"],
        "packagePath": f"skills/{identifier}/{sha256}.zip",
        "permissions": permissions,
        "sha256": sha256,
        "size": len(payload),
        "source": "local-content",
        "sourceId": f"{source.source}:{identifier}",
        "status": status,
        "version": frontmatter["version"],
        "warnings": sorted(set(warnings)),
    }
    entry["_payload"] = payload
    return entry, audit


def license_declaration(value: object) -> str:
    if isinstance(value, dict):
        value = value.get("name") or value.get("spdx") or value.get("id") or ""
    return str(value or "").strip()


def normalized_known_license(value: str) -> str:
    raw = value.lower()
    if raw in {"mit", "mit license"}:
        return "MIT"
    if raw in {"apache 2.0", "apache-2.0", "apache-2.0 license"}:
        return "Apache-2.0"
    return ""


def source_license_notice(declaration: str, source_url: str) -> bytes:
    return (
        "License declaration mirrored from the upstream marketplace metadata:\n"
        f"{declaration}\n\n"
        f"Upstream source: {source_url or 'not supplied in the cached record'}\n\n"
        "This notice preserves the upstream declaration and does not replace the original license terms.\n"
    ).encode()


def audit_stage_skill(
    raw: dict[str, object],
    licenses: dict[str, bytes],
) -> tuple[dict[str, object] | None, dict[str, object]]:
    detail = raw.get("detail") if isinstance(raw.get("detail"), dict) else {}
    manifest = detail.get("manifest") if isinstance(detail.get("manifest"), dict) else {}
    original_id = str(raw.get("identifier") or detail.get("identifier") or "")
    identifier = re.sub(r"[^a-z0-9._-]+", "-", original_id.lower()).strip("-")
    name = str(manifest.get("name") or raw.get("name") or "").strip()
    description = str(manifest.get("description") or detail.get("description") or "").strip()
    version = str(detail.get("version") or manifest.get("version") or "").strip()
    declared_license = license_declaration(detail.get("license") or manifest.get("license"))
    known_license = normalized_known_license(declared_license)
    content = str(detail.get("content") or "").strip()
    errors: list[str] = []
    if not identifier or not re.fullmatch(r"[a-z0-9._-]{1,255}", identifier):
        errors.append("invalid-identifier")
    for key, value in (("name", name), ("description", description), ("version", version), ("content", content)):
        if not value:
            errors.append(f"missing-{key}")
    if not declared_license:
        errors.append("missing-license-declaration")
    encoded = content.encode()
    if len(encoded) > MAX_PACKAGE_BYTES:
        errors.append("package-too-large")
    private_key_example = any(pattern.search(content) for pattern in HARD_SECRET_PATTERNS)
    sensitive_example = any(pattern.search(content) for pattern in SENSITIVE_EXAMPLE_PATTERNS)
    shell_example = any(pattern.search(content) for pattern in DANGEROUS_SCRIPT_PATTERNS)

    permissions = permission_declaration([], {Path("SKILL.md"): content})
    warnings = ["requires-explicit-permission"] if permissions else []
    if sensitive_example:
        warnings.append("contains-sensitive-credential-example")
    if private_key_example:
        warnings.append("contains-private-key-material")
    if shell_example:
        warnings.append("contains-shell-instructions")
    status = "blocked" if errors else ("needs-config" if warnings else "installable")
    audit = {
        "errors": sorted(set(errors)),
        "identifier": identifier or original_id,
        "permissions": permissions,
        "source": "market-mirror-stage-b",
        "sourcePath": f"market_mirror.skills:{original_id}",
        "status": status,
        "warnings": warnings,
    }
    if errors:
        return None, audit

    author_value = manifest.get("author") or detail.get("author") or "market-mirror"
    if isinstance(author_value, dict):
        author_value = author_value.get("name") or "market-mirror"
    frontmatter = {
        "author": str(author_value),
        "description": description,
        "license": declared_license,
        "name": name,
        "permissions": permissions,
        "version": version,
    }
    source_url = (
        manifest.get("sourceUrl")
        or detail.get("sourceUrl")
        or detail.get("homepage")
        or detail.get("repository")
        or ""
    )
    if isinstance(source_url, str) and source_url.startswith(("http://", "https://")):
        frontmatter["sourceUrl"] = source_url
    skill_md = "---\n" + "\n".join(
        f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in frontmatter.items()
    ) + f"\n---\n\n{content}\n"
    package_meta = {
        "dependencies": [],
        "format": "fab-skill-package-v1",
        "identifier": identifier,
        "license": declared_license,
        "permissions": permissions,
        "source": "market-mirror-stage-b",
        "version": version,
    }
    package_manifest = json.dumps(package_meta, ensure_ascii=False, indent=2, sort_keys=True).encode()
    license_bytes = licenses.get(known_license) or source_license_notice(
        declared_license,
        str(source_url),
    )
    payload = deterministic_zip_entries([
        ("FAB_PACKAGE.json", package_manifest),
        ("LICENSE", license_bytes),
        ("SKILL.md", skill_md.encode()),
    ])
    sha256 = hashlib.sha256(payload).hexdigest()
    entry = {
        "author": str(author_value),
        "description": description,
        "dependencies": [],
        "fileCount": 3,
        "id": identifier,
        "installable": True,
        "license": declared_license,
        "name": name,
        "packagePath": f"skills/{identifier}/{sha256}.zip",
        "permissions": permissions,
        "sha256": sha256,
        "size": len(payload),
        "source": "local-content",
        "sourceId": f"market-mirror-stage-b:{identifier}",
        "sourceTrust": {
            "featured": bool(detail.get("isFeatured")),
            "level": (
                "official" if detail.get("isOfficial")
                else "validated" if detail.get("isValidated")
                else "published"
            ),
            "official": bool(detail.get("isOfficial")),
            "provider": "lobehub-market",
            "validated": bool(detail.get("isValidated")),
        },
        "status": status,
        "version": version,
        "warnings": warnings,
        "_payload": payload,
    }
    return entry, audit


def trusted_assistant(raw: dict[str, object]) -> tuple[dict[str, object] | None, dict[str, object]]:
    meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else raw
    source_id = str(raw.get("identifier") or meta.get("identifier") or meta.get("id") or "").strip()
    config = meta.get("config") if isinstance(meta.get("config"), dict) else {}
    system_role = str(config.get("systemRole") or "").strip()
    name = str(meta.get("name") or meta.get("title") or source_id).strip()
    errors: list[str] = []
    if not source_id or not re.fullmatch(r"[A-Za-z0-9._-]{1,255}", source_id):
        errors.append("invalid-source-id")
    if not name:
        errors.append("missing-name")
    if not system_role:
        errors.append("missing-system-role")
    plugin_count = int(meta.get("pluginCount") or 0)
    knowledge_count = int(meta.get("knowledgeCount") or 0)
    missing: list[str] = []
    if plugin_count:
        missing.append("原助手引用的工具需在 Fab 内单独安装或授权")
    if knowledge_count:
        missing.append("原助手引用的知识库未包含在助手定义中")
    status = "blocked" if errors else ("needs-config" if missing else "installable")
    audit = {
        "errors": errors,
        "identifier": source_id,
        "source": "lobehub-market-mirror",
        "sourcePath": f"assistant:{source_id}",
        "status": status,
        "warnings": missing,
    }
    if errors:
        return None, audit

    version = str(meta.get("versionName") or meta.get("versionNumber") or "1").strip()
    entry = {
        "author": meta.get("author"),
        "avatar": meta.get("avatar"),
        "category": meta.get("category"),
        "config": {
            "openingMessage": config.get("openingMessage"),
            "openingQuestions": config.get("openingQuestions"),
            "systemRole": system_role,
        },
        "description": str(meta.get("description") or ""),
        "featured": bool(meta.get("isFeatured")),
        "id": source_id,
        "installCount": meta.get("installCount"),
        "installable": True,
        "kind": "assistant",
        "missing": missing,
        "name": name,
        "official": bool(meta.get("isOfficial")),
        "ratingCount": meta.get("ratingCount") or meta.get("commentCount"),
        "score": meta.get("score"),
        "source": "lobehub-market-mirror",
        "sourceId": source_id,
        "sourceTrust": {
            "featured": bool(meta.get("isFeatured")),
            "level": (
                "official" if meta.get("isOfficial")
                else "validated" if meta.get("isValidated")
                else "published"
            ),
            "official": bool(meta.get("isOfficial")),
            "provider": "lobehub-market",
            "validated": bool(meta.get("isValidated")),
        },
        "stars": (meta.get("github") or {}).get("stars") if isinstance(meta.get("github"), dict) else None,
        "status": status,
        "tags": meta.get("tags") if isinstance(meta.get("tags"), list) else [],
        "updatedAt": meta.get("updatedAt"),
        "validated": bool(meta.get("isValidated")),
        "version": version,
    }
    canonical = json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    entry["sha256"] = hashlib.sha256(canonical).hexdigest()
    return entry, audit


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--audit-output", required=True, type=Path)
    parser.add_argument(
        "--license",
        action="append",
        required=True,
        help="SPDX-ID=/absolute/path/to/license-text",
    )
    parser.add_argument("--mcp-entries", type=Path)
    parser.add_argument("--assistant-jsonl", action="append", type=Path, default=[])
    parser.add_argument("--root", action="append", required=True, help="source-name=/absolute/path")
    parser.add_argument("--skill-jsonl", action="append", type=Path, default=[])
    args = parser.parse_args()

    roots: list[SourceRoot] = []
    for value in args.root:
        source, separator, raw_path = value.partition("=")
        if not separator or not source or not raw_path:
            parser.error("--root must be source-name=/absolute/path")
        roots.append(SourceRoot(Path(raw_path).resolve(), source))

    licenses: dict[str, bytes] = {}
    for value in args.license:
        license_id, separator, raw_path = value.partition("=")
        if not separator or not license_id or not raw_path:
            parser.error("--license must be SPDX-ID=/absolute/path")
        licenses[license_id] = Path(raw_path).read_bytes()
    output = args.output.resolve()
    if output.exists():
        raise SystemExit(f"refusing to overwrite existing output: {output}")
    output.mkdir(parents=True)
    entries: list[dict[str, object]] = []
    audits: list[dict[str, object]] = []
    seen: set[str] = set()

    for source in roots:
        for skill_md in sorted(source.path.rglob("SKILL.md")):
            entry, audit = audit_skill(skill_md.parent, source, licenses)
            identifier = str(audit["identifier"])
            if identifier in seen:
                audit["errors"] = sorted(set([*audit["errors"], "duplicate-identifier"]))
                audit["status"] = "blocked"
                entry = None
            seen.add(identifier)
            audits.append(audit)
            if not entry:
                continue
            payload = entry.pop("_payload")
            package_path = output / str(entry["packagePath"])
            package_path.parent.mkdir(parents=True, exist_ok=True)
            package_path.write_bytes(payload)
            entries.append(entry)

    for jsonl_path in args.skill_jsonl:
        with jsonl_path.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(raw, dict):
                    continue
                entry, audit = audit_stage_skill(raw, licenses)
                identifier = str(audit["identifier"])
                if identifier in seen:
                    audit["errors"] = sorted(set([*audit["errors"], "duplicate-identifier"]))
                    audit["status"] = "blocked"
                    entry = None
                seen.add(identifier)
                audits.append(audit)
                if not entry:
                    continue
                payload = entry.pop("_payload")
                package_path = output / str(entry["packagePath"])
                package_path.parent.mkdir(parents=True, exist_ok=True)
                package_path.write_bytes(payload)
                entries.append(entry)

    entries.sort(key=lambda item: (item["status"] != "installable", str(item["name"]), str(item["id"])))
    (output / "catalog.json").write_text(
        json.dumps({"format": "fab-installable-catalog-v1", "items": entries}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    audit_output = args.audit_output.resolve()
    audit_output.parent.mkdir(parents=True, exist_ok=True)
    if audit_output.exists():
        raise SystemExit(f"refusing to overwrite existing audit: {audit_output}")
    assistant_items: list[dict[str, object]] = []
    assistant_audits: list[dict[str, object]] = []
    assistant_seen: set[str] = set()
    for jsonl_path in args.assistant_jsonl:
        with jsonl_path.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(raw, dict):
                    continue
                entry, audit = trusted_assistant(raw)
                identifier = str(audit["identifier"])
                if identifier in assistant_seen:
                    audit["warnings"] = [*audit["warnings"], "duplicate-source-id-deduplicated"]
                    audit["status"] = "duplicate"
                    entry = None
                assistant_seen.add(identifier)
                assistant_audits.append(audit)
                if entry:
                    assistant_items.append(entry)
    assistant_items.sort(
        key=lambda item: (
            not bool(item.get("featured") or item.get("official") or item.get("validated")),
            -(int(item.get("stars") or 0)),
            str(item["name"]),
            str(item["id"]),
        )
    )
    assistant_dir = output / "assistant"
    assistant_dir.mkdir(parents=True, exist_ok=True)
    (assistant_dir / "catalog.json").write_text(
        json.dumps(
            {"format": "fab-assistant-catalog-v1", "items": assistant_items},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    audit_output.write_text(
        json.dumps(
            {
                "assistants": assistant_audits,
                "skills": audits,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    audit_output.chmod(0o600)
    mcp_items: list[dict[str, object]] = []
    if args.mcp_entries:
        raw_entries = json.loads(args.mcp_entries.read_text(encoding="utf-8"))
        for raw in raw_entries:
            deployment = raw.get("deployment") if isinstance(raw, dict) else None
            connection = deployment.get("connection") if isinstance(deployment, dict) else None
            identifier = raw.get("identifier") if isinstance(raw, dict) else None
            transport = connection.get("type") if isinstance(connection, dict) else None
            endpoint = connection.get("url") if isinstance(connection, dict) else None
            if not isinstance(identifier, str) or not re.fullmatch(r"[a-z0-9._-]{1,255}", identifier):
                continue
            if transport not in {"http", "stdio"}:
                continue
            if transport == "http" and (not isinstance(endpoint, str) or not endpoint.startswith("https://")):
                continue
            auth_mode = raw.get("auth") if isinstance(raw, dict) else None
            if auth_mode not in {"none", "server-managed", "user-config"}:
                auth_mode = (
                    "server-managed"
                    if isinstance(deployment, dict) and deployment.get("headersMode") == "auto-inject"
                    else "none"
                )
            runner = deployment.get("runner") if isinstance(deployment, dict) else None
            deployable = transport == "http" or (transport == "stdio" and isinstance(runner, str) and bool(runner))
            sanitized = {
                "author": raw.get("author") or "gdibao",
                "auth": auth_mode,
                "deployment": {
                    "connection": {
                        "type": transport,
                        **({"url": endpoint} if isinstance(endpoint, str) else {}),
                    },
                    **({"runner": runner} if isinstance(runner, str) and runner else {}),
                },
                "description": raw.get("description") or raw.get("summary") or "",
                "healthCheck": "tools/list-on-install",
                "id": identifier,
                "installable": deployable,
                "name": raw.get("name") or identifier,
                "permissions": (
                    ["isolated-code-execution"]
                    if identifier == "sandbox-mcp"
                    else ["knowledge-read"]
                ),
                "source": "local-content",
                "sourceId": f"fab-mcp:{identifier}",
                "sourceTrust": {
                    "featured": bool(raw.get("isFeatured")),
                    "level": (
                        "official" if raw.get("isOfficial")
                        else "validated" if raw.get("isValidated")
                        else "published"
                    ),
                    "official": bool(raw.get("isOfficial")),
                    "provider": "lobehub-market",
                    "validated": bool(raw.get("isValidated")),
                },
                "status": "needs-config",
                "toolsCount": int(raw.get("toolsCount") or 0),
                "transport": transport,
                "validated": bool(raw.get("isValidated")),
                "version": str(raw.get("version") or "1.0.0"),
            }
            canonical = json.dumps(sanitized, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
            sanitized["sha256"] = hashlib.sha256(canonical).hexdigest()
            mcp_items.append(sanitized)
        mcp_dir = output / "mcp"
        mcp_dir.mkdir(parents=True, exist_ok=True)
        (mcp_dir / "catalog.json").write_text(
            json.dumps({"format": "fab-mcp-catalog-v1", "items": mcp_items}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    summary = {
        "assistantBlocked": sum(item["status"] == "blocked" for item in assistant_audits),
        "assistantPublished": len(assistant_items),
        "blocked": sum(item["status"] == "blocked" for item in audits),
        "installable": sum(item["status"] == "installable" for item in entries),
        "needsConfig": sum(item["status"] == "needs-config" for item in entries),
        "mcpNeedsConfig": len(mcp_items),
        "packageBytes": sum(int(item["size"]) for item in entries),
        "published": len(entries),
        "scanned": len(audits),
    }
    (output / "manifest.json").write_text(
        json.dumps(
            {
                "catalogs": {
                    "assistant": "assistant/catalog.json",
                    "mcp": "mcp/catalog.json",
                    "skill": "catalog.json",
                },
                "format": "fab-local-market-bundle-v1",
                "summary": summary,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
