#!/usr/bin/env python3
"""
app_launcher.py — One-visible-window launcher for Cluster Organizer.

Detects Python, Node.js, selects free ports, starts backend and frontend
as hidden background processes, waits for health, and opens the browser.

Usage:
    python scripts/app_launcher.py --mode venv
    python scripts/app_launcher.py --mode venv --debug-windows
    python scripts/app_launcher.py --mode venv --debug-windows --skip-deps
"""

from __future__ import annotations

import argparse
import atexit
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import List, Optional, Tuple

# ── Paths ─────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
RUNTIME_DIR = REPO_ROOT / ".runtime"
LAUNCHER_LOG = RUNTIME_DIR / "launcher.log"
BACKEND_LOG = RUNTIME_DIR / "backend.log"
FRONTEND_LOG = RUNTIME_DIR / "frontend.log"
PORTS_FILE = RUNTIME_DIR / "ports.json"
HEALTHCHECK_FILE = RUNTIME_DIR / "healthcheck.json"
ENV_LOCAL = REPO_ROOT / "studio" / "frontend_react" / ".env.local"
REQUIREMENTS = REPO_ROOT / "requirements.txt"
VENV_DIR = REPO_ROOT / ".venv"

BACKEND_PREFERRED_PORT = 8003
BACKEND_PORT_RANGE = range(8003, 8100)
FRONTEND_PREFERRED_PORT = 5173
FRONTEND_PORT_RANGE = range(5173, 5274)

FRONTEND_DIR = REPO_ROOT / "studio" / "frontend_react"
FRONTEND_PKG = FRONTEND_DIR / "package.json"

# ── Logging ───────────────────────────────────────────────────────────────────

log = logging.getLogger("launcher")
_children: List[subprocess.Popen] = []


def _setup_logging(debug: bool = False) -> None:
    """Configure logging to both file and console."""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    # File handler — always DEBUG
    fh = logging.FileHandler(str(LAUNCHER_LOG), encoding="utf-8", mode="w")
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    fh.setLevel(logging.DEBUG)
    log.addHandler(fh)

    # Console handler — INFO or DEBUG
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(logging.Formatter("%(message)s"))
    ch.setLevel(logging.DEBUG if debug else logging.INFO)
    log.addHandler(ch)

    log.setLevel(logging.DEBUG)


# ── Utilities ─────────────────────────────────────────────────────────────────


def _e(msg: str) -> str:
    """Return emoji-prefixed message for console visual polish."""
    return msg


def _port_is_free(host: str, port: int) -> bool:
    """Check whether a TCP port is available."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _select_port(preferred: int, port_range: range, host: str = "127.0.0.1") -> int:
    """Select the first free port from preferred then fallback range."""
    if _port_is_free(host, preferred):
        return preferred
    for p in port_range:
        if _port_is_free(host, p):
            return p
    raise RuntimeError(
        f"No free port found in range {preferred}-{port_range.stop - 1}"
    )


def _http_ok(url: str, timeout: float = 5.0) -> bool:
    """Return True if the URL returns a 2xx HTTP response."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        # Fall back to GET for servers that don't handle HEAD
        resp = urllib.request.urlopen(req, timeout=timeout)
        return 200 <= resp.status < 300
    except Exception:
        try:
            resp = urllib.request.urlopen(url, timeout=timeout)
            return 200 <= resp.status < 300
        except Exception:
            return False


def _http_get_text(url: str, timeout: float = 10.0) -> Optional[str]:
    """Fetch URL body as text, or None on failure."""
    try:
        resp = urllib.request.urlopen(url, timeout=timeout)
        if 200 <= resp.status < 300:
            charset = resp.headers.get_content_charset() or "utf-8"
            return resp.read().decode(charset, errors="replace")
        return None
    except Exception:
        return None


def _cleanup_children() -> None:
    """Terminate all tracked child processes."""
    for proc in _children:
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
    # Second pass — force kill stragglers
    time.sleep(0.5)
    for proc in _children:
        if proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass


