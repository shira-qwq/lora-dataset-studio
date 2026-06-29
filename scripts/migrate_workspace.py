from __future__ import annotations

import argparse
import json
from pathlib import Path

from light_analysis_engine.workspace import (
    WorkspaceLayout,
    infer_job_manifest,
    load_image_index,
    load_job_manifest,
    write_image_index,
    write_job_manifest,
)


def migrate(job: Path, apply: bool) -> dict:
    layout = WorkspaceLayout.from_output_root(job)
    manifest_existed = layout.job_manifest_path.exists()
    index_existed = layout.image_index_path.exists()
    manifest = load_job_manifest(layout)
    if not manifest_existed:
        manifest = infer_job_manifest(layout, job_id=manifest.job_id)
    index = load_image_index(layout, manifest)
    missing = [
        {
            "image_id": entry.image_id,
            "filename": entry.filename,
            "source_path": str(entry.source_path),
            "reason": "source file missing",
        }
        for entry in index.entries
        if not entry.source_path.exists()
    ]
    report = {
        "job": str(layout.output_root),
        "manifest_existed": manifest_existed,
        "image_index_existed": index_existed,
        "image_count": len(index.entries),
        "missing_count": len(missing),
        "missing": missing[:200],
        "would_write": {
            "manifest": str(layout.job_manifest_path),
            "image_index": str(layout.image_index_path),
        },
    }
    if apply:
        write_job_manifest(layout, manifest)
        write_image_index(layout, index.entries)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize a job workspace manifest and image index.")
    parser.add_argument("--job", required=True, help="Job output_root path")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Report changes without writing")
    group.add_argument("--apply", action="store_true", help="Write normalized manifest/index metadata")
    args = parser.parse_args()
    report = migrate(Path(args.job), apply=args.apply)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
