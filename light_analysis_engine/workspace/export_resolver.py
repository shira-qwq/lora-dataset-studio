from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException

from .layout import WorkspaceLayout
from .media_resolver import MediaResolver


def sanitize_filename(name: str, max_len: int = 120, fallback: str = "export") -> str:
    raw = str(name or fallback).strip() or fallback
    cleaned = "".join("_" if ch in '<>:"/\\|?*' or ord(ch) < 32 else ch for ch in raw)
    cleaned = cleaned.replace(" ", "_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    cleaned = cleaned.strip("_")
    return (cleaned or fallback)[:max_len]


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for idx in range(1, 10000):
        candidate = path.with_name(f"{stem}_{idx}{suffix}")
        if not candidate.exists():
            return candidate
    return path


@dataclass
class ExportRequest:
    image_ids: list[str]
    folder_name: str = "export"
    rename_mode: str = "keep_original"
    skip_duplicates: bool = False


@dataclass
class ExportResult:
    ok: bool
    export_id: str
    export_dir: str
    copied_count: int
    skipped_count: int
    warnings: list[str]
    manifest_path: str


class ExportResolver:
    def __init__(self, job_id: str, layout: WorkspaceLayout, media: MediaResolver):
        self.job_id = job_id
        self.layout = layout
        self.media = media

    def export_images(self, request: ExportRequest) -> ExportResult:
        if not request.image_ids:
            raise HTTPException(400, "image_ids is required")
        export_name = sanitize_filename(request.folder_name, fallback="export")
        export_dir = self._unique_export_dir(export_name)
        export_dir.mkdir(parents=True, exist_ok=True)
        copied = 0
        skipped = 0
        warnings: list[str] = []
        items: list[dict] = []
        seen: set[str] = set()
        for idx, image_id in enumerate(request.image_ids, start=1):
            if request.skip_duplicates and image_id in seen:
                skipped += 1
                continue
            seen.add(image_id)
            try:
                src = self.media.get_source_path(image_id)
            except HTTPException:
                skipped += 1
                warnings.append(f"source file missing: {image_id}")
                continue
            filename = self._export_filename(src, idx, request.rename_mode, export_name)
            dst = unique_path(export_dir / filename)
            shutil.copy2(src, dst)
            copied += 1
            items.append({
                "image_id": image_id,
                "source_path": str(src),
                "source_path_rel": self._try_relpath(src, self.layout.output_root),
                "export_path": str(dst),
                "export_path_rel": self._try_relpath(dst, self.layout.output_root),
                "original_filename": src.name,
                "export_filename": dst.name,
            })
        if copied == 0:
            raise HTTPException(400, "No valid original images found for provided image_ids")
        export_id = f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        record = {
            "version": 2,
            "export_id": export_id,
            "job_id": self.job_id,
            "created_at": datetime.now().isoformat(),
            "export_dir": str(export_dir),
            "export_dir_rel": self._try_relpath(export_dir, self.layout.output_root),
            "copied_count": copied,
            "skipped_count": skipped,
            "items": items,
            "warnings": warnings,
        }
        self.layout.export_records_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = self.layout.export_records_dir / f"{export_id}.json"
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)
        return ExportResult(True, export_id, str(export_dir), copied, skipped, warnings, str(manifest_path))

    def _unique_export_dir(self, export_name: str) -> Path:
        base = self.layout.exports_dir
        base.mkdir(parents=True, exist_ok=True)
        candidate = base / export_name
        if not candidate.exists():
            return candidate
        for idx in range(1, 1000):
            candidate = base / f"{export_name}_{idx:03d}"
            if not candidate.exists():
                return candidate
        return base / f"{export_name}_{999:03d}"

    @staticmethod
    def _export_filename(src: Path, idx: int, mode: str, folder: str) -> str:
        if mode in {"sequence_original", "index_original"}:
            return sanitize_filename(f"{idx:04d}_{src.name}", max_len=180, fallback=src.name)
        if mode == "template":
            return sanitize_filename(f"{folder}_{idx:04d}{src.suffix}", max_len=180, fallback=src.name)
        return sanitize_filename(src.name, max_len=180, fallback=src.name)

    @staticmethod
    def _try_relpath(path: Path, base: Path) -> str:
        try:
            return str(path.relative_to(base))
        except (ValueError, OSError):
            return str(path)
