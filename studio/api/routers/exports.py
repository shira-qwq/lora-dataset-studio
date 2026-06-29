"""Exports router — create and download export manifests/sets.

For V1, exports are lightweight CSV manifests listing selected images.
In a full Studio implementation this would spawn background jobs.
"""

from __future__ import annotations

import csv
import io
import json
import shutil
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from studio.api.organize_state import load_organized_rows, parse_cluster_id, read_json

router = APIRouter(prefix="/exports", tags=["exports"])

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent

# In-memory export store (volatile)
_exports: Dict[str, dict] = {}


def _resolve_job_dir(job_id: str) -> Optional[Path]:
    """Resolve a job_id to its output directory (multi-root scan)."""
    # 1. jobs.py 内存状态
    try:
        import studio.api.routers.jobs as jobs_mod
        state = jobs_mod._jobs.get(job_id) or {}
        out = state.get("config", {}).get("output_folder") or state.get("output_folder")
        if out:
            p = Path(out)
            if p.is_dir():
                return p
    except Exception:
        pass

    # 2. 磁盘扫描
    roots = [_PROJECT_ROOT, _PROJECT_ROOT.parent]
    for root in roots:
        candidates = [
            root / job_id,
            root / f"{job_id}_output_v7",
            root / f"{job_id}_output_v6",
            root / f"{job_id}_output",
        ]
        for c in candidates:
            if c.is_dir():
                return c
        for p in root.iterdir():
            if not p.is_dir():
                continue
            if p.name.startswith("test_") and job_id not in p.name:
                continue
            if job_id in p.name:
                return p
    return None


@router.post("")
async def create_export(body: dict):
    """Create an export manifest.

    Body:
    {
        "job_id": "写真test_output_v7",
        "selector": {"type": "by_cluster", "cluster_ids": ["0", "1"]},
        "format": "manifest",  // manifest | index
        "filename": "my_export"
    }
    """
    job_id = body.get("job_id", "")
    selector = body.get("selector", {})
    fmt = body.get("format", "manifest")
    filename = body.get("filename", f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}")

    if not job_id:
        raise HTTPException(422, "job_id is required")

    # Resolve output dir
    candidates = [
        _PROJECT_ROOT / job_id,
        _PROJECT_ROOT / f"{job_id}_output_v7",
        _PROJECT_ROOT / f"{job_id}_output",
    ]
    out_dir = None
    for c in candidates:
        if c.is_dir():
            out_dir = c
            break
    if not out_dir:
        raise HTTPException(404, f"Job output not found: {job_id}")

    all_points = load_organized_rows(out_dir)
    if not all_points:
        raise HTTPException(404, "atlas_points.csv not found")

    # Filter by selector
    sel_type = selector.get("type", "all")
    filtered = []
    if sel_type == "all":
        filtered = all_points
    elif sel_type == "by_cluster":
        cluster_ids = set(selector.get("cluster_ids", []))
        filtered = [p for p in all_points if str(p.get("cluster_id", "")) in cluster_ids]
    elif sel_type == "by_review":
        # Load reviews and filter
        reviews_path = out_dir / "reviews.json"
        flag = selector.get("flag")
        if reviews_path.exists():
            with open(reviews_path, encoding="utf-8") as f:
                reviews = json.load(f)
            flagged_filenames = set()
            for fn, rv in reviews.items():
                if flag is None or rv.get("flag") == flag:
                    flagged_filenames.add(fn)
            filtered = [
                p for p in all_points
                if Path(str(p.get("image_path", ""))).name in flagged_filenames
                or str(p.get("filename", "")) in flagged_filenames
            ]
        else:
            filtered = []
    else:
        filtered = all_points

    if not filtered:
        raise HTTPException(422, "Selector matched no images")

    # Generate export content
    export_id = f"exp_{uuid.uuid4().hex[:8]}"

    if fmt == "manifest":
        # JSON manifest
        manifest = {
            "export_id": export_id,
            "created_at": datetime.now().isoformat(),
            "job_id": job_id,
            "selector": selector,
            "total": len(filtered),
            "files": [
                {
                    "image_path": p.get("image_path", ""),
                    "cluster_id": parse_cluster_id(p.get("cluster_id", -1)),
                    "cluster_name": p.get("cluster_name", ""),
                    "umap_x": float(p.get("umap_x", 0)),
                    "umap_y": float(p.get("umap_y", 0)),
                }
                for p in filtered
            ],
        }
        _exports[export_id] = {"id": export_id, "status": "completed", "format": fmt,
                                "total": len(filtered), "created_at": manifest["created_at"]}
        return {"export_id": export_id, "status": "completed", "total": len(filtered),
                "manifest": manifest}

    elif fmt == "index":
        # CSV index
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["image_path", "cluster_id", "cluster_name", "umap_x", "umap_y", "umap_z"])
        for p in filtered:
            writer.writerow([
                p.get("image_path", ""),
                parse_cluster_id(p.get("cluster_id", -1)),
                p.get("cluster_name", ""),
                p.get("umap_x", "0"),
                p.get("umap_y", "0"),
                p.get("umap_z", "0"),
            ])
        csv_content = output.getvalue()

        _exports[export_id] = {"id": export_id, "status": "completed", "format": fmt,
                                "total": len(filtered), "created_at": datetime.now().isoformat()}

        return StreamingResponse(
            iter([csv_content]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=\"{filename}.csv\""}
        )

    return {"export_id": export_id, "status": "completed", "total": len(filtered)}


@router.get("")
async def list_exports():
    """List all known exports."""
    return {"exports": list(_exports.values())}


@router.get("/{export_id}")
async def get_export(export_id: str):
    """Get export status."""
    exp = _exports.get(export_id)
    if not exp:
        raise HTTPException(404, f"Export not found: {export_id}")
    return exp


