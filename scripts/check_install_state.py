from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.dependency_state import (  # noqa: E402
    REPO_ROOT,
    current_package_hash,
    current_requirements_hash,
    load_install_marker,
)


def _marker_venv_path(marker: dict) -> Path | None:
    venv_path = marker.get("venv_path")
    if not venv_path:
        return None
    path = Path(venv_path)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path


def main() -> int:
    marker = load_install_marker(REPO_ROOT)
    if not marker:
        print("NEED_SETUP")
        return 1

    expected_requirements_hash = marker.get("requirements_hash")
    expected_package_hash = marker.get("package_lock_hash")
    expected_node_modules = bool(marker.get("node_modules_checked"))

    current_requirements = current_requirements_hash(REPO_ROOT)
    current_packages = current_package_hash(REPO_ROOT)

    problems: list[str] = []
    if expected_requirements_hash != current_requirements:
        problems.append("requirements changed")
    if expected_package_hash != current_packages:
        problems.append("frontend package files changed")

    venv_path = _marker_venv_path(marker)
    if venv_path is not None and not venv_path.exists():
        problems.append(f"venv missing: {venv_path}")

    node_modules = REPO_ROOT / "studio" / "frontend_react" / "node_modules"
    if expected_node_modules and not node_modules.is_dir():
        problems.append("node_modules missing")

    if problems:
        print("NEED_SETUP")
        for item in problems:
            print(item, file=sys.stderr)
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