def _register_child(proc: subprocess.Popen) -> None:
    """Track a child process for cleanup on exit."""
    _children.append(proc)


def _write_json(filepath: Path, data: dict) -> None:
    """Write JSON atomically."""
    tmp = filepath.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(filepath)


# ── Detection ─────────────────────────────────────────────────────────────────


def _detect_python(use_venv: bool = True) -> Tuple[str, str]:
    """Detect the Python executable path and version string.

    In venv mode, prefer .venv python; otherwise fall back to system python.
    Returns (python_path, version_display).
    """
    candidates = []

    if use_venv:
        venv_py = _get_venv_python()
        if venv_py:
            candidates.append(venv_py)

    # System Python candidates
    if sys.platform == "win32":
        candidates.extend(["python", "py -3"])
    else:
        candidates.extend(["python3", "python"])

    seen = set()
    for cmd in candidates:
        if cmd in seen:
            continue
        seen.add(cmd)
        try:
            # Use the command directly for detection
            result = subprocess.run(
                cmd.split() + ["--version"],
                capture_output=True, text=True, errors="replace", timeout=10,
            )
            if result.returncode == 0:
                version_str = result.stdout.strip() or result.stderr.strip()
                # Resolve to absolute path
                if sys.platform == "win32" and " " not in cmd:
                    where = subprocess.run(
                        ["where", cmd.split()[0]],
                        capture_output=True, text=True, errors="replace", timeout=5,
                    )
                    if where.returncode == 0:
                        resolved = where.stdout.strip().split("\n")[0].strip()
                        return resolved, version_str
                return cmd, version_str
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            continue

    raise RuntimeError("Could not find a working Python interpreter.")


def _get_venv_python() -> Optional[str]:
    """Return path to .venv Python if it exists."""
    if sys.platform == "win32":
        py_path = VENV_DIR / "Scripts" / "python.exe"
    else:
        py_path = VENV_DIR / "bin" / "python3"
        if not py_path.exists():
            py_path = VENV_DIR / "bin" / "python"
    return str(py_path) if py_path.exists() else None


def _detect_nodejs() -> str:
    """Detect Node.js executable."""
    for cmd in ["node", "nodejs"]:
        try:
            result = subprocess.run(
                [cmd, "--version"], capture_output=True, text=True, errors="replace", timeout=10
            )
            if result.returncode == 0:
                return cmd
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            continue
    raise RuntimeError("Node.js not found. Install Node.js 18+ first.")


def _detect_npm(node_cmd: str) -> str:
    """Detect npm executable (usually next to node)."""
    # On Windows, try npm.cmd explicitly since subprocess may not find bare "npm"
    npm_candidates = ["npm"]
    if sys.platform == "win32":
        npm_candidates.insert(0, "npm.cmd")

    for candidate in npm_candidates:
        try:
            result = subprocess.run(
                [candidate, "--version"], capture_output=True, text=True, errors="replace", timeout=10
            )
            if result.returncode == 0:
                return candidate
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            continue

    # Try via node's execPath directory
    try:
        raw = subprocess.check_output(
            [node_cmd, "-e", "process.execPath"], text=True, errors="replace", timeout=10
        ).strip()
        if raw:
            node_dir = str(Path(raw).parent)
            for name in ("npm.cmd", "npm"):
                candidate = os.path.join(node_dir, name)
                if os.path.exists(candidate):
                    return candidate
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass

    # Last resort
    try:
        subprocess.run(["npx", "--version"], capture_output=True, timeout=10)
        return "npx npm"
    except Exception:
        raise RuntimeError("npm not found.")


# ── Venv setup ────────────────────────────────────────────────────────────────


