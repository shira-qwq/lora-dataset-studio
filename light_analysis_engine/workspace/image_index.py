from __future__ import annotations

import base64
import csv
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

from .layout import WorkspaceLayout
from .manifest import JobManifest


def stable_image_id(value: str) -> str:
    raw = str(value or "").replace("\\", "/")
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def decode_image_id(value: str) -> str:
    padding = "=" * (-len(value or "") % 4)
    try:
        return base64.urlsafe_b64decode((value + padding).encode("ascii")).decode("utf-8")
    except Exception:
        return value


@dataclass
class ImageIndexEntry:
    image_id: str
    source_path: Path
    relative_path: str
    filename: str
    width: int | None = None
    height: int | None = None
    file_size: int | None = None
    exists: bool = True
    hash: str | None = None
    created_at: str | None = None

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["source_path"] = str(self.source_path)
        return data

    def aliases(self) -> set[str]:
        return {self.image_id, self.relative_path, self.filename, str(self.source_path)}


class ImageIndex:
    def __init__(self, entries: Iterable[ImageIndexEntry]):
        self.entries = list(entries)
        self.by_id: dict[str, ImageIndexEntry] = {}
        for entry in self.entries:
            self.by_id[entry.image_id] = entry
            self.by_id.setdefault(stable_image_id(entry.relative_path), entry)
            self.by_id.setdefault(stable_image_id(entry.filename), entry)

    def get(self, image_id: str) -> ImageIndexEntry | None:
        if image_id in self.by_id:
            return self.by_id[image_id]
        decoded = decode_image_id(image_id)
        for key in (decoded, Path(decoded).name, stable_image_id(decoded), stable_image_id(Path(decoded).name)):
            if key in self.by_id:
                return self.by_id[key]
        return None


def _read_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _iter_index_records(data: Any) -> Iterable[dict[str, Any]]:
    if isinstance(data, dict):
        images = data.get("images", data)
        if isinstance(images, dict):
            for key, value in images.items():
                if isinstance(value, dict):
                    row = dict(value)
                    row.setdefault("image_id", key)
                    yield row
        elif isinstance(images, list):
            for item in images:
                if isinstance(item, dict):
                    yield item
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                yield item


def _relative_to_inputs(source: Path, manifest: JobManifest) -> str:
    try:
        resolved = source.resolve()
    except (OSError, RuntimeError):
        resolved = source
    for root in manifest.input_roots:
        try:
            return str(resolved.relative_to(root.resolve())).replace("\\", "/")
        except (OSError, ValueError):
            continue
    return source.name


def normalize_index_record(row: dict[str, Any], manifest: JobManifest) -> ImageIndexEntry:
    raw_source = (
        row.get("source_path")
        or row.get("original_path")
        or row.get("image_path")
        or row.get("path")
        or row.get("file")
        or row.get("src")
        or row.get("filename")
        or ""
    )
    source = Path(str(raw_source)).expanduser()
    if not source.is_absolute() and (manifest.output_root / source).exists():
        source = manifest.output_root / source
    if not source.is_absolute() and manifest.input_roots:
        for root in manifest.input_roots:
            candidate = root / source
            if candidate.exists():
                source = candidate
                break
    relative_path = str(row.get("relative_path") or _relative_to_inputs(source, manifest)).replace("\\", "/")
    filename = str(row.get("filename") or Path(relative_path).name or source.name)
    image_id = str(row.get("image_id") or stable_image_id(relative_path or str(source)))
    try:
        file_size = int(row.get("file_size") or source.stat().st_size)
    except Exception:
        file_size = None
    exists = bool(row.get("exists", source.exists()))
    return ImageIndexEntry(
        image_id=image_id,
        source_path=source.expanduser().resolve() if source.exists() else source,
        relative_path=relative_path,
        filename=filename,
        width=_int_or_none(row.get("width") or row.get("original_width")),
        height=_int_or_none(row.get("height") or row.get("original_height")),
        file_size=file_size,
        exists=exists,
        hash=row.get("hash") or row.get("sha256"),
        created_at=row.get("created_at"),
    )


def _int_or_none(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _read_csv_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        with open(path, encoding="utf-8", newline="") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


def _fallback_rows(layout: WorkspaceLayout) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name in ("atlas_points.csv", "umap_points_3d.csv", "features.csv"):
        for path in layout.read_file_candidates(name):
            rows = _read_csv_rows(path)
            if rows:
                return rows
    return rows


def load_image_index(layout: WorkspaceLayout, manifest: JobManifest) -> ImageIndex:
    data = _read_json(layout.image_index_path) or _read_json(layout.output_root / "image_index.json")
    rows = list(_iter_index_records(data))
    if not rows:
        rows = _fallback_rows(layout)
    entries = [normalize_index_record(row, manifest) for row in rows]
    return ImageIndex(entries)


def write_image_index(layout: WorkspaceLayout, entries: Iterable[ImageIndexEntry]) -> Path:
    layout.ensure_runtime_dirs()
    payload = {
        "version": 1,
        "images": [entry.to_json() for entry in entries],
    }
    with open(layout.image_index_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    return layout.image_index_path
