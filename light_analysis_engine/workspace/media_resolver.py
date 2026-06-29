from __future__ import annotations

import mimetypes
from dataclasses import asdict, dataclass
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import Response

from .image_index import ImageIndexEntry
from .layout import WorkspaceLayout


@dataclass
class ImageRef:
    image_id: str
    filename: str
    width: int | None
    height: int | None
    exists: bool
    thumbnail_url: str | None
    original_url: str | None
    missing_reason: str | None = None

    def to_json(self) -> dict:
        return asdict(self)


class MediaResolver:
    def __init__(self, job_id: str, layout: WorkspaceLayout, entries: list[ImageIndexEntry], api_prefix: str = "/api/v1"):
        self.job_id = job_id
        self.layout = layout
        self.entries = entries
        self.api_prefix = api_prefix.rstrip("/")
        self.by_id = {entry.image_id: entry for entry in entries}
        for entry in entries:
            self.by_id.setdefault(entry.filename, entry)

    def _entry(self, image_id: str) -> ImageIndexEntry:
        entry = self.by_id.get(image_id)
        if entry:
            return entry
        from .image_index import ImageIndex
        index = ImageIndex(self.entries)
        entry = index.get(image_id)
        if entry:
            return entry
        raise HTTPException(404, f"Image not found: {image_id}")

    def get_image_ref(self, image_id: str, size: int = 384) -> ImageRef:
        entry = self._entry(image_id)
        exists = entry.source_path.exists() and entry.source_path.is_file()
        return ImageRef(
            image_id=entry.image_id,
            filename=entry.filename,
            width=entry.width,
            height=entry.height,
            exists=exists,
            thumbnail_url=f"{self.api_prefix}/jobs/{self.job_id}/images/{entry.image_id}/thumbnail?size={size}" if exists else None,
            original_url=f"{self.api_prefix}/jobs/{self.job_id}/images/{entry.image_id}/original" if exists else None,
            missing_reason=None if exists else "source file missing",
        )

    def get_all_image_refs(self, size: int = 384) -> list[ImageRef]:
        return [self.get_image_ref(entry.image_id, size=size) for entry in self.entries]

    def get_source_path(self, image_id: str) -> Path:
        entry = self._entry(image_id)
        if not entry.source_path.exists() or not entry.source_path.is_file():
            raise HTTPException(404, "source file missing")
        return entry.source_path

    def get_original_response(self, image_id: str) -> Response:
        src = self.get_source_path(image_id)
        return Response(
            content=src.read_bytes(),
            media_type=mimetypes.guess_type(str(src))[0] or "application/octet-stream",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    def get_thumbnail_response(self, image_id: str, size: int) -> Response:
        src = self.get_source_path(image_id)
        cache_path = self.layout.thumbnail_size_dir(size) / f"{self._safe_cache_stem(image_id)}.jpg"
        if cache_path.exists() and cache_path.stat().st_mtime >= src.stat().st_mtime:
            return Response(content=cache_path.read_bytes(), media_type="image/jpeg")
        try:
            from PIL import Image
        except ImportError:
            return self.get_original_response(image_id)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(src) as img:
            img.thumbnail((size, size))
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            import io
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85 if size <= 512 else 78)
            cache_path.write_bytes(buf.getvalue())
            return Response(
                content=buf.getvalue(),
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=86400"},
            )

    @staticmethod
    def _safe_cache_stem(image_id: str) -> str:
        return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in image_id)[:160] or "image"