def _ensure_venv(system_python: str) -> str:
    """Create .venv if missing, return the venv python path."""
    venv_py = _get_venv_python()
    if venv_py:
        log.info(" ✓ Virtual environment found at .venv")
        return venv_py

    log.info(" ⏳ Creating virtual environment with %s ...", system_python)
    log.info("    python -m venv .venv")
    py_cmd = system_python.split()
    result = subprocess.run(
        py_cmd + ["-m", "venv", str(VENV_DIR)],
        capture_output=True, text=True, errors="replace", timeout=120,
    )
    if result.returncode != 0:
        log.error(" ✗ Failed to create venv: %s", result.stderr.strip())
        raise RuntimeError("Virtual environment creation failed.")

    venv_py = _get_venv_python()
    if not venv_py:
        raise RuntimeError("Venv created but python not found.")
    log.info(" ✓ Virtual environment created")
    return venv_py


def _python_deps_installed(python_path: str) -> bool:
    """Check if key Python packages are already importable (offline detection).

    Tries to import a representative set of required packages.
    Returns True if all key packages are available, False otherwise.
    """
    check_code = (
        "import sys; "
        "pkgs = ['fastapi', 'uvicorn', 'numpy', 'pandas', 'sklearn', 'hdbscan', 'PIL', 'tqdm', 'scipy']; "
        "missing = []; "
        "for p in pkgs: "
        "  try: __import__(p) "
        "  except ImportError: missing.append(p); "
        "if missing: print('MISSING:' + ','.join(missing), file=sys.stderr); sys.exit(1); "
        "print('OK')"
    )
    try:
        result = subprocess.run(
            python_path.split() + ["-c", check_code],
            capture_output=True, text=True, errors="replace", timeout=30,
        )
        if "OK" in result.stdout:
            return True
        log.debug("Python deps missing: %s", result.stderr.strip()[:200])
        return False
    except (subprocess.TimeoutExpired, OSError) as e:
        log.debug("Python deps check failed: %s", e)
        return False


def _install_python_deps(python_path: str) -> None:
    """Install Python dependencies from requirements.txt if not already installed."""
    if not REQUIREMENTS.exists():
        log.warning(" ⚠ requirements.txt not found, skipping Python deps")
        return

    if _python_deps_installed(python_path):
        log.info(" ✓ Python dependencies already installed")
        return

    log.info(" ⏳ Installing Python dependencies (pip install -r requirements.txt) ...")
    py_cmd = python_path.split()
    start = time.time()
    result = subprocess.run(
        py_cmd + ["-m", "pip", "install", "-r", str(REQUIREMENTS)],
        capture_output=True, text=True, errors="replace", timeout=600,
    )
    elapsed = time.time() - start
    if result.returncode != 0:
        log.error(" ✗ pip install failed (%ds): %s", elapsed, result.stderr.strip()[:500])
        raise RuntimeError("Python dependency installation failed.")
    log.info(" ✓ Python dependencies installed (%ds)", elapsed)


def _install_npm_deps(npm_cmd: str) -> None:
    """Install npm dependencies if node_modules missing."""
    node_modules = FRONTEND_DIR / "node_modules"
    if node_modules.is_dir():
        log.info(" ✓ Frontend dependencies already installed")
        return
    if not FRONTEND_PKG.exists():
        log.warning(" ⚠ package.json not found at %s", FRONTEND_PKG)
        return

    log.info(" ⏳ Installing frontend dependencies (npm install) ...")
    start = time.time()
    result = subprocess.run(
        [npm_cmd, "install"],
        cwd=str(FRONTEND_DIR),
        capture_output=True, text=True, errors="replace", timeout=300,
    )
    elapsed = time.time() - start
    if result.returncode != 0:
        log.error(" ✗ npm install failed (%ds): %s", elapsed, result.stderr.strip()[:300])
        raise RuntimeError("Frontend dependency installation failed.")
    log.info(" ✓ Frontend dependencies installed (%ds)", elapsed)


# ── Env config ────────────────────────────────────────────────────────────────


