#!/usr/bin/env python3
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
import urllib.request
import webbrowser
from pathlib import Path
from typing import List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
RUNTIME_DIR = REPO_ROOT / ".runtime"
LAUNCHER_LOG = RUNTIME_DIR / "launcher.log"
BACKEND_LOG = RUNTIME_DIR / "backend.log"
FRONTEND_LOG = RUNTIME_DIR / "frontend.log"
PORTS_FILE = RUNTIME_DIR / "ports.json"
HEALTHCHECK_FILE = RUNTIME_DIR / "healthcheck.json"
ENV_LOCAL = REPO_ROOT / "studio" / "frontend_react" / ".env.local"
FRONTEND_DIR = REPO_ROOT / "studio" / "frontend_react"
VENV_DIR = REPO_ROOT / ".venv"

BACKEND_PREFERRED_PORT = 8003
BACKEND_PORT_RANGE = range(8003, 8100)
FRONTEND_PREFERRED_PORT = 5173
FRONTEND_PORT_RANGE = range(5173, 5274)
CREATE_NO_WINDOW = 0x08000000


log = logging.getLogger("launcher")
_children: List[subprocess.Popen] = []


def _setup_logging(debug: bool = False) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    log.handlers.clear()

    file_handler = logging.FileHandler(str(LAUNCHER_LOG), encoding="utf-8", mode="w")
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    file_handler.setLevel(logging.DEBUG)
    log.addHandler(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter("%(message)s"))
    console_handler.setLevel(logging.DEBUG if debug else logging.INFO)
    log.addHandler(console_handler)

    log.setLevel(logging.DEBUG)


def _port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def _select_port(preferred: int, port_range: range, host: str = "127.0.0.1") -> int:
    if _port_is_free(host, preferred):
        return preferred
    for port in port_range:
        if _port_is_free(host, port):
            return port
    raise RuntimeError(f"No free port found in range {preferred}-{port_range.stop - 1}")


