from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.dependency_catalog import importables_for_runtime_check  # noqa: E402


def main() -> int:
    missing: list[str] = []
    for module_name in importables_for_runtime_check():
        if importlib.util.find_spec(module_name) is None:
            missing.append(module_name)

    if missing:
        print("NEED_SETUP")
        print(
            "Missing runtime imports: " + ", ".join(sorted(missing)),
            file=sys.stderr,
        )
        print(
            "依赖缺失，请运行 scripts/setup_windows.bat 或 scripts/setup_unix.sh",
            file=sys.stderr,
        )
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
