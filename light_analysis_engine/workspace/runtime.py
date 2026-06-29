from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from fastapi import HTTPException

from .compatibility import resolve_output_root
from .export_resolver import ExportResolver
from .image_index import ImageIndex, load_image_index
from .layout import WorkspaceLayout
from .manifest import JobManifest, load_job_manifest
from .media_resolver import MediaResolver


class JobWorkspaceRuntime:
    def __init__(self, job_id: str, output_root: str | Path):
        self.job_id = job_id
        self.layout = WorkspaceLayout.from_output_root(output_root)
        self.manifest = load_job_manifest(self.layout, job_id=job_id)
        self.image_index = load_image_index(self.layout, self.manifest)
        self.media = MediaResolver(job_id, self.layout, self.image_index.entries)
        self.exports = ExportResolver(job_id, self.layout, self.media)

    @classmethod
    def for_job_id(cls, job_id: str) -> "JobWorkspaceRuntime":
        root = resolve_output_root(job_id)
        if not root:
            raise HTTPException(404, f"Job output not found: {job_id}")
        return cls(job_id, root)

    def manifest_json(self) -> dict:
        return self.manifest.to_json()

    def images_json(self, size: int = 384) -> dict:
        return {"images": [ref.to_json() for ref in self.media.get_all_image_refs(size=size)]}

    def clusters_json(self, size: int = 384) -> dict:
        rows = self._load_organized_rows()
        catalog = self._load_cluster_catalog()
        by_cluster: dict[str, list[str]] = {}
        for row in rows:
            cid = str(self._parse_cluster_id(row.get("cluster_id", -1)))
            image_id = str(row.get("image_id") or "")
            if not image_id:
                image_id = ImageIndex(self.image_index.entries).get(str(row.get("image_path") or row.get("filename") or "")) or None
                image_id = image_id.image_id if image_id else ""
            if not image_id:
                from .image_index import stable_image_id
                image_id = stable_image_id(row.get("image_path") or row.get("filename") or "")
            by_cluster.setdefault(cid, []).append(image_id)
        cluster_ids = set(by_cluster) | set(catalog)
        clusters = []
        for cid in sorted(cluster_ids, key=lambda v: self._parse_cluster_id(v)):
            image_ids = by_cluster.get(cid, [])
            info = catalog.get(cid, {})
            title = info.get("display_name") or info.get("suggested_name") or ("noise" if cid == "-1" else f"Cluster {cid}")
            refs = []
            for image_id in image_ids:
                try:
                    refs.append(self.media.get_image_ref(image_id, size=size).to_json())
                except HTTPException:
                    continue
            clusters.append({
                "cluster_id": cid,
                "id": cid,
                "title": title,
                "name": title,
                "count": len(image_ids),
                "image_ids": image_ids,
                "images": refs,
                "color": self._cluster_color(cid),
                "confidence": info.get("confidence", 0),
                "suggested_name": info.get("suggested_name", title),
            })
        return {"clusters": clusters}

    def _load_organized_rows(self) -> list[dict]:
        try:
            from studio.api.organize_state import load_organized_rows
            return load_organized_rows(self.layout.output_root)
        except Exception:
            return []

    def _load_cluster_catalog(self) -> dict[str, dict]:
        try:
            from studio.api.organize_state import load_cluster_catalog
            return load_cluster_catalog(self.layout.output_root)
        except Exception:
            return {}

    @staticmethod
    def _parse_cluster_id(value) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return -1

    @staticmethod
    def _cluster_color(cid: str) -> str:
        colors = ["#46f1c5", "#ffd93d", "#ff6b9d", "#78d6ce", "#bc99ff", "#ff9b6b", "#6bcb77", "#ffa3d2"]
        try:
            value = abs(int(cid))
        except ValueError:
            value = 0
        return "#404040" if cid == "-1" else colors[value % len(colors)]


def get_workspace_runtime(job_id: str) -> JobWorkspaceRuntime:
    return JobWorkspaceRuntime.for_job_id(job_id)
