#!/usr/bin/env python3
"""
export_clean.py — Export a clean release package with only code and essential files.

Excludes:
  - Virtual environments (.venv/, venv/)
  - Node modules (node_modules/)
  - Python cache (__pycache__/, *.pyc)
  - Runtime files (.runtime/)
  - Output and test output directories
  - External dependencies (depth-anything-3/, stitch_light_analysis_engine/)
  - Personal configs, large test images, AI conversation dumps
  - Git history

Usage:
    python scripts/export_clean.py
    python scripts/export_clean.py --output-dir ../cluster-organizer-clean
    python scripts/export_clean.py --dry-run    # preview without copying
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Files and directories to ALWAYS include (even if they match exclusion patterns)
FORCE_INCLUDE = {
    "scripts/app_launcher.py",
    "scripts/smoke_test.py",
    "scripts/reset_local_state.py",
    "scripts/export_clean.py",
    "START_VENV.bat",
    "START_LOCAL.bat",
    "START_LOCAL.bat",
    "start.sh",
    "requirements.txt",
    ".gitignore",
}

# Directories to exclude entirely
EXCLUDE_DIRS = {
    ".venv",
    "venv",
    "env",
    "node_modules",
    "__pycache__",
    ".runtime",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".git",
    ".vscode",
    ".idea",
    ".agents",
    ".claude",
    "lighting_outputs",
    "exports",
    "tmp",
    "temp",
    "backup",
    "backup_before_v4",
    "graphify-out",
    "depth-anything-3",
    "stitch_light_analysis_engine",
    "_da3_wheel_extracted",
    # Planning docs (not essential for running)
    "superpowers",
    # Output / test dirs
    "test_fix_output",
    "test_fix_v2",
    "test_fix_v3",
    "test_fix_v4",
    "test_fix_v5",
    "test_full_v6",
    "test_full_v7",
    "test_smoke_output",
    "_validation_outputs",
    "_histogram_acceptance",
    "_histogram_data",
    "_histogram_label_calibration",
    "_histogram_label_ab_compare",
    "_histogram_acceptance_after_apply",
    "_residual_refine_experiment",
    "shexyo-47",
    "写真test",
    "写真test_output",
    "氛围test",
    "氛围test_output",
    "ready_for_training_folder",
    # Build artifacts
    "dist",
    "build",
    "*.egg-info",
}

# File patterns to exclude
EXCLUDE_PATTERNS = {
    "*.pyc",
    "*.pyo",
    "*.pyd",
    "*.swp",
    "*.swo",
    "*.tmp",
    "*.log",
    "Thumbs.db",
    ".DS_Store",
    "Desktop.ini",
}

# Large directories (by name pattern) that should be excluded
EXCLUDE_NAME_PATTERNS = {
    "thumbnails",
    "backup_*",
    "lighting_engine_backup_*",
    "test_thumb*",
}

# Specific files to exclude
EXCLUDE_FILES = {
    "config_saved.json",
    "nul",
    # Stray test files in root
    "16-dim",
    "depth_test.py",
    "test_log.txt",
    "test_pipeline.py",
    # AI / chat dumps
    "HANDOFF.md",
    "HANDOFF_CURRENT.md",
    "HANDOFF_接手文档.md",
    # Generated env files
    ".env.local",
    "studio/frontend_react/.env.local",
    # Planning docs (not essential for running)
    "docs/skill.md",
}


def _matches_any(path: Path, patterns: set) -> bool:
    """Check if a path name matches any glob pattern or exact name."""
    name = path.name
    if name in patterns:
        return True
    for pat in patterns:
        if "*" in pat:
            from fnmatch import fnmatch
            if fnmatch(name, pat):
                return True
    return False


def _should_exclude(path: Path, rel_path: str) -> bool:
    """Return True if the given path should be excluded from the clean package."""
    # Force-include overrides exclusions
    if rel_path in FORCE_INCLUDE:
        return False

    # Check exclude dirs (by relative path component)
    parts = path.relative_to(REPO_ROOT).parts
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True
        # Check glob patterns for dir names
        for pat in EXCLUDE_DIRS:
            if "*" in pat:
                from fnmatch import fnmatch
                if fnmatch(part, pat):
                    return True

    # For directories, check name patterns
    if path.is_dir():
        name = path.name
        for pat in EXCLUDE_NAME_PATTERNS:
            if "*" in pat:
                from fnmatch import fnmatch
                if fnmatch(name, pat):
                    return True
            elif name.startswith(pat.replace("*", "")):
                return True

    # For files, check exclude patterns
    if path.is_file():
        if _matches_any(path, EXCLUDE_PATTERNS):
            return True
        if rel_path in EXCLUDE_FILES:
            return True

    return False


def _collect_files(root: Path) -> list[tuple[Path, str]]:
    """Collect all files to include, returning (source_path, relative_path) tuples."""
    collected = []
    for filepath in sorted(root.rglob("*")):
        if not filepath.is_file():
            continue
        rel = filepath.relative_to(root).as_posix()
        if _should_exclude(filepath, rel):
            continue
        collected.append((filepath, rel))
    return collected


def main() -> None:
    parser = argparse.ArgumentParser(description="Export clean release package")
    parser.add_argument(
        "--output-dir", "-o",
        default=str(REPO_ROOT.parent / "cluster-organizer-clean"),
        help="Output directory for the clean package (default: ../cluster-organizer-clean)",
    )
    parser.add_argument(
        "--dry-run", "-n", action="store_true",
        help="Preview files that would be copied without copying",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    files = _collect_files(REPO_ROOT)

    print(f"Cluster Organizer — Clean Package Export")
    print(f"Source:      {REPO_ROOT}")
    print(f"Output:      {output_dir}")
    print(f"Files found: {len(files)}")
    print()

    if args.dry_run:
        print("Files to export:")
        for _, rel in files:
            print(f"  {rel}")
        print(f"\nTotal: {len(files)} files")
        return

    # Copy files
    output_dir.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src, rel in files:
        dst = output_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(src, dst)
            copied += 1
        except Exception as e:
            print(f"  ✗  Failed to copy {rel}: {e}")

    print(f"  Copied {copied}/{len(files)} files to {output_dir}")
    print()

    # Write a README in the clean package
    readme = output_dir / "README_CLEAN_PACKAGE.md"
    readme_content = f"""# Cluster Organizer — Clean Package