@router.post("/copy-by-cluster")
async def copy_by_cluster(body: dict):
    """Copy images into per-cluster directories on disk.

    RELEASE-002R: exports to <output_root>/exports/<export_name>/

    Body:
    {
        "export_name": "整理画板_001",
        "include_user_moves": true
    }
    """
    from light_analysis_engine.workspace import JobWorkspaceRuntime, get_workspace_runtime
    from light_analysis_engine.workspace.image_index import stable_image_id
    from ..path_resolver import resolve_output_root, unique_filename, sanitize_filename, sanitize_filename

    job_id = body.get("job_id", "")
    include_moves = body.get("include_user_moves", True)
    if not job_id:
        raise HTTPException(422, "job_id is required")

    try:
        runtime = get_workspace_runtime(job_id)
    except HTTPException:
        old_job_dir = _resolve_job_dir(job_id)
        if not old_job_dir:
            raise
        runtime = JobWorkspaceRuntime(job_id, old_job_dir)
    output_root = runtime.layout.output_root
    job_dir = output_root

    all_points = load_organized_rows(job_dir)
    if not all_points:
        raise HTTPException(422, "atlas file is empty")

    if not include_moves:
        for point in all_points:
            point["cluster_id"] = parse_cluster_id(point.get("original_cluster_id", point.get("cluster_id", -1)))
            point["cluster_name"] = point.get("original_cluster_name") or point.get("cluster_name") or ""

    export_name = body.get("export_name") or sanitize_filename("整理画板", fallback="organize")
    # Build export path directly under output_root/exports/
    exports_base = runtime.layout.exports_dir
    exports_base.mkdir(parents=True, exist_ok=True)
    candidate = exports_base / export_name
    if not candidate.exists():
        export_dir = candidate
    else:
        for i in range(1, 1000):
            candidate = exports_base / f"{export_name}_{i:03d}"
            if not candidate.exists():
                export_dir = candidate
                break
        else:
            export_dir = exports_base / f"{export_name}_{999:03d}"
    export_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    exported = 0
    cluster_counts: Dict[str, int] = {}
    cluster_folders: Dict[str, str] = {}
    failed: list = []
    manifest_items: list = []

    def _sanitize(name: str) -> str:
        return "".join(c if c.isalnum() or c in "-_." else "_" for c in name).strip("_")[:80]

    for p in all_points:
        cid_str = str(parse_cluster_id(p.get("cluster_id", -1)))

        if cid_str == "-1" or cid_str == "noise":
            folder_name = "noise"
        else:
            cluster_name = str(p.get("cluster_name") or f"cluster_{cid_str}")
            folder_name = _sanitize(cluster_name) or f"cluster_{cid_str}"
            if folder_name in cluster_folders.values() and cluster_folders.get(cid_str) != folder_name:
                folder_name = f"{folder_name}_{cid_str}"

        cluster_folders[cid_str] = folder_name
        cluster_dir = export_dir / folder_name
        cluster_dir.mkdir(parents=True, exist_ok=True)

        img_rel = (p.get("image_path") or p.get("filename") or "").replace("\\", "/")
        if not img_rel:
            continue
        image_id = p.get("image_id") or stable_image_id(img_rel)
        try:
            src = runtime.media.get_source_path(str(image_id))
        except HTTPException:
            failed.append({"image_id": image_id, "image": img_rel, "reason": "source not found"})
            continue

        # Use unique_filename to avoid conflicts
        dst = unique_filename(cluster_dir / Path(img_rel).name)
        try:
            shutil.copy2(src, dst)
            exported += 1
            cluster_counts[folder_name] = cluster_counts.get(folder_name, 0) + 1
            manifest_items.append({
                "source_path": str(src),
                "source_path_rel": _try_relpath(str(src), str(output_root)),
                "export_path": str(dst),
                "export_path_rel": _try_relpath(str(dst), str(output_root)),
                "cluster_id": cid_str,
                "cluster_name": folder_name,
                "original_filename": Path(img_rel).name,
                "export_filename": dst.name,
            })
        except Exception as e:
            failed.append({"image": img_rel, "reason": str(e)})

    duration = time.time() - start

    # Write export record to _studio/export_records/ (not in export dir)
    export_id = f"organize_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    record = {
        "version": 2,
        "export_id": export_id,
        "job_id": job_id,
        "export_type": "organize",
        "created_at": datetime.now().isoformat(),
        "output_root": str(output_root),
        "export_name": export_name,
        "export_dir": str(export_dir),
        "export_dir_rel": _try_relpath(str(export_dir), str(output_root)),
        "include_user_moves": include_moves,
        "exported_count": exported,
        "failed_count": len(failed),
        "cluster_count": len(cluster_counts),
        "cluster_counts": cluster_counts,
        "items": manifest_items,
        "failed": failed[:20],
    }
    # Write record directly
    try:
        records_dir = runtime.layout.export_records_dir
        records_dir.mkdir(parents=True, exist_ok=True)
        with open(records_dir / f"{export_id}.json", "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)
    except OSError:
        pass

    result = {
        "ok": True,
        "export_id": export_id,
        "export_dir": str(export_dir),
        "output_dir": str(export_dir),  # backward compat
        "export_dir_rel": _try_relpath(str(export_dir), str(output_root)),
        "exported_count": exported,
        "failed_count": len(failed),
        "cluster_count": len(cluster_counts),
        "cluster_counts": cluster_counts,
        "duration_sec": round(duration, 2),
        "failed": failed[:20],
    }
    return result


def _try_relpath(path: str, base: str) -> str:
    try:
        return str(Path(path).relative_to(Path(base)))
    except (ValueError, OSError):
        return path
