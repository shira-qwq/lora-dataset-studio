"""Compatibility wrapper around the unified job workspace runtime kit."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from light_analysis_engine.workspace import WorkspaceLayout
from light_analysis_engine.workspace.compatibility import resolve_output_root as _resolve_output_root
from light_analysis_engine.workspace.export_resolver import sanitize_filename, unique_path

logger = logging.getLogger("path_resolver")


def resolve_output_root(job_id: str) -> Optional[Path]:
    return _resolve_output_root(job_id)


def resolve_job_dir(job_id: str) -> Optional[Path]:
    return resolve_output_root(job_id)


def _layout(job_id: str) -> Optional[WorkspaceLayout]:
    root = resolve_output_root(job_id)
    return WorkspaceLayout.from_output_root(root) if root else None


def resolve_internal_dir(job_id: str) -> Optional[Path]:
    layout = _layout(job_id)
    return layout.studio_dir if layout else None


def resolve_internal_file(job_id: str, filename: str) -> Optional[Path]:
    layout = _layout(job_id)
    if not layout:
        return None
    for candidate in layout.read_file_candidates(filename):
        if candidate.exists():
            return candidate
    return layout.studio_dir / filename


def resolve_exports_dir(job_id: str) -> Optional[Path]:
    layout = _layout(job_id)
    return layout.exports_dir if layout else None


def resolve_export_dir(job_id: str, export_name: str) -> Optional[Path]:
    exports = resolve_exports_dir(job_id)
    return exports / export_name if exports else None


def unique_export_dir(job_id: str, export_name: str) -> Optional[Path]:
    exports = resolve_exports_dir(job_id)
    if not exports:
        return None
    exports.mkdir(parents=True, exist_ok=True)
    candidate = exports / export_name
    if not candidate.exists():
        return candidate
    for idx in range(1, 1000):
        candidate = exports / f"{export_name}_{idx:03d}"
        if not candidate.exists():
            return candidate
    return exports / f"{export_name}_{999:03d}"


def resolve_export_records_dir(job_id: str) -> Optional[Path]:
    layout = _layout(job_id)
    return layout.export_records_dir if layout else None


def resolve_cache_dir(job_id: str) -> Optional[Path]:
    layout = _layout(job_id)
    return layout.cache_dir if layout else None


def resolve_thumbnail_dir(job_id: str, size: int = 256) -> Optional[Path]:
    layout = _layout(job_id)
    return layout.thumbnail_size_dir(size) if layout else None


def find_thumbnail_file(job_id: str, stem: str, size: int = 256) -> Optional[Path]:
    layout = _layout(job_id)
    if not layout:
        return None
    candidates = [
        layout.thumbnail_size_dir(size) / f"{stem}.jpg",
        layout.thumbnails_dir / f"{stem}.jpg",
        layout.output_root / "thumbnails" / str(size) / f"{stem}.jpg",
        layout.output_root / "thumbnails" / f"{stem}.jpg",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def resolve_reports_dir(job_id: str) -> Optional[Path]:
    layout = _layout(job_id)
    return layout.reports_dir if layout else None


def unique_filename(dst: Path) -> Path:
    return unique_path(dst)


def write_export_record(job_id: str, record: dict) -> Optional[Path]:
    records_dir = resolve_export_records_dir(job_id)
    if not records_dir:
        return None
    records_dir.mkdir(parents=True, exist_ok=True)
    export_id = record.get("export_id", "unknown")
    path = records_dir / f"{export_id}.json"
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)
        return path
    except OSError as e:
        logger.warning("Failed to write export record %s: %s", export_id, e)
        return None


def read_export_record(job_id: str, export_id: str) -> Optional[dict]:
    records_dir = resolve_export_records_dir(job_id)
    if not records_dir:
        return None
    path = records_dir / f"{export_id}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def list_export_records(job_id: str) -> list[dict]:
    records_dir = resolve_export_records_dir(job_id)
    if not records_dir or not records_dir.exists():
        return []
    records = []
    for path in sorted(records_dir.glob("*.json")):
        try:
            with open(path, encoding="utf-8") as f:
                records.append(json.load(f))
        except Exception:
            continue
    return records