def _http_ok(url: str, timeout: float = 5.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _http_get_text(url: str, timeout: float = 10.0) -> Optional[str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if 200 <= resp.status < 300:
                charset = resp.headers.get_content_charset() or "utf-8"
                return resp.read().decode(charset, errors="replace")
    except Exception:
        return None
    return None


def _cleanup_children() -> None:
    for proc in _children:
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
    time.sleep(0.5)
    for proc in _children:
        if proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass


def _register_child(proc: subprocess.Popen) -> None:
    _children.append(proc)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _resolve_python(mode: str) -> str:
    if mode == "system":
        return sys.executable

    if sys.platform == "win32":
        venv_python = VENV_DIR / "Scripts" / "python.exe"
    else:
        venv_python = VENV_DIR / "bin" / "python"
    if not venv_python.exists():
        raise RuntimeError(
            "Project venv not found. Please run scripts/setup_windows.bat or scripts/setup_unix.sh."
        )
    return str(venv_python)


def _resolve_node_command() -> str:
    candidates = ["node", "nodejs"]
    for cmd in candidates:
        try:
            result = subprocess.run(
                [cmd, "--version"],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=10,
            )
            if result.returncode == 0:
                return cmd
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
    raise RuntimeError("Node.js not found. Please install Node.js 18+ first.")


def _resolve_npm_command(node_cmd: str) -> str:
    candidates = ["npm.cmd", "npm"] if sys.platform == "win32" else ["npm"]
    for cmd in candidates:
        try:
            result = subprocess.run(
                [cmd, "--version"],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=10,
            )
            if result.returncode == 0:
                return cmd
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue

    try:
        raw = subprocess.check_output(
            [node_cmd, "-e", "process.execPath"],
            text=True,
            errors="replace",
            timeout=10,
        ).strip()
        if raw:
            node_dir = str(Path(raw).parent)
            for name in ("npm.cmd", "npm"):
                candidate = os.path.join(node_dir, name)
                if os.path.exists(candidate):
                    return candidate
    except Exception:
        pass

    raise RuntimeError("npm not found.")


def _ensure_frontend_env(backend_port: int, frontend_port: int) -> None:
    backend_url = f"http://127.0.0.1:{backend_port}"
    content = (
        "# Generated by scripts/app_launcher.py - do not commit\n"
        f"VITE_API_PROXY_TARGET={backend_url}\n"
        f"VITE_SERVER_BASE={backend_url}\n"
        f"VITE_PORT={frontend_port}\n"
    )
    ENV_LOCAL.parent.mkdir(parents=True, exist_ok=True)
    ENV_LOCAL.write_text(content, encoding="utf-8")


def _start_backend(python_path: str, backend_port: int, debug_windows: bool) -> subprocess.Popen:
    cmd = [
        python_path,
        "-m",
        "uvicorn",
        "studio.api.app:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(backend_port),
        "--reload",
    ]
    log.info("Starting backend on port %d", backend_port)

    backend_log = BACKEND_LOG.open("wb")
    kwargs = {
        "cwd": str(REPO_ROOT),
        "stdout": backend_log,
        "stderr": subprocess.STDOUT,
    }
    if sys.platform == "win32" and not debug_windows:
        kwargs["creationflags"] = CREATE_NO_WINDOW

    proc = subprocess.Popen(cmd, **kwargs)
    _register_child(proc)
    return proc


def _start_frontend(npm_cmd: str, frontend_port: int, debug_windows: bool) -> subprocess.Popen:
    cmd = [
        npm_cmd,
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        str(frontend_port),
    ]
    log.info("Starting frontend on port %d", frontend_port)

    frontend_log = FRONTEND_LOG.open("wb")
    kwargs = {
        "cwd": str(FRONTEND_DIR),
        "stdout": frontend_log,
        "stderr": subprocess.STDOUT,
    }
    if sys.platform == "win32" and not debug_windows:
        kwargs["creationflags"] = CREATE_NO_WINDOW

    proc = subprocess.Popen(cmd, **kwargs)
    _register_child(proc)
    return proc


def _wait_for_backend(backend_port: int, max_wait: float = 60.0, interval: float = 1.0) -> Tuple[bool, float]:
    health_urls = [
        f"http://127.0.0.1:{backend_port}/api/v1/health",
        f"http://127.0.0.1:{backend_port}/docs",
        f"http://127.0.0.1:{backend_port}/",
    ]

    start = time.time()
    while time.time() - start < max_wait:
        for url in health_urls:
            try:
                with urllib.request.urlopen(url, timeout=2) as resp:
                    if resp.status < 400:
                        return True, time.time() - start
            except Exception:
                continue
        time.sleep(interval)
    return False, time.time() - start


def _wait_for_frontend(frontend_port: int, max_wait: float = 60.0, interval: float = 1.0) -> Tuple[bool, float]:
    url = f"http://127.0.0.1:{frontend_port}/"
    start = time.time()
    while time.time() - start < max_wait:
        text = _http_get_text(url, timeout=3)
        if text and ("<html" in text.lower() or "script" in text.lower()):
            return True, time.time() - start
        if _http_ok(url, timeout=2):
            return True, time.time() - start
        time.sleep(interval)
    return False, time.time() - start


def _print_failure_summary(backend_alive: bool, frontend_alive: bool) -> None:
    log.error("")
    log.error("=" * 52)
    log.error("Launch failed")
    log.error("=" * 52)
    log.error("Backend alive:  %s", "YES" if backend_alive else "NO")
    log.error("Frontend alive: %s", "YES" if frontend_alive else "NO")
    log.error("")
    log.error("Launcher log: %s", LAUNCHER_LOG)
    log.error("Backend log:  %s", BACKEND_LOG)
    log.error("Frontend log: %s", FRONTEND_LOG)
    log.error("Ports file:    %s", PORTS_FILE)
    for title, path in [("Backend", BACKEND_LOG), ("Frontend", FRONTEND_LOG)]:
        if not path.exists():
            continue
        log.error("")
        log.error("%s log tail:", title)
        tail = path.read_text(encoding="utf-8", errors="replace").splitlines()[-40:]
        for line in tail:
            log.error("  %s", line.rstrip())


def _run_local_check(python_path: str, script_name: str) -> None:
    script_path = REPO_ROOT / "scripts" / script_name
    result = subprocess.run(
        [python_path, str(script_path)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        errors="replace",
    )
    if result.returncode != 0:
        if result.stdout.strip():
            log.info(result.stdout.strip())
        if result.stderr.strip():
            log.error(result.stderr.strip())
        raise RuntimeError(f"{script_name} failed.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Cluster Organizer Launcher")
    parser.add_argument("--mode", choices=["venv", "system"], default="venv")
    parser.add_argument("--debug-windows", action="store_true")
    parser.add_argument("--skip-deps", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    _setup_logging(debug=args.debug_windows)
    log.info("Cluster Organizer Launcher")
    log.info("Repository: %s", REPO_ROOT)
    log.info("Mode: %s", args.mode)
    if args.skip_deps:
        log.info("Dependency installation is disabled in this launcher.")
    log.info("")

    atexit.register(_cleanup_children)
    if sys.platform != "win32":
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, lambda s, f: (_cleanup_children(), sys.exit(128 + s)))
            except (ValueError, OSError):
                pass

    try:
        _run_local_check(sys.executable, "check_install_state.py")
        python_path = _resolve_python(args.mode)
        _run_local_check(python_path, "check_runtime_imports.py")

        node_cmd = _resolve_node_command()
        npm_cmd = _resolve_npm_command(node_cmd)

        backend_port = _select_port(BACKEND_PREFERRED_PORT, BACKEND_PORT_RANGE)
        frontend_port = _select_port(FRONTEND_PREFERRED_PORT, FRONTEND_PORT_RANGE)

        _ensure_frontend_env(backend_port, frontend_port)

        ports_data = {
            "backend_host": "127.0.0.1",
            "backend_port": backend_port,
            "backend_url": f"http://127.0.0.1:{backend_port}",
            "frontend_host": "127.0.0.1",
            "frontend_port": frontend_port,
            "frontend_url": f"http://127.0.0.1:{frontend_port}",
        }
        _write_json(PORTS_FILE, ports_data)

        backend_proc = _start_backend(python_path, backend_port, args.debug_windows)
        frontend_proc = _start_frontend(npm_cmd, frontend_port, args.debug_windows)

        backend_ok, backend_elapsed = _wait_for_backend(backend_port)
        frontend_ok, frontend_elapsed = _wait_for_frontend(frontend_port)
        _write_json(
            HEALTHCHECK_FILE,
            {
                "backend_ok": backend_ok,
                "backend_elapsed_sec": round(backend_elapsed, 1),
                "frontend_ok": frontend_ok,
                "frontend_elapsed_sec": round(frontend_elapsed, 1),
                "backend_port": backend_port,
                "frontend_port": frontend_port,
            },
        )

        if not (backend_ok and frontend_ok):
            _print_failure_summary(backend_proc.poll() is None, frontend_proc.poll() is None)
            return 1

        frontend_url = f"http://127.0.0.1:{frontend_port}/react/organize/"
        log.info("")
        log.info("Project is running")
        log.info("Frontend: %s", ports_data["frontend_url"])
        log.info("Backend:  %s", ports_data["backend_url"])
        log.info("API docs: %s/docs", ports_data["backend_url"])
        log.info("")

        if not args.no_browser:
            webbrowser.open(frontend_url)

        log.info("Close this window to stop all services.")
        log.info("Logs are in .runtime/")

        while True:
            if backend_proc.poll() is not None:
                log.error("Backend exited unexpectedly with code %s", backend_proc.returncode)
                _print_failure_summary(False, frontend_proc.poll() is None)
                return 1
            if frontend_proc.poll() is not None:
                log.error("Frontend exited unexpectedly with code %s", frontend_proc.returncode)
                _print_failure_summary(backend_proc.poll() is None, False)
                return 1
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down...")
        return 0
    except Exception as exc:
        log.error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
