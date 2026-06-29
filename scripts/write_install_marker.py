from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.dependency_state import (  # noqa: E402
    MARKER_PATH,
    build_install_marker,
    write_json_atomic,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Write .setup/installed.json")
    parser.add_argument("--venv-path", default=".venv")
    args = parser.parse_args()

    marker = build_install_marker(REPO_ROOT, venv_path=args.venv_path)
    write_json_atomic(MARKER_PATH, marker)
    print(str(MARKER_PATH))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