def _ensure_frontend_env(backend_port: int, frontend_port: int) -> None:
    """Generate .env.local for the frontend with runtime ports."""
    backend_url = f"http://127.0.0.1:{backend_port}"
    content = (
        f"# Generated by app_launcher.py — do not commit\n"
        f"VITE_API_PROXY_TARGET={backend_url}\n"
        f"VITE_SERVER_BASE={backend_url}\n"
        f"VITE_PORT={frontend_port}\n"
    )
    ENV_LOCAL.parent.mkdir(parents=True, exist_ok=True)
    ENV_LOCAL.write_text(content, encoding="utf-8")
    log.debug("Wrote %s", ENV_LOCAL)


# ── Process startup ───────────────────────────────────────────────────────────


def _start_backend(
    python_path: str,
    backend_port: int,
    debug_windows: bool,
) -> subprocess.Popen:
    """Start the FastAPI backend as a hidden child process."""
    cmd = [
        python_path, "-m", "uvicorn", "studio.api.app:app",
        "--host", "127.0.0.1",
        "--port", str(backend_port),
        "--reload",
    ]
    log.info(" ⏳ Starting backend on port %d ...", backend_port)
    log.debug("    cmd: %s", " ".join(cmd))

    log_fh = BACKEND_LOG.open("wb")
    kwargs: dict = {
        "stdout": log_fh,
        "stderr": subprocess.STDOUT,
        "cwd": str(REPO_ROOT),
    }

    if sys.platform == "win32" and not debug_windows:
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW

    proc = subprocess.Popen(cmd, **kwargs)
    _register_child(proc)
    log.debug("Backend PID: %d", proc.pid)
    return proc


def _start_frontend(
    frontend_port: int,
    npm_cmd: str,
    debug_windows: bool,
) -> subprocess.Popen:
    """Start the Vite dev server as a hidden child process."""
    cmd = [
        npm_cmd, "run", "dev", "--",
        "--host", "127.0.0.1",
        "--port", str(frontend_port),
    ]
    log.info(" ⏳ Starting frontend on port %d ...", frontend_port)
    log.debug("    cmd: cd %s && %s", FRONTEND_DIR, " ".join(cmd))

    log_fh = FRONTEND_LOG.open("wb")
    kwargs: dict = {
        "stdout": log_fh,
        "stderr": subprocess.STDOUT,
        "cwd": str(FRONTEND_DIR),
    }

    if sys.platform == "win32" and not debug_windows:
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW

    proc = subprocess.Popen(cmd, **kwargs)
    _register_child(proc)
    log.debug("Frontend PID: %d", proc.pid)
    return proc


# ── Health checks ─────────────────────────────────────────────────────────────


def _wait_for_backend(
    backend_port: int,
    max_wait: float = 60.0,
    interval: float = 1.0,
) -> Tuple[bool, float]:
    """Poll backend health endpoint until ready. Returns (ok, elapsed_sec)."""
    health_urls = [
        f"http://127.0.0.1:{backend_port}/api/v1/health",
        f"http://127.0.0.1:{backend_port}/docs",
        f"http://127.0.0.1:{backend_port}/",
    ]

    log.info(" ⏳ Waiting for backend to become ready ...")
    start = time.time()
    while time.time() - start < max_wait:
        for url in health_urls:
            try:
                resp = urllib.request.urlopen(url, timeout=2)
                if resp.status < 400:
                    elapsed = time.time() - start
                    log.info(" ✓ Backend ready after %.1fs", elapsed)
                    return True, elapsed
            except Exception:
                continue
        time.sleep(interval)

    elapsed = time.time() - start
    log.error(" ✗ Backend not ready after %.1fs", elapsed)
    return False, elapsed


def _wait_for_frontend(
    frontend_port: int,
    max_wait: float = 60.0,
    interval: float = 1.0,
) -> Tuple[bool, float]:
    """Poll frontend URL until it responds with HTML. Returns (ok, elapsed_sec)."""
    frontend_url = f"http://127.0.0.1:{frontend_port}/"

    log.info(" ⏳ Waiting for frontend to become ready ...")
    start = time.time()
    while time.time() - start < max_wait:
        text = _http_get_text(frontend_url, timeout=3)
        if text and ("<!DOCTYPE html>" in text or "<html" in text.lower() or "script" in text.lower()):
            elapsed = time.time() - start
            log.info(" ✓ Frontend ready after %.1fs", elapsed)
            return True, elapsed
        # Also accept any non-error response
        if _http_ok(frontend_url, timeout=2):
            elapsed = time.time() - start
            log.info(" ✓ Frontend ready after %.1fs (HTTP ok)", elapsed)
            return True, elapsed
        time.sleep(interval)

    elapsed = time.time() - start
    log.error(" ✗ Frontend not ready after %.1fs", elapsed)
    return False, elapsed


