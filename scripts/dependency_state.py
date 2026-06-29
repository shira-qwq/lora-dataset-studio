from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence


REPO_ROOT = Path(__file__).resolve().parent.parent
SETUP_DIR = REPO_ROOT / ".setup"
MARKER_PATH = SETUP_DIR / "installed.json"
FRONTEND_DIR = REPO_ROOT / "studio" / "frontend_react"


def existing_paths(paths: Sequence[Path]) -> list[Path]:
    return [path for path in paths if path.exists()]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def combined_hash(paths: Sequence[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        if not path.exists():
            continue
        digest.update(path.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def current_requirements_files(repo_root: Path = REPO_ROOT) -> list[Path]:
    files = [
        repo_root / "requirements.txt",
        repo_root / "requirements-dev.txt",
    ]
    return existing_paths(files)


def current_frontend_package_files(repo_root: Path = REPO_ROOT) -> list[Path]:
    frontend_dir = repo_root / "studio" / "frontend_react"
    files = [
        frontend_dir / "package.json",
        frontend_dir / "package-lock.json",
    ]
    return existing_paths(files)


def current_requirements_hash(repo_root: Path = REPO_ROOT) -> str:
    return combined_hash(current_requirements_files(repo_root))


def current_package_hash(repo_root: Path = REPO_ROOT) -> str:
    return combined_hash(current_frontend_package_files(repo_root))


def build_install_marker(
    repo_root: Path = REPO_ROOT,
    *,
    python_version: str | None = None,
    venv_path: str = ".venv",
) -> dict:
    if python_version is None:
        python_version = sys.version.split()[0]
    node_modules = repo_root / "studio" / "frontend_react" / "node_modules"
    return {
        "installed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "python_version": python_version,
        "requirements_hash": current_requirements_hash(repo_root),
        "package_lock_hash": current_package_hash(repo_root),
        "node_modules_checked": node_modules.is_dir(),
        "venv_path": venv_path,
        "requirements_files": [path.relative_to(repo_root).as_posix() for path in current_requirements_files(repo_root)],
        "package_files": [path.relative_to(repo_root).as_posix() for path in current_frontend_package_files(repo_root)],
    }


def load_install_marker(repo_root: Path = REPO_ROOT) -> dict | None:
    path = repo_root / ".setup" / "installed.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def write_json_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