Exported from: {REPO_ROOT.name}
Export date: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
Total files: {copied}

## Quick Start

	### Windows (venv recommended)
	```
	START_VENV.bat
	```
	
	### Windows (system Python)
	```
	START_LOCAL.bat
	```

### Linux / macOS
```
chmod +x start.sh
./start.sh
```

## What's included

- Source code: `studio/`, `lighting_engine/`
- Test files: `tests/`
- Documentation: `docs/`
- Build system: `ai-build/`
- Launcher: `scripts/`
- Tools: `tools/`

## What's NOT included (excluded on purpose)

- Virtual environments, node_modules, __pycache__
- Test outputs, generated data, runtime logs
- External dependencies (depth-anything-3, stitch_light_analysis_engine)
- Large test image directories
- Personal configs, AI conversation dumps
- Git history

## First-time setup

The launcher will automatically:
1. Create a `.venv` virtual environment
2. Install Python dependencies (`pip install -r requirements.txt`)
3. Install frontend dependencies (`npm install`)
4. Start the application

Or use `START_LOCAL.bat` to install into system Python directly.
"""
    readme.write_text(readme_content, encoding="utf-8")
    print(f"  Wrote {readme.relative_to(output_dir.parent) if readme.parent == output_dir.parent.parent else readme}")

    # Count by category
    from collections import Counter
    extensions = Counter()
    for _, rel in files:
        ext = Path(rel).suffix or "(no ext)"
        extensions[ext] += 1
    print()
    print("File type breakdown:")
    for ext, count in extensions.most_common(10):
        print(f"  {ext:10s} {count:4d} files")
    print()

    # Total size
    total_size = sum(src.stat().st_size for src, _ in files)
    print(f"Total size: {total_size / 1024 / 1024:.1f} MB")
    print()
    print("Done. Clean package is ready at:", output_dir)


if __name__ == "__main__":
    main()