# ── Failure reporting ─────────────────────────────────────────────────────────


def _print_failure_summary(
    backend_alive: bool,
    frontend_alive: bool,
) -> None:
    """Print a failure summary with log tails."""
    log.error("")
    log.error("═" * 50)
    log.error("  LAUNCH FAILED")
    log.error("═" * 50)
    log.error("")
    log.error("  Backend alive:  %s", "YES" if backend_alive else "NO")
    log.error("  Frontend alive: %s", "YES" if frontend_alive else "NO")
    log.error("")
    log.error("  Log files:")
    log.error("    Launcher: %s", LAUNCHER_LOG)
    log.error("    Backend:  %s", BACKEND_LOG)
    log.error("    Frontend: %s", FRONTEND_LOG)
    log.error("    Ports:    %s", PORTS_FILE)
    log.error("")

    for label, path in [("Backend log (last 40 lines)", BACKEND_LOG),
                         ("Frontend log (last 40 lines)", FRONTEND_LOG)]:
        if path.exists():
            lines = path.read_text(encoding="utf-8", errors="replace").strip().split("\n")
            tail = lines[-40:] if len(lines) > 40 else lines
            log.error("  ── %s ──", label)
            for line in tail:
                log.error("  %s", line.rstrip())
            log.error("")


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Cluster Organizer Launcher")
    parser.add_argument(
        "--mode", choices=["venv", "system"], default="venv",
        help="Python environment mode (default: venv)",
    )
    parser.add_argument(
        "--debug-windows", action="store_true",
        help="Show backend/frontend windows for debugging",
    )
    parser.add_argument(
        "--skip-deps", action="store_true",
        help="Skip dependency installation",
    )
    parser.add_argument(
        "--no-browser", action="store_true",
        help="Do not open browser automatically",
    )
    args = parser.parse_args()

    _setup_logging()
    log.info("Cluster Organizer Launcher")
    log.info("Repository: %s", REPO_ROOT)
    log.info("Mode:       %s", args.mode)
    log.info("")

    # ── Register cleanup ──────────────────────────────────────────────────
    atexit.register(_cleanup_children)
    if sys.platform != "win32":
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, lambda s, f: (_cleanup_children(), sys.exit(128 + s)))
            except (ValueError, OSError):
                pass

    # ── Detect tooling ────────────────────────────────────────────────────
    log.info("Checking Python...")
    use_venv = args.mode == "venv"
    python_path, python_ver = _detect_python(use_venv=use_venv)
    log.info("  ✓ %s (%s)", python_path, python_ver)

    log.info("Checking Node.js...")
    node_cmd = _detect_nodejs()
    node_ver = subprocess.run(
        [node_cmd, "--version"], capture_output=True, text=True, errors="replace", timeout=5
    ).stdout.strip()
    log.info("  ✓ %s (%s)", node_cmd, node_ver)

    log.info("Checking npm...")
    npm_cmd = _detect_npm(node_cmd)
    npm_ver = subprocess.run(
        [npm_cmd, "--version"], capture_output=True, text=True, errors="replace", timeout=5
    ).stdout.strip()
    log.info("  ✓ npm (%s)", npm_ver)
    log.info("")

    # ── Ensure venv + install deps ────────────────────────────────────────
    if use_venv:
        python_path = _ensure_venv(python_path)

    if not args.skip_deps:
        _install_python_deps(python_path)
        _install_npm_deps(npm_cmd)
    else:
        log.info(" ⏩ Skipping dependency installation (--skip-deps)")
    log.info("")

    # ── Select ports ──────────────────────────────────────────────────────
    log.info("Selecting ports...")
    try:
        backend_port = _select_port(BACKEND_PREFERRED_PORT, BACKEND_PORT_RANGE)
        frontend_port = _select_port(FRONTEND_PREFERRED_PORT, FRONTEND_PORT_RANGE)
    except RuntimeError as e:
        log.error(" ✗ %s", e)
        sys.exit(1)

    log.info("  Backend port:  %d", backend_port)
    log.info("  Frontend port: %d", frontend_port)

    # Write ports.json
    ports_data = {
        "backend_host": "127.0.0.1",
        "backend_port": backend_port,
        "backend_url": f"http://127.0.0.1:{backend_port}",
        "frontend_host": "127.0.0.1",
        "frontend_port": frontend_port,
        "frontend_url": f"http://127.0.0.1:{frontend_port}",
    }
    _write_json(PORTS_FILE, ports_data)
    log.info("  Ports written to %s", PORTS_FILE)
    log.info("")

    # ── Generate frontend env ─────────────────────────────────────────────
    _ensure_frontend_env(backend_port, frontend_port)
    log.info("Frontend env: %s", ENV_LOCAL)
    log.info("")

    # ── Start backend ─────────────────────────────────────────────────────
    backend_proc = _start_backend(python_path, backend_port, args.debug_windows)

    # ── Start frontend ────────────────────────────────────────────────────
    frontend_proc = _start_frontend(frontend_port, npm_cmd, args.debug_windows)

    # ── Wait for backend ──────────────────────────────────────────────────
    backend_ok, backend_elapsed = _wait_for_backend(backend_port)

    # ── Wait for frontend ─────────────────────────────────────────────────
    frontend_ok, frontend_elapsed = _wait_for_frontend(frontend_port)

    # ── Health check record ───────────────────────────────────────────────
    health_data = {
        "backend_ok": backend_ok,
        "backend_elapsed_sec": round(backend_elapsed, 1),
        "frontend_ok": frontend_ok,
        "frontend_elapsed_sec": round(frontend_elapsed, 1),
        "backend_port": backend_port,
        "frontend_port": frontend_port,
    }
    _write_json(HEALTHCHECK_FILE, health_data)

    # ── Open browser ──────────────────────────────────────────────────────
    if backend_ok and frontend_ok:
        frontend_url = f"http://127.0.0.1:{frontend_port}/react/organize/"
        log.info("")
        log.info("═" * 50)
        log.info("  Project is running!")
        log.info("═" * 50)
        log.info("")
        log.info("  Frontend:  %s", ports_data["frontend_url"])
        log.info("  Backend:   %s", ports_data["backend_url"])
        log.info("  API docs:  %s/docs", ports_data["backend_url"])
        log.info("")

        if not args.no_browser:
            log.info("Opening browser...")
            webbrowser.open(frontend_url)

        log.info("")
        log.info("Close this window (Ctrl+C) to stop all services.")
        log.info("Logs are in .runtime/")

        # Keep alive — wait for Ctrl+C
        try:
            while True:
                # Check children are still alive
                if backend_proc.poll() is not None:
                    log.error(" ⚠ Backend process exited unexpectedly (code: %d)", backend_proc.returncode)
                    _print_failure_summary(False, frontend_proc.poll() is None)
                    break
                if frontend_proc.poll() is not None:
                    log.error(" ⚠ Frontend process exited unexpectedly (code: %d)", frontend_proc.returncode)
                    _print_failure_summary(backend_proc.poll() is None, False)
                    break
                time.sleep(1)
        except KeyboardInterrupt:
            log.info("\nShutting down...")
    else:
        backend_alive = backend_proc.poll() is None
        frontend_alive = frontend_proc.poll() is None
        _print_failure_summary(backend_alive, frontend_alive)
        sys.exit(1)


if __name__ == "__main__":
    main()
