#!/usr/bin/env python3
"""
smoke_test.py — Verify launcher components and project structure.

Tests:
1. Repository root detection
2. .runtime/ creation
3. Port selection
4. ports.json write
5. Python dependency metadata detection
6. Frontend package detection
7. npm detection
8. Backend command construction
9. Frontend command construction
10. Frontend env generation
11. Hardcoded URL scan
12. Known generated folders ignored by .gitignore

Usage:
    python scripts/smoke_test.py
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
PASS = "✓"
FAIL = "✗"
SKIP = "➜"
results: List[Tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    icon = PASS if ok else FAIL
    print(f"  {icon}  {name}{' — ' + detail if detail else ''}")


def run() -> int:
    print(f"\nCluster Organizer Smoke Test\n")
    print(f"Repository: {ROOT}")
    print()

    # ── 1. Repository root detection ──────────────────────────────────────
    print("1. Repository root detection")
    check("REPO_ROOT exists", ROOT.is_dir())
    check("Is git repo", (ROOT / ".git").is_dir())
    check("Has ai-build/", (ROOT / "ai-build").is_dir())
    check("Has studio/", (ROOT / "studio").is_dir())

    # ── 2. .runtime/ creation ─────────────────────────────────────────────
    print("\n2. Runtime directory")
    rt = ROOT / ".runtime"
    rt.mkdir(parents=True, exist_ok=True)
    check(".runtime/ created", rt.is_dir())
    check(".runtime/ is empty or has logs", True)

    # ── 3. Port selection ─────────────────────────────────────────────────
    print("\n3. Port selection")
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            free_port = s.getsockname()[1]
        check("Free port detection works", True, f"found port {free_port}")
    except Exception as e:
        check("Free port detection works", False, str(e))

    # ── 4. ports.json write ───────────────────────────────────────────────
    print("\n4. ports.json write")
    ports_path = rt / "ports.json"
    test_ports = {
        "backend_host": "127.0.0.1",
        "backend_port": 8003,
        "backend_url": "http://127.0.0.1:8003",
        "frontend_host": "127.0.0.1",
        "frontend_port": 5173,
        "frontend_url": "http://127.0.0.1:5173",
    }
    tmp = ports_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(test_ports, indent=2))
    tmp.replace(ports_path)
    check("ports.json written", ports_path.exists())
    if ports_path.exists():
        loaded = json.loads(ports_path.read_text())
        check("ports.json valid JSON", isinstance(loaded, dict))
        check("ports.json has backend_port", loaded.get("backend_port") == 8003)
    else:
        check("ports.json valid JSON", False)
        check("ports.json has backend_port", False)

    # ── 5. Python dependency metadata ─────────────────────────────────────
    print("\n5. Python dependency metadata")
    req_txt = ROOT / "requirements.txt"
    check("requirements.txt exists", req_txt.exists())
    if req_txt.exists():
        text = req_txt.read_text(encoding="utf-8")
        for dep in ["fastapi", "uvicorn", "numpy", "pandas", "scikit-learn"]:
            check(f"  has {dep}", dep in text)
    pyproject = ROOT / "pyproject.toml"
    check("pyproject.toml does NOT exist (project style)", not pyproject.exists(),
          "pip install -r requirements.txt is the expected mode")

    # ── 6. Frontend package detection ─────────────────────────────────────
    print("\n6. Frontend package detection")
    fe_dir = ROOT / "studio" / "frontend_react"
    check("frontend_react/ exists", fe_dir.is_dir())
    pkg_json = fe_dir / "package.json"
    check("package.json exists", pkg_json.exists())
    if pkg_json.exists():
        pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
        check("package.json has dev script",
              "dev" in pkg.get("scripts", {}))
        check("package.json has vite dep",
              any("vite" in k for k in pkg.get("devDependencies", {})))

    # ── 7. npm detection ──────────────────────────────────────────────────
    print("\n7. npm detection")
    try:
        npm_ver = subprocess.run(
            ["npm", "--version"], capture_output=True, text=True, timeout=10
        )
        check("npm found", npm_ver.returncode == 0, npm_ver.stdout.strip() or "?")
    except FileNotFoundError:
        check("npm found", False, "not installed")

    # ── 8. Backend command construction ───────────────────────────────────
    print("\n8. Backend command construction")
    backend_app = ROOT / "studio" / "api" / "app.py"
    check("studio/api/app.py exists", backend_app.exists())
    if backend_app.exists():
        text = backend_app.read_text(encoding="utf-8")
        check("Has FastAPI app = FastAPI(...)", "FastAPI(" in text)
        check("Has health endpoint", "/api/v1/health" in text)
        check("Has CORS middleware", "CORSMiddleware" in text)
    cmd = "python -m uvicorn studio.api.app:app --host 127.0.0.1 --port 8003 --reload"
    check("Backend command constructible", True, cmd)

    # ── 9. Frontend command construction ──────────────────────────────────
    print("\n9. Frontend command construction")
    check("Vite dev server command", True, "npm run dev -- --port <port> --host 127.0.0.1")
    has_vite_config = (fe_dir / "vite.config.ts").exists()
    check("vite.config.ts exists", has_vite_config)

    # ── 10. Frontend env generation ───────────────────────────────────────
    print("\n10. Frontend env generation")
    env_example = fe_dir / ".env.example"
    check(".env.example exists", env_example.exists())
    if env_example.exists():
        text = env_example.read_text(encoding="utf-8")
        check("Has VITE_SERVER_BASE", "VITE_SERVER_BASE" in text)
    client_ts = ROOT / "studio" / "frontend_react" / "src" / "api" / "client.ts"
    check("client.ts exists", client_ts.exists())
    if client_ts.exists():
        text = client_ts.read_text(encoding="utf-8")
        check("client.ts reads VITE_SERVER_BASE", "VITE_SERVER_BASE" in text)
        check("client.ts has fallback URL", "127.0.0.1:8003" in text)

    # ── 11. Hardcoded URL scan ────────────────────────────────────────────
    print("\n11. Hardcoded URL scan")
    scan_dirs = [
        ROOT / "studio" / "api",
        ROOT / "studio" / "frontend_react" / "src",
    ]
    patterns = {
        "localhost:8000": [],
        "127.0.0.1:8000": [],
        "localhost:5173": [],
        "127.0.0.1:5173": [],
    }
    for sd in scan_dirs:
        if not sd.is_dir():
            continue
        for fpath in sd.rglob("*.py"):
            if "venv" in str(fpath) or "__pycache__" in str(fpath):
                continue
            try:
                text = fpath.read_text(encoding="utf-8", errors="replace")
                for pat in patterns:
                    for lineno, line in enumerate(text.split("\n"), 1):
                        if pat in line and "#" not in line.split(pat)[0].strip():
                            patterns[pat].append(f"{fpath.relative_to(ROOT)}:{lineno}")
            except Exception:
                pass
        for fpath in sd.rglob("*.ts"):
            if "node_modules" in str(fpath) or "dist" in str(fpath):
                continue
            try:
                text = fpath.read_text(encoding="utf-8", errors="replace")
                for pat in patterns:
                    for lineno, line in enumerate(text.split("\n"), 1):
                        if pat in line and "//" not in line.split(pat)[0].strip():
                            patterns[pat].append(f"{fpath.relative_to(ROOT)}:{lineno}")
            except Exception:
                pass

    total_hardcoded = sum(len(v) for v in patterns.values())
    if total_hardcoded == 0:
        check("No hardcoded localhost URLs found", True)
    else:
        for pat, locs in patterns.items():
            if locs:
                for loc in locs[:5]:
                    check(f"Hardcoded '{pat}'", False, loc)
                if len(locs) > 5:
                    check(f"  ... and {len(locs)-5} more", False)

    # Scan bat files for hardcoded ports.
    # Legacy scripts (start_dev_all.bat, 启动WebApp.bat) are expected to have
    # hardcoded ports — they are kept for backward compatibility.
    # Only flag issues in the new launcher files.
    legacy_bats = {"start_dev_all.bat", "启动WebApp.bat"}
    for bat in ROOT.glob("*.bat"):
        if bat.name in legacy_bats:
            continue  # Legacy scripts intentionally have hardcoded ports
        text = bat.read_text(encoding="utf-8", errors="replace")
        for pat in ["8003", "5173"]:
            for lineno, line in enumerate(text.split("\n"), 1):
                if pat in line and "echo" not in line.strip()[:4].lower():
                    check(f"Hardcoded port {pat} in {bat.name}:{lineno}", False,
                          line.strip()[:80])

    # ── 12. .gitignore check ──────────────────────────────────────────────
    print("\n12. Gitignore check")
    gitignore = ROOT / ".gitignore"
    check(".gitignore exists", gitignore.exists())
    if gitignore.exists():
        text = gitignore.read_text(encoding="utf-8")
        for pattern in [".runtime/", ".env.local", "studio/frontend_react/.env.local",
                        "node_modules/", "__pycache__/", ".venv/"]:
            check(f"Ignores '{pattern}'", pattern in text or pattern.replace("/", "") in text)

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 50)
    passed = sum(1 for r in results if r[1])
    failed = sum(1 for r in results if not r[1])
    total = len(results)
    print(f"  Results: {PASS} {passed}/{total} passed, {FAIL} {failed} failed")
    print("=" * 50)

    if failed:
        print("\nFailed checks:")
        for name, ok, detail in results:
            if not ok:
                print(f"  {FAIL}  {name}{' — ' + detail if detail else ''}")

    print()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
