#!/usr/bin/env python3
"""
reset_local_state.py — Reset runtime files and generated env files.

Cleans:
  .runtime/         (ports.json, healthcheck.json, logs, etc.)
  .env.local        (frontend env override)
  studio/frontend_react/.env.local

Usage:
    python scripts/reset_local_state.py
    python scripts/reset_local_state.py --dry-run   # preview without deleting
    python scripts/reset_local_state.py --all        # also remove .venv/ node_modules/
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [
    ROOT / ".runtime",
    ROOT / ".env.local",
    ROOT / "studio" / "frontend_react" / ".env.local",
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset local runtime state")
    parser.add_argument("--dry-run", action="store_true", help="Preview without deleting")
    parser.add_argument("--all", action="store_true", help="Also remove .venv and node_modules")
    args = parser.parse_args()

    targets = list(TARGETS)
    if args.all:
        targets.extend([
            ROOT / ".venv",
            ROOT / "studio" / "frontend_react" / "node_modules",
        ])

    print("Reset local state")
    print(f"Repository: {ROOT}")
    print()

    removed = 0
    for path in targets:
        if not path.exists():
            print(f"  ✓  {path.relative_to(ROOT)} — does not exist")
            continue

        if args.dry_run:
            what = "directory" if path.is_dir() else "file"
            print(f"  →  would remove {what}: {path.relative_to(ROOT)}")
            removed += 1
        else:
            try:
                if path.is_dir():
                    shutil.rmtree(path)
                    print(f"  ✓  removed directory: {path.relative_to(ROOT)}")
                else:
                    path.unlink()
                    print(f"  ✓  removed file: {path.relative_to(ROOT)}")
                removed += 1
            except Exception as e:
                print(f"  ✗  failed to remove {path.relative_to(ROOT)}: {e}")

    if args.dry_run:
        print(f"\nWould remove {removed} item(s). Run without --dry-run to execute.")
    else:
        print(f"\nRemoved {removed} item(s).")


if __name__ == "__main__":
    main()
